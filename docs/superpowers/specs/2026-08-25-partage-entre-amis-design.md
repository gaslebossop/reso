# Partager un son avec ses amis

Design validé le 2026-08-25. Portée : **envoyer un titre du fil à quelqu'un
qu'on suit et qui nous suit en retour**, et le recevoir comme une carte.

## Ce que ce chantier ajoute, en une phrase

Une personne écoute un extrait, pense à quelqu'un, et le lui envoie. Chez
l'autre, le titre arrive **dans le fil**, signé, et se swipe comme les autres.

## Ce que ce chantier ne fait pas

- **Pas de mot joint.** Le son est le message.
- **Pas de conversation.** Aucune pile de messages par personne, aucun fil de
  discussion. Reso n'est pas une messagerie, et le jour où l'on doit y répondre
  par écrit, c'en est une.
- **Pas de partage vers l'extérieur.** Un lien vers Deezer existe déjà là où il
  a sa place ; ce chantier ne parle que de gens qui sont tous les deux ici.
- **Pas de partage de groupe**, pas de destinataire qui ne soit pas un ami.

## 1. Un ami est une conséquence, pas un objet

**Ami = suivi réciproque.** `social_suivis` jointe à elle-même :

```sql
SELECT u.* FROM social_suivis a
JOIN social_suivis b ON b.suiveur = a.suivi AND b.suivi = a.suiveur
JOIN users u ON u.id = a.suivi
WHERE a.suiveur = ?
```

**Rien de neuf n'est stocké pour ça**, et c'est délibéré. Une table
`amitiés` avec des demandes à accepter aurait ajouté un troisième état
(demandé / accepté / refusé) à un graphe qui n'en a que deux, et il aurait
fallu la tenir cohérente avec `social_suivis` à chaque désabonnement. Ici, ne
plus suivre quelqu'un défait l'amitié sans qu'une ligne de code s'en occupe.

Même règle que partout dans le social : **les profils cachés ne comptent pas.**
Quelqu'un qui s'est retiré de la recherche n'apparaît pas dans la liste d'amis
et ne reçoit rien.

## 2. Le partage, lui, est un fait — il faut l'écrire

Les notifications de cette application sont **dérivées, jamais écrites**
(`GenreNotif`, `Repo.notifs`) : un nouvel abonné se lit dans `social_suivis`,
un titre repris dans `library_tracks`. Un partage ne se déduit de rien. C'est
la seule table neuve du chantier.

```sql
CREATE TABLE IF NOT EXISTS social_partages (
  id         BIGSERIAL   PRIMARY KEY,
  de         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a          TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   BIGINT      NOT NULL,
  track      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  livre_at   TIMESTAMPTZ,
  CHECK (de <> a)
);
CREATE INDEX social_partages_a_idx  ON social_partages (a, created_at DESC);
CREATE INDEX social_partages_de_idx ON social_partages (de, created_at DESC);
CREATE INDEX social_partages_attente_idx ON social_partages (a) WHERE livre_at IS NULL;
```

**La fiche entière est stockée**, comme dans `library_tracks` et pour la même
raison : le catalogue Deezer bouge, et un titre disparu ne doit pas faire
disparaître le souvenir de l'envoi. Seule l'URL de preview est re-résolue à la
lecture — elle est signée et expire en quinze minutes.

`livre_at` dit que la carte est partie dans un lot. L'index partiel sert la
seule requête chaude : « qu'est-ce qui attend d'être livré à cette personne ».

**La réciprocité se vérifie à l'écriture**, pas à l'affichage : `POST
/social/partager` refuse en 403 un destinataire qui n'est pas un ami. Un client
modifié ne peut donc pas envoyer à un inconnu.

## 3. Le quota : trois sons par jour

**Trois titres distincts par jour et par expéditeur**, tous destinataires
confondus. Envoyer le même son à quatre amis coûte **un** des trois.

```sql
SELECT COUNT(DISTINCT track_id) FROM social_partages
WHERE de = ? AND created_at >= date_trunc('day', now())
```

Le quota est refusé si le compte atteint 3 **et** que le titre demandé n'est
pas déjà parmi ceux du jour — renvoyer le même son plus tard dans la journée à
quelqu'un d'autre reste toujours gratuit.

Deux raisons, et la seconde compte plus que la première :

- **Le fil de l'autre est ce qu'on protège.** Sans plafond, une personne peut
  noyer le fil d'une autre, et c'est le fil qui prend — l'objet central de
  l'application.
- **La rareté fait le sens.** Trois par jour, ça se choisit. Illimité, ça se
  jette. C'est le même raisonnement que le refus des séries quotidiennes :
  engagement oui, compulsion non.

