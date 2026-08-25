# Partage entre amis — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'envoyer un titre du fil à un ami (suivi réciproque), et de le recevoir comme une carte signée dans son propre fil.

**Architecture:** Une table neuve côté moteur (`social_partages`) ; l'amitié reste calculée depuis `social_suivis`, jamais stockée. `Feed.next` préfixe le lot avec les partages en attente. Les notifications restent dérivées : `social_partages` devient une troisième source. Côté app, une icône sur le cartel ouvre une feuille d'amis, et la ligne de mention du cartel porte la signature à la réception.

**Tech Stack:** Scala 3.3.4 / http4s / circe / munit / Postgres (moteur, dépôt `../prisme`) — React Native + Expo SDK 54 / TypeScript (app, dépôt courant).

**Spec:** `docs/superpowers/specs/2026-08-25-partage-entre-amis-design.md`

## Global Constraints

- **Deux dépôts.** Le moteur est `C:/Users/nouno/OneDrive/Bureau/IAFILTRE/prisme`, l'app est `C:/Users/nouno/OneDrive/Bureau/IAFILTRE/reso`. Chacun a son git ; les commits ne se mélangent pas.
- **Expo SDK figé à 54.** Ne jamais le remonter, ne rien installer qui l'exige.
- **Trois sons par jour et par expéditeur**, titres distincts, tous destinataires confondus. Valeur exacte : `Tuning.PartagesParJour = 3`.
- **Ami = suivi réciproque**, profils cachés exclus. Aucune table d'amitié.
- **Les notifications sont dérivées, jamais écrites.** Aucune ligne de notification n'est insérée nulle part.
- **Rien de nouveau sur `/feed/event` qui dépende de `replay.load`** — c'est le chemin le plus chaud de l'application.
- **`serve_log` ne reçoit jamais une carte partagée.**
- **Les commentaires du code sont en français sans accents côté Scala** (le reste du moteur l'est), **avec accents côté TypeScript** (le reste de l'app l'est). Suivre le fichier qu'on modifie.
- Fin de message de commit : `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Après toute modification du moteur : `sbt -batch test` doit être vert, **puis `bash deploy-vps.sh`**.
- Après toute modification de l'app : `npx tsc --noEmit` doit passer.

---

## Structure des fichiers

### Moteur (`../prisme`)

| Fichier | Responsabilité, après ce chantier |
|---|---|
| `src/main/scala/prisme/Db.scala` | + la table `social_partages` et ses trois index |
| `src/main/scala/prisme/Repo.scala` | + `GenreNotif.PartageRecu/PartageGarde` ; + 5 méthodes au trait, à `PgRepo` et à `MemoryRepo` ; + 2 sources dans `notifs` |
| `src/main/scala/prisme/Models.scala` | + `Scored.envoyePar`, + `envoye_par` dans l'encodeur |
| `src/main/scala/prisme/Tuning.scala` | + `PartagesParJour` |
| `src/main/scala/prisme/Feed.scala` | + le préfixe du lot, avant `markSeen` |
| `src/main/scala/prisme/Routes.scala` | + `GET /social/amis`, `POST /social/partager` ; `from_share` sur `/feed/event` ; 2 genres dans `/social/notifs` |
| `src/test/scala/prisme/PartageSpec.scala` | **neuf** — amitié, quota, livraison, notifications |

### App (dépôt courant)

| Fichier | Responsabilité, après ce chantier |
|---|---|
| `src/api/types.ts` | + `Ami`, + `Card.envoye_par`, `Notif.genre` élargi |
| `src/api/client.ts` | + `amis()`, + `partager()`, + `fromShare` sur `event()` |
| `src/components/Icones.tsx` | + `IconeEnvoyer` |
| `src/components/Passage.tsx` | + l'icône d'envoi sur la ligne du titre, + la signature sur la ligne de mention |
| `src/components/FeuilleEnvoi.tsx` | **neuf** — la feuille qui liste les amis et envoie |
| `app/(tabs)/index.tsx` | + l'ouverture de la feuille |
| `src/state/useFeed.ts` | + `fromShare` au moment du swipe |
| `app/notifs.tsx` | + les deux genres |
| `AGENTS.md` | + une section sur le partage |

---

## Task 1 : la table, et l'amitié qui se calcule

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Db.scala` (à la fin de `migrate`, après le bloc `artist_suivis`)
- Modify: `../prisme/src/main/scala/prisme/Repo.scala` (trait, `PgRepo`, `MemoryRepo`)
- Test: `../prisme/src/test/scala/prisme/PartageSpec.scala` (créer)

**Interfaces:**
- Consomme : `Gen(id, handle, nom, avatar, gardes)`, `MemoryRepo`, `repo.suivre(moi, autre)`, `repo.setVisible(userId, v)`
- Produit : `def amis(userId: String): IO[List[Gen]]` sur le trait `Repo`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `../prisme/src/test/scala/prisme/PartageSpec.scala` :

```scala
package prisme

import cats.effect.IO
import cats.effect.unsafe.implicits.global

/** Le partage entre amis.
  *
  * Un ami n'est pas un objet : c'est un suivi reciproque, calcule a la
  * lecture. Ce fichier tient surtout la seule chose qui pourrait deriver en
  * silence — qui a le droit d'envoyer a qui, et combien de fois.
  */
class PartageSpec extends munit.FunSuite:

  private def track(id: Long) =
    Track(id, None, s"t$id", Artist(id, s"a$id", ""), "", "", "http://p", 200, 1000, None)

  /** Un compte G, sinon rien de social ne le voit. */
  private def compte(repo: MemoryRepo, id: String, nom: String): IO[Unit] =
    repo.upsertUser(Identity(id, isG = true, Some(nom), None, None)).void

  test("suivre sans etre suivi ne fait pas un ami"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.suivre("moi", "lea")
      a <- repo.amis("moi")
    yield assertEquals(a, Nil)).unsafeRunSync()

  test("le suivi reciproque fait un ami, des deux cotes"):
    val repo = new MemoryRepo
    (for
      _  <- compte(repo, "moi", "Moi")
      _  <- compte(repo, "lea", "Lea")
      _  <- repo.suivre("moi", "lea")
      _  <- repo.suivre("lea", "moi")
      a1 <- repo.amis("moi")
      a2 <- repo.amis("lea")
    yield
      assertEquals(a1.map(_.id), List("lea"))
      assertEquals(a2.map(_.id), List("moi"))).unsafeRunSync()

  test("se desabonner defait l'amitie dans les deux sens"):
    val repo = new MemoryRepo
    (for
      _  <- compte(repo, "moi", "Moi")
      _  <- compte(repo, "lea", "Lea")
      _  <- repo.suivre("moi", "lea")
      _  <- repo.suivre("lea", "moi")
      _  <- repo.nePlusSuivre("moi", "lea")
      a1 <- repo.amis("moi")
      a2 <- repo.amis("lea")
    yield
      assertEquals(a1, Nil)
      assertEquals(a2, Nil)).unsafeRunSync()

  test("un profil cache n'est l'ami de personne"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.suivre("moi", "lea")
      _ <- repo.suivre("lea", "moi")
      _ <- repo.setVisible("lea", false)
      a <- repo.amis("moi")
    yield assertEquals(a, Nil)).unsafeRunSync()
```

**Avant d'écrire ce fichier**, vérifier la signature exacte de `upsertUser` et de `Identity` :

```bash
cd ../prisme && grep -n "def upsertUser" -A 3 src/main/scala/prisme/Repo.scala && grep -n "case class Identity" -A 8 src/main/scala/prisme/*.scala
```

Adapter l'appel `compte` à la signature réelle si elle diffère. Ne pas inventer : lire.

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : ÉCHEC de compilation, `value amis is not a member of prisme.MemoryRepo`.

- [ ] **Step 3 : la table**

Dans `Db.scala`, à la toute fin du bloc `try` de `migrate`, juste après la création de `artist_suivis` et avant `finally st.close()` :

```scala
      // Les sons qu'on s'envoie. La seule table de ce chantier, et la seule
      // chose qu'il fallait ecrire : l'amitie, elle, se calcule (voir
      // `Repo.amis`), et les notifications se derivent d'ici.
      //
      // La fiche entiere est rangee, comme dans `library_tracks` et pour la
      // meme raison : le catalogue Deezer bouge, et un titre disparu ne doit
      // pas faire disparaitre le souvenir de l'envoi. Seule l'URL de preview
      // est re-signee a la lecture — elle expire en quinze minutes.
      //
      // `livre_at` dit que la carte est partie dans un lot. L'index partiel
      // sert la seule requete chaude : ce qui attend d'etre livre a quelqu'un.
      st.execute("""
        CREATE TABLE IF NOT EXISTS social_partages (
          id         BIGSERIAL   PRIMARY KEY,
          de         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          a          TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          track_id   BIGINT      NOT NULL,
          track      JSONB       NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          livre_at   TIMESTAMPTZ,
          CHECK (de <> a)
        )""")
      st.execute("CREATE INDEX IF NOT EXISTS social_partages_a_idx ON social_partages (a, created_at DESC)")
      st.execute("CREATE INDEX IF NOT EXISTS social_partages_de_idx ON social_partages (de, created_at DESC)")
      st.execute(
        "CREATE INDEX IF NOT EXISTS social_partages_attente_idx ON social_partages (a) WHERE livre_at IS NULL"
      )
```

- [ ] **Step 4 : la déclaration au trait**

Dans `Repo.scala`, dans la section `// -- Le social ---`, juste après `def gensSuivis(...)` :

```scala
  /** Les amis : ceux qu'on suit ET qui nous suivent.
    *
    * **Calcule, jamais stocke.** Une table d'amities avec des demandes a
    * accepter aurait ajoute un troisieme etat a un graphe qui n'en a que
    * deux, et il aurait fallu la tenir coherente avec `social_suivis` a
    * chaque desabonnement. Ici, ne plus suivre quelqu'un defait l'amitie
    * sans qu'une ligne de code s'en occupe.
    *
    * Meme regle que partout dans le social : **les profils caches n'y sont
    * pas**. Se retirer de la recherche, c'est aussi cesser d'etre joignable.
    */
  def amis(userId: String): IO[List[Gen]]
```

- [ ] **Step 5 : l'implémentation Postgres**

Dans `PgRepo`, juste après `gensSuivis` :

```scala
  def amis(userId: String): IO[List[Gen]] =
    db.use { c =>
      val ps = c.prepareStatement("""
        SELECT u.id, u.handle, u.name, COALESCE(sa.data, u.picture) AS picture,
               (SELECT COUNT(*) FROM library_tracks l WHERE l.user_id = u.id)
        FROM social_suivis a
        JOIN social_suivis b ON b.suiveur = a.suivi AND b.suivi = a.suiveur
        JOIN users u ON u.id = a.suivi
        LEFT JOIN social_avatar sa ON sa.user_id = u.id
        LEFT JOIN social_prefs sp ON sp.user_id = u.id
        WHERE a.suiveur = ? AND u.kind = 'g' AND COALESCE(sp.visible, TRUE)
        ORDER BY a.created_at DESC""")
      try
        ps.setString(1, userId)
        Db.rows(ps.executeQuery()) { rs =>
          Gen(
            rs.getString(1),
            Option(rs.getString(2)).getOrElse(""),
            Option(rs.getString(3)).getOrElse(""),
            Option(rs.getString(4)).getOrElse(""),
            rs.getInt(5)
          )
        }
      finally ps.close()
    }.handleError(_ => Nil)
```

- [ ] **Step 6 : l'implémentation mémoire**

Dans `MemoryRepo`, juste après `gensSuivis`. **Lire d'abord** comment `gensSuivis` fabrique un `Gen` dans cette classe (il existe une fonction d'aide, souvent `genDe`) et la réutiliser telle quelle :

