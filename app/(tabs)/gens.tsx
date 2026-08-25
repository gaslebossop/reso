import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../src/api/client';
import { fansLisibles } from '../../src/api/titre';
import type { Artist, Gen, ProfilSocial } from '../../src/api/types';
import { AccountGate } from '../../src/components/AccountGate';
import { NomVerifie } from '../../src/components/NomVerifie';
import { Visage } from '../../src/components/Visage';
import { IconeChevron, IconeCloche, IconePartage } from '../../src/components/Icones';
import { rafraichirNotifs, useNouvellesNotifs } from '../../src/state/notifs';
import { useAccount } from '../../src/state/useAccount';
import { vibrer } from '../../src/state/vibration';
import { chiffres, color, radius, space, type } from '../../src/theme/tokens';

/**
 * « Les gens » — ta carte de visite, et le repertoire.
 *
 * ## Ce que l'ecran etait, et pourquoi c'etait faux
 *
 * Un titre, **quatre lignes grises identiques a chevron** (Ton profil,
 * Notifications, Tes abonnements, Tes abonnes), un champ de recherche, un
 * interrupteur en bas, et 40 % de l'ecran vide. C'etait une page de reglages
 * iOS : la meme mise en page aurait servi a une app de livraison en changeant
 * les libelles. Rien n'y montrait de gens, dans un ecran qui s'appelle « les
 * gens ».
 *
 * ## L'objet : une carte de visite, puis un repertoire
 *
 * En haut, **toi** — et surtout ton `@`, parce que c'est ce qu'on donne. Toute
 * la vie sociale de cette application commence par quelqu'un qui envoie son
 * profil a quelqu'un d'autre : l'adresse doit donc etre lisible d'un coup
 * d'oeil et partageable d'un tap, pas cachee derriere une ligne « Ton profil »
 * qui menait a un ecran ou il fallait la chercher.
 *
 * En dessous, **comment on trouve les autres** : le champ, puis les visages de
 * ceux qu'on suit deja. Ce sont eux qui remplissent le vide, et ils le
 * remplissent avec la seule chose qui avait sa place ici.
 *
 * ## Ce qui a disparu
 *
 * - **Le titre « Les gens ».** La barre d'onglets le dit deja, juste en
 *   dessous. Un titre qui repete l'onglet coute une hauteur de ligne et
 *   n'apprend rien ; la place revient a la carte de visite.
 * - **Les quatre lignes a chevron.** « Tes abonnements » et « Tes abonnes »
 *   sont devenus deux chiffres cliquables sous le nom — la ou on les cherche
 *   sur n'importe quel profil, y compris le sien. « Ton profil » est devenu
 *   l'en-tete elle-meme : on n'a plus a ouvrir une page pour voir ce que les
 *   gens voient, on le voit.
 * - **Le bloc de la bascule** (titre, sous-titre, filet). Un reglage qu'on
 *   touche une fois n'a pas besoin de trois lignes ; il en garde une.
 * - **Le vide.**
 *
 * ## Ce qui est apparu
 *
 * - **Le `@handle`, en clair, avec un bouton pour l'envoyer.** Il n'etait
 *   visible nulle part sur cet ecran.
 * - **Un visage de repli** quand la photo manque (`Visage`) : presque personne
 *   n'en a mis, et les lignes s'affichaient avec un trou invisible sur fond
 *   noir.
 * - **Les trois chiffres** — gardes, abonnements, abonnes.
 * - **Les visages de tes abonnements**, en rangee, tapables directement.
 * - **La cloche**, avec le nombre de nouvelles. Elle remplace la ligne
 *   « Notifications » : une destination avec un compteur se met dans un coin
 *   qu'on surveille, pas dans une liste qu'on parcourt.
 *
 * ## La recherche attend que le doigt se repose
 *
 * Trois cents millisecondes de silence, deux caracteres minimum. Chercher
 * lettre par lettre contre un serveur distant, c'est tirer un aller-retour par
 * frappe — et voir la liste clignoter sous le pouce.
 *
 * ## Un seul champ, deux natures de reponse
 *
 * On tape un nom, et on ne sait pas toujours si c'est celui d'un ami ou d'un
 * artiste — « Angele » est les deux. Deux champs auraient oblige a trancher
 * avant de chercher ; un seul champ interroge les deux cotes en parallele et
 * rend deux listes titrees. Les profils d'abord : c'est l'onglet « Les gens »,
 * et quelqu'un qui cherche un @ ne doit pas defiler sous une discographie.
 *
 * Les deux appels sont independants : un cote qui echoue laisse l'autre
 * s'afficher, et le message d'erreur n'apparait que si les deux sont muets.
 * La recherche d'artistes part **allegee** — sans titres phares ni badge —
 * parce que rien de tout cela n'est montre ici, et que l'enrichissement se
 * paie en appels sortants a chaque pause de frappe.
 */

