# Import du goût par lien — Deezer et YouTube Music

Design validé le 2026-08-23. Portée : **import du goût seulement**, jamais
d'écriture.

## Pourquoi ce chantier existe

`app/plateforme.tsx` propose cinq réponses et une seule sait importer un goût :
Spotify. Les quatre autres lignes disent la vérité, mais elles la disent pour
de mauvaises raisons — et ces raisons ont changé.

Vérifié le 2026-08-23 :

| Plateforme | OAuth | Verdict |
|---|---|---|
| Deezer | **fermé** — Deezer a suspendu la création de nouvelles applications après des abus répétés des ToS. Aucun App ID ni Secret neuf n'est délivrable. | pas d'OAuth, **mais voir plus bas** |
| Apple Music | possible, mais exige un compte Apple Developer à 99 €/an pour la clé MusicKit `.p8` | hors périmètre : refusé pour raison de coût |
| YouTube Music | aucune API de bibliothèque ; l'API YouTube Data v3 ne lit les titres likés qu'en OAuth avec un scope sensible à faire vérifier | pas d'OAuth, **mais voir plus bas** |

Le retournement : **l'import ne dépend pas de l'OAuth, il dépend d'avoir un
identifiant.** Les routes Deezer *par identifiant* sont restées ouvertes, sans
jeton ni clé. Une playlist YouTube publique se lit avec une simple clé API.

Donc on remplace « autorise Reso à lire ton compte » par **« colle ton lien »**.

Mesuré, sans aucune authentification :

```
GET api.deezer.com/user/{id}/tracks     -> titres likés, avec isrc
GET api.deezer.com/user/{id}/artists    -> artistes suivis
GET api.deezer.com/user/{id}/playlists  -> playlists
GET api.deezer.com/playlist/{id}/tracks -> titres, avec isrc
profil privé ou inexistant              -> {"error":{"code":800,"message":"no data"}}
```

## Ce que ce chantier ne fait pas

**Il n'ajoute aucune écriture.** Aucun lien ne permet d'écrire chez qui que ce
soit. « Ajouter aux titres likés » reste réservé à Spotify, et le repli des
autres — ouvrir le titre chez elles — ne bouge pas. Cette ligne d'`AGENTS.md`
reste vraie et ne doit pas être « améliorée » :

> Pour les trois sans écriture, « ajouter aux likés » ouvre le titre chez eux.
> C'est un geste de moins, et rien de plus n'est promis à l'écran.

**Apple Music reste sans import.** Le seul chemin gratuit serait de parser le
bloc `serialized-server-data` de la page publique — ça marche aujourd'hui, ça
cassera au prochain changement de HTML d'Apple. Écarté délibérément.

## Où vit le code, et pourquoi côté serveur

Le parsing va dans **Prisme**, pas dans l'app :

- la clé API YouTube ne doit pas se trouver dans le bundle Expo ;
- `Deezer.scala` existe déjà, avec son cache Redis et la résolution
  d'homonymes (`HomonymesSpec`) qui est exactement le problème qu'un import
  par noms fait ressurgir ;
- un parseur qui casse se corrige par un redéploiement du VPS, pas par une
  release Expo Go — ce qui compte pour un projet figé au SDK 54.

## Le contrat

`POST /import/lien { url }` → `{ source, artist_ids, artists, titres }`

```
source     : "deezer_profil" | "deezer_playlist" | "ytmusic_playlist"
artist_ids : Int[]     identifiants Deezer natifs, du plus écouté au moins
artists    : String[]  noms, quand aucun identifiant n'est connu
titres     : Int       nombre de titres lus, pour l'affichage
```

Les deux champs sont exclusifs par source, et c'est le point le plus important
du design : `POST /taste/seed` accepte déjà **`artist_ids`** aussi bien que
`artists`. Un import Deezer rend donc des identifiants Deezer et
**contourne entièrement la résolution par nom** — pas de recherche, pas
d'homonyme, pas de « PNL » qui résout vers Pink Floyd. Seul YouTube, qui ne
connaît pas Deezer, passe par les noms.

## L'extraction, source par source

### Deezer, lien de profil — `deezer.com/profile/{id}`

`GET /user/{id}/tracks?limit=100`, paginé jusqu'à **300 titres** au plus.

La source principale est **les titres likés, pas `/user/{id}/artists`**. Les
artistes « suivis » sont un geste rare : beaucoup de comptes en ont trois ou
zéro, alors que les mêmes ont des centaines de titres likés. On agrège
`track.artist.id` par fréquence et on trie décroissant — ce qui donne en prime
une pondération que l'import Spotify n'a pas.

Plafond à 300 : au-delà, la latence de l'onboarding se voit, et les artistes
de queue n'apportent plus rien au classement.

### Deezer, lien de playlist — `deezer.com/playlist/{id}`

`GET /playlist/{id}/tracks?limit=100`, même agrégation.