```bash
cd ../prisme && grep -n "genDe" -A 15 src/main/scala/prisme/Repo.scala | head -40
```

```scala
  def amis(userId: String): IO[List[Gen]] = IO {
    // `suivis` associe une cible a ses suiveurs. Un ami est donc quelqu'un
    // que je suis et dont je suis moi-meme dans la liste de suiveurs.
    val jeSuis = suivis.asScala.toVector.flatMap { (cible, xs) =>
      xs.collect { case (s, at) if s == userId => (cible, at) }
    }
    jeSuis
      .filter((cible, _) => suivis.getOrDefault(userId, Vector.empty).exists((s, _) => s == cible))
      .sortBy(-_._2)
      .flatMap((cible, _) => genDe(cible))
      .toList
  }
```

`genDe` écarte déjà les profils cachés et les comptes non-G — vérifier que c'est bien le cas dans le code lu à l'étape précédente, et l'ajouter au filtre si ce n'est pas le cas.

- [ ] **Step 7 : lancer les tests**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : les 4 tests passent.

- [ ] **Step 8 : commit**

```bash
cd ../prisme && git add src/main/scala/prisme/Db.scala src/main/scala/prisme/Repo.scala src/test/scala/prisme/PartageSpec.scala && git commit -m "$(cat <<'EOF'
Un ami est un suivi réciproque, et il se calcule

La table des partages arrive avec, mais l'amitié n'en a pas : une table
d'amitiés aurait ajouté un troisième état à un graphe qui n'en a que deux,
et il aurait fallu la tenir cohérente à chaque désabonnement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 : envoyer, et le quota de trois par jour

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Tuning.scala`
- Modify: `../prisme/src/main/scala/prisme/Repo.scala`
- Test: `../prisme/src/test/scala/prisme/PartageSpec.scala`

**Interfaces:**
- Consomme : `Repo.amis` (Task 1), `Track`
- Produit :
  - `Tuning.PartagesParJour: Int = 3`
  - `def partager(de: String, a: String, t: Track): IO[Unit]`
  - `def titresPartagesAujourdhui(de: String): IO[Set[Long]]`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `PartageSpec.scala` :

```scala
  test("trois titres distincts par jour, et le quatrieme est refuse par la regle"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.partager("moi", "lea", track(1))
      _ <- repo.partager("moi", "lea", track(2))
      _ <- repo.partager("moi", "lea", track(3))
      t <- repo.titresPartagesAujourdhui("moi")
    yield
      assertEquals(t, Set(1L, 2L, 3L))
      // La regle vit dans la route : le depot dit seulement ce qui est deja
      // parti aujourd'hui. Trois titres distincts, donc le quatrieme sera
      // refuse et un quatrieme envoi du titre 2 ne le sera pas.
      assert(t.size >= Tuning.PartagesParJour)
      assert(t.contains(2L))).unsafeRunSync()

  test("le meme titre a trois amis ne coute qu'un"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- compte(repo, "sam", "Sam")
      _ <- compte(repo, "tom", "Tom")
      _ <- repo.partager("moi", "lea", track(7))
      _ <- repo.partager("moi", "sam", track(7))
      _ <- repo.partager("moi", "tom", track(7))
      t <- repo.titresPartagesAujourdhui("moi")
    yield assertEquals(t, Set(7L))).unsafeRunSync()

  test("le quota est par expediteur, pas global"):
    val repo = new MemoryRepo
    (for
      _  <- compte(repo, "moi", "Moi")
      _  <- compte(repo, "lea", "Lea")
      _  <- repo.partager("moi", "lea", track(1))
      _  <- repo.partager("lea", "moi", track(2))
      m  <- repo.titresPartagesAujourdhui("moi")
      l  <- repo.titresPartagesAujourdhui("lea")
    yield
      assertEquals(m, Set(1L))
      assertEquals(l, Set(2L))).unsafeRunSync()
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : ÉCHEC de compilation, `value partager is not a member`.

- [ ] **Step 3 : le réglage**

Dans `Tuning.scala`, ajouter :

```scala
  /** Combien de titres distincts une personne peut envoyer par jour.
    *
    * Deux raisons, et la seconde compte plus : sans plafond, quelqu'un peut
    * noyer le fil d'un autre — et le fil est l'objet central de cette
    * application. Et surtout, **la rarete fait le sens** : trois par jour, ca
    * se choisit ; illimite, ca se jette.
    *
    * Le compte porte sur les **titres**, pas sur les envois : le meme son a
    * quatre amis coute un. Ce qui est rare, c'est le morceau qu'on juge digne
    * d'etre envoye, pas le nombre de gens a qui on pense.
    */
  val PartagesParJour = 3
```

- [ ] **Step 4 : la déclaration au trait**

Dans `Repo.scala`, après `def amis(...)` :

```scala
  /** Range un envoi. **Ne verifie ni l'amitie ni le quota** : les deux sont
    * des regles, et les regles vivent dans la route, avec le code HTTP
    * qu'elles justifient. Le depot ne fait qu'ecrire.
    *
    * La fiche entiere part en base — voir la table pour pourquoi. */
  def partager(de: String, a: String, t: Track): IO[Unit]

  /** Les titres deja envoyes aujourd'hui par ce compte, tous destinataires
    * confondus. Rend un ensemble et non un compte : la route a besoin de
    * savoir si le titre demande y figure deja, auquel cas il est gratuit. */
  def titresPartagesAujourdhui(de: String): IO[Set[Long]]
```

- [ ] **Step 5 : l'implémentation Postgres**

Dans `PgRepo`, après `amis`. **Lire d'abord** comment `addToLibrary` sérialise un `Track` en JSONB et reprendre exactement la même forme :

```bash
cd ../prisme && grep -n "def addToLibrary" -A 20 src/main/scala/prisme/Repo.scala
```

```scala
  def partager(de: String, a: String, t: Track): IO[Unit] =
    db.use { c =>
      val ps = c.prepareStatement("""
        INSERT INTO social_partages (de, a, track_id, track) VALUES (?, ?, ?, ?::jsonb)""")
      try
        ps.setString(1, de)
        ps.setString(2, a)
        ps.setLong(3, t.id)
        ps.setString(4, t.asJson.noSpaces)
        ps.executeUpdate()
        ()
      finally ps.close()
    }.attempt.void

  def titresPartagesAujourdhui(de: String): IO[Set[Long]] =
    db.use { c =>
      val ps = c.prepareStatement("""
        SELECT DISTINCT track_id FROM social_partages
        WHERE de = ? AND created_at >= date_trunc('day', now())""")
      try
        ps.setString(1, de)
        Db.rows(ps.executeQuery())(_.getLong(1)).toSet
      finally ps.close()
    }.handleError(_ => Set.empty)