/** Le silence qui declenche la recherche. */
const PAUSE_MS = 300;
/** En dessous, la route rend vide de toute facon : ne pas l'appeler. */
const MINIMUM = 2;
/** Combien de visages tiennent dans la rangee avant « tout voir ». */
const VISAGES = 12;

export default function GensScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();
  const nouvelles = useNouvellesNotifs();

  const [texte, setTexte] = useState('');
  const [gens, setGens] = useState<Gen[] | null>(null);
  /** Les artistes du meme mot, cherches en parallele des profils. */
  const [artistes, setArtistes] = useState<Artist[] | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [visible, setVisible] = useState<boolean | null>(null);
  /** Ta carte de visite : `@`, avatar, et les trois chiffres. */
  const [moi, setMoi] = useState<ProfilSocial | null>(null);
  /** Ceux que tu suis, en visages. */
  const [suivis, setSuivis] = useState<Gen[] | null>(null);
  /**
   * Les artistes que tu suis.
   *
   * Ils font partie du meme abonnement — meme geste, meme bouton — et la
   * rangee les montre a la suite des visages plutot que dans une deuxieme
   * file : « tout voir » mene a une seule liste, et deux rangees ici
   * promettraient deux ecrans.
   */
  const [artistesSuivis, setArtistesSuivis] = useState<Artist[] | null>(null);

  // Le minuteur de pause vit dans une reference : il survit aux rendus, et
  // un caractere tape vite annule la recherche du caractere d'avant.
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jeton = useRef(0);

  const chercher = useCallback(async (q: string) => {
    const propre = q.trim();
    const mien = ++jeton.current;
    if (propre.length < MINIMUM) {
      setGens(null);
      setArtistes(null);
      setErreur(null);
      setOccupe(false);
      return;
    }
    setOccupe(true);
    // De front, et chacun avec son propre filet : le repertoire social et le
    // catalogue Deezer n'ont aucune raison de tomber ensemble, et perdre les
    // artistes parce qu'une requete SQL a echoue viderait l'ecran pour rien.
    const [profils, trouves] = await Promise.all([
      prisme
        .rechercheGens(propre)
        .then((r) => ({ gens: r.gens, erreur: null as string | null }))
        .catch((e) => ({
          gens: null,
          erreur: e instanceof Error ? e.message : 'Recherche impossible',
        })),
      prisme
        .searchArtists(propre, true)
        .then((r) => r.artists)
        .catch(() => [] as Artist[]),
    ]);
    if (mien !== jeton.current) return;
    setGens(profils.gens);
    setArtistes(trouves);
    // Une moitie qui a repondu suffit a faire un ecran utile : l'erreur ne
    // s'affiche que quand il n'y a vraiment rien a montrer.
    setErreur(profils.erreur && trouves.length === 0 ? profils.erreur : null);
    setOccupe(false);
  }, []);

  useEffect(() => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => void chercher(texte), PAUSE_MS);
    return () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    };
  }, [texte, chercher]);

  /**
   * Tout se relit au focus, et **rien ne se vide** en attendant.
   *
   * L'etat de la bascule peut avoir change sur un autre appareil, et un
   * interrupteur qui ment est pire qu'absent. Les chiffres bougent des qu'on
   * suit quelqu'un depuis un autre ecran. Mais remplacer la carte de visite
   * par une roue a chaque retour donnerait l'impression d'ouvrir l'onglet pour
   * la premiere fois — c'est le defaut qui vient d'etre corrige sur le profil,
   * il n'a pas a etre recree ici.
   */
  useFocusEffect(
    useCallback(() => {
      if (compte.loading || !compte.connected) return;
      let vivant = true;

      prisme.visibilite().then((r) => {
        if (vivant) setVisible(r.visible);
      }).catch(() => {
        if (vivant) setVisible(null);
      });

      void (async () => {
        try {
          const identite = await prisme.me();
          if (!vivant) return;
          const [profil, abonnements] = await Promise.all([
            prisme.profilPublic(identite.user_id),
            prisme
              .gensDuProfil(identite.user_id, 'abonnements')
              .catch(() => ({ gens: [] as Gen[], artistes: [] as Artist[] })),
          ]);
          if (!vivant) return;
          setMoi(profil);
          setSuivis(abonnements.gens);
          setArtistesSuivis(abonnements.artistes ?? []);
        } catch {
          // Sans carte de visite, l'ecran reste utilisable : la recherche, la
          // cloche et la bascule ne dependent pas d'elle.
        }
      })();

      // La pastille doit etre juste des l'arrivee, pas apres un aller-retour.
      void rafraichirNotifs();

      return () => {
        vivant = false;
      };
    }, [compte.loading, compte.connected]),
  );

  const basculer = useCallback(async (v: boolean) => {
    vibrer.choix();
    // Optimiste, puis relit : la relecture est ce qui corrige si le serveur
    // a refuse sans que le catch le voie.
    setVisible(v);
    const r = await prisme.setVisibilite(v).catch(() => null);
    if (r) setVisible(r.visible);
  }, []);

  const ouvrir = useCallback(
    (id: string) => {
      vibrer.choix();
      router.push(`/gens/${encodeURIComponent(id)}`);
    },
    [router],
  );

  const ouvrirArtiste = useCallback(
    (id: number) => {
      vibrer.choix();
      router.push(`/artiste/${id}`);
    },
    [router],
  );

  /**
   * Donner son profil.
   *
   * C'est l'usage central de tout le social de cette application — « va sur le
   * profil que quelqu'un t'a donne » — et il n'avait aucun bouton. On partage
   * le `@` et non l'identifiant : c'est court, ca se dit a l'oral, et le
   * moteur resout les deux.
   */
  const partager = useCallback(async () => {
    if (!moi?.handle) return;
    vibrer.action();
    await Share.share({ message: `Retrouve-moi sur Reso : @${moi.handle}` }).catch(() => {});
  }, [moi?.handle]);

  if (!compte.loading && !compte.connected) {
    return (
      <AccountGate
        titre="Les gens"
        raison="Cherche les profils, écoute ce qu'ils gardent — et montre le tien si tu veux."
        busy={compte.busy}
        error={compte.error}
        onConnect={compte.connect}
      />
    );
  }

  /** Une recherche en cours prend toute la place : ce qu'on cherche passe
   *  avant ce qu'on a deja. */
  const enRecherche = texte.trim().length >= MINIMUM;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: space.xxl }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* -- La carte de visite ------------------------------------------- */}
      <View style={styles.carte}>
        <Pressable
          style={({ pressed }) => [styles.identite, pressed && styles.pale]}
          onPress={() => moi && ouvrir(moi.id)}
          disabled={!moi}
          accessibilityRole="button"
          accessibilityLabel="Voir ton profil tel que les gens le voient"
        >
          <Visage uri={moi?.avatar} taille={72} />
          <View style={styles.identiteTexte}>
            <NomVerifie
              nom={moi?.nom || 'Toi'}
              verifie={moi?.verifie}
              style={styles.nom}
              taille={16}
            />
            <Text style={styles.arobase} numberOfLines={1}>
              {moi?.handle ? `@${moi.handle}` : '…'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.cloche, pressed && styles.pale]}
          onPress={() => {
            vibrer.choix();
            router.push('/notifs');
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={
            nouvelles > 0 ? `Notifications, ${nouvelles} nouvelles` : 'Notifications'
          }
        >
          <IconeCloche couleur={nouvelles > 0 ? color.text : color.textMuted} />
          {nouvelles > 0 ? (
            <View style={styles.badge}>
              <Text style={[styles.badgeTexte, chiffres]}>{nouvelles > 9 ? '9+' : nouvelles}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* Les trois chiffres. Deux menent quelque part, le premier non : ce
          qu'on garde se regarde dans l'onglet « Gardés », pas ici. */}
      <View style={styles.chiffres}>
        <Compteur n={moi?.total} mot="gardés" />
        <Compteur
          n={moi?.abonnements}
          mot="abonnements"
          onPress={
            moi ? () => router.push(`/gens/${encodeURIComponent(moi.id)}/gens?type=abonnements`) : undefined
          }
        />
        <Compteur
          n={moi?.abonnes}
          mot="abonnés"
          onPress={
            moi ? () => router.push(`/gens/${encodeURIComponent(moi.id)}/gens?type=abonnes`) : undefined
          }
        />
        {moi?.handle ? (
          <Pressable
            style={({ pressed }) => [styles.partage, pressed && styles.pale]}
            onPress={partager}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Partager ton profil"
          >
            <IconePartage couleur={color.accent} />
          </Pressable>
        ) : null}
      </View>

      {/* -- Le repertoire -------------------------------------------------- */}
      <TextInput
        style={styles.champ}
        placeholder="Chercher un profil, un @ ou un artiste…"
        placeholderTextColor={color.textFaint}
        value={texte}
        onChangeText={setTexte}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Rechercher un profil ou un artiste"
      />

      {occupe ? <ActivityIndicator color={color.accent} style={styles.attente} /> : null}
      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

      {!erreur &&
      enRecherche &&
      !occupe &&
      gens !== null &&
      gens.length === 0 &&
      artistes !== null &&
      artistes.length === 0 ? (
        <Text style={styles.vide}>
          Ni profil ni artiste de ce nom. Les profils cachés n'apparaissent pas — c'est le but.
        </Text>
      ) : null}

      {/* Les profils d'abord : c'est l'onglet « Les gens », et quelqu'un qui
          cherche un @ ne doit pas defiler sous une liste d'artistes. Les
          titres de section ne s'affichent qu'en recherche — hors recherche il
          n'y a qu'une liste, et la nommer serait du bruit. */}
      {enRecherche && gens !== null && gens.length > 0 ? (
        <View style={styles.resultats}>
          <Text style={styles.sectionTitre}>Profils</Text>
          <View style={styles.liste}>
            {gens.map((g) => (
              <Pressable
                key={g.user_id}
                style={({ pressed }) => [styles.rang, pressed && styles.pale]}
                onPress={() => ouvrir(g.user_id)}
                accessibilityRole="button"
                accessibilityLabel={`Voir le profil de ${g.nom}`}
              >
                <Visage uri={g.avatar} taille={48} />
                <View style={styles.rangTexte}>
                  <NomVerifie
                    nom={g.nom || 'Sans nom'}
                    verifie={g.verifie}
                    style={styles.rangNom}
                  />
                  <Text style={styles.sous} numberOfLines={1}>
                    {[g.handle ? `@${g.handle}` : null, `${g.gardes} gardé${g.gardes > 1 ? 's' : ''}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <IconeChevron couleur={color.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Les artistes. Portrait carre a coins arrondis, la ou les profils ont
          un visage rond : la forme dit la nature de la ligne avant que le
          titre de section soit lu, et c'est ce qui permet aux deux listes de
          se suivre sans se confondre. */}
      {enRecherche && artistes !== null && artistes.length > 0 ? (
        <View style={styles.resultats}>
          <Text style={styles.sectionTitre}>Artistes</Text>
          <View style={styles.liste}>
            {artistes.map((a) => {
              const abonnes = fansLisibles(a.fans);
              return (
                <Pressable
                  key={a.id}
                  style={({ pressed }) => [styles.rang, pressed && styles.pale]}
                  onPress={() => ouvrirArtiste(a.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Voir la fiche de ${a.name}`}
                >
                  <Image
                    source={{ uri: a.picture }}
                    style={styles.portrait}
                    contentFit="cover"
                    transition={160}
                    cachePolicy="memory-disk"
                    recyclingKey={String(a.id)}
                  />
                  <View style={styles.rangTexte}>
                    <NomVerifie nom={a.name} verifie={a.verifie} style={styles.rangNom} />
                    {abonnes ? (
                      <Text style={styles.sous} numberOfLines={1}>
                        {abonnes} sur Deezer
                      </Text>
                    ) : null}
                  </View>
                  <IconeChevron couleur={color.textFaint} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Les visages de ceux qu'on suit, puis les portraits des artistes.
          Ils ne s'affichent pas pendant une recherche : deux listes de gens
          l'une sous l'autre demanderaient de lire le titre pour savoir
          laquelle on regarde.

          Rond pour un profil, carre a coins arrondis pour un artiste : la
          forme dit la nature avant qu'on lise le nom, et c'est ce qui permet
          aux deux de se suivre dans la meme file. */}
      {!enRecherche && (suivis?.length ?? 0) + (artistesSuivis?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionEntete}>
            <Text style={styles.sectionTitre}>Tu suis</Text>
            {moi ? (
              <Pressable
                onPress={() =>
                  router.push(`/gens/${encodeURIComponent(moi.id)}/gens?type=abonnements`)
                }
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Voir tous tes abonnements"
              >
                <Text style={styles.tout}>tout voir</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rangee}
          >
            {(suivis ?? []).slice(0, VISAGES).map((g) => (
              <Pressable
                key={g.user_id}
                style={({ pressed }) => [styles.tete, pressed && styles.pale]}
                onPress={() => ouvrir(g.user_id)}
                accessibilityRole="button"
                accessibilityLabel={`Voir le profil de ${g.nom}`}
              >
                <Visage uri={g.avatar} taille={56} />
                <Text style={styles.tetePrenom} numberOfLines={1}>
                  {(g.nom || g.handle || '?').split(' ')[0]}
                </Text>
              </Pressable>
            ))}
            {(artistesSuivis ?? []).slice(0, VISAGES).map((a) => (
              <Pressable
                key={`a${a.id}`}
                style={({ pressed }) => [styles.tete, pressed && styles.pale]}
                onPress={() => ouvrirArtiste(a.id)}
                accessibilityRole="button"
                accessibilityLabel={`Voir la fiche de ${a.name}`}
              >
                <Image
                  source={{ uri: a.picture }}
                  style={styles.tetePortrait}
                  contentFit="cover"
                  transition={160}
                  cachePolicy="memory-disk"
                  recyclingKey={String(a.id)}
                />
                <Text style={styles.tetePrenom} numberOfLines={1}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {!enRecherche &&
      suivis !== null &&
      suivis.length === 0 &&
      (artistesSuivis?.length ?? 0) === 0 ? (
        <Text style={styles.vide}>
          Tu ne suis personne. Cherche un @ ou un artiste au-dessus, ou demande son profil à
          quelqu'un.
        </Text>
      ) : null}

      {/* La bascule, en une ligne, tout en bas : on ne vient ici que pour elle
          quand on veut disparaitre, jamais par hasard. */}
      <View style={styles.bascule}>
        <Text style={styles.basculeTitre}>Apparaître dans la recherche</Text>
        <Switch
          value={visible ?? false}
          disabled={visible === null}
          onValueChange={basculer}
          trackColor={{ false: '#26262B', true: color.accentDim }}
          thumbColor={visible ? color.accent : color.textMuted}
          ios_backgroundColor="#26262B"
          accessibilityLabel="Apparaître dans la recherche"
        />
      </View>
      <Text style={styles.basculeSous}>
        Caché, ton profil ne se cherche pas et répond introuvable. Ton lien continue de marcher.
      </Text>
    </ScrollView>
  );
}

/**
 * Un chiffre et son mot.
 *
 * Le nombre au-dessus du mot, et non a cote : trois paires cote a cote sur une
 * ligne se lisent comme une phrase, empilees elles se comparent. Un compteur
 * sans destination n'est pas pressable — ce serait promettre un ecran qui
 * n'existe pas.
 */
function Compteur({ n, mot, onPress }: { n?: number; mot: string; onPress?: () => void }) {
  const contenu = (
    <>
      <Text style={[styles.compteurN, chiffres]}>{n ?? '—'}</Text>
      <Text style={styles.compteurMot}>{mot}</Text>
    </>
  );
  if (!onPress) return <View style={styles.compteur}>{contenu}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.compteur, pressed && styles.pale]}
      onPress={() => {
        vibrer.choix();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${n ?? 0} ${mot}`}
    >
      {contenu}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  pale: { opacity: 0.55 },

  // -- Carte de visite --------------------------------------------------
  carte: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identite: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  identiteTexte: { flex: 1, gap: 2 },
  nom: { ...type.display, fontSize: 26, lineHeight: 31, color: color.text },
  arobase: { ...type.body, color: color.accent },

  cloche: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent,
    borderWidth: 2,
    borderColor: color.bg,
  },
  badgeTexte: { ...type.caption, fontSize: 12, lineHeight: 15, color: color.bg, fontWeight: '800' },

  chiffres: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    marginTop: space.lg,
  },
  compteur: { alignItems: 'flex-start', gap: 1 },
  compteurN: { ...type.title, fontSize: 20, lineHeight: 25, color: color.text },
  compteurMot: { ...type.label, fontSize: 13, lineHeight: 17, color: color.textFaint },
  // Pousse a droite : c'est une action, pas un quatrieme chiffre.
  partage: {
    marginLeft: 'auto',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accentDim,
  },

  // -- Repertoire --------------------------------------------------------
  champ: {
    ...type.body,
    color: color.text,
    backgroundColor: color.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.xl,
  },

  attente: { marginTop: space.lg },
  erreur: { ...type.body, fontSize: 15, lineHeight: 20, color: color.alert, marginTop: space.lg },
  vide: { ...type.body, fontSize: 15, lineHeight: 22, color: color.textMuted, marginTop: space.lg },

  // Un bloc de resultats : son titre, puis ses lignes. La marge du haut est
  // portee ici et non par la liste, sinon le titre collerait au champ.
  resultats: { marginTop: space.lg },
  liste: { marginTop: space.sm },
  portrait: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.bgElevated },
  rang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  rangTexte: { flex: 1, gap: 2 },
  rangNom: { ...type.lead, color: color.text },
  sous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  section: { marginTop: space.xl, gap: space.md },
  sectionEntete: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitre: { ...type.label, color: color.textMuted, letterSpacing: 0.4 },
  tout: { ...type.label, fontSize: 13, color: color.accent },
  // La rangee deborde volontairement des marges de l'ecran : un defilement
  // horizontal qui s'arrete pile au bord ne se voit pas defiler.
  rangee: { gap: space.md, paddingRight: space.lg },
  tete: { width: 56, alignItems: 'center', gap: space.xs },
  tetePortrait: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: color.bgElevated },
  tetePrenom: { ...type.caption, fontSize: 13, lineHeight: 18, color: color.textFaint },


  // -- Bascule ------------------------------------------------------------
  bascule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.xxl,
    minHeight: 44,
  },
  basculeTitre: { ...type.lead, color: color.text, flex: 1 },
  basculeSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
});
