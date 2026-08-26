# Reso — notes pour l'agent

## Le SDK est volontairement figé à 54

Ce projet a été **rétrogradé de SDK 57 à SDK 54 le 2026-08-22**, et doit y
rester : l'iPhone de test ne peut installer qu'Expo Go **54.0.2** (l'App Store
n'y propose aucune version plus récente). Un projet en SDK 57 y affiche
« Project is incompatible with this version of Expo Go » et refuse de démarrer.

**Ne remonte pas le SDK** sans que le besoin d'Expo Go ait disparu — ce qui
suppose un *development build*, donc un Mac ou EAS Build.

Lis les docs à la version du projet, pas `latest` :
https://docs.expo.dev/versions/v54.0.0/

Conséquences déjà traitées, à ne pas défaire :
- `expo-image` n'expose **pas** de config plugin en SDK 54 : il ne doit pas
  figurer dans `plugins` d'`app.json`, sinon le démarrage échoue.

## Le piège audio qui a coûté un extrait sur deux

`createAudioPlayer` charge de façon asynchrone, et **`play()` sur un lecteur
dont `isLoaded` est encore faux ne fait rien** — aucune erreur, aucune
exception, et la lecture ne démarre jamais, même une fois le chargement
terminé.

Précharger ne suffit pas : cela ne fait que *lancer* le chargement. Il faut
attendre `isLoaded` (voir `awaitLoaded` dans `src/audio/player.ts`).

`seekTo()` rend une **promesse**. L'appeler sans l'attendre laisse le
repositionnement se terminer après le `play()` et annuler la lecture.

## Le son qui part une seconde, revient une seconde

Signalé le 2026-08-23, **deux fois**. La seconde reprise a montré que le
diagnostic initial était en partie faux ; ce qui suit remplace l'ancien.

### Ce que fait vraiment le module natif (lu dans `node_modules/expo-audio/ios`)

Trois comportements gouvernent tout, et aucun n'est documenté côté JS :

1. **`pause()` programme la coupure de la session audio partagée cent
   millisecondes plus tard** (`AudioModule.swift`, `deactivateSession`). Elle
   n'est annulée que si un lecteur est déjà passé à
   `timeControlStatus == .playing`. Or on met en pause la carte qu'on quitte et
   on lance la suivante dans la même milliseconde, et AVPlayer traverse d'abord
   `waitingToPlayAtSpecifiedRate` — le temps d'activer la session et de monter
   la route audio. **Dès que ce délai dépasse cent millisecondes, la session est
   coupée sous une carte qui venait de commencer.** Le son s'arrête, `sustain`
   le voit deux relevés plus tard et relance, et le son revient.
   → tous les lecteurs sont créés avec **`keepAudioSessionActive: true`**, et la
   session est rendue explicitement dans `suspend()` et `release()`.

2. **`remove()` ne fait que désinscrire le lecteur du registre natif**
   (`Function("remove")` → `registry.remove`). Il ne l'arrête pas. Un lecteur
   jeté en pleine lecture continue donc de jouer, et plus personne ne tient sa
   référence pour l'interrompre. → `suspend()` et `release()` mettent en pause
   avant de jeter.

3. **`downloadFirst: true` ne crée pas le lecteur avec sa source.** Il le crée
   *vide*, télécharge le fichier en entier, puis lui donne l'extrait local
   (`ExpoAudio.js` / `resolveSource.ts`). **Donc `isLoaded` veut bien dire « tout
   est arrivé »** — l'inverse de ce que ce document affirmait. C'est vrai en
   streaming, faux ici.

### Les deux fautes côté app

**Le garde-fou du préchargement ne gardait rien.** `sustain` partait de
`last = -1` alors que `currentTime` rend **zéro** tant qu'aucun extrait n'est
chargé. Le tout premier relevé concluait donc que le son avait avancé — de `-1`
à `0` — et la mise en attente du préchargement, dont `player.ts` fait toute une
affaire, ne retardait rien : elle expirait cent cinquante millisecondes après
chaque `play()`, quoi qu'il arrive.

**`keepOnly` lisait une carte périmée.** `play()` ne prenait `currentId` qu'après
son premier `await`, alors que React enchaîne l'effet `[topId]` et l'effet
`[state.cards]` sans laisser passer la moindre promesse. `keepOnly` épargnait
donc le lecteur de la carte quittée et jetait celui d'une carte à venir :
**quatre pipelines de décodage vivants là où trois est le maximum**, et c'est
au-delà de trois qu'iOS en coupe un au hasard.

### Ce qui a changé

- `keepAudioSessionActive: true` sur tous les lecteurs (règle 1 ci-dessus).
- `play()` prend `currentId`/`currentTrack` et coupe le précédent **avant** son
  premier `await`.
- `sustain` part de la position réelle.
- La condition qui libère le préchargement n'est plus « le titre courant a du
  son » mais **« son extrait est entièrement téléchargé »**. L'ancienne se
  bloquait : sur un réseau où une carte n'arrive jamais à sonner avant le swipe
  suivant, la file n'était plus jamais vidée, donc rien n'était plus jamais
  préparé, donc plus aucune carte n'arrivait à sonner.
- **Les extraits se préparent un par un.** Deux téléchargements simultanés ne
  vont pas deux fois plus vite, ils vont chacun deux fois moins vite : la carte
  suivante arrivait deux fois trop tard alors que seule sa voisine avait besoin
  d'attendre.
- `awaitLoaded` relève périodiquement au lieu de n'écouter que le statut : **un
  lecteur en cours de téléchargement n'émet rien**, donc le garde-fou de
  génération ne se déclenchait jamais et une préparation restait accrochée à une
  carte déjà quittée pendant huit secondes.

**À ne pas défaire :** ne jamais relancer ni reconstruire un lecteur en
bufferisation ; ne jamais précharger avant que l'extrait à l'écran soit arrivé ;
ne jamais laisser un lecteur rendre la session audio.

## Plus de son au douzième titre (Android)

Signalé sur appareil le 2026-08-23 : le son s'arrête après une douzaine de
titres, sans erreur, et seul un redémarrage de l'app le ramène.

**`remove()` ne libère pas le décodeur.** Côté Android il se contente de retirer
l'entrée de la map du module :

```kotlin
Function("remove") { player: AudioPlayer -> players.remove(player.id) }
```

L'ExoPlayer sous-jacent, lui, n'est détruit qu'au `sharedObjectDidRelease` —
c'est-à-dire **quand le ramasse-miettes JS finit par passer sur l'objet**. Or
chaque ExoPlayer retient un `MediaCodec`, et Android en plafonne le nombre par
processus. Le fil jette un lecteur par carte swipée : au douzième, plus aucun
décodeur n'est disponible.

`release()`, hérité de `SharedObject`, détache l'objet JS de son homologue natif
immédiatement et déclenche donc `ref.release()` sans attendre le ramasse-miettes.
C'est **la seule chose qui rende un décodeur**. D'où `rendre(p)` dans
`player.ts`, utilisé par `discard`, `keepOnly`, `suspend` et `release`.

**L'ordre compte : pause, puis `remove`, puis `release`.** La pause parce qu'un
lecteur abandonné en pleine lecture continue de jouer (règle 2 de la section
audio ci-dessus) ; `remove` avant `release` parce qu'après détachement, passer
l'objet à une fonction native lève.

**Corollaire à ne pas défaire : après `release()`, l'objet est mort.** Lire
n'importe laquelle de ses propriétés lève une exception. Trois endroits lisent
un lecteur de façon asynchrone et doivent donc se protéger — `awaitLoaded`,
`sustain` et `probe`. Sans ces gardes, corriger la fuite **fait planter l'app** :
une préparation en vol vise très facilement un lecteur qu'on vient de jeter.
C'est le banc qui l'a montré, pas la relecture.

### Ce que le banc ne voyait pas, et pourquoi

`lecteursVivants()` rendait `registre.size`, c'est-à-dire la taille de la map du
module — que `remove()` vide. **La règle B mesurait donc exactement la seule
chose que le défaut ne touchait pas**, et restait verte pendant qu'Android
accumulait les décodeurs. Elle compte maintenant les lecteurs réellement
vivants, que seul `release()` fait disparaître.

Le faux module modélise désormais les deux méthodes séparément, et **lève sur
tout accès à un objet rendu**, comme le socle. Vérifié en retirant le correctif :

```
ECHEC  wifi du bureau      B. 11 lecteurs vivants a la fois (3 au plus)
ECHEC  demarrage lent      B. 11 lecteurs vivants a la fois (3 au plus)
ECHEC  reseau mobile       B. 11 lecteurs vivants a la fois (3 au plus)
ECHEC  mobile + lent       B. 11 lecteurs vivants a la fois (3 au plus)
```

Onze décodeurs là où trois est le maximum — l'ordre de grandeur du symptôme.

## Le banc d'essai du fil — `npm run bench`

`bench/` rejoue une session de swipes contre `src/audio/player.ts` en ne simulant
qu'`expo-audio`, sur horloge virtuelle (instantané et déterministe). Le faux
module est calqué sur le code natif iOS livré dans `node_modules`, y compris la
coupure de session à cent millisecondes — c'est ce qui lui permet de voir des
défauts qu'aucune lecture de code ne montre.

Quatre réseaux, cinq règles :

| | |
|---|---|
| A | le son arrive vite, et ne se coupe pas |
| B | jamais plus de trois lecteurs vivants |
| C | rien ne se télécharge tant que l'extrait à l'écran n'est pas arrivé |
| D | un aller-retour par l'arrière-plan ramène le son |
| E | la session audio n'est jamais rendue pendant que le fil tourne |

**Le lancer après toute modification de `player.ts` ou de `useFeed.ts`.** Chaque
correction a été vérifiée en la retirant une par une : le banc redevient rouge.

## Le fil : la forme ne bouge pas, le plaisir se joue au relâchement

Deux passes le 2026-08-23, sur la même demande — « rends l'interface la plus
addictive possible », puis « comme TikTok ». **La seconde a été refusée et
annulée**, et c'est la leçon la plus utile de la journée.

### Ce qui a été essayé, refusé, et retiré

Un **fil paginé plein écran** : plus de carte ni de marge, la pochette suivante
visible en bas, le geste vers le haut rendu « gratuit » (passer au suivant sans
verdict) et « garder » déplacé à gauche. Verdict du user, en deux messages :
« je veux pas de swipe ou alors fais-le mieux, c'était bien avant », puis
« enlève le scroll pour revenir comme avant ».

**Ne pas y revenir.** Deux fautes distinctes, et la seconde compte plus :

- **Réattribuer des gestes déjà dans les doigts.** Refaire la forme d'un écran
  n'autorise pas à faire réapprendre son usage.
- **Le plein écran a produit un vide.** La pochette est carrée et l'écran ne
  l'est pas : affichée en `contain`, elle laisse la moitié basse de l'écran
  noire. La carte marginée en `cover` n'a jamais ce problème — c'est pour ça
  qu'elle marchait.

### La forme, donc, est celle d'avant — mais la carte est un objet

Pile de trois cartes, en-tête, barre d'action en pied de 128 px.

**La carte a la taille de son contenu**, elle ne remplit plus la scène : un
carré exact pour la pochette, entière, et dessous un cartel de hauteur fixe
(`CARTEL = 154`) qui porte le texte. Elle est centrée dans la scène. Ce n'est
pas une préférence de forme, c'est un défaut corrigé : **la carte étirée
recadrait la pochette en `cover` et en coupait près d'un tiers sur les côtés**,
dans une application dont on demande précisément de juger la pochette. C'est ce
qui donnait des cartes ternes — un bord d'image étiré sous un aplat noir — et le
user les a dites « moches ».

Le cartel a une hauteur **constante** : un titre sur une ligne et un titre sur
deux donneraient sinon deux cartes de hauteurs différentes, et la pile changerait
de forme à chaque swipe. Son fond est la pochette elle-même, floutée et voilée à
0,87 : un aplat gris sous une pochette colorée fait gabarit.

`cadreCarte(largeur, hauteur)` est **exportée** et utilisée aussi par l'écran :
c'est de ce carré-là que part le vol vers la trace. Recalculer la géométrie à
part garantirait qu'elle parte d'à côté le jour où la carte changera.
Gestes : **passer à gauche, j'aime à droite, garder en haut, appui long pour
bannir**. Seuils : `0,28 × largeur` en latéral, `130 px` en vertical, ou la
vitesse (`900`). En fin de geste, `haut && vertical` est testé avant
l'horizontal, pour que la sauvegarde ne vole pas un swipe franc.

### Ce qui a été ajouté : le moment de paiement

C'était le vrai manque, et il ne demandait aucun changement de disposition.
Les deux gestes qui produisent quelque chose n'avaient **rien au relâchement** :
la teinte du verdict suit le doigt, donc elle est déjà à son maximum quand on
lâche, et ensuite la carte part, c'est tout. Or c'est au lâcher que la décision
devient un fait.

- **L'éclat** : une bouffée de la couleur du verdict sur toute la carte, 80 ms
  de montée, 320 de retombée. **Jamais pour « passer »** — ce n'est pas une
  récompense, et lui en donner une reviendrait à dire que les trois se valent.
- **L'haptique du verdict** : `vibrer.aime()` (`Medium`) au lâcher d'un j'aime,
  `vibrer.garde()` (`Success`) **à l'atterrissage** du vol. Le cran du seuil
  (`vibrer.seuil()`, `Rigid`) reste ce qu'il était : il annonce pendant qu'on
  décide encore.
- **L'envol de la pochette vers la trace** (`Envol.tsx`). « Je garde » était le
  seul geste qui produit un objet, et l'objet n'allait nulle part : la carte
  sortait par le haut, une vignette apparaissait en haut à gauche au même
  instant — deux événements simultanés sans lien visible, donc deux événements
  qu'on ne relie pas.
- **La trace** (`Trace.tsx`) remplace le compteur « ↑ N gardés ». Le nombre
  était la bonne intuition — c'est le *taux* de récompense qui gouverne, et il
  ne se perçoit que rendu visible — mais un nombre est un score, il se compare.
  Des pochettes s'accumulent. À zéro elle apprend le geste, comme avant.
- **La lumière** : la pochette courante, floutée et débordante, éclaire tout
  l'écran derrière la carte et **respire sur 26 s** en `inOut`, sous le seuil de
  perception. Le fond était un aplat noir et la carte y flottait seule. Elle
  reste très en retrait (voile à 0,74) : la pochette nette doit rester la seule
  source de couleur.
- **La découverte se fait attendre.** Son texte arrive 190 ms après la pochette
  au lieu de 90, avec un peu plus de course et un haptique `Soft`
  (`vibrer.surprise()`) que rien d'autre ne déclenche. Un signal prévisible
  cesse d'être un signal ; c'est ce décalage qui empêche l'arrivée de devenir un
  métronome.
- **Les glyphes typographiques `✕ ↑ ♥` ont disparu** de la barre et des
  verdicts, au profit de `IconeCroix` / `IconeGarder` / `IconeCoeur` — même
  grille de 24 et même épaisseur que les icônes d'onglets. Trois caractères de
  trois graisses côte à côte dans trois cercles identiques, ça se voit.

### Ce que la recherche donne d'exploitable

- **Salimpoor et coll., *Nature Neuroscience* 2011** : sur la musique, la
  dopamine est libérée *avant* le pic de plaisir (noyau caudé), pas pendant
  (accumbens). C'est ce qui justifie l'arrivée en deux temps — pochette, puis
  texte au moment où le son sort.
- **Lindström et coll., *Nature Communications* 2021** : c'est le *taux* de
  récompense qui gouverne, d'où la trace.
- Le versant calme (GABA / ASMR) : mouvement lent et continu sous le seuil de
  perception, aucun blanc pur, aucun ressort qui rebondit — d'où la respiration
  de la lumière, et pas une animation de plus.

### Ce que le fil ne fait toujours pas

Aucune série à ne pas rompre, aucun objectif quotidien, aucun compte à rebours,
aucun point de sortie supprimé. Une série transforme l'envie de revenir en peur
de perdre, et ce jour-là l'app cesse d'être un plaisir : c'est ce qui la fait
désinstaller, pas ce qui la fait garder. La ligne est **engagement oui,
compulsion non**, et elle a été annoncée au user à chaque passe.

### Trois défauts trouvés sur appareil, et leur cause

- **Deux verdicts s'affichaient en même temps.** Chaque voile lisait son propre
  axe, donc tirer vers le haut en dérivant de vingt pixels montrait « JE GARDE »
  et « J'AIME » ensemble, à deux forces différentes. Ils lisent maintenant
  **l'axe dominant, avec exactement la règle qui tranche au lâcher**
  (`|dy| > |dx|`). Les deux doivent rester identiques : sinon la carte annonce
  autre chose que ce qu'elle va faire.
- **L'envol vers la trace sautait.** Pour garder, il faut avoir tiré la carte de
  130 px vers le haut ; le vol, lui, partait de la position de **repos** de la
  carte. `onVerdict` porte donc maintenant le déplacement du doigt au lâcher, et
  l'envol part de là. Corollaire : sur « garder », la carte **ne s'envole plus
  hors de l'écran** — elle s'efface sur place en 140 ms et la pochette prend le
  relais. Deux mouvements concurrents partant de deux endroits, c'était la
  moitié du défaut.
- **Le verdict était l'élément le plus bruyant de l'écran.** Un liseré de 3 px
  autour de la carte entière, un glyphe de 72 px et un mot en capitales
  espacées, en pleine saturation, cinquante fois par séance. C'est maintenant un
  voile teinté et une pastille sombre posée sur la pochette. Ce qui ne change
  pas : elle **grossit avec le déplacement**, et c'est ce qui rend le geste
  corrigeable à vue.

### Deux pièges de mise en œuvre

- **Le vol interrompu est posé immédiatement.** Deux « je garde » enchaînés plus
  vite que les 430 ms du vol remplaceraient sinon la première pochette par la
  seconde, et la première ne serait jamais comptée — elle disparaîtrait de la
  trace sans que rien ne le dise. D'où la référence `volEnCours` en plus de
  l'état.
- **`Envol` met son origine de transformation en haut à gauche.** C'est ce qui
  rend le vol adressable : sans elle, réduire l'échelle déplace aussi le coin et
  la cible se dérobe.
- **Aucun padding sur la vue racine du fil.** En React Native, un enfant en
  position absolue se place par rapport à la **boîte de padding** du parent : un
  `paddingTop: insets.top` sur l'écran décalerait `Lumiere` et `Envol` d'une
  hauteur de zone sûre. Les marges de zone sûre vivent donc dans l'en-tête et le
  pied.

`npm run bench` reste vert et `tsc` passe : ni `player.ts` ni `useFeed.ts` n'ont
été touchés. **Le vol vers la trace et l'éclat n'ont pas encore été vus sur
appareil.**

## Les featurings ne sont pas dans le titre

Signalé le 2026-08-23 : « il manque le nom des gens en feat ». Ils n'étaient
nulle part, et ce n'était pas un problème d'affichage.

**`/artist/top` et `/artist/radio` rendent « Rich Baby Daddy »**, jamais « Rich
Baby Daddy (feat. Sexyy Red & SZA) ». Les invités vivent dans **`contributors`**,
avec un `role` (`Main` / `Featured`).

Deux pièges mesurés sur l'API :

- **`/artist/radio` ne renvoie aucun `contributors`.** `/artist/top` et
  `/track/{id}` si. La radio étant la première source de candidats, une bonne
  partie des cartes n'a l'information que si `Feed.refresh` est allé chercher la
  fiche complète pour re-signer l'extrait — ce qu'il fait souvent, mais pas sur
  un lot fraîchement récupéré.
- **`(Album Version)` et `(Explicit Version)` ne sont pas des featurings.**
  Deezer en met partout ; toute lecture du titre doit les écarter.

`Track.featuring` porte donc les invités, remplis depuis `contributors` quand ils
sont là, à défaut lus dans le titre. `encodeTrack` les re-sérialise : sans ça un
titre relu depuis le cache de six heures les perdrait, donc la plupart les
perdraient. Côté app, le titre est **épluché dans tous les cas** — certaines
fiches portent « (feat. X) » dans le libellé, et il ne doit pas s'afficher deux
fois.

**Réserve, non traitée :** rendre les featurings exhaustifs demanderait d'aller
chercher `/track/{id}` pour les douze cartes de chaque lot, soit une douzaine
d'appels Deezer de plus — environ 1,3 s au rythme de `Deezer.Espacement`. Comme
les lots suivants sont préchargés en tâche de fond, ce coût serait invisible
partout sauf au tout premier lot d'une session. C'est un arbitrage à trancher,
pas un oubli.

## Vérifier une modification du son

Les `console.log` de l'app remontent dans la sortie de `npx expo start`. Pour
juger si le son part réellement, ne te fie pas à `player.playing` — il est mis
à jour de façon asynchrone et vaut `false` juste après `play()` même quand tout
va bien. Le seul témoin fiable est **`currentTime` qui avance**, mesuré ~1 s
après.

## Le quota Deezer, et le cache qui s'empoisonnait tout seul

Diagnostic du 2026-08-23, à partir des journaux du VPS. Deux fautes qui se
nourrissaient l'une l'autre :

**1. La simultanéité n'est pas un débit.** `Deezer.MaxInFlight = 6` bornait le
nombre d'appels *en vol*, pas leur *cadence* : six appels à ~130 ms font une
quarantaine de requêtes par seconde, quand Deezer en tolère une dizaine
(≈ 50 par tranche de 5 s). Résultat mesuré : **28 réponses 403** en rafale,
`/artist/N/top` et `/artist/N/radio` — et aussi `/track/…`, donc des extraits
muets en plus des cartes manquantes.

**2. Un appel raté était mis en cache.** `cachedTracks` écrivait ce que le
`fetch` rendait, y compris la liste vide produite par un 403. Un incident de
quota décrétait donc qu'un artiste n'avait **aucun titre pendant 3 jours**
(`TopTtlSec`), ou **aucun voisin pendant 14 jours** (`RelatedTtlSec`).

Le cliquet : moins de candidats → `MinFresh` non atteint → `widen` →
davantage d'appels → plus de quota → plus d'entrées empoisonnées. L'app
ralentissait un peu plus à chaque incident **sans jamais se rétablir seule**.
109 entrées empoisonnées ont été trouvées et supprimées (105 listes de titres,
4 voisinages).

Corrections, à ne pas défaire :

- `Deezer.Espacement` (110 ms) est **la seule chose qui borne le débit**. Ne
  pas le retirer en croyant que `MaxInFlight` suffit.
- `get` rend `Option[Json]` : `None` = appel inexploitable. **Ne jamais mettre
  un `None` en cache.** La distinction entre « Deezer dit qu'il n'y a rien » et
  « l'appel a échoué » est tout le sujet.
- Les erreurs Deezer sont journalisées (`[deezer] chemin -> code`). Elles
  étaient totalement muettes, ce qui rendait la lenteur indiagnostiquable.

Effet mesuré, chemin entièrement froid (42 artistes absents du cache) :

| | avant | après |
|---|---|---|
| `/feed/next` | 9 181 / 14 174 / 20 014 ms | 2 542 ms au pire |
| `/profile` | 8 645 ms | — |
| 20 lots d'affilée | quota explosé | 23 s, **zéro 403** |

## Le rejeu du profil coûtait trente-six secondes de calcul

Signalé le 2026-08-23 : « Prisme ne répond pas — /feed/next n'a pas répondu en
20 s ». **La première hypothèse était fausse**, et elle mérite d'être racontée
parce que c'est la façon dont on s'est trompé qui a coûté le temps.

Le journal montrait des lots à 15-23 s entrelacés avec des lots à 1-2 s, et zéro
erreur Deezer. Raisonnement plausible : la cadence vers Deezer est bridée à un
appel toutes les 110 ms, donc un lot élargi (`Feed.widen`, qui va chercher le 2ᵉ
degré du graphe) coûterait ~180 appels, soit vingt secondes. Un budget a été posé
sur l'élargissement — utile, mais **sans rapport avec le défaut**.

Ce qui a tranché, c'est d'avoir instrumenté au lieu de raisonner. La ligne
`[lot]` a immédiatement montré `elargi=non dz=8 en 35907 ms` : **huit appels
réseau, trente-six secondes**. Ce n'était pas le réseau, c'était du calcul.

### La vraie cause

`Replay.rebuild` refait le profil à partir de **toute** l'histoire, et la clé de
son cache porte le nombre de faits — donc **un seul swipe suffit à tout
refaire**, à chaque requête. Ce rejeu appelle `Facets.rebuild` à chaque artiste
aimé encore inconnu, soit sur une histoire réelle les trois quarts des
événements. Et `Facets.cluster` est cubique :

- il recalculait **tous** les couples de groupes à chaque tour de fusion ;
- chacun de ces centaines de milliers de calculs de similarité **reconstruisait
  deux ensembles de voisins** à partir des mêmes listes ;
- et il indexait ses groupes dans une `List` (`groups(i)` est linéaire), au cœur
  d'une boucle en O(g²).

Mesuré sur le moteur déployé, même scénario avant et après :

| swipes rejoués | avant | après |
|---|---|---|
| 48 | 1 977 ms | 586 ms |
| 84 | 8 399 ms | 959 ms |
| 120 | 20 138 ms | 772 ms |
| 156 | **35 907 ms** | **437 ms** |

Le coût explosait avec l'histoire ; il est maintenant plat.

### Les trois corrections, toutes à résultat identique

- **La table des similarités est calculée une fois** par regroupement, au lieu
  d'une fois par couple de groupes et par tour.
- **Le lien moyen se fusionne exactement** : joindre A et B donne, vers C,
  `(|A|·lien(A,C) + |B|·lien(B,C)) / (|A|+|B|)`. Aucune raison de reparcourir
  tous les couples d'artistes à chaque tour.
- **L'intersection est comptée, pas construite** : `na & nbs` et `na | nbs`
  allouaient deux ensembles pour n'en lire que la taille. L'union se déduit.

Un test compare `Facets.cluster` à une implémentation naïve sur quarante graphes
tirés au sort et exige l'égalité **exacte** : ces optimisations ne doivent jamais
changer une recommandation. Un second test borne le coût d'un rejeu de 300
swipes, pour que la complexité ne puisse pas réapparaître en silence.

### Ce qui reste en place, et pourquoi

- `Tuning.ElargissementBudgetMs` (7 s) borne l'élargissement facette par facette.
  Ce n'était pas la cause, mais c'est un garde-fou juste : l'élargissement est un
  bonus, et le sacrifier rend une file plus courte là où le garder rendrait un
  écran d'erreur. On n'interrompt jamais une facette commencée.
- **`[lot]` et `[rejeu]` sont la vraie leçon.** `[lot] … dz=N en N ms (profil=…
  voisins=… vivier=… elarg=… extraits=…)` et `[rejeu] … artistes=N faits=N dz=N`.
  Sans `dz=`, réseau et calcul sont indiscernables — et c'est exactement là qu'on
  s'est trompé. **Regarder `dz=` avant de toucher au modèle.**
- Côté app, `REFILL_AT` passe de 4 à 6 cartes : le seuil est une durée déguisée,
  et quatre cartes valent moins que le délai d'abandon du client.

### Une réserve, non traitée

`tools/simulate.py` appelait `/profile/<user>`, route disparue avec l'arrivée de
la connexion au réseau G — la simulation était donc **cassée depuis ce
chantier-là** et n'a rien validé entre-temps. Réparée (l'affichage du profil est
devenu facultatif, le verdict n'en dépendait pas), elle rend maintenant « pas
d'apprentissage net » : part de rap 50 % → 17 %, là où la référence notée était
36 % → 53 %. **Ce n'est pas dû aux optimisations ci-dessus** — le test
d'équivalence exacte l'exclut. À instruire séparément ; attention en le faisant
au fait que l'univers rap de référence ne compte que cinquante artistes, quand la
simulation sert cent vingt cartes : l'anti-répétition seule peut expliquer une
part de rap qui décroît.

## Le vivier s'epuisait, et le fil devenait mediocre en vieillissant

Signale le 2026-08-25 : « l'algo est moins bon qu'au debut ». Ce n'etait pas une
impression, et la cause n'etait ni le modele ni le reseau.

### Ce que le journal montrait

Taille du vivier de candidats, compte de 2440 faits, par tranches de 40 lots :

| lots | vivier moyen |
|---|---|
| 1-40 | **608** |
| 81-120 | 429 |
| 161-200 | 223 |
| 241-280 | 158 |
| 321-332 | **43** |

Decroissance **monotone**. Un compte de 79 faits reste plat a ~500 sur la meme
periode, et le journal ne porte **aucune erreur `[deezer]`** : ce n'est ni le
quota ni le reseau, c'est l'anciennete du profil.

A 43 candidats pour douze cartes, **le moteur ne choisit plus** — il sert ce qui
reste. Tout le classement (collaboratif, proximite de facette, decouverte)
s'applique a un fond de tiroir. C'est la forme que prend « moins bon qu'avant ».

### La cause, en arithmetique

`artistTop` appelait `/artist/{id}/top?limit=12` **sans `index`**, mis en cache
trois jours. Mesure sur l'API le 2026-08-25 : ce point d'entree annonce
**`total: 100`** et honore `index` — `index=12` rend douze AUTRES titres. On
lisait donc **douze pour cent** du catalogue accessible.

Chaque ancre exposait ainsi 20 voisins x 12 titres = **240 titres,
definitivement**. Chaque lot tire six voisins sur vingt : une vingtaine de
tirages d'une ancre couvre tous ses voisins, et les ancres lourdes ont ete
tirees des centaines de fois sur 332 lots. Leur univers etait consomme, et
`pickWeighted` — proportionnel au poids, sans memoire du deja-vu — y retournait
quand meme.

**Preuve independante**, prise sur les quinze artistes les plus consommes de ce
compte, en confrontant chaque page a ses 3976 `seen_tracks` :

| page | index | titres | frais | part fraiche |
|---|---|---|---|---|
| 0 | 0 | 180 | 18 | **10,0 %** |
| 1 | 12 | 175 | 73 | 41,7 % |
| 2 | 24 | 157 | 101 | 64,3 % |
| 3 | 36 | 141 | 104 | 73,8 % |
| 4 | 48 | 115 | 99 | **86,1 %** |

La page 0 est vue a 90 % — soit exactement le taux de rejet lu dans les
journaux, retrouve par un chemin sans rapport. Les pages 1-4 rendent
**x21,9 de matiere fraiche**.

### Les quatre correctifs

1. **Pagination des catalogues.** `artistTop(id, limit, index)`, avec l'index
   **dans la cle de cache** — sans lui, la deuxieme page rendrait la premiere,
   deja en cache, et la pagination n'existerait que dans l'URL. Une page tiree
   par voisin et par lot (`Feed.pageDeVoisin`), penchee vers les titres phares
   par un poids `1/(1+p)` : ouvrir la profondeur n'est pas y demenager, les
   pages profondes sont pleines de versions live et de remixes. Univers d'une
   ancre : 240 -> **1200 titres**.
2. **La radio se renouvelle, on la gelait.** Deux appels consecutifs a
   `/artist/{id}/radio` rendent des selections differentes — c'est la seule
   variete gratuite du moteur. Elle etait gardee six heures, sous une cle qui
   **ne portait meme pas le `limit`** (donc un appel a une autre profondeur
   rendait la reponse de la premiere). Cle corrigee, `Tuning.RadioTtlSec` a
   trente minutes.
3. **Le tirage des ancres est aplati** (`Tuning.AncrePlatitude = 0.5`, une
   racine carree). Proportionnel au poids, il repechait les memes artistes
   lourds pendant que la traine de six cents artistes n'etait jamais visitee.
   La racine **conserve l'ordre** : un artiste vingt fois plus aime reste plus
   probable. Elargir n'est pas niveler — a exposant nul, le fil cesserait de
   ressembler a quelqu'un.
4. **`MinFresh` : 24 -> 72.** Vingt-quatre pour un lot de douze, c'etait se
   declarer en bonne sante avec deux candidats par carte. Mesure :
   l'elargissement s'est declenche **2 fois sur 332 lots** pendant
   l'effondrement. Le filet etait sous le plancher du probleme.

### Ce que `/artist/related` ne pourra jamais donner

Mesure : il rend **vingt** voisins quel que soit le `limit` demande.
`Tuning.RelatedLimit = 30` en demande trente et en recoit vingt. Ce plafond est
celui de Deezer — c'est pour cela que la profondeur devait venir des pages de
catalogue, et de nulle part ailleurs.

### Trois pistes suivies qui etaient fausses

Elles sont ecrites pour qu'on ne les reprenne pas :

- **« le plafond de douze titres sature chaque artiste »** — non. Mesure en
  base : **3,13 titres servis par artiste** en moyenne, et 20 artistes sur 627
  seulement approchent douze. Le plafond mord par l'**union sur 332 lots**, pas
  artiste par artiste.
- **« les voisinages ne couvrent que les 45 amorces »** — non. `allAnchors`
  couvre les 645 artistes du profil.
- **« quota Deezer »** — non, zero 403 dans le journal.

### Un piege de mesure, paye deux fois

`[lot]` porte **deux champs nommes `vivier`** : la taille du vivier, et le temps
passe a le construire (dans la parenthese). Un `grep -o "vivier=[0-9]*"` melange
les deux et fait croire a une oscillation qui n'existe pas.

Et **`POST /feed/next` n'accepte plus `user_id` dans le corps** : forcer un lot
avec cette cle cree un compte `anon:` et sert un demarrage a froid, ce qui ne
mesure rien du compte vise. L'identite passe par le `Bearer` ou `device_id`.

## Lire les lenteurs sans deviner

`Main.chronometre` écrit dans `prisme.log` **toute requête ≥ 1 s**, avec sa
durée et son code : `[lent] POST /feed/next -> 200 en 2520 ms`. Sans lui, une
lenteur signalée depuis le téléphone ne permettait pas de dire si le temps
partait dans le moteur, chez Deezer ou dans le réseau — on en était réduit à
rejouer la scène en espérant retomber sur le même état de cache.

Combiné à `[deezer]`, c'est ce couple qui a permis de trouver le quota en
quelques minutes.

## Un swipe ne rejoue plus le profil

`POST /feed/event` rechargeait le profil pour renvoyer un taux d'accroche que
l'app rangeait dans son état **sans jamais l'afficher**. Le détail qui rendait
la faute coûteuse : archiver un événement change le nombre de faits, donc la
version, donc la clé du profil en cache — un swipe garantissait donc un rejeu
complet, jamais un cache touché.

Mesuré sur le moteur déployé, histoire de 65 swipes :

| | avant | après |
|---|---|---|
| `POST /feed/event` | **890 ms** | **66 ms** |
| appareil sans histoire | 10 ms | 10 ms |

Le coût grandissait avec l'histoire et **se mettait en file** : une dizaine de
swipes rapides s'additionnaient, et le dernier attendait une vingtaine de
secondes (18,6 s observées sur appareil, à 1,4 s du délai d'abandon du client).
Ce n'était ni le réseau ni Deezer — le chemin public et le moteur local
mesuraient la même chose à 50 ms près.

La réponse ne porte plus que `reward`. Le profil est de toute façon rejoué au
lot de cartes suivant, où le coût est payé une fois pour douze cartes au lieu
d'une fois par carte.

**À ne pas défaire :** ne rien remettre sur le chemin de `/feed/event` qui
dépende de `replay.load`. C'est le chemin le plus chaud de l'application.

## Mesurer une lenteur

`src/api/client.ts` trace **chaque** appel dans la sortie de `npx expo start` :

```
[api] GET /profile — 312 ms — 200
[api] !! LENT POST /feed/next — 2140 ms (dont 890 ms de jeton) — 200
[api] !! LENT GET /library — 20003 ms — ABANDON apres 20 s
```

Le temps d'obtention du jeton est compté à part, parce que c'est le seul
segment **invisible depuis le VPS** : les journaux du moteur ne voient rien
d'un aller-retour vers g-auth fait par le téléphone.

Deux choses à savoir avant d'accuser le moteur :

- `TIMEOUT_MS` vaut 20 s. **Une attente de plus de 20 s n'est jamais un seul
  appel** — c'est un abandon suivi d'un autre appel, ou plusieurs appels en
  file.
- Le renouvellement du jeton est **à vol unique** (`renouveler` dans
  `src/auth/gnetwork.ts`). Il ne l'était pas : deux appels concurrents
  renouvelaient avec le même jeton de rafraîchissement, or G le fait tourner —
  le second échouait, et l'échec valait déconnexion silencieuse.

Côté VPS, les journaux utiles sont `/home/debian/prisme/prisme.log`
(`journalctl -u prisme` ne montre que systemd). `Your CPU is probably starving`
y signale une saturation, jamais un plantage.

## L'app affiche, elle ne calcule pas

Depuis le 2026-08-22, **rien n'est gardé côté téléphone** hormis l'identifiant
d'appareil et les jetons du réseau G. Le profil de goût, la bibliothèque,
l'historique et les titres déjà vus vivent en base sur le VPS, et le moteur
recalcule le profil à partir de toute l'histoire à chaque requête.

Conséquence pratique : `src/api/client.ts` n'accepte plus d'`userId`. L'identité
part toute seule — un `Bearer` si quelqu'un est connecté, sinon `device_id`
dans le corps (ou `X-Device-Id` pour les GET).

```ts
prisme.nextCards()                 // et non nextCards(userId)
prisme.event({ track, action, … }) // et non event(userId, …)
prisme.prism()                     // GET /profile, exige un compte
prisme.library()                   // GET /library, exige un compte
```

## L'état de compte est partagé, et ses fonctions sont stables

`src/state/useAccount.ts` n'est **pas** un `useState` par écran : c'est un
petit magasin de module, avec des abonnés. Deux raisons, et les deux ont été
des bugs réels (corrigés le 2026-08-23) :

- **Les onglets ne se démontent pas.** Avec un état par écran, se connecter
  depuis « Gardés » laissait « Prisme » sur l'état qu'il avait au premier
  affichage — déconnecté — jusqu'au rechargement complet de l'app.
- **L'objet rendu doit être stable.** Il était reconstruit à chaque rendu
  (`{ ...state, connect, … }`). Un `useCallback` qui en dépendait changeait
  donc d'identité à chaque rendu, l'effet qui en dépendait repartait, la
  réponse posait un nouveau tableau dans l'état, ce qui provoquait un rendu…
  **`/library` et `/profile` étaient redemandés en boucle**, plusieurs fois par
  seconde, tant que l'onglet restait monté. Côté VPS cela se lisait en famine
  CPU (`Your CPU is probably starving` dans `prisme.log`), jamais en crash.

Conséquences à ne pas défaire :

- Ne jamais mettre `compte` (l'objet) dans un tableau de dépendances de
  `useCallback`/`useEffect` — mettre `compte.connected` et `compte.loading`.
- Pour rafraîchir depuis un `catch`, importer `refreshAccount` du module, pas
  `compte.refresh`.
- Les onglets chargent leurs données dans un **`useFocusEffect`**, pas au
  montage : monté une fois, un onglet ne se remonte jamais.
- **Ne rien conclure tant que `compte.loading` est vrai.** C'est ce qui faisait
  dire « aucun goût » à un compte qui en avait un, puis se corriger tout seul
  quelques secondes plus tard.

## Le bouton de l'accueil et celui de la porte sont au même endroit

`bienvenue.tsx` réserve sous son bouton une hauteur vide (`PIED_SECONDAIRE`
dans les jetons) égale à celle qu'occupe « Plus tard » sur `connexion.tsx`.
Sans elle, le bouton principal saute d'une cinquantaine de pixels entre deux
écrans que tout le reste s'emploie à faire passer pour le même.

Même intention pour le mur de pochettes : `MurDePochettes` retient dans un
module l'instant de son premier affichage, et chaque colonne en déduit où elle
devrait être. Un exemplaire monté sur le second écran **reprend la dérive** au
lieu de repartir du haut.

## Deux écrans, deux sujets : `/profile` et `/stats`

`GET /profile` rend l'état du **moteur** — masses, facettes, part
d'exploration. `GET /stats` rend le comportement de la **personne** — temps
d'écoute, vitesse de verdict, heures, artistes qui reviennent. **Aucun chiffre
n'apparaît dans les deux**, et c'est délibéré : les mélanger avait produit un
écran où l'on ne savait plus lequel des deux on lisait, et où toutes les
valeurs affichées étaient internes au moteur (« exploration : 22 % » n'apprend
rien à personne sur soi-même).

Le calcul du portrait est pur (`Portrait.scala`, `PortraitSpec`) et se fait à
partir de `repo.events` : rien de nouveau n'est collecté, tout était déjà dans
`swipe_events`.

**Les heures partent en temps universel** (`hours_utc`). Le serveur ignore le
fuseau du téléphone, et se tromper de deux heures sur « tu écoutes vers
minuit » rend la phrase fausse, pas approximative. C'est `heuresLocales` dans
`src/state/portrait.ts` qui fait tourner le tableau.

L'écran Prisme fonctionne **sans** `/stats` : un moteur d'une version
antérieure rend le spectre seul, sans erreur ni trou. Même règle pour
`/taste/anchors`, `/blocked` et `/prefs` sur la page réglages.

## Le réglage de découverte ne s'écrit pas dans l'histoire

`user_prefs.discovery` est appliqué dans `Replay.load` **après** le cache, au
même endroit que l'oubli. Deux conséquences voulues :

- changer le réglage n'invalide aucun profil ;
- revenir à « automatique » rend **exactement** le profil d'avant, puisque le
  rejeu n'a jamais été touché.

Côté écran, la valeur n'est jamais montrée : trois intentions nommées
(Familier / Automatique / Curieux). Un curseur exposerait une grandeur interne
du moteur et demanderait de deviner ce que vaut 0,32.

## Bannir se défait en effaçant la décision

Le bannissement n'est pas un drapeau : c'est une conséquence du rejeu, que
`Taste` reconstruit tant qu'un `block` figure dans l'histoire. `Repo.unblock`
**supprime donc les événements** — ce qui est exactement ce qu'on veut dire par
« je me suis trompé ». Effacer change le nombre de faits, donc la version, donc
la clé du profil en cache : aucune invalidation à écrire.

## Le retour haptique passe par un seul endroit

`expo-haptics` n'est plus appelé directement nulle part : tout passe par
`vibrer.choix()` / `vibrer.action()` / `vibrer.grave()` dans
`src/state/vibration.ts`. C'est ce qui rend l'interrupteur des réglages
possible — sinon il aurait fallu poser un `if` à huit endroits et en oublier
un. L'état est lu **en mémoire** au moment de vibrer, jamais sur le disque : un
retour haptique qui arrive après le geste est pire que pas de retour.

## Se connecter au réseau G

Le fil est ouvert à tout le monde ; la bibliothèque et « Ton Prisme » exigent
un compte du réseau G (`g.twitninf.duckdns.org`). Le portail est
`src/components/AccountGate.tsx`, l'état vient de `src/state/useAccount.ts`, et
le flux OAuth est dans `src/auth/gnetwork.ts` (Authorization Code + PKCE,
client **public** `reso-mobile`, aucun secret).

**Piège des URIs de redirection.** G les compare caractère pour caractère, sans
joker. Une app compilée revient sur `reso://callback`, mais **dans Expo Go
l'app n'a pas de schéma à elle** et revient sur
`exp://<ip-du-poste>:8081/--/callback`. Les deux sont déclarées ; si l'IP du
poste change, la connexion échoue en développement et il faut rejouer :

```bash
ssh … "cd /home/debian/g-auth/packages/core && DATABASE_URL=\$(cat /home/debian/g-auth-secrets/dburl)   G_AUTH_SECRET=\$(cat /home/debian/g-auth-secrets/master)   RESO_EXTRA_REDIRECT_URIS='exp://<nouvelle-ip>:8081/--/callback'   npx tsx src/scripts/registerResoClient.ts"
```

## Construire un APK **ici**, en deux minutes — `npm run apk`

Mis en place le 2026-08-25, parce qu'un build EAS coûte une quinzaine de
minutes **dont une bonne moitié en file d'attente**, avant qu'une seule ligne
soit compilée. Mesuré ce jour-là : le build lancé était encore `IN_QUEUE` au
bout de dix minutes. Or l'immense majorité des changements de ce dépôt ne
touche **aucun code natif** — un badge, un écran, une couleur.

`tools/apk.mjs` sort un APK signé dans `build/reso.apk`. En Node et pas en
shell : il doit tourner pareil depuis PowerShell et depuis bash.

### Les trois choses qui font la vitesse, et qu'il ne faut pas défaire

1. **`android/` n'est jamais régénéré de zéro.** `expo prebuild` **sans**
   `--clean` met à jour ce qui a changé et laisse le reste, donc les sorties
   de compilation natives restent valides. `--clean` ramène à un build à froid
   à chaque fois — c'est toute la différence entre deux minutes et quinze.
2. **Les caches Gradle vivent dans `~/.gradle/gradle.properties`**, pas dans le
   projet : `android/gradle.properties` est réécrit par prebuild, donc tout ce
   qu'on y met disparaît. Cache de build, cache de configuration, démon,
   `-Xmx8g`, Kotlin hors processus.
3. **RNRepo** (`@rnrepo/expo-config-plugin`) substitue aux bibliothèques React
   Native des artefacts déjà compilés, au lieu de les bâtir depuis les sources.
   C'est ce qui coupe le coût du **premier** build, celui que les deux caches
   ci-dessus ne peuvent pas éviter. Exige RN ≥ 0.80 et la nouvelle
   architecture : Reso est en 0.81 + `newArchEnabled`. **En bêta.** Pour le
   désactiver sans rien désinstaller : `DISABLE_RNREPO=1`.
4. **`:app:assembleRelease`, jamais `assembleRelease` tout court.** Sans le
   prefixe de module, Gradle declenche la tache de chaque sous-projet
   **independamment** au lieu de passer par le graphe de dependances de
   l'app. Symptome mesure, et il coute cher :
   `:react-native-reanimated:buildCMakeRelWithDebInfo` echoue en cherchant
   `libworklets.so` dans un dossier de variante que personne ne lui a demande
   de produire — **dix-huit minutes pour rien**. La doc de RNRepo le dit
   explicitement, et le premier jet de `tools/apk.mjs` l'ignorait.

Mesure sur ce poste le 2026-08-25 : **a froid 18 min**, **incremental
1 min 12** (182 taches, dont 138 deja a jour). L'APK sort a `build/reso.apk`,
87 Mo.

### La signature n'est pas un détail

Le projet Android généré par Expo signe sa variante `release` avec le
**keystore de débogage**. Un APK ainsi signé s'installe, mais Android refusera
ensuite toute mise à jour par-dessus un APK signé par EAS avec
`credentials/reso.jks` — et inversement. Deux clés différentes, c'est une
désinstallation forcée à chaque va-et-vient entre local et EAS.

Le script resigne donc systématiquement avec `reso.jks` **après coup**
(`apksigner`), plutôt que de modifier `app/build.gradle` — que le prochain
prebuild réécrirait. C'est la seule façon que ça survive à un prebuild.

### Deux garde-fous, et pourquoi ils sont là

- **Le disque.** Deux seuils, parce que la depense n'est pas la meme : **12 Go**
  a froid, **5 Go** en incremental. Ce sont des mesures, pas des estimations —
  un premier passage complet a consomme 7,4 Go sur ce poste (dont 0,8 pour
  `android/` et 2,5 pour `~/.gradle`), et un build incremental ne redepense
  pas ce qui est deja pose. Le premier jet avait un seuil unique a 15 Go : il
  bloquait des builds incrementaux qui tenaient tres largement dans ce qui
  restait. En dessous du seuil, un build Android echoue *en pleine
  compilation*, avec une erreur qui ne mentionne jamais le disque — refuser
  tout de suite coute moins cher qu'un diagnostic.
- **`ANDROID_HOME` n'est pas posé sur ce poste.** Le script trouve le SDK à son
  emplacement par défaut et l'exporte lui-même. C'est la première chose qui
  fait échouer un build local, et elle n'a rien à voir avec le projet.

### Le piège OneDrive

Le dépôt vit dans `OneDrive\Bureau\`. Un build Android crée des dizaines de
milliers de fichiers intermédiaires ; OneDrive va tous vouloir les
synchroniser et peut en **verrouiller un en plein build**. C'est une cause
classique d'échec non reproductible. Exclure `android/`, `node_modules/` et
`build/` de la synchronisation, ou builder depuis un clone hors OneDrive.

### Ce que ça change pour EAS

`@rnrepo/expo-config-plugin` est dans les `plugins` d'`app.json`, donc il
s'applique **aussi** aux builds EAS. C'est voulu (ils y gagnent autant), mais
c'est un composant en bêta de plus dans une chaîne qui marchait : si un build
EAS se met à échouer sans raison apparente, c'est le premier suspect, et
`DISABLE_RNREPO=1` le tranche en une exécution.

`.fingerprintignore` porte `**/.rnrepo-cache` : sans lui, chaque
téléchargement d'artefact pré-compilé changerait l'empreinte du projet et
invaliderait la réutilisation des builds EAS.

## Construire un APK

```bash
npx eas build --platform android --profile apk --non-interactive --no-wait
```

Le profil `apk` d'`eas.json` produit un `.apk` (et non un `.aab`) en
distribution interne. Trois choses ont dû être mises en place, et chacune est un
piège si on l'ignore.

**La clé de signature est locale.** EAS refuse d'en générer une en mode non
interactif. Elle vit dans `credentials/reso.jks`, déclarée par
`credentials.json` (`credentialsSource: "local"` dans le profil). Les deux sont
**ignorés par git** — donc ils n'existent que sur ce poste, et il faut les
sauvegarder ailleurs : une clé différente veut dire qu'Android refusera toute
mise à jour par-dessus une installation existante. Voir
[[gstore-signature-derive]] pour ce que coûte une dérive de signature.

**`react-dom` doit être épinglé.** Le premier build a échoué à la phase
« Install dependencies », et la cause ne se voyait pas en local : `react-dom`
n'était **pas une dépendance directe** — il arrivait par `expo-router` — et le
lockfile l'avait résolu en `19.2.8`, qui exige `react ^19.2.8` alors que le
projet est figé à `react 19.1.0`. `npm ci` refuse le conflit de peer deps, alors
que `npm install` l'avait accepté. **`npx expo install --check` ne le voit pas
non plus** : il ne vérifie que les dépendances directes. Le diagnostic tient en
une commande, à faire avant tout build :

```bash
npm ci --dry-run
```

**EAS ne détecte pas git depuis ce poste** (« Using EAS CLI without version
control system »). Il archive donc le **dossier de travail** tel quel, pas le
dernier commit — ce qui est commode, le travail non commité part dans le build,
mais rien n'est exclu tout seul. D'où `.easignore` : sans lui, `node_modules`
partirait. L'archive doit peser autour de 700 Ko ; si elle fait des dizaines de
mégaoctets, c'est que `.easignore` a été perdu.

`.env` n'est **pas** ignoré, et c'est voulu : `EXPO_PUBLIC_PRISME_URL` et
`EXPO_PUBLIC_SPOTIFY_CLIENT_ID` doivent partir dans le build. Un APK construit
sans lui viserait quand même le moteur déployé (l'adresse par défaut de
`src/api/client.ts`), mais perdrait l'import Spotify.

## Le serveur

`.env` pointe sur **https://reso.twitninf.duckdns.org**. Pour travailler contre
un moteur local, mettre l'IP du poste (jamais `localhost` : sur un téléphone,
`localhost` désigne le téléphone). Voir `prisme/README.md` pour le déploiement.

## Le parcours de démarrage

Cinq écrans, dans cet ordre, avant d'atteindre le fil :

| Route | Rôle | L'objet dont il s'inspire |
|---|---|---|
| `app/bienvenue.tsx` | Ce qu'est Reso, montré plutôt que décrit | **une pochette** |
| `app/connexion.tsx` | Compte du réseau G, ou pas | **une porte** |
| `app/plateforme.tsx` | « Où écoutes-tu ? » | **une liste de destinations** |
| `app/onboarding.tsx` | « Qui écoutes-tu ? » — **sauté** si l'import a marché | **une liste d'invités** |
| `app/styles.tsx` | « Dans quoi tu creuses ? » — **seulement** après un import Spotify | **les intercalaires d'un bac de disquaire** |
| `app/habitude.tsx` | « Tu écoutes beaucoup ? » | **un curseur de lumière** |

`app/styles.tsx` prend la place de l'écran des artistes quand l'import l'a rendu
inutile : les deux sont l'étape 3, jamais les deux à la fois. Ce qu'il faut
savoir avant d'y toucher :

- **Les styles viennent des genres que Spotify attache à ses objets artiste**
  (`me/top/artists`, `me/following`), donc **gratuitement** — aucun appel de
  plus. Les sources de titres n'en portent pas.
- **Prisme ne connaît pas ces libellés.** Cocher « french hip hop » n'agit pas
  sur une catégorie du catalogue Deezer : ça appuie sur **les ancres que ce
  style recouvre**. D'où `resolved` dans la réponse de `POST /taste/seed`, qui
  donne la correspondance nom → identifiant Deezer sans repayer une recherche
  par artiste.
- **C'est une pondération, pas un filtre** (`Tuning.StyleBoost`). Appliquée
  dans `Replay.load` **après le cache**, au même endroit que la découverte :
  changer sa sélection n'invalide aucun profil, et tout décocher rend
  exactement le profil d'avant.
- Depuis les Réglages, la liste ne peut montrer que ce qui est **actif** : les
  propositions viennent de l'import, et l'import n'est pas rejoué pour ouvrir
  un écran de réglage. L'écran le dit au lieu de le laisser deviner.

`app/index.tsx` aiguille : `isOnboarded()` → `/(tabs)`, sinon `/bienvenue`.

Trois décisions à ne pas défaire sans raison :

- **Pas de carrousel à puces.** C'est le tell le plus reconnaissable d'un
  onboarding, et personne ne lit le deuxième volet. L'accueil est un écran
  unique : le mur des artistes du moment derrière un voile
  (`src/components/MurDePochettes.tsx`), une phrase posée dessus.
- **Sur l'écran du compte, les deux actions n'ont pas le même poids** — un
  bouton plein contre une ligne de texte. Deux boutons jumeaux forceraient à
  trancher une question qui n'en est pas une pour quelqu'un qui veut écouter.
- **L'accueil précharge la grille d'artistes** (`src/state/catalogue.ts`). Elle
  coûte plusieurs secondes au moteur (six palmarès Deezer) ; demandée pendant
  qu'on lit, elle est prête à la troisième étape. Ne pas remettre un appel
  direct à `prisme.onboardingArtists()` dans l'écran de choix.

Un compte G qui porte déjà un goût (construit sur un autre téléphone) **saute
l'étape des goûts** : `connexion.tsx` lit `/profile` et va droit au fil si des
facettes existent. C'est la démonstration concrète de ce que le compte apporte.

## Spotify a supprimé `PUT /me/tracks` — et son 403 ment

**Diagnostic du 2026-08-23.** Un ajout aux titres likés échouait en
`403 Forbidden` alors que le journal montrait la portée bien accordée :

```
[spotify] portees accordees : user-library-read user-library-modify user-read-recently-played user-top-read
[spotify] PUT /me/tracks -> 403 Forbidden
```

Ce n'était ni une portée, ni le « Development mode ». **Spotify a retiré tous
les points d'entrée par type en février 2026** (`PUT|DELETE /me/tracks`,
`/me/albums`, `/me/episodes`, `/me/shows`, `/me/audiobooks`) au profit d'un
seul `/me/library` qui prend des URI Spotify. Le piège : l'ancien ne répond ni
404 ni 410, **il répond 403**, exactement comme un refus de permission — ce qui
envoie chercher le problème là où il n'est pas.

La forme qui marche :

```
PUT https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3A<id>
```

40 URI au maximum, portée `user-library-modify`, succès en 200.

Autres suppressions de la même vague qui touchent ce dépôt :

- **`GET /me/tracks` (lire la bibliothèque) n'a PAS été supprimé.** Ce document
  l'a affirmé, et c'était faux. Mesuré sur un vrai jeton le 2026-08-23 :
  `GET me/tracks?limit=50` répond **200** et pagine normalement (1087 titres
  lus sur un compte réel), tandis que `GET me/library` répond **405** — ce
  chemin n'accepte que `PUT` et `DELETE`, il n'a jamais eu de lecture. Le
  changelog de février 2026 range pourtant `GET /me/tracks` parmi les points
  d'entrée retirés, et sa page de référence le décrit toujours comme vivant.
  **La documentation de Spotify se contredit : ne jamais retrancher un point
  d'entrée sur sa seule foi.** `likes()` sonde donc les trois chemins
  candidats et journalise le code de chacun, ce qui rend la question
  tranchable en une exécution au lieu d'une session ;
- `GET /search` : limite maximale ramenée de 50 à 10 — `trouverChezSpotify`
  demande 1, donc rien à changer, mais ne pas la remonter ;
- `GET /me/top/*` et `/me/player/recently-played` sont **conservés** :
  l'import de goût n'est pas affecté.

Depuis mars 2026, une application en Development Mode exige aussi que son
propriétaire ait un abonnement Premium actif.

**Leçon transposable :** un 403 de Spotify ne veut pas dire « permission
refusée ». Avant de suspecter les portées, vérifier que le point d'entrée
existe encore.

## Une portée Spotify ne s'élargit jamais après coup

Un jeton porte les portées du jour où il a été obtenu. Ajouter
`user-library-modify` au code ne change **rien** pour un jeton déjà rangé sur
le téléphone : Spotify ré-autorise en silence avec l'ancien jeu, et le refus
n'arrive qu'à l'écriture, en `403 Forbidden`, loin de sa cause.

D'où trois choses :

- la portée **réellement accordée** est enregistrée avec le jeton (`scope`) et
  vérifiée **avant** l'appel — voir `etatSpotify` ;
- `autoriser()` passe `show_dialog: 'true'`, seul moyen de forcer l'écran de
  consentement à réapparaître ;
- Réglages → Spotify affiche « complète » ou « lecture seule », avec le bouton
  qui répare.

Si un 403 subsiste **après** reconnexion, le motif renvoyé par Spotify est
maintenant relayé à l'écran et dans la console. Le suspect suivant est alors le
« Development mode » du tableau de bord Spotify, qui exige que le compte figure
dans *User Management*.

## Importer et écrire ne suivent pas la même frontière

`app/plateforme.tsx` propose cinq réponses, et ce qu'elles permettent est écrit
sous chaque nom — sans arrondi, parce que les capacités sont très inégales :

| | importer un goût | ajouter aux favoris |
|---|---|---|
| Spotify | oui, **par compte** (`/me/top/*`, PKCE) | oui (`PUT /me/library`) |
| Deezer | oui, **par lien** (profil ou playlist publique) | non |
| YouTube Music | oui, **par lien** (playlist publique, si le serveur a la clé) | non |
| Apple Music | non — MusicKit + clé développeur payante | non |
| Aucune | non | non |

**L'écriture reste le privilège de Spotify**, et ce n'est pas un chantier
en attente : aucun lien ne permet d'écrire chez qui que ce soit.

**L'import, lui, ne passe plus forcément par OAuth** — et c'est le
retournement du 2026-08-23. L'OAuth est fermé partout ailleurs que chez
Spotify :

- **Deezer a suspendu la création de nouvelles applications** après des abus
  répétés de ses conditions. Aucun App ID ni Secret n'est délivrable. Ce n'est
  pas « pas encore fait », c'est fermé.
- YouTube n'expose aucune API de bibliothèque, et lire les titres likés
  demanderait une portée sensible à faire vérifier par Google.
- Apple Music exige un compte développeur à 99 €/an pour la clé MusicKit.

Mais **l'import ne dépend pas de l'OAuth, il dépend d'avoir un identifiant**,
et les routes Deezer *par identifiant* sont restées ouvertes, sans jeton ni
clé :

```
GET api.deezer.com/user/{id}/tracks     -> titres likés, avec isrc
GET api.deezer.com/playlist/{id}/tracks -> titres, avec isrc
profil privé ou inexistant              -> {"error":{"code":800}}, en HTTP 200
```

D'où `Import.scala` côté moteur et `app/import-lien.tsx` côté app : on ne
demande plus « autorise Reso à lire ton compte » mais **« colle ton lien »**.

Trois choses à ne pas défaire dans ce fichier :

- **Un import Deezer rend des `artist_ids`, pas des noms.** `POST /taste/seed`
  accepte les deux, et passer par les identifiants natifs contourne
  entièrement la résolution par nom — donc les homonymes, donc « PNL » qui
  résout vers Pink Floyd. Seul YouTube, qui ignore tout de Deezer, doit passer
  par les noms.
- **La source du goût Deezer est les titres likés, pas `/user/{id}/artists`.**
  Suivre un artiste est un geste rare — beaucoup de comptes en suivent trois
  ou zéro — alors que liker est courant. Compter les occurrences donne en
  prime une pondération que l'import Spotify n'a pas.
- **Ne jamais apparier les titres YouTube un à un via `search.list`** : 100
  unités l'appel contre 1 pour `playlistItems.list`, sur 10 000 par jour et
  **par projet**, tous utilisateurs confondus. C'est pourquoi on n'extrait que
  des noms d'artistes, et pourquoi ça suffit.

`YOUTUBE_API_KEY` est facultative comme le reste de `Config.scala` : absente,
`GET /import/sources` ne liste que `deezer` et l'écran ne propose pas YouTube
Music. Promettre un import qui échouera **après** qu'on a collé son lien serait
pire que de ne rien promettre.

Conséquences à ne pas défaire :

- **L'écran des artistes n'est sauté que si l'import a réellement rendu des
  noms.** Choisir Apple Music n'importe rien : on y passe quand même, et
  l'écran le dit. Ne pas « simplifier » en sautant l'étape pour toute
  plateforme choisie — le profil partirait vide.
- Pour les trois sans écriture, « ajouter aux likés » **ouvre le titre chez
  eux**. C'est un geste de moins, et rien de plus n'est promis à l'écran.
- Le lien de partage de l'application Deezer est un lien **court**
  (`link.deezer.com/s/…`) qui ne porte pas l'identifiant : c'est la forme que
  les gens colleront le plus souvent, et `Imports.deplier` la suit en HEAD
  avant de la reconnaître. La refuser reviendrait à demander d'aller chercher
  son lien sur le site, ce que personne ne fera.
- Le pont entre catalogues est l'**ISRC** (`Track.isrc`, donné par Deezer),
  pas une recherche par titre : les rééditions, versions live et albums deluxe
  portent le même nom sans être le même enregistrement.
- Les jetons Spotify sont désormais **conservés** (`reso.spotify.tokens`) avec
  renouvellement à vol unique. Ils ne l'étaient pas : l'autorisation servait à
  lire le goût une fois puis était perdue, ce qui rendait impossible tout ajout
  ultérieur.

La plateforme est rangée **sur le téléphone**, pas sur le compte : elle dit
quelle application est installée *ici*, alors que le goût, lui, est le même
d'un appareil à l'autre.

## `/prefs` est ouvert aux appareils sans compte

Contrairement au reste des réglages. La question de la découverte est posée par
`app/habitude.tsx` **à la fin du démarrage, avant toute connexion** : un
réglage qu'on propose puis qu'on n'applique pas serait pire que pas de réglage.
D'où `identify` au lieu de `withAccount` sur `GET|PUT /prefs`, et l'en-tête
`X-Device-Id` côté client (comme `/me`).

## Retirer un gardé ≠ débannir un artiste

Deux suppressions qui n'ont pas le même sens, et le code les traite
différemment :

- `DELETE /library/{trackId}` retire de la bibliothèque **et laisse le swipe
  dans l'histoire**. Ranger n'est pas se dédire : la décision a eu lieu, le
  goût doit continuer d'en tenir compte.
- `DELETE /blocked/{artistId}` **efface les événements** `block`. Là, on se
  dédit vraiment — voir plus haut.

## Un abonnement n'est pas forcément quelqu'un

On suit des gens et on suit des artistes, du même geste et depuis le même
bouton. La liste derrière le compteur « abonnements » ne montrait pourtant que
les gens : suivre un artiste ne laissait aucune trace à l'endroit même où l'on
va chercher ce qu'on suit.

`GET /social/profil/{ref}/gens?type=abonnements` rend donc **deux clés** —
`gens` (les profils) et `artistes` (les fiches Deezer complètes). Côté
`abonnes`, `artistes` est toujours vide mais **présent** : un artiste n'est pas
un compte, il ne suit personne, et l'app n'a pas à distinguer l'absence du vide.

Trois conséquences à ne pas défaire :

- **`comptesSuivis` compte les artistes dans les abonnements**, pas dans les
  abonnés. Le chiffre annonce la liste où il mène ; un compteur qui dit trois
  au-dessus d'une liste de dix ferait douter de la liste, pas du compteur.
- **Les fiches sont plafonnées à cinquante**, comme les gens. Chacune est un
  appel Deezer — mis en cache quatorze jours, donc gratuit dès la deuxième
  ouverture, mais la première ne doit pas devenir une attente.
- **La forme distingue les deux natures avant le texte** : visage rond pour un
  profil, portrait carré à coins arrondis pour un artiste. C'est ce qui permet
  aux deux de se suivre dans la même liste, et c'est déjà l'idiome de la
  recherche de l'onglet « Les gens ». Les titres de section (« Profils » /
  « Artistes ») n'apparaissent que quand les deux natures sont là — nommer une
  liste seule est du bruit.

Le client tolère un moteur d'une version antérieure : `artistes` est facultatif
et son absence vaut liste vide, donc l'écran retombe sur ce qu'il montrait
avant.

## Partager un son : ce qui compte, et ce qui ne compte pas

**Ami = suivi réciproque**, calculé depuis `social_suivis`, jamais stocké. Ne
pas créer de table d'amitié : elle ajouterait un troisième état à un graphe qui
n'en a que deux, et il faudrait la tenir cohérente à chaque désabonnement. Les
profils cachés n'y figurent pas — se retirer de la recherche, c'est aussi
cesser d'être joignable.

**`social_partages` est la seule chose écrite**, parce qu'un partage ne se
déduit de rien. Les notifications, elles, restent **dérivées** : `partage_recu`
et `partage_garde` sont des jointures, donc elles ne peuvent pas mentir.
`added_at > created_at` sur la seconde est ce qui empêche la fausse bonne
nouvelle — envoyer un son que l'autre avait déjà gardé n'annonce rien.

Cinq choses à ne pas défaire :

- **Le préfixe du lot se fait dans `Feed.next`, avant `markSeen`.** Le faire
  dans la route laisserait les titres partagés hors de l'anti-répétition, et
  ils reviendraient ensuite par le chemin normal. L'arithmétique du lot est
  extraite dans `Feed.prefixer` — c'est la seule du chemin, et elle est testée.
- **Une carte partagée n'entre jamais dans `serve_log`.** Cette table dit ce
  que le modèle *croyait* en servant la carte ; il n'a rien cru ici, et y
  écrire des zéros empoisonnerait le futur reclasseur.
- **Un « passer » sur un son d'ami ne compte pas dans le goût** — il est
  souvent social. **Bannir compte**, lui : ignorer le geste le plus explicite
  de l'app ferait mentir le bouton. Le drapeau `from_share` vient de l'app, et
  le serveur ne s'en sert que pour **supprimer** un événement, jamais pour en
  créer un : `/feed/event` est le chemin le plus chaud, on n'y lit pas la base.
  Un client modifié ne peut donc qu'abîmer son propre profil.
- **La signature est la ligne de mention du cartel, pas un bandeau.** Un
  bandeau au-dessus de la pochette rendrait les cartes partagées plus hautes
  que les autres, et la pile changerait de forme à chaque fois que l'une passe.
- **L'icône d'envoi lève `surBouton`**, comme le bouton « suivre ». Sans ça, un
  appui un peu lent dessus ouvre la demande de bannissement au bout de 600 ms.

**Trois titres par jour** (`Tuning.PartagesParJour`), tous destinataires
confondus : le même son à quatre amis coûte un. Ce qui est rare, c'est le
morceau qu'on juge digne d'être envoyé, pas le nombre de gens à qui on pense.
Le dépassement rend **429, pas 403** — voir juste en dessous.

### Un son, une personne, une fois

**Signalé le 2026-08-25 :** on pouvait envoyer le même son à la même personne
autant de fois qu'on voulait. Chaque envoi faisait une ligne, donc une carte et
une notification de plus chez elle.

**Le quota n'y pouvait rien, et ne pouvait pas y pouvoir :** il compte des
titres distincts par jour, donc renvoyer un titre déjà parti est gratuit *par
construction* — c'est précisément ce qui rend « le même son à quatre amis coûte
un ». C'était la dernière porte ouverte au harcèlement.

`UNIQUE (de, a, track_id)` et `ON CONFLICT DO NOTHING`. Trois choses à ne pas
défaire :

- **`DO NOTHING`, jamais `DO UPDATE`.** Rafraîchir `created_at` ferait remonter
  la notification en tête de liste chez l'autre : un doublon déguisé.
- **La migration nettoie avant de créer l'index**, en gardant la ligne la plus
  ancienne — celle qui porte la vraie date et, le cas échéant, sa livraison.
  Sans ce ménage, l'index unique refuserait de se créer sur une base qui a déjà
  des doublons, et le démarrage échouerait.
- **`GET /social/amis?track_id=` marque les amis qui l'ont déjà**, et la feuille
  les affiche cochés et non tapables. L'envoi étant idempotent, taper dans le
  vide et voir « envoyé » alors que rien ne part serait pire que le doublon
  qu'on vient de fermer.

### Le retour couvre les DEUX gestes positifs

**Signalé sur appareil le 2026-08-25 :** un son envoyé, aimé par le
destinataire, aucune notification. Le journal ne montrait rien, et pour cause —
rien n'avait échoué.

`partage_garde` se dérivait de `library_tracks` seule. Or **un « j'aime » ne
range rien** : seul « je garde » entre en bibliothèque. La moitié du positif
était donc invisible, et c'est la moitié la plus fréquente — aimer est le geste
courant, garder est le geste rare.

La faute était dans la spec, pas dans le code : « seulement le positif » avait
été rétréci en « seulement le gardé » à l'écriture, sans que ça se voie.

Le retour se dérive maintenant de **la même union que `Repo.communs`** — la
bibliothèque ∪ les swipes `like`/`save` — ce qui était déjà le motif juste dans
ce dépôt. Trois choses à ne pas défaire :

- **Deux genres, pas un** (`partage_aime`, `partage_garde`) : garder et aimer
  ne racontent pas la même rencontre, et c'est exactement pour ça que l'écran
  des titres en commun a déjà été corrigé une fois.
- **Une seule notification par envoi**, celle du geste le plus fort — aimé puis
  gardé se raconte comme un gardé. D'où `GROUP BY p.id` et `bool_or(garde)`.
  Sans ça, un même son produirait deux lignes et ferait croire à deux
  événements.
- **`g.at > p.created_at`** : envoyer un son que l'autre aimait *déjà* n'annonce
  rien. Sans cette borne, chaque envoi d'un titre populaire produirait une
  fausse bonne nouvelle immédiate.

**Leçon transposable :** dans ce dépôt, « positif » veut dire `like` **ou**
`save`. Toute lecture du goût qui n'interroge que `library_tracks` ne voit
qu'un geste sur deux.

### Un 403 ne veut pas dire « connecte-toi »

Corrigé pendant ce chantier. `src/api/client.ts` transformait **tout** 403 en
`AccountRequiredError`, en jetant le corps de la réponse. Seul le refus de
`withAccount` joint une `auth_config` ; les autres 403 sont des règles métier
dont la phrase est écrite pour être affichée. La feuille d'envoi aurait donc
ouvert le portail de connexion à quelqu'un déjà connecté, en cachant le vrai
motif. C'est la même faute que le 403 de Spotify, qui a coûté une journée.

`AccountRequiredError` n'est levée que si `auth_config` est présente ; sinon
c'est une `PrismeError` qui porte le message du serveur.

**Réserve, non traitée :** on ne peut pas bloquer les envois de quelqu'un sans
se désabonner de lui. Le plafond rend le harcèlement coûteux, pas impossible.

## Le badge vérifié dit « c'est bien lui », et rien d'autre

Ajouté le 2026-08-25. Vert (`color.verifie`, `#2BC55E`), rosace crantée façon
Twitter, à côté du nom.

**Ce n'est pas un badge de notoriété.** Il répond à une seule question — « cette
fiche-là est-elle bien celle de cet artiste-là, ce compte-là bien cette
personne-là ». Le nombre d'abonnés sert d'indice pour y répondre, pas de mérite
à récompenser.

### Deux sources, et il en faut deux

`Verifies.scala`, côté moteur :

```
verifie(artiste) = curé(id)     || fans ≥ 100 000
verifie(compte)  = curé(handle)
```

- **La liste curée** vit dans la table `verifies` et se sème au démarrage
  depuis `Verifies.semisComptes` / `semisArtistes`. C'est la seule chose qui
  puisse badger `gasleboss` (**deux** abonnés Deezer, id `219912405`) ou
  `@gaspirou` : aucune règle automatique ne les atteindra jamais, et c'est
  exactement pour ces cas-là qu'un badge existe.
- **Le seuil** couvre les artistes installés que personne n'a pensé à curer.
  Sans lui, le badge se serait lu comme « ami de la maison ».

`ON CONFLICT DO NOTHING` sur le semis, **jamais `DO UPDATE`** : déverifier
quelqu'un est un `DELETE` en SQL, et il doit tenir au redémarrage suivant.
Sinon la seule façon de retirer un badge aurait été de modifier le code.

```sql
-- ajouter          / retirer
INSERT INTO verifies (genre, ref) VALUES ('compte', 'unhandle');
INSERT INTO verifies (genre, ref) VALUES ('artiste', '219912405');
DELETE FROM verifies WHERE genre = 'artiste' AND ref = '219912405';
```

Le moteur relit la table **au démarrage seulement** : une modification en SQL
demande un `systemctl restart prisme`. C'est voulu — la liste est lue à chaque
sérialisation d'artiste, donc à chaque carte du fil, et une lecture de base à
cet endroit-là serait le pire endroit possible pour en mettre une.

### Pourquoi il remplace `principal`

`principal` répondait à la bonne question — « parmi les fiches portant le nom
que tu as tapé, laquelle est la vraie » — mais **il n'était calculable que dans
une recherche** : il lui fallait le mot tapé et le groupe d'homonymes. Sur la
fiche d'un artiste, ouverte depuis une carte du fil, il n'y a ni l'un ni
l'autre. Le même artiste portait donc la pastille dans la liste de résultats et
la perdait une fois sa fiche ouverte. **Un badge qui clignote d'un écran à
l'autre ne se lit plus comme un fait, il se lit comme un bug.**

Le seuil, lui, est une propriété de la fiche seule. Il tient la même promesse
anti-homonyme sur les cas qui l'avaient motivée — le vrai Daft Punk passe,
« Daft Punk Experience » (63 abonnés) non ; le vrai Nirvana passe, « Nirvana
(UK) » non — et il la tient **partout**.

`principal` reste calculé et envoyé : un APK déjà installé le lit encore, et le
retirer aurait éteint la pastille sur les téléphones non mis à jour. L'app à
jour ne le dessine plus.

### Le drapeau tombe dans les encodeurs, pas dans les routes

`verifie` est ajouté dans `given Encoder[Artist]` et dans un **nouveau**
`given Encoder[Gen]` (`Models.scala`). Un artiste est rendu par une dizaine de
chemins — la fiche, la recherche, les abonnements, les cartes du fil, le profil
de quelqu'un — et le poser route par route aurait garanti d'en oublier un.

Le profil, lui, était **recopié à la main à cinq endroits** : la recherche, les
listes d'abonnés et d'abonnements, la feuille d'envoi, les notifications, la
signature d'une carte partagée. Ils passent tous par l'encodeur maintenant.
`/social/profil/{ref}` reste à part (ce n'est pas un `Gen`) et calcule le même
drapeau sur la même clé — le handle.

**Corollaire :** `Verifies` porte un état de module posé une fois au démarrage
(`Verifies.poser`, dans `Main`), parce qu'un encodeur est une fonction pure et
ne peut rien aller chercher. C'est de la configuration en lecture seule, du
même genre que `Tuning`.

### Côté app

`NomVerifie` (`src/components/NomVerifie.tsx`) est le seul endroit qui dessine
la pastille. Une rangée et pas un `<Text>` imbriqué : React Native n'accepte
pas de SVG dans un `Text`. `flexShrink` sur le texte — c'est le nom qui se
tronque quand la place manque, jamais la pastille.

**Le vert n'est pas `accent`.** L'accent teal est le « j'aime » du fil ; le voir
à côté d'un nom d'artiste ferait lire « tu aimes » là où on veut dire « c'est
bien lui ». Deux marques de la même couleur finissent par ne plus rien dire ni
l'une ni l'autre.

**Dans les notifications, c'est une vue en ligne.** Le nom y ouvre une phrase
qui coule sur deux lignes (« *Gaspirou* a gardé le son que tu lui as
envoyé »). Le premier jet avait sauté cet écran en se disant qu'un SVG ne
rentre pas dans un `<Text>` — c'est faux : **React Native accepte une `View`
dans un `Text` depuis 0.50**, sur les deux plateformes, et sous Fabric (le
projet est en nouvelle architecture) elle est correctement mesurée.

Deux choses à ne pas défaire dans `notifs.tsx` :

- **la pastille reste dans le `Text`.** La sortir pour l'accoler au nom dans
  une rangée casserait le retour à la ligne : la phrase se couperait après le
  nom quelle que soit sa longueur ;
- **`width`/`height` explicites et `marginBottom: -2`.** Une vue en ligne
  n'hérite de rien du texte qui l'entoure — un SVG sans taille y occupe zéro
  pixel — et elle s'aligne sur la ligne de base, donc sans la marge négative
  la pastille flotte au-dessus du mot qu'elle qualifie.

**Un seul endroit ne le montre pas, volontairement :** la rangée « Tu suis »
de l'onglet Les gens. Des colonnes de 56 px avec un prénom tronqué dessous ;
la pastille y pousserait le nom hors de sa colonne, et le badge appartient là
où un nom entier est lisible.

**Pas encore vu sur appareil** : la rosace à 14 px à côté d'un nom, le vert sur
le fond de la fiche artiste, et surtout **la vue en ligne des notifications** —
c'est la seule qui repose sur un comportement de mise en page que la relecture
ne tranche pas.

## Le banc lisait `__DEV__`, que Node ne définit pas

`player.ts` tait ses traces en production avec `if (!__DEV__) return`. Metro
définit ce symbole, Node non : `npm run bench` s'arrêtait donc sur un
`ReferenceError` dès la première lecture, sur les quatre réseaux. Le banc était
**muet depuis ce commit-là**, et rien ne le disait — il échouait avant d'avoir
mesuré quoi que ce soit.

`bench/fil.ts` pose `globalThis.__DEV__ = false` avant tout. Faux et pas vrai :
le banc mesure le chemin de production, pas ses journaux.

## Repartir de zéro

Trois mémoires distinctes, et les effacer toutes n'est pas la même chose que
les effacer une par une :

| Où | Ce qu'il y a | Comment l'effacer |
|---|---|---|
| Le téléphone (AsyncStorage) | `reso.device_id`, `reso.onboarded`, `reso.g.tokens` | « Repartir de zéro » dans l'onglet Prisme |
| Postgres, sur le VPS | comptes, amorces, swipes, bibliothèque, titres vus | `/home/debian/prisme/purge-utilisateur.sh [id]` |
| Redis (cache) | profils rejoués, graphe Deezer | rien à faire : se reconstruit seul |

« Repartir de zéro » **déconnecte aussi du réseau G** : garder les jetons
ferait repartir sur le même compte, donc sur le même profil côté moteur —
l'app aurait l'air neuve et le fil saurait déjà tout.

Le bouton est atteignable **sans compte** : il figure aussi sur le portail de
l'onglet Prisme, sinon un appareil anonyme n'aurait aucun moyen de recommencer.

Dans Expo Go, il n'y a pas de « vider les données » par projet : la seule
alternative au bouton est de réinstaller Expo Go, ce qui efface *tous* les
projets. Passer par l'app est donc la bonne voie.

## Une case pré-cochée est une réponse, et elle part comme telle

Corrigé le 2026-08-26, après « le fil n'est pas à la hauteur ».

`app/habitude.tsx` pré-cochait « De temps en temps », dont la valeur est
`FAMILIER = 0`, et l'écran fonctionne **sans qu'on y touche** — « Ouvrir le
fil » est actif dès l'arrivée. Personne n'avait donc à choisir quoi que ce
soit pour que `PUT /prefs { discovery: 0 }` parte. Mesure en base ce jour-là :
**81 comptes sur 81 à zéro, aucun en automatique**, dont 49 écrits à la même
microseconde.

Côté moteur ce zéro n'est pas un réglage tiède, c'est un interrupteur : il
annule le terme de bruit du score, il écrase le correcteur proportionnel, et
il désactive même le filet du nouveau venu qu'il croyait imiter (la branche
« choix explicite » saute `Replay.prudent`). Voir `prisme/README.md`, « Le
jour où le classement s'est débranché sans rien casser ».

Le défaut est désormais **Automatique**. Deux règles qui en sortent :

- **Ne jamais pré-cocher une réponse qui restreint le moteur.** Un écran de
  démarrage recueille surtout des non-réponses ; ce que le défaut envoie doit
  donc être ce qu'on servirait à quelqu'un dont on ne sait rien — et pour la
  découverte, c'est « laisse le moteur décider », pas « rien d'inconnu ».
- **La bande animée lit `DEFAUT`**, elle ne répète plus l'indice à la main.
  Les deux étaient écrits séparément (`REPONSES[0].part` d'un côté,
  `REPONSES[0].cle` de l'autre) : changer le défaut désynchronisait la barre
  de la case cochée, et rien ne l'aurait signalé.

**Piège de la même famille, côté serveur, à ne pas reproduire ici :** l'app
envoie `{"discovery": null}` pour « Automatique ». Ce `null` était décodé en
`Double.NaN` et empoisonnait le profil, tandis que la réponse et `GET /prefs`
rendaient tous deux `null` — l'écran confirmait donc le réglage choisi
pendant que le classement était débranché. Corrigé côté moteur, mais la leçon
vaut pour l'app : **une valeur que l'écran affiche comme acceptée n'est pas
une preuve qu'elle a été stockée telle quelle.**

## Le fil consultait le moteur une fois tous les douze swipes

Corrigé le 2026-08-26, sur demande : *« fais que ça s'actualise tous les 4
swipes »*.

**Ce n'est pas le seuil de rechargement qui gouverne la réactivité, c'est la
taille du lot.** Avec des lots de douze et `REFILL_AT = 6`, la file oscille
entre six et dix-huit cartes : le moteur n'est donc consulté qu'une fois tous
les douze swipes, et une carte peut attendre **dix-huit swipes** entre le
moment où elle est classée et celui où on la voit. C'est ce décalage qu'on
ressent comme « il n'a pas compris ce que je viens d'aimer » — le classement
était juste, il datait.

Deux tailles désormais : `LOT_INITIAL = 12` au démarrage (l'écran se remplit
d'un seul aller-retour, c'est le seul moment où quelqu'un attend devant du
vide) et `LOT_SUIVANT = 4` ensuite. La file oscille alors entre six et dix, le
moteur est consulté tous les quatre swipes, et rien n'attend plus de dix
cartes.

**`REFILL_AT` reste à 6, et ne doit pas redescendre à 4** : c'est une durée
déguisée, et quatre cartes valent moins que le délai d'abandon du client.

Ce que ça coûte, mesuré contre la production ce jour-là :

| lot | durée | appels Deezer | par carte |
|---|---|---|---|
| 12 | 1315-1648 ms | 12-15 | ~1,1 |
| 6 | 1057-1277 ms | 10-12 | ~1,8 |
| 4 | 959-1112 ms | 9-10 | ~2,4 |

Le coût par carte double, parce que **construire le vivier (~300 candidats)
coûte la même chose qu'on en serve quatre ou douze**. À l'échelle actuelle
c'est sans danger : on est à environ 1 % du plafond quotidien de Deezer, et
`Deezer.Espacement` borne de toute façon le débit à ~9 appels/s. Ce qui se
réduit de moitié, c'est le nombre de cartes que **la plateforme entière** peut
servir par seconde : ~8/s avec des lots de douze, ~3,7/s avec des lots de
quatre.

C'est un plafond de croissance, pas un coût d'aujourd'hui — et c'est la
première ligne à remonter si le fil se met à ralentir à plusieurs. `npm run
bench` reste vert sur les quatre réseaux.