```

`t.asJson` exige `import Codecs.given` en tête de `Repo.scala` — vérifier qu'il y est déjà (c'est le cas si `addToLibrary` sérialise de la même façon) et l'ajouter sinon.

- [ ] **Step 6 : l'implémentation mémoire**

Dans `MemoryRepo`, à côté des autres structures sociales, ajouter le champ puis les deux méthodes :

```scala
  /** (de, a, track, envoye_a, livre_at). Un `Vector` dans une reference
    * atomique : les tests sont sequentiels, mais le reste de cette classe
    * l'est aussi et la coherence de forme vaut mieux qu'une exception. */
  private val partages =
    new java.util.concurrent.atomic.AtomicReference[Vector[(String, String, Track, Long, Option[Long])]](
      Vector.empty
    )

  def partager(de: String, a: String, t: Track): IO[Unit] = IO {
    partages.updateAndGet(v => v :+ (de, a, t, System.currentTimeMillis(), None))
    ()
  }

  def titresPartagesAujourdhui(de: String): IO[Set[Long]] = IO {
    // Le repli memoire ne survit pas a un redemarrage : « aujourd'hui » y vaut
    // « depuis le demarrage ». Suffisant pour ce qu'il sert — les tests et un
    // moteur sans base.
    partages.get().collect { case (d, _, t, _, _) if d == de => t.id }.toSet
  }
```

- [ ] **Step 7 : lancer les tests**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : les 7 tests passent.

- [ ] **Step 8 : commit**

```bash
cd ../prisme && git add -A && git commit -m "$(cat <<'EOF'
Trois sons par jour, et c'est le titre qu'on compte

Le même morceau à quatre amis coûte un. Ce qui est rare, c'est le son qu'on
juge digne d'être envoyé, pas le nombre de gens à qui on pense en l'écoutant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 : la carte partagée traverse le fil

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Repo.scala`
- Modify: `../prisme/src/main/scala/prisme/Models.scala:196-215` (`Scored`) et `:252-261` (son encodeur)
- Modify: `../prisme/src/main/scala/prisme/Feed.scala:118-126`
- Test: `../prisme/src/test/scala/prisme/PartageSpec.scala`

**Interfaces:**
- Consomme : `partager` (Task 2), `Gen`, `Scored`, `Breakdown(collaborative, facetFit, discovery, exploration)`
- Produit :
  - `def partagesEnAttente(a: String, limit: Int): IO[List[(Gen, Track)]]`
  - `def marquerPartagesLivres(a: String, trackIds: Seq[Long]): IO[Unit]`
  - `Scored.envoyePar: Option[Gen] = None`, sérialisé en `envoye_par`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `PartageSpec.scala` :

```scala
  test("un partage attend, puis ne sort qu'une fois"):
    val repo = new MemoryRepo
    (for
      _  <- compte(repo, "moi", "Moi")
      _  <- compte(repo, "lea", "Lea")
      _  <- repo.suivre("moi", "lea")
      _  <- repo.suivre("lea", "moi")
      _  <- repo.partager("lea", "moi", track(42))
      a1 <- repo.partagesEnAttente("moi", 10)
      _  <- repo.marquerPartagesLivres("moi", List(42L))
      a2 <- repo.partagesEnAttente("moi", 10)
    yield
      assertEquals(a1.map((g, t) => (g.id, t.id)), List(("lea", 42L)))
      assertEquals(a2, Nil)).unsafeRunSync()

  test("l'attente est celle du destinataire, pas de l'expediteur"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.partager("lea", "moi", track(9))
      m <- repo.partagesEnAttente("moi", 10)
      l <- repo.partagesEnAttente("lea", 10)
    yield
      assertEquals(m.size, 1)
      assertEquals(l, Nil)).unsafeRunSync()

  test("une carte partagee porte son expediteur"):
    val g = Gen("lea", "lea", "Lea", "", 0)
    val s = Scored(track(1), 0.0, -1, Breakdown(0, 0, 0, 0), "Lea te l'envoie", envoyePar = Some(g))
    assertEquals(s.envoyePar.map(_.nom), Some("Lea"))
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : ÉCHEC de compilation sur `partagesEnAttente` et sur `envoyePar`.

- [ ] **Step 3 : les deux méthodes du dépôt**

Au trait, après `titresPartagesAujourdhui` :

```scala
  /** Ce qui attend d'etre livre a quelqu'un, du plus ancien au plus recent :
    * on lit ses messages dans l'ordre ou ils sont arrives. */
  def partagesEnAttente(a: String, limit: Int): IO[List[(Gen, Track)]]

  /** Marque livre. Appele par [[Feed]] au moment du service, dans le meme
    * mouvement que `markSeen`. */
  def marquerPartagesLivres(a: String, trackIds: Seq[Long]): IO[Unit]
```

Dans `PgRepo` :

```scala
  def partagesEnAttente(a: String, limit: Int): IO[List[(Gen, Track)]] =
    db.use { c =>
      val ps = c.prepareStatement("""
        SELECT u.id, u.handle, u.name, COALESCE(sa.data, u.picture) AS picture,
               (SELECT COUNT(*) FROM library_tracks l WHERE l.user_id = u.id),
               p.track
        FROM social_partages p
        JOIN users u ON u.id = p.de
        LEFT JOIN social_avatar sa ON sa.user_id = u.id
        LEFT JOIN social_prefs sp ON sp.user_id = u.id
        WHERE p.a = ? AND p.livre_at IS NULL AND COALESCE(sp.visible, TRUE)
        ORDER BY p.created_at ASC
        LIMIT ?""")
      try
        ps.setString(1, a)
        ps.setInt(2, limit)
        Db.rows(ps.executeQuery()) { rs =>
          val g = Gen(
            rs.getString(1),
            Option(rs.getString(2)).getOrElse(""),
            Option(rs.getString(3)).getOrElse(""),
            Option(rs.getString(4)).getOrElse(""),
            rs.getInt(5)
          )
          (g, parser.parse(rs.getString(6)).toOption.flatMap(Deezer.parseTrack))
        }.collect { case (g, Some(t)) => (g, t) }
      finally ps.close()
    }.handleError(_ => Nil)

  def marquerPartagesLivres(a: String, trackIds: Seq[Long]): IO[Unit] =
    if trackIds.isEmpty then IO.unit
    else
      db.use { c =>
        val ps = c.prepareStatement(
          "UPDATE social_partages SET livre_at = now() WHERE a = ? AND livre_at IS NULL AND track_id = ANY (?)"
        )
        try
          ps.setString(1, a)
          ps.setArray(2, c.createArrayOf("bigint", trackIds.map(Long.box).toArray))
          ps.executeUpdate()
          ()
        finally ps.close()
      }.attempt.void
```

Dans `MemoryRepo` :

```scala
  def partagesEnAttente(a: String, limit: Int): IO[List[(Gen, Track)]] = IO {
    partages
      .get()
      .collect { case (de, dest, t, at, None) if dest == a => (de, t, at) }
      .sortBy(_._3)
      .flatMap((de, t, _) => genDe(de).map(_ -> t))
      .take(limit)
      .toList
  }

  def marquerPartagesLivres(a: String, trackIds: Seq[Long]): IO[Unit] = IO {
    val cibles = trackIds.toSet
    val now    = System.currentTimeMillis()
    partages.updateAndGet(_.map {
      case (de, dest, t, at, None) if dest == a && cibles.contains(t.id) =>
        (de, dest, t, at, Some(now))
      case x => x
    })
    ()
  }
```

- [ ] **Step 4 : le champ sur la carte**

Dans `Models.scala`, à la fin de `Scored` (après `followed: Boolean = false`) :

```scala
    ,
    /** Qui te l'envoie, si cette carte est un partage.
      *
      * Porte par la carte plutot que recupere a part, pour la meme raison que
      * `followed` juste au-dessus : la signature doit etre dans le bon etat
      * des la premiere image. Une requete separee la ferait apparaitre sous
      * les yeux une fraction de seconde apres la pochette. */
    envoyePar: Option[Gen] = None
```

Et dans son encodeur, après `"followed"` :

```scala
      "envoye_par" -> s.envoyePar.map(g =>
        Json.obj(
          "user_id" -> g.id.asJson,
          "handle"  -> g.handle.asJson,
          "nom"     -> g.nom.asJson,
          "avatar"  -> g.avatar.asJson,
          "gardes"  -> g.gardes.asJson
        )
      ).getOrElse(Json.Null)
```

`Gen` vit dans `Repo.scala`, `Models.scala` est dans le même package `prisme` — aucun import à ajouter.

- [ ] **Step 5 : le préfixe du lot**

Dans `Feed.scala`, dans la `for`-compréhension de `next` : ajouter la lecture **avant** le calcul de `out` (à côté du `followed <-` de la ligne 45), puis le préfixe juste avant `refresh(out)`.

Lecture, après `followed <- ...` :

```scala
      // Ce qu'un ami t'a envoye passe devant tout ce que le moteur a choisi.
      // Plafonne a trois par lot : au-dela, un lot de douze cartes ne serait
      // plus un fil mais une boite de reception.
      attente <- repo.partagesEnAttente(userId, math.min(3, limit))
```

Puis, remplacer la ligne `servis <- refresh(out)` par :

```scala
      // Le prefixe se fait ICI et non dans la route, et c'est le point a ne
      // pas rater : `markSeen` et `logServis` sont appeles juste en dessous,
      // une seule fois, sur `servis`. Prefixer en dehors laisserait les titres
      // partages hors de l'anti-repetition — ils reviendraient ensuite par le
      // chemin normal, ce que `seen_tracks` existe precisement pour empecher.
      //
      // `facetId = -1` et un `Breakdown` a zero : cette carte n'a ete choisie
      // par aucune facette et le moteur n'a rien cru en la servant. C'est
      // aussi pourquoi elle ne part pas dans `logServis`.
      cartesAmis = attente.map { (g, t) =>
        Scored(t, 0.0, -1, Breakdown(0, 0, 0, 0), s"${g.nom} te l'envoie", envoyePar = Some(g))
      }
      avecAmis = cartesAmis ++ out.take(math.max(0, limit - cartesAmis.size))
      servis <- refresh(avecAmis)
```