Le compteur restant est **renvoyé par le serveur**, dans le champ `restants` de
`GET /social/amis` (à l'ouverture de la feuille) comme de `POST
/social/partager` (après chaque envoi), et affiché dans la feuille. Le calculer
côté app le ferait diverger dès qu'on envoie depuis un deuxième appareil.

## 4. La réception : une carte dans le fil

`Feed.next` **préfixe le lot** avec les partages en attente, puis complète avec
les cartes qu'il a choisies, de sorte que le lot garde sa taille :

```scala
partages ++ scored.take(limit - partages.size)
```

**Le préfixe se fait à l'intérieur de `Feed.next`, avant `markSeen`.** C'est le
point de mise en œuvre à ne pas rater : `markSeen` est appelé une seule fois,
sur les cartes servies (`Feed.scala:124`). Préfixer dans la route, en dehors,
laisserait les titres partagés hors de l'anti-répétition — ils reviendraient
ensuite par le chemin normal, ce qui est exactement ce que `seen_tracks`
existe pour empêcher.

`livre_at` est posé dans le même mouvement.

### Ce qui change dans le modèle

`Scored` gagne un champ :

```scala
envoyePar: Option[Gen] = None
```

Porté par la carte plutôt que récupéré à part, pour la même raison que
`followed` juste au-dessus : le bandeau doit être dans le bon état dès la
première image. Une requête séparée le ferait apparaître sous les yeux.

### Conséquences assumées

- **Le partage arrive au prochain rechargement**, donc au plus six swipes plus
  tard (`REFILL_AT`). Pas instantanément. Le rendre immédiat demanderait du
  polling depuis l'app, et un aller-retour périodique sur le chemin le plus
  chaud est précisément ce que ce dépôt a passé une journée à retirer.
- **Le titre est injecté même s'il a déjà été vu, ou s'il est déjà en
  bibliothèque.** L'anti-répétition sert le moteur, pas ton ami. Un partage est
  un message : le recevoir a du sens même si on connaît le morceau.

## 5. Le goût : un « passer » sur un son d'ami ne compte pas

| Verdict sur une carte partagée | `swipe_events` | `seen_tracks` |
|---|---|---|
| garder | oui | oui |
| aimer | oui | oui |
| passer | **non** | oui |
| bannir | oui | oui |

`seen_tracks` est écrit au service, pas au verdict (§4) : passer sur une carte
partagée n'archive donc rien, mais le titre ne revient pas pour autant.

Et **une carte partagée n'entre jamais dans `serve_log`** — cette table est
écrite au service elle aussi, et le préfixe du lot la contourne entièrement.

**Pourquoi « passer » ne compte pas.** Un passage sur un son qu'un ami envoie
est souvent social — on le connaît déjà, on n'est pas d'humeur, on répondra
plus tard — et le compter pousserait le profil à l'opposé d'un artiste pour une
raison qui n'a rien à voir avec le goût.

**Pourquoi « bannir » compte quand même.** Bannir est le geste le plus explicite
et le plus destructeur de l'application. L'ignorer parce que la carte vient d'un
ami ferait mentir le bouton, et c'est pire qu'une donnée de trop.

**Pourquoi `serve_log` est contourné.** Cette table enregistre ce que le modèle
*croyait* en servant la carte — facette, score, part d'exploration — pour
entraîner un futur reclasseur. Sur une carte partagée, il n'a rien cru du tout :
y écrire des zéros empoisonnerait le jeu d'entraînement avec des lignes qui ne
décrivent aucune décision.

**Comment le moteur le sait.** L'app envoie `from_share: true` dans `POST
/feed/event` — elle le sait, sa carte porte `envoye_par`. Le serveur ne s'en
sert que pour **supprimer** un événement, jamais pour en créer un : un client
modifié ne peut donc qu'abîmer son propre profil.

Une lecture en base aurait été plus sûre, et elle est refusée : `/feed/event`
est le chemin le plus chaud de l'application, et `AGENTS.md` interdit d'y
remettre quoi que ce soit.

## 6. Les notifications restent dérivées

`social_partages` devient une **troisième source** à côté de `social_suivis` et
`library_tracks`. Aucune ligne de notification n'est écrite.

| Genre | Dérivé de | Texte |
|---|---|---|
| `partage_recu` | `social_partages` où `a = moi` | « Sam t'a envoyé *Fantôme* » |
| `partage_garde` | `social_partages` où `de = moi`, joint à la bibliothèque du destinataire | « Sam a gardé le son que tu lui as envoyé » |

`partage_recu` est le filet de sécurité : une carte peut être ratée — l'app
fermée entre la livraison et le swipe — mais la notification, elle, reste.

**Un « passé » ne remonte jamais à l'expéditeur.** Dire à quelqu'un qu'on a
zappé son morceau est une petite cruauté gratuite, et c'est exactement ce qui
fait arrêter d'envoyer. Le retour est asymétrique par construction : le positif
seul.

`partage_garde` se dérive comme `match` le fait déjà — l'entrée existe si le
titre est dans `library_tracks` du destinataire **et** qu'il y est entré après
l'envoi. Sans cette dernière condition, envoyer un son que l'autre avait déjà
gardé produirait une fausse bonne nouvelle.

## 7. L'envoi, côté écran

### L'icône

Sur le **cartel** de la carte, à droite du titre. Le cartel a une hauteur
constante (`CARTEL = 154`) et l'icône s'y pose sans la changer : la géométrie
de `cadreCarte` ne bouge pas, donc le vol vers la trace part toujours du même
carré.

Aucun geste n'est réattribué. Gauche, droite, haut et l'appui long gardent
exactement ce qu'ils font — c'est la leçon de la refonte refusée du
2026-08-23 : refaire la forme d'un écran n'autorise pas à en faire réapprendre
l'usage.

### La feuille

Un appui ouvre une `Feuille` : les visages des amis, et le compteur du jour.

- **Un tap envoie**, le visage se coche, on peut en toucher plusieurs. Pas de
  bouton « Envoyer » — l'envoi *est* le tap. Un bouton de confirmation aurait
  demandé un second geste pour une action réversible… qui ne l'est pas, mais
  dont le coût d'erreur est un ami qui reçoit un son.
- **Le compteur est visible dès l'ouverture** : « 2 envois restants
  aujourd'hui ». Découvrir un plafond en le heurtant est la pire façon de
  l'apprendre.
- **Sans ami, la feuille le dit** et renvoie vers la recherche de l'onglet
  « Les gens ». Une feuille vide laisserait croire à une panne.
- Optimiste : le visage se coche tout de suite, l'appel part ensuite. Un refus
  décoche et affiche pourquoi.

### Le bandeau, côté réception

Au-dessus de la pochette : l'avatar de l'expéditeur et « Léa te l'envoie ».
Il vit **au-dessus** du carré de la pochette, jamais dedans — la pochette reste
entière, ce qui est le point sur lequel les cartes ont déjà été refaites une
fois.

## 8. Ce que ça touche

### Moteur (`prisme`)

| Fichier | Ce qui change |
|---|---|
| `Db.scala` | la table `social_partages` et ses trois index |
| `Repo.scala` | `amis`, `partager`, `partagesEnAttente`, `restantsAujourdhui`, deux sources dans `notifs` ; `GenreNotif` gagne deux cas |
| `Models.scala` | `Scored.envoyePar`, encodage `envoye_par` |
| `Feed.scala` | le préfixe du lot, avant `markSeen` |
| `Routes.scala` | `GET /social/amis`, `POST /social/partager`, `from_share` sur `/feed/event`, les deux genres dans `/social/notifs` |

### App (`reso`)

| Fichier | Ce qui change |
|---|---|
| `src/api/types.ts` | `Card.envoye_par`, `Notif.genre` élargi, type `Ami` |
| `src/api/client.ts` | `amis()`, `partager(trackId, aQui)`, `from_share` sur `event()` |
| `src/components/Passage.tsx` | l'icône sur le cartel, le bandeau signé |
| `app/(tabs)/index.tsx` | la feuille d'envoi, le passage de `from_share` au swipe |
| `app/notifs.tsx` | les deux genres |
| `src/components/Icones.tsx` | `IconeEnvoyer` |

### Tests

- **Réciprocité** : suivre sans être suivi n'ouvre aucun envoi ; se désabonner
  ferme l'amitié dans les deux sens ; un profil caché n'est jamais un ami.
- **Quota** : trois titres distincts passent, le quatrième non ; le même titre
  à quatre amis ne coûte qu'un ; le compteur repart le lendemain.
- **Préfixe du lot** : les partages en attente sortent en tête, le lot garde sa
  taille, `livre_at` est posé, `seen_tracks` est écrit.
- **Notifications** : `partage_garde` n'apparaît que si le titre est entré en
  bibliothèque **après** l'envoi ; un « passé » ne produit rien.

## 9. Réserves, non traitées

- **L'arrivée n'est pas instantanée** (voir §4). Si ça se révèle frustrant à
  l'usage, la réponse est une notification poussée, pas du polling.
- **Aucun moyen de bloquer les envois de quelqu'un** sans se désabonner de lui.
  Le plafond de trois par jour rend le harcèlement coûteux, il ne le rend pas
  impossible. À instruire si le cas se présente.
- **Les partages ne sont purgés par rien.** La table grandit d'au plus trois
  lignes par personne et par jour ; à l'échelle actuelle, ce n'est pas un
  problème, mais ce n'en est pas un *par construction*.