Le repli quand le profil est privé — et le seul chemin pour quelqu'un qui ne
veut pas rendre son profil public. À dire à l'écran, pas à deviner.

### YouTube Music, lien de playlist publique

`music.youtube.com/playlist?list={id}` et `youtube.com/playlist?list={id}` :
même identifiant, mêmes données.

`playlistItems.list` — **1 unité de quota par page de 50**, quota de
10 000/jour par projet, soit ~2 500 pages. Confortable. Une clé API suffit,
aucun OAuth : la playlist est publique.

> Ne jamais passer par `search.list` (100 unités l'appel) pour apparier les
> titres : ~100 recherches par jour pour toute l'app, tous utilisateurs
> confondus. C'est ce qui rend l'appariement titre-à-titre impraticable, et
> c'est pourquoi on n'extrait que des **noms d'artistes**.

Extraction du nom d'artiste, par ordre de fiabilité :

1. `snippet.videoOwnerChannelTitle` finissant par ` - Topic` → le préfixe est
   le nom de l'artiste, donné par YouTube lui-même. C'est le cas le plus
   fréquent dans YouTube Music et le plus propre.
2. sinon, `snippet.title` découpé sur le premier ` - ` → partie gauche.
3. sinon, on laisse tomber ce titre.

Nettoyage appliqué ensuite : suppression des suffixes entre parenthèses ou
crochets (`(Official Video)`, `(Official Music Video)`, `(Lyric Video)`,
`(Audio)`, `(Visualizer)`, `[4K]`, `(Remastered …)`), et de ` ft. ` / ` feat. `
et ce qui suit.

Les noms ainsi obtenus partent dans `artists`, et c'est `Matching.scala` qui
les résout — avec la gestion d'homonymes déjà écrite.

## Erreurs

Chacune a un message propre à l'écran. Le mode d'échec à éviter est celui du
403 de Spotify : un message générique qui envoie chercher le problème ailleurs.

| Cas | Ce qui est dit |
|---|---|
| Deezer `code 800` | « Ce profil Deezer est privé. Rends-le public dans les réglages Deezer, ou colle plutôt le lien d'une playlist. » |
| URL non reconnue | « Ce lien n'est pas un profil ni une playlist. » avec un exemple de chaque forme attendue |
| playlist vide / 0 artiste extrait | on **n'escamote pas** l'écran des artistes ; on y va, et l'écran le dit |
| clé YouTube absente côté serveur | YouTube n'est pas proposé comme import du tout (voir capacités) |
| Deezer/YouTube injoignable | « Impossible de lire ce lien pour l'instant. » |

## Capacités annoncées

`YOUTUBE_API_KEY` suit la convention de `Config.scala` : facultative, et son
absence dégrade proprement plutôt que de casser. Prisme expose donc

`GET /import/sources` → `["deezer"]` ou `["deezer","ytmusic"]`

L'app la lit une fois. Si l'appel échoue, elle suppose `["deezer"]` — Deezer
ne demande aucune clé, donc c'est toujours vrai.

## Côté app

**`src/state/plateforme.ts`** — le booléen `importe` devient un tri-état, parce
que Spotify et Deezer ne demandent pas le même geste et que l'écran doit
savoir lequel proposer :

```
importe: 'compte' | 'lien' | false
```

Spotify est `'compte'`, Deezer et YouTube Music `'lien'`, Apple Music et
« Aucune » restent `false`. Les lignes `dit` sont réécrites en conséquence.

**`app/import-lien.tsx`** — nouvel écran : un champ, et surtout **où trouver
le lien**. C'est le vrai point de friction et il se règle par le texte, pas
par le code : dans Deezer, Profil → ⋯ → Partager mon profil.

**`app/plateforme.tsx`** — une plateforme `'lien'` pousse vers cet écran. Le
succès enchaîne sur `prisme.seed(...)` puis `/habitude`, exactement comme
Spotify aujourd'hui.

La règle en place tient et ne doit pas être « simplifiée » :

> L'écran des artistes n'est sauté que si l'import a réellement rendu des noms.

## Tests

`prisme/src/test/scala/prisme/ImportSpec.scala` :

- reconnaissance d'URL : les deux formes Deezer, les deux formes YouTube,
  une URL avec paramètres de suivi, une URL étrangère ;
- agrégation par fréquence : l'ordre rendu suit bien le nombre d'occurrences ;
- plafond à 300 titres respecté ;
- ` - Topic` : le nom d'artiste est bien le préfixe ;
- nettoyage des titres YouTube, un cas par motif supprimé ;
- profil privé (`code 800`) → l'erreur typée, pas une exception nue ;
- playlist vide → liste vide, pas d'échec.

Côté app, `plateforme.ts` : `importe` a bien trois états et `lienVers` n'est
pas modifié.

## Ordre de mise en œuvre

1. Deezer, profil et playlist — aucun prérequis, appariement exact.
2. `GET /import/sources` et l'écran.
3. YouTube Music — après création de la clé API Google.