Puis, juste après la ligne `_ <- repo.markSeen(userId, servis.map(_.track.id))` :

```scala
      _ <- repo.marquerPartagesLivres(userId, cartesAmis.map(_.track.id))
```

Et remplacer la ligne `_ <- repo.logServis(userId, servis, p.exploration)` par :

```scala
      // Les cartes d'amis sont ecartees du journal de service : cette table
      // enregistre ce que le modele CROYAIT en servant la carte, pour
      // entrainer un futur reclasseur. Il n'a rien cru ici, et y ecrire des
      // zeros empoisonnerait le jeu d'entrainement.
      _ <- repo.logServis(userId, servis.filter(_.envoyePar.isEmpty), p.exploration)
```

- [ ] **Step 6 : lancer toute la suite**

```bash
cd ../prisme && sbt -batch test
```

Attendu : tout passe, y compris les 10 tests de `PartageSpec`. Si `FeedSpec` échoue, lire l'erreur : c'est probablement un `Repo` de test qui n'implémente pas les nouvelles méthodes.

**Ce que ces tests ne couvrent pas, et qu'il faut savoir :** la taille du lot
(`cartesAmis ++ out.take(limit - cartesAmis.size)`), l'écriture de `seen_tracks`
et l'exclusion de `serve_log` ne sont vérifiées par aucun test — elles vivent
dans `Feed.next`, dont le montage de test demande un `Deezer`, un `Replay` et un
`Store`. Regarder `FeedSpec.scala` avant de conclure : **s'il monte déjà un
`Feed` complet, ajouter les trois assertions là-bas** (le lot fait `limit`
cartes, la carte partagée est en tête, `logServis` n'a rien reçu d'elle). S'il
ne monte rien de tel, ne pas construire ce montage pour l'occasion — le noter
ici et le vérifier à l'étape 5 de la Task 11, sur appareil.

- [ ] **Step 7 : commit**

```bash
cd ../prisme && git add -A && git commit -m "$(cat <<'EOF'
Ce qu'un ami envoie passe devant, et une seule fois

Le préfixe se fait dans Feed.next et non dans la route : markSeen et
logServis sont appelés juste en dessous. Préfixer en dehors laisserait les
titres partagés hors de l'anti-répétition, et ils reviendraient ensuite par
le chemin normal.

Les cartes d'amis sont écartées de serve_log : cette table dit ce que le
modèle croyait en servant la carte, et il n'a rien cru ici.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 : les deux routes

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Routes.scala` (section `// -- Le social ---`, après la route `GET /social/notifs`)

**Interfaces:**
- Consomme : `repo.amis`, `repo.partager`, `repo.titresPartagesAujourdhui`, `Tuning.PartagesParJour`, `dz.track`
- Produit :
  - `GET /social/amis` → `{ "amis": [Gen…], "restants": Int }`
  - `POST /social/partager` body `{ "track_id": Long, "a": String }` → `{ "envoye": true, "restants": Int }`

- [ ] **Step 1 : lire les conventions du fichier**

```bash
cd ../prisme && grep -n "withAccount\|def err\|withJson" -A 6 src/main/scala/prisme/Routes.scala | head -40
```

Relever la signature exacte de `withAccount`, `withJson` et `err`.

- [ ] **Step 2 : écrire les routes**

Dans `Routes.scala`, après la route `GET -> Root / "social" / "notifs" / …` ou à la fin de la section sociale :

```scala
    /** Les amis, et ce qu'il reste d'envois aujourd'hui.
      *
      * Les deux dans la meme reponse : la feuille d'envoi affiche le compteur
      * des son ouverture, et un second aller-retour pour un entier serait
      * payé a chaque appui sur l'icone.
      *
      * **Le compteur vient du serveur.** Le calculer cote app le ferait
      * diverger des qu'on envoie depuis un deuxieme appareil, et un plafond
      * qui ment est pire qu'un plafond.
      */
    case req @ GET -> Root / "social" / "amis" =>
      withAccount(req) { me =>
        (repo.amis(me.id), repo.titresPartagesAujourdhui(me.id)).parTupled.flatMap { (as, dejaEnvoyes) =>
          Ok(Json.obj(
            "amis" -> as.map { g =>
              Json.obj(
                "user_id" -> g.id.asJson,
                "handle"  -> g.handle.asJson,
                "nom"     -> g.nom.asJson,
                "avatar"  -> g.avatar.asJson,
                "gardes"  -> g.gardes.asJson
              )
            }.asJson,
            "restants" -> math.max(0, Tuning.PartagesParJour - dejaEnvoyes.size).asJson
          ))
        }
      }

    /** Envoyer un titre a un ami.
      *
      * **La reciprocite se verifie ici, a l'ecriture.** Un client modifie ne
      * peut donc pas envoyer a un inconnu : le refus est un 403, et il dit
      * pourquoi.
      *
      * Le quota porte sur les **titres du jour**, pas sur les envois : renvoyer
      * un titre deja parti aujourd'hui est toujours gratuit, meme au-dela des
      * trois. Ce qui est rare, c'est le morceau qu'on juge digne d'etre
      * envoye, pas le nombre de gens a qui on pense.
      */
    case req @ POST -> Root / "social" / "partager" =>
      withJson(req) { j =>
        withAccount(req) { me =>
          val c       = j.hcursor
          val trackId = c.downField("track_id").as[Long].toOption
          val aQui    = c.downField("a").as[String].toOption.map(_.trim).filter(_.nonEmpty)
          (trackId, aQui) match
            case (None, _) => BadRequest(err("track_id manquant"))
            case (_, None) => BadRequest(err("destinataire manquant"))
            case (Some(id), Some(ref)) =>
              repo.resoudre(ref).flatMap {
                case None => NotFound(err("profil introuvable"))
                case Some(cible) =>
                  repo.amis(me.id).flatMap { as =>
                    if !as.exists(_.id == cible) then
                      Forbidden(err("on n'envoie qu'a un ami — il faut se suivre des deux cotes"))
                    else
                      repo.titresPartagesAujourdhui(me.id).flatMap { deja =>
                        if deja.size >= Tuning.PartagesParJour && !deja.contains(id) then
                          Forbidden(err(s"${Tuning.PartagesParJour} sons par jour, et c'est fini pour aujourd'hui"))
                        else
                          dz.track(id).flatMap {
                            case None => NotFound(err("titre introuvable"))
                            case Some(t) =>
                              repo.partager(me.id, cible, t) *>
                                repo.titresPartagesAujourdhui(me.id).flatMap { apres =>
                                  Ok(Json.obj(
                                    "envoye"   -> true.asJson,
                                    "restants" -> math.max(0, Tuning.PartagesParJour - apres.size).asJson
                                  ))
                                }
                          }
                      }
                  }
              }
        }
      }
```

Si `withJson` et `withAccount` ne s'imbriquent pas dans cet ordre dans ce fichier, reprendre l'ordre utilisé par `POST -> Root / "social" / "avatar"` (lu à l'étape 1) — c'est le seul POST authentifié à corps JSON qui existe déjà.

- [ ] **Step 3 : compiler**

```bash
cd ../prisme && sbt -batch compile
```

Attendu : succès. `Forbidden` vient de `org.http4s.dsl.io.*`, déjà importé.

- [ ] **Step 4 : lancer toute la suite**

```bash
cd ../prisme && sbt -batch test
```

Attendu : 250+ tests, 0 échec.

- [ ] **Step 5 : commit**

```bash
cd ../prisme && git add -A && git commit -m "$(cat <<'EOF'
Les routes du partage, et la réciprocité vérifiée à l'écriture

Un client modifié ne peut pas envoyer à un inconnu : c'est un 403, et il dit
pourquoi. Le compteur du jour part avec la liste d'amis — la feuille l'affiche
dès son ouverture, et un second aller-retour pour un entier serait payé à
chaque appui.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 : un « passer » sur un son d'ami ne compte pas

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Routes.scala` (route `POST /feed/event`)

**Interfaces:**
- Consomme : la route `/feed/event` existante
- Produit : le champ `from_share: Boolean` accepté dans le corps, par défaut `false`

- [ ] **Step 1 : lire la route**

```bash
cd ../prisme && sed -n 479,530p src/main/scala/prisme/Routes.scala
```

Relever comment `action` est décodé et où l'événement est archivé.

- [ ] **Step 2 : écrire la règle**

Juste après le décodage de `action`, ajouter la lecture du drapeau et la sortie anticipée. Le code exact dépend de ce qui a été lu à l'étape 1 ; la forme est :

La forme visée, en trois temps : décoder le drapeau, sortir tôt si c'est un
« passer » venu d'un partage, laisser le reste **strictement intact**. Ne
réécrire aucune ligne du corps existant : l'envelopper dans le `else`.

```scala
        // Un « passer » sur un son qu'un ami envoie n'entre pas dans le gout.
        //
        // Il est souvent social — on le connait deja, on n'est pas d'humeur —
        // et le compter pousserait le profil a l'oppose d'un artiste pour une
        // raison qui n'a rien a voir avec le gout. Les trois autres verdicts
        // comptent, **bannir compris** : c'est le geste le plus explicite de
        // l'application, et l'ignorer parce que la carte vient d'un ami
        // ferait mentir le bouton.
        //
        // Le drapeau vient de l'app, qui le sait — sa carte porte
        // `envoye_par`. Une lecture en base serait plus sure et elle est
        // refusee : c'est le chemin le plus chaud de l'application. Le serveur
        // ne s'en sert que pour SUPPRIMER un evenement, jamais pour en creer
        // un — un client modifie ne peut donc qu'abimer son propre profil.
        val duPartage = c.downField("from_share").as[Boolean].getOrElse(false)
        if duPartage && action == Action.Skip then
          // La carte a deja ete notee vue au service : rien ne reviendra, et
          // il n'y a donc rien a ecrire. La reponse garde la meme forme que
          // celle du chemin normal — l'app lit `reward` sans savoir lequel des
          // deux chemins a repondu.
          Ok(Json.obj("reward" -> 0.0.asJson))
        else
          <TOUT LE CORPS EXISTANT DE LA ROUTE, DEPLACE ICI SANS UNE MODIFICATION>
```

Concrètement : indenter d'un niveau tout ce qui suivait le décodage de
`action`, et rien d'autre. Si la route se termine par un `.flatMap { … Ok(…) }`,
c'est ce bloc entier qui passe dans le `else`. Relire le diff avant de commiter :
`git diff` ne doit montrer que l'indentation, les trois lignes du garde-fou et
le commentaire.

Vérifier le nom exact du constructeur de « passer » dans l'`enum Action` :

```bash
cd ../prisme && grep -n "enum Action" -A 6 src/main/scala/prisme/Models.scala
```

- [ ] **Step 3 : compiler et lancer la suite**

```bash
cd ../prisme && sbt -batch test
```

Attendu : 0 échec.

- [ ] **Step 4 : commit**

```bash
cd ../prisme && git add -A && git commit -m "$(cat <<'EOF'
Un « passer » sur un son d'ami ne compte pas dans le goût

Il est souvent social — on le connaît déjà, on n'est pas d'humeur — et le
compter pousserait le profil à l'opposé d'un artiste pour une raison qui n'en
est pas une. Bannir compte, lui : c'est le geste le plus explicite de l'app.

Le drapeau vient de l'app, pas d'une lecture en base : /feed/event est le
chemin le plus chaud. Le serveur ne s'en sert que pour supprimer un événement,
jamais pour en créer un.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 : les deux notifications, dérivées

**Files:**
- Modify: `../prisme/src/main/scala/prisme/Repo.scala` (`GenreNotif`, `PgRepo.notifs`, `MemoryRepo.notifs`)
- Modify: `../prisme/src/main/scala/prisme/Routes.scala` (route `GET /social/notifs`, le `match` sur le genre)
- Test: `../prisme/src/test/scala/prisme/PartageSpec.scala`

**Interfaces:**
- Consomme : `Notif(genre, at, gen, track)`, `partager` (Task 2), `addToLibrary`
- Produit : `GenreNotif.PartageRecu`, `GenreNotif.PartageGarde`, sérialisés `"partage_recu"` / `"partage_garde"`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `PartageSpec.scala` :

```scala
  test("recevoir un son produit une notification"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.partager("lea", "moi", track(5))
      n <- repo.notifs("moi", 20)
    yield
      val recus = n.filter(_.genre == GenreNotif.PartageRecu)
      assertEquals(recus.map(x => (x.gen.id, x.track.map(_.id))), List(("lea", Some(5L))))).unsafeRunSync()

  test("l'expediteur apprend que son son a ete garde"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.partager("moi", "lea", track(6))
      _ <- repo.addToLibrary("lea", track(6))
      n <- repo.notifs("moi", 20)
    yield
      val gardes = n.filter(_.genre == GenreNotif.PartageGarde)
      assertEquals(gardes.map(x => (x.gen.id, x.track.map(_.id))), List(("lea", Some(6L))))).unsafeRunSync()

  test("un son que l'autre avait DEJA garde ne produit pas de fausse bonne nouvelle"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.addToLibrary("lea", track(8))
      _ <- IO.sleep(scala.concurrent.duration.FiniteDuration(5, "ms"))
      _ <- repo.partager("moi", "lea", track(8))
      n <- repo.notifs("moi", 20)
    yield assertEquals(n.count(_.genre == GenreNotif.PartageGarde), 0)).unsafeRunSync()

  test("un « passe » ne remonte jamais a l'expediteur"):
    val repo = new MemoryRepo
    (for
      _ <- compte(repo, "moi", "Moi")
      _ <- compte(repo, "lea", "Lea")
      _ <- repo.partager("moi", "lea", track(11))
      n <- repo.notifs("moi", 20)
    yield
      // Rien du tout : ni bonne ni mauvaise nouvelle. Dire a quelqu'un qu'on a
      // zappe son morceau est une petite cruaute gratuite.
      assertEquals(n.count(_.genre == GenreNotif.PartageGarde), 0)).unsafeRunSync()
```

`IO.sleep` exige `import cats.effect.unsafe.implicits.global` (déjà présent) et un `IORuntime` — il l'est via `unsafeRunSync()`.

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
cd ../prisme && sbt -batch "testOnly prisme.PartageSpec"
```

Attendu : ÉCHEC de compilation, `value PartageRecu is not a member of object prisme.GenreNotif`.

- [ ] **Step 3 : élargir l'énumération**

Dans `Repo.scala`, remplacer :

```scala
enum GenreNotif:
  case Abonne, Match
```

par :

```scala
enum GenreNotif:
  case Abonne, Match, PartageRecu, PartageGarde
```

Et corriger le commentaire juste au-dessus, qui dit « Deux genres, et aucun troisième n'est inventé » :

```scala
/** Ce qui s'est passe pendant qu'on n'etait pas la.
  *
  * Quatre genres, et **aucun cinquieme n'est invente** : un nouvel abonne, un
  * titre que quelqu'un vous a repris, un son qu'un ami vous envoie, et un son
  * que vous avez envoye et que l'autre a garde. Tout le reste serait une
  * notification fabriquee pour donner l'impression qu'il se passe quelque
  * chose.
  *
  * Rien n'est ecrit nulle part pour les produire : elles sont **derivees** de
  * `social_suivis`, `library_tracks` et `social_partages` a la lecture. Une
  * table d'evenements aurait demande d'ecrire a chaque geste, de purger, et
  * de rester coherente avec des faits qui, eux, existent deja.
  *
  * **Un « passe » ne remonte jamais a l'expediteur**, et c'est delibere :
  * dire a quelqu'un qu'on a zappe son morceau est une petite cruaute
  * gratuite, et c'est exactement ce qui fait arreter d'envoyer.
  */
```

- [ ] **Step 4 : les deux sources, côté Postgres**

Dans `PgRepo.notifs`, ajouter deux blocs `val` sur le modèle des deux existants (`abonnes` et `reprises`), puis changer la ligne finale.

```scala
      val recus =
        val ps = c.prepareStatement("""
          SELECT u.id, u.handle, u.name, COALESCE(sa.data, u.picture) AS picture,
                 (SELECT COUNT(*) FROM library_tracks l WHERE l.user_id = u.id),
                 p.created_at, p.track
          FROM social_partages p
          JOIN users u ON u.id = p.de
          LEFT JOIN social_avatar sa ON sa.user_id = u.id
          LEFT JOIN social_prefs sp ON sp.user_id = u.id
          WHERE p.a = ? AND COALESCE(sp.visible, TRUE)
          ORDER BY p.created_at DESC
          LIMIT ?""")
        try
          ps.setString(1, userId)
          ps.setInt(2, limit)
          Db.rows(ps.executeQuery()) { rs =>
            Notif(
              GenreNotif.PartageRecu,
              rs.getTimestamp(6).getTime,
              Gen(
                rs.getString(1),
                Option(rs.getString(2)).getOrElse(""),
                Option(rs.getString(3)).getOrElse(""),
                Option(rs.getString(4)).getOrElse(""),
                rs.getInt(5)
              ),
              parser.parse(rs.getString(7)).toOption.flatMap(Deezer.parseTrack)
            )
          }
        finally ps.close()

      val gardesParEux =
        // `l.added_at > p.created_at` est ce qui empeche la fausse bonne
        // nouvelle : envoyer un son que l'autre avait deja garde ne doit rien
        // annoncer du tout.
        val ps = c.prepareStatement("""
          SELECT u.id, u.handle, u.name, COALESCE(sa.data, u.picture) AS picture,
                 (SELECT COUNT(*) FROM library_tracks l2 WHERE l2.user_id = u.id),
                 l.added_at, p.track
          FROM social_partages p
          JOIN library_tracks l ON l.user_id = p.a AND l.track_id = p.track_id
          JOIN users u ON u.id = p.a
          LEFT JOIN social_avatar sa ON sa.user_id = u.id
          LEFT JOIN social_prefs sp ON sp.user_id = u.id
          WHERE p.de = ? AND l.added_at > p.created_at AND COALESCE(sp.visible, TRUE)
          ORDER BY l.added_at DESC
          LIMIT ?""")
        try
          ps.setString(1, userId)
          ps.setInt(2, limit)
          Db.rows(ps.executeQuery()) { rs =>
            Notif(
              GenreNotif.PartageGarde,
              rs.getTimestamp(6).getTime,
              Gen(
                rs.getString(1),
                Option(rs.getString(2)).getOrElse(""),
                Option(rs.getString(3)).getOrElse(""),
                Option(rs.getString(4)).getOrElse(""),
                rs.getInt(5)
              ),
              parser.parse(rs.getString(7)).toOption.flatMap(Deezer.parseTrack)
            )
          }
        finally ps.close()
```

Puis remplacer la ligne finale :

```scala
      (abonnes ::: reprises).sortBy(-_.at).take(limit)
```

par :

```scala
      (abonnes ::: reprises ::: recus ::: gardesParEux).sortBy(-_.at).take(limit)
```

- [ ] **Step 5 : les deux sources, côté mémoire**

Dans `MemoryRepo.notifs`, à côté des deux dérivations existantes. **Lire d'abord** la fonction existante en entier :

```bash
cd ../prisme && sed -n 1660,1700p src/main/scala/prisme/Repo.scala
```

Puis ajouter, sur le même modèle (`gardeAt(userId, trackId)` existe déjà et rend l'instant d'entrée en bibliothèque) :

```scala
      val recus = partages.get().collect {
        case (de, dest, t, at, _) if dest == userId =>
          genDe(de).map(g => Notif(GenreNotif.PartageRecu, at, g, Some(t)))
      }.flatten

      val gardesParEux = partages.get().collect {
        case (de, dest, t, at, _) if de == userId && gardeAt(dest, t.id) > at =>
          genDe(dest).map(g => Notif(GenreNotif.PartageGarde, gardeAt(dest, t.id), g, Some(t)))
      }.flatten
```

et les ajouter à la liste finale, comme côté Postgres. Vérifier la signature de `gardeAt` dans le code lu ; si elle rend `Option[Long]` ou `0L` quand absent, adapter la comparaison — l'important est que **rien** ne sorte quand le titre n'est pas en bibliothèque, et rien non plus quand il y était déjà avant l'envoi.

- [ ] **Step 6 : la sérialisation**

Dans `Routes.scala`, route `GET /social/notifs`, remplacer :

```scala
                "genre" -> (n.genre match
                  case GenreNotif.Abonne => "abonne"
                  case GenreNotif.Match  => "match"
                ).asJson,
```

par :

```scala
                "genre" -> (n.genre match
                  case GenreNotif.Abonne       => "abonne"
                  case GenreNotif.Match        => "match"
                  case GenreNotif.PartageRecu  => "partage_recu"
                  case GenreNotif.PartageGarde => "partage_garde"
                ).asJson,
```

- [ ] **Step 7 : lancer toute la suite**

```bash
cd ../prisme && sbt -batch test
```

Attendu : 0 échec, `PartageSpec` à 14 tests.

- [ ] **Step 8 : commit et déploiement**

```bash
cd ../prisme && git add -A && git commit -m "$(cat <<'EOF'
Deux notifications de plus, dérivées comme les autres

social_partages devient une troisième source à côté de social_suivis et
library_tracks. Rien n'est écrit : la notification « ton son a été gardé »
est une jointure, donc elle ne peut pas mentir.

added_at > created_at est ce qui empêche la fausse bonne nouvelle : envoyer
un son que l'autre avait déjà gardé n'annonce rien.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)" && bash deploy-vps.sh
```

Attendu : `/health` vert en local **et** en public. Reporter la sortie.

---

## Task 7 : les types et le client, côté app

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/client.ts:361-369` (`event`) et section « Le social »
- Modify: `src/state/useFeed.ts:172`

**Interfaces:**
- Consomme : les routes de Task 4 et 5, `Gen`, `Card`
- Produit :
  - `type Ami = Gen`
  - `Card.envoye_par?: Gen`
  - `prisme.amis(): Promise<{ amis: Gen[]; restants: number }>`
  - `prisme.partager(trackId: number, aQui: string): Promise<{ envoye: boolean; restants: number }>`
  - `prisme.event({ …, fromShare?: boolean })`

- [ ] **Step 1 : les types**

Dans `src/api/types.ts`, ajouter à `Card` après `followed?: boolean;` :

```ts
  /**
   * Qui t'envoie ce titre, si c'est un ami qui te l'a partagé.
   *
   * Porté par la carte et non récupéré à part : la signature doit être dans
   * le bon état dès la première image, comme `followed` juste au-dessus.
   *
   * Sa présence change trois choses, et c'est tout : la ligne de mention
   * devient la signature, un « passer » n'est plus compté dans le goût, et
   * l'icône d'envoi disparaît — on ne renvoie pas un son qu'on vient de
   * recevoir sans l'avoir jugé.
   *
   * Optionnel : un moteur antérieur au partage ne l'envoie pas.
   */
  envoye_par?: Gen;
```

Et élargir le genre des notifications. Repérer la ligne :

```bash
grep -n "genre: 'abonne' | 'match'" src/api/types.ts
```

la remplacer par :

```ts
  genre: 'abonne' | 'match' | 'partage_recu' | 'partage_garde';
```

- [ ] **Step 2 : le client**

Dans `src/api/client.ts`, remplacer le corps de `event` par :

```ts
  event: (p: {
    track: Track;
    action: SwipeAction;
    msPlayed: number;
    previewMs: number;
    /** La carte venait d'un ami. Le moteur s'en sert **uniquement** pour ne
     *  pas compter un « passer » : un passage sur un son qu'on vous envoie est
     *  souvent social, et le compter pousserait le profil à l'opposé pour une
     *  raison qui n'en est pas une. Les trois autres verdicts comptent. */
    fromShare?: boolean;
  }) =>
    post<EventResult>('/feed/event', {
      track_id: p.track.id,
      artist_id: p.track.artist.id,
      genre_id: p.track.genre_id,
      action: p.action,
      ms_played: Math.round(p.msPlayed),
      preview_ms: Math.round(p.previewMs),
      from_share: p.fromShare === true,
    }),
```

Et ajouter, dans la section « Le social », après `gensDuProfil` :

```ts
  /** Les amis — ceux qu'on suit et qui nous suivent — et ce qu'il reste
   *  d'envois aujourd'hui.
   *
   *  Les deux dans le même appel : la feuille d'envoi affiche le compteur dès
   *  son ouverture, et un second aller-retour pour un entier serait payé à
   *  chaque appui sur l'icône. Le compteur vient du serveur — le calculer ici
   *  le ferait diverger dès qu'on envoie depuis un deuxième appareil. */
  amis: () => call<{ amis: Gen[]; restants: number }>('/social/amis'),

  /** Envoyer un titre à un ami. `aQui` est un identifiant ou un @handle.
   *
   *  403 si ce n'est pas un ami, ou si les trois sons du jour sont partis —
   *  le message du serveur est fait pour être affiché tel quel. */
  partager: (trackId: number, aQui: string) =>
    call<{ envoye: boolean; restants: number }>('/social/partager', {
      method: 'POST',
      body: JSON.stringify({ track_id: trackId, a: aQui }),
    }),
```

Vérifier que `Gen` est bien dans la liste d'imports de type en tête du fichier (il l'est).

- [ ] **Step 3 : passer le drapeau au swipe**

Dans `src/state/useFeed.ts`, ligne 172, remplacer :

```ts
      prisme.event({ track: top.track, action, msPlayed, previewMs }).catch(() => {});
```

par :

```ts
      prisme
        .event({ track: top.track, action, msPlayed, previewMs, fromShare: !!top.envoye_par })
        .catch(() => {});
```

- [ ] **Step 4 : typecheck**

```bash
npx tsc --noEmit
```

Attendu : aucune sortie.

- [ ] **Step 5 : commit**

```bash
git add src/api/types.ts src/api/client.ts src/state/useFeed.ts && git commit -m "$(cat <<'EOF'
Le client sait envoyer un son, et dire d'où vient la carte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 : l'icône, et la signature sur le cartel

**Files:**
- Modify: `src/components/Icones.tsx`
- Modify: `src/components/Passage.tsx` (le bloc `<Animated.View style={[styles.texte, …]}>`, autour de la ligne 539)

**Interfaces:**
- Consomme : `Card.envoye_par` (Task 7), `Visage` (`src/components/Visage.tsx`)
- Produit :
  - `IconeEnvoyer({ couleur, taille }: { couleur: string; taille?: number })`
  - `Passage` accepte `onEnvoyer?: () => void`

- [ ] **Step 1 : l'icône**

Dans `src/components/Icones.tsx`, lire une icône existante pour reprendre exactement sa forme (grille de 24, même épaisseur de trait) :

```bash
grep -n "export function IconePartage" -A 20 src/components/Icones.tsx
```

Ajouter, sur le même modèle, une flèche d'envoi :

```tsx
/** Envoyer à quelqu'un. Une flèche qui part, sur la même grille de 24 et la
 *  même épaisseur que les icônes d'onglets — trois graisses différentes côte
 *  à côte, ça se voit. */
export function IconeEnvoyer({ couleur, taille = 24 }: { couleur: string; taille?: number }) {
  return (
    <Svg width={taille} height={taille} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.5 2.5 11 13"
        stroke={couleur}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M21.5 2.5 14.8 21.5l-3.8-8.5-8.5-3.8L21.5 2.5Z"
        stroke={couleur}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
```

Adapter les imports (`Svg`, `Path`) à ce que le fichier utilise déjà.

- [ ] **Step 2 : la prop sur la carte**

Dans `src/components/Passage.tsx`, ajouter à la liste des props du composant de carte, à côté de `onSuivre` :

```tsx
  /** Ouvrir la feuille d'envoi pour ce titre. Absent = pas d'icône : on
   *  n'envoie pas depuis une carte qu'on vient soi-même de recevoir. */
  onEnvoyer?: () => void;
```

- [ ] **Step 3 : la signature à la place de la mention**

Remplacer le bloc de la mention :

```tsx
            <Text style={[styles.mention, mentionTon[ton]]} numberOfLines={1}>
              {card.reason}
            </Text>
```

par :

```tsx
            {/* La signature prend la place de la mention — le slot qui existe
                déjà, et dont le rôle est exactement « pourquoi cette carte est
                là ». Un bandeau au-dessus de la pochette aurait rendu les
                cartes partagées plus hautes que les autres, et la pile aurait
                changé de forme à chaque fois que l'une passe. */}
            {card.envoye_par ? (
              <View style={styles.signature}>
                <Visage uri={card.envoye_par.avatar} taille={18} />
                <Text style={[styles.mention, mentionTon[ton]]} numberOfLines={1}>
                  {`${card.envoye_par.nom || `@${card.envoye_par.handle}`} te l’envoie`}
                </Text>
              </View>
            ) : (
              <Text style={[styles.mention, mentionTon[ton]]} numberOfLines={1}>
                {card.reason}
              </Text>
            )}
```

Ajouter le style, à côté de `mention` :

```tsx
  // La marge du bas est celle de `mention`, portée ici : la ligne fait la même
  // hauteur avec ou sans avatar, donc le cartel ne bouge pas d'un pixel.
  signature: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
```

et retirer `marginBottom` de `mention` **uniquement si** le nouveau conteneur le porte déjà — sinon la marge serait doublée dans le cas partagé. Vérifier à l'œil sur l'appareil.

Importer `Visage` en tête du fichier :

```tsx
import { Visage } from './Visage';
```

- [ ] **Step 4 : l'icône sur la ligne du titre**

Remplacer le bloc du titre :

```tsx
            <Text
              style={[
                styles.titre,
                { fontSize: tailleTitre, lineHeight: Math.round(tailleTitre * 1.18) },
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {titre}
            </Text>
```

par :

```tsx
            {/* Le titre, et l'envoi à sa droite. `flexShrink` sur le seul
                texte : c'est le titre qui s'abrège quand il est long, jamais
                l'icône qui sort de la carte — même règle que le bouton
                « suivre » sur la ligne du dessous. */}
            <View style={styles.ligneTitre}>
              <Text
                style={[
                  styles.titre,
                  styles.titreFlex,
                  { fontSize: tailleTitre, lineHeight: Math.round(tailleTitre * 1.18) },
                ]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {titre}
              </Text>
              {onEnvoyer && !card.envoye_par ? (
                <Pressable
                  onPress={() => {
                    vibrer.action();
                    onEnvoyer();
                  }}
                  onPressIn={() => surBouton.set(1)}
                  onPressOut={() => surBouton.set(0)}
                  disabled={!active}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Envoyer ${titre} à un ami`}
                  style={({ pressed }) => [styles.envoyer, pressed && { opacity: 0.6 }]}
                >
                  <IconeEnvoyer couleur={color.textMuted} taille={cadre.compact ? 18 : 20} />
                </Pressable>
              ) : null}
            </View>
```

Styles à ajouter :

```tsx
  ligneTitre: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  titreFlex: { flexShrink: 1 },
  envoyer: { paddingTop: 2 },
```

`surBouton` est le `SharedValue<number>` déjà utilisé par le bouton « suivre » — il **doit** être levé ici aussi, sinon l'appui sur l'icône déclenche l'appui long qui bannit l'artiste au bout de 600 ms. C'est le piège de ce fichier ; le lire à la déclaration de `surBouton` avant d'écrire.

Importer `IconeEnvoyer` depuis `./Icones`.

- [ ] **Step 5 : typecheck**

```bash
npx tsc --noEmit
```

Attendu : une erreur sur `onEnvoyer` non fourni par `app/(tabs)/index.tsx` **si** la prop a été rendue obligatoire. Elle est optionnelle : aucune sortie attendue.

- [ ] **Step 6 : commit**

```bash
git add src/components/Icones.tsx src/components/Passage.tsx && git commit -m "$(cat <<'EOF'
Une icône pour envoyer, une signature pour recevoir

La signature prend la ligne de mention plutôt qu'un bandeau au-dessus de la
pochette : un bandeau aurait rendu les cartes partagées plus hautes que les
autres, et la pile aurait changé de forme à chaque fois que l'une passe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 : la feuille d'envoi

**Files:**
- Create: `src/components/FeuilleEnvoi.tsx`
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consomme : `prisme.amis`, `prisme.partager` (Task 7), `Feuille` et `EnteteTitre` (`src/components/Feuille.tsx`), `Visage`, `Track`, `Gen`
- Produit : `<FeuilleEnvoi track={…} visible={…} onFermer={…} />`

- [ ] **Step 1 : lire la feuille existante**

```bash
sed -n 1,165p src/components/Feuille.tsx
```

Relever la signature de `Feuille`, `EnteteTitre` et de la ligne (`LigneFeuille` ou équivalent).

- [ ] **Step 2 : écrire le composant**

Créer `src/components/FeuilleEnvoi.tsx` :

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { prisme } from '../api/client';
import type { Gen, Track } from '../api/types';
import { vibrer } from '../state/vibration';
import { color, radius, space, type } from '../theme/tokens';
import { EnteteTitre, Feuille } from './Feuille';
import { Visage } from './Visage';

/**
 * Envoyer un son à quelqu'un.
 *
 * ## Un tap envoie
 *
 * Pas de bouton « Envoyer », pas de case à cocher puis de validation :
 * l'envoi **est** le tap. Un bouton de confirmation aurait demandé un second
 * geste pour une action dont le pire dénouement est qu'un ami reçoive un son.
 * On peut en toucher plusieurs — le visage se coche et reste coché.
 *
 * ## Le compteur est visible dès l'ouverture
 *
 * « 2 envois restants aujourd'hui ». Découvrir un plafond en le heurtant est
 * la pire façon de l'apprendre, et il vient du serveur : le calculer ici le
 * ferait diverger dès qu'on envoie depuis un deuxième appareil.
 *
 * ## Le coche part avant la réponse
 *
 * Optimiste, comme le bouton « suivre » de la carte. Un refus décoche et
 * affiche le message du serveur tel quel — c'est lui qui sait s'il s'agit
 * d'une amitié rompue ou d'un quota atteint.
 */
export function FeuilleEnvoi({
  track,
  visible,
  onFermer,
}: {
  track: Track | null;
  visible: boolean;
  onFermer: () => void;
}) {
  const [amis, setAmis] = useState<Gen[] | null>(null);
  const [restants, setRestants] = useState<number | null>(null);
  const [envoyes, setEnvoyes] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  // La liste se relit à chaque ouverture : on a pu se faire un ami depuis la
  // dernière, et le compteur du jour bouge tout seul à minuit.
  useEffect(() => {
    if (!visible) return;
    let vivant = true;
    setEnvoyes(new Set());
    setErreur(null);
    prisme
      .amis()
      .then((r) => {
        if (!vivant) return;
        setAmis(r.amis);
        setRestants(r.restants);
      })
      .catch(() => {
        if (vivant) setErreur('Liste d’amis indisponible');
      });
    return () => {
      vivant = false;
    };
  }, [visible]);

  const envoyer = useCallback(
    async (g: Gen) => {
      if (!track || envoyes.has(g.user_id)) return;
      vibrer.action();
      setEnvoyes((s) => new Set(s).add(g.user_id));
      setErreur(null);
      try {
        const r = await prisme.partager(track.id, g.user_id);
        setRestants(r.restants);
      } catch (e) {
        setEnvoyes((s) => {
          const n = new Set(s);
          n.delete(g.user_id);
          return n;
        });
        setErreur(e instanceof Error ? e.message : 'Envoi impossible');
      }
    },
    [track, envoyes],
  );

  return (
    <Feuille visible={visible} onFermer={onFermer}>
      {track ? <EnteteTitre track={track} sous="À qui tu l’envoies ?" /> : null}

      {restants !== null ? (
        <Text style={styles.compteur}>
          {restants > 0
            ? `${restants} son${restants > 1 ? 's' : ''} à envoyer aujourd’hui`
            : 'Tu as envoyé tes trois sons du jour'}
        </Text>
      ) : null}

      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

      {amis === null && erreur === null ? (
        <ActivityIndicator color={color.accent} style={styles.attente} />
      ) : amis !== null && amis.length === 0 ? (
        <Text style={styles.vide}>
          Tu n’as pas encore d’ami ici. Il faut se suivre des deux côtés — cherche un @ dans
          l’onglet « Les gens ».
        </Text>
      ) : (
        <ScrollView style={styles.liste} showsVerticalScrollIndicator={false}>
          {(amis ?? []).map((g) => {
            const parti = envoyes.has(g.user_id);
            return (
              <Pressable
                key={g.user_id}
                style={({ pressed }) => [styles.rang, pressed && styles.pale]}
                onPress={() => void envoyer(g)}
                disabled={parti}
                accessibilityRole="button"
                accessibilityState={{ disabled: parti }}
                accessibilityLabel={parti ? `Envoyé à ${g.nom}` : `Envoyer à ${g.nom}`}
              >
                <Visage uri={g.avatar} taille={40} />
                <Text style={[styles.nom, parti && styles.nomParti]} numberOfLines={1}>
                  {g.nom || `@${g.handle}`}
                </Text>
                <Text style={[styles.etat, parti && styles.etatParti]}>{parti ? 'envoyé' : ''}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Feuille>
  );
}

const styles = StyleSheet.create({
  pale: { opacity: 0.55 },
  compteur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, paddingHorizontal: space.lg, paddingTop: space.sm },
  erreur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.alert, paddingHorizontal: space.lg, paddingTop: space.sm },
  attente: { marginVertical: space.xl },
  vide: { ...type.body, fontSize: 15, lineHeight: 22, color: color.textMuted, padding: space.lg },
  // Bornée en hauteur : quinze amis ne doivent pas pousser la feuille jusqu'en
  // haut de l'écran.
  liste: { maxHeight: 320 },
  rang: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg },
  nom: { ...type.lead, color: color.text, flex: 1 },
  nomParti: { color: color.textMuted },
  etat: { ...type.label, fontSize: 13, color: color.accent },
  etatParti: { color: color.accent },
});
```

Adapter `EnteteTitre` si sa prop `sous` n'existe pas sous ce nom (lu à l'étape 1). `radius` est importé mais peut ne pas servir — le retirer si `tsc` ou le linter s'en plaint.

- [ ] **Step 3 : brancher la feuille dans le fil**

Dans `app/(tabs)/index.tsx` :

1. Importer `FeuilleEnvoi` ;
2. Ajouter l'état, à côté des autres états de l'écran :

```tsx
  /** Le titre dont la feuille d'envoi est ouverte. `null` = fermée. */
  const [aEnvoyer, setAEnvoyer] = useState<Track | null>(null);
```

3. Passer la prop à la carte du dessus. Repérer où `onSuivre` est passé à `Passage` et ajouter juste à côté :

```tsx
                onEnvoyer={() => setAEnvoyer(card.track)}
```

**Uniquement sur la carte active**, jamais sur celles du dessous de la pile : une icône tapable sur une carte qu'on ne voit pas est un piège. Suivre exactement ce que fait `onSuivre` — s'il est passé à toutes les cartes avec un drapeau `active`, faire pareil.

4. Rendre la feuille, à la fin du JSX, à côté de la confirmation de bannissement :

```tsx
      <FeuilleEnvoi
        track={aEnvoyer}
        visible={aEnvoyer !== null}
        onFermer={() => setAEnvoyer(null)}
      />
```

- [ ] **Step 4 : typecheck**

```bash
npx tsc --noEmit
```

Attendu : aucune sortie.

- [ ] **Step 5 : le banc du fil**

`player.ts` et `useFeed.ts` n'ont pas été touchés autrement que par une ligne dans `useFeed.ts` (Task 7), mais la règle du dépôt est de le lancer :

```bash
npm run bench
```

Attendu : les cinq règles vertes sur les quatre réseaux.

- [ ] **Step 6 : commit**

```bash
git add src/components/FeuilleEnvoi.tsx "app/(tabs)/index.tsx" && git commit -m "$(cat <<'EOF'
La feuille d'envoi : un tap envoie

Pas de bouton « Envoyer » — l'envoi est le tap. Un bouton de confirmation
aurait demandé un second geste pour une action dont le pire dénouement est
qu'un ami reçoive un son.

Le compteur du jour est visible dès l'ouverture : découvrir un plafond en le
heurtant est la pire façon de l'apprendre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 : les notifications à l'écran

**Files:**
- Modify: `app/notifs.tsx`

**Interfaces:**
- Consomme : `Notif.genre` élargi (Task 7)

- [ ] **Step 1 : lire l'écran**

```bash
grep -n "genre" -B 4 -A 12 app/notifs.tsx
```

Relever comment la phrase de chaque notification est composée aujourd'hui pour `abonne` et `match`.

- [ ] **Step 2 : les deux phrases**

Ajouter les deux cas au même endroit, en suivant exactement la forme des deux
existants. Le contenu exact, à couler dans la structure lue à l'étape 1 :

```tsx
    case 'partage_recu':
      // Le titre est nommé : c'est ce qu'on est venu voir. Sans lui, la ligne
      // dit qu'il s'est passé quelque chose sans dire quoi.
      return {
        phrase: `${nom} t’a envoyé ${n.track?.title ?? 'un son'}`,
        // Même destination que « match » : c'est un titre, il mène au titre.
        aller: n.track ? () => router.push(`/artiste/${n.track!.artist.id}`) : undefined,
      };
    case 'partage_garde':
      // Pas de titre ici, et c'est voulu : ce qui compte est que la personne
      // ait gardé, pas lequel des trois sons du jour c'était.
      return {
        phrase: `${nom} a gardé le son que tu lui as envoyé`,
        aller: () => router.push(`/gens/${encodeURIComponent(n.gen.user_id)}`),
      };
```

Les noms `phrase` / `aller` sont **à remplacer par ceux du fichier** : cet écran
compose peut-être ses lignes autrement (un JSX direct, un `Text` par genre).
Reprendre sa forme, garder ces deux textes mot pour mot.

Aucun genre inconnu ne doit casser l'écran : si le `switch` n'a pas de cas par
défaut, en ajouter un qui rend `null` — un moteur plus récent que l'app
enverrait sinon un genre qu'elle ne connaît pas, et la liste entière
disparaîtrait pour une ligne.

- [ ] **Step 3 : typecheck**

```bash
npx tsc --noEmit
```

Attendu : aucune sortie.

- [ ] **Step 4 : commit**

```bash
git add app/notifs.tsx && git commit -m "$(cat <<'EOF'
Les notifications disent aussi les sons qu'on s'envoie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 : la documentation, et la vérification de bout en bout

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1 : la section**

Ajouter dans `AGENTS.md`, juste avant `## Repartir de zéro` :

```markdown
## Partager un son : ce qui compte, et ce qui ne compte pas

**Ami = suivi réciproque**, calculé depuis `social_suivis`, jamais stocké. Ne
pas créer de table d'amitié : elle ajouterait un troisième état à un graphe
qui n'en a que deux, et il faudrait la tenir cohérente à chaque désabonnement.

**`social_partages` est la seule chose écrite**, parce qu'un partage ne se
déduit de rien. Les notifications, elles, restent **dérivées** : `partage_recu`
et `partage_garde` sont des jointures, donc elles ne peuvent pas mentir.
`added_at > created_at` sur la seconde est ce qui empêche la fausse bonne
nouvelle — envoyer un son que l'autre avait déjà gardé n'annonce rien.

Quatre choses à ne pas défaire :

- **Le préfixe du lot se fait dans `Feed.next`, avant `markSeen`.** Le faire
  dans la route laisserait les titres partagés hors de l'anti-répétition, et
  ils reviendraient ensuite par le chemin normal.
- **Une carte partagée n'entre jamais dans `serve_log`.** Cette table dit ce
  que le modèle *croyait* en servant la carte ; il n'a rien cru ici, et y
  écrire des zéros empoisonnerait le futur reclasseur.
- **Un « passer » sur un son d'ami ne compte pas dans le goût** — il est
  souvent social. **Bannir compte**, lui : ignorer le geste le plus explicite
  de l'app ferait mentir le bouton. Le drapeau `from_share` vient de l'app et
  le serveur ne s'en sert que pour **supprimer** un événement, jamais pour en
  créer un : `/feed/event` est le chemin le plus chaud, on n'y lit pas la base.
- **La signature est la ligne de mention du cartel, pas un bandeau.** Un
  bandeau au-dessus de la pochette rendrait les cartes partagées plus hautes
  que les autres, et la pile changerait de forme à chaque fois que l'une
  passe.

**Trois titres par jour** (`Tuning.PartagesParJour`), tous destinataires
confondus : le même son à quatre amis coûte un. Ce qui est rare, c'est le
morceau qu'on juge digne d'être envoyé.

**Réserve, non traitée :** on ne peut pas bloquer les envois de quelqu'un sans
se désabonner de lui. Le plafond rend le harcèlement coûteux, pas impossible.
```

- [ ] **Step 2 : la vérification complète**

```bash
cd ../prisme && sbt -batch test
cd ../reso && npx tsc --noEmit && npm run bench
```

Attendu : 0 échec côté moteur, aucune sortie de `tsc`, banc vert.

- [ ] **Step 3 : le déploiement**

```bash
cd ../prisme && bash deploy-vps.sh
```

Attendu : `/health` vert en local et en public. **Reporter la sortie telle quelle.**

- [ ] **Step 4 : commit**

```bash
cd ../reso && git add AGENTS.md && git commit -m "$(cat <<'EOF'
AGENTS.md : ce que le partage compte, et ce qu'il ne compte pas

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5 : l'essai sur appareil**

Ce chantier ne peut pas être déclaré fini sans être vu. À faire vérifier par le porteur du projet, avec deux comptes qui se suivent :

1. L'icône d'envoi apparaît sur le cartel, et l'appui **n'ouvre pas** la confirmation de bannissement.
2. La feuille liste l'ami, affiche « 3 sons à envoyer aujourd'hui », et le visage se coche au tap.
3. Le quatrième titre du jour est refusé avec le message du serveur.
4. Chez l'ami, la carte arrive au rechargement suivant, signée, avec la pochette entière et la pile qui ne change pas de forme.
5. Un « passer » sur cette carte ne la fait pas revenir, et l'écran « Ton Prisme » ne bouge pas.
6. Garder cette carte fait apparaître « … a gardé le son que tu lui as envoyé » chez l'expéditeur.

Tant que ces six points ne sont pas vus, dire **« pas encore vu sur appareil »** — pas « fait ».
