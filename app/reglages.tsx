import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { Fragment, isValidElement, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import Animated, {
  Easing, LinearTransition, interpolateColor, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { autoriser, etatSpotify, importTaste, isSpotifyConfigured, oublierSpotify } from '../src/auth/spotify';
import { oublierSync } from '../src/state/spotifySync';
import type { Artist, Prefs } from '../src/api/types';
import { IconeChevron, IconeRetour } from '../src/components/Icones';
import { Visage } from '../src/components/Visage';
import type { IdPlateforme } from '../src/state/plateforme';
import { chargerPlateforme, PLATEFORMES, plateforme, reglerPlateforme } from '../src/state/plateforme';
import { resetSession } from '../src/state/session';
import { reinitialiserPasse } from '../src/state/passe';
import { refreshAccount, useAccount } from '../src/state/useAccount';
import { chargerVibration, reglerVibration, vibrer } from '../src/state/vibration';
import { color, curve, motion, radius, space, type } from '../src/theme/tokens';

/**
 * Les reglages — **le dos d'une pochette**, pas un panneau de configuration.
 *
 * L'ecran precedent empilait neuf sections du meme poids : compte, plateforme,
 * Spotify, le fil, gouts de depart, bannis, donnees, moteur, credit. Chacune
 * avec son titre a 20 px et ses lignes filetees identiques. Quand tout pese
 * pareil, rien ne pese — et le lecteur ne trouve rien parce qu'il n'y a rien a
 * trouver, juste une liste plate a parcourir en entier.
 *
 * Le dos d'une pochette de disque, lui, a toujours eu trois etages : en haut
 * l'etiquette (a qui c'est, ce que c'est), au milieu les mentions qu'on
 * consulte, en bas les credits et la reference de pressage, minuscules. C'est
 * l'ordre repris ici, et il donne les trois poids qui manquaient.
 *
 * ## Ce qui a ete retire, et pourquoi
 *
 *  - **Le bloc « Le moteur »** — base, cache, reseau G, adresse du serveur.
 *    C'etait le modele de donnees du serveur affiche a quelqu'un qui n'a aucun
 *    moyen d'agir dessus, et c'est ce qui faisait le plus surement « build de
 *    developpement » plutot que « produit ». Le numero de version survit, en
 *    pied de page, la ou toutes les applications le mettent.
 *  - **« Tester la liaison » et son verdict en chasse fixe.** Un code de statut
 *    HTTP n'est pas une reponse. `diagnostiquer()` reste dans
 *    `src/auth/spotify.ts` pour la console ; ce que l'ecran garde, c'est le
 *    bouton qui **repare** (reautoriser), pas celui qui constate.
 *  - **Le tableau des trois memoires** (telephone / serveur / cache). Meme
 *    faute : une description d'architecture posee devant quelqu'un qui voulait
 *    juste savoir ce que « Repartir de zero » efface. La phrase sous le bouton
 *    le dit, et c'est tout ce qui est utile au moment ou on hesite.
 *  - **Le titre « Reglages ».** Aucun autre ecran de l'app ne se nomme
 *    lui-meme : `bienvenue`, `connexion`, `plateforme` ouvrent tous sur une
 *    phrase, jamais sur une etiquette de page. Ici l'etiquette, c'est le
 *    visage de la personne.
 *
 * ## Ce qui a ete ajoute
 *
 *  - **L'etat du fil, ecrit en toutes lettres.** `discovery_now` etait charge
 *    depuis toujours et n'etait jamais montre : c'est pourtant la seule chose
 *    de cet ecran qui ait bouge depuis la derniere visite. La phrase le dit
 *    sans jamais lacher le nombre — la regle « aucun modele de donnees a
 *    l'ecran » tient, et « Automatique » cesse d'etre une boite noire.
 *  - **Un etat vide dessine** pour le gout, au lieu d'une section qui
 *    disparait. Une section qui s'evapore n'apprend rien ; une phrase, si.
 *
 * ## Ce qui n'a pas bouge
 *
 * Aucun appel serveur n'a change de forme. `prefs`, `anchors`, `blocked`,
 * `setPrefs`, `unblock`, `resetSession` sont appeles exactement comme avant,
 * et deux appels ont disparu (`health`, `diagnostiquer`).
 *
 * L'ecran reste ouvert **sans compte** : c'est le seul chemin vers « repartir
 * de zero » pour un appareil anonyme, et une page de reglages qui exigerait de
 * se connecter pour se deconnecter serait une plaisanterie.
 *
 * ## La lecon des reglages natifs
 *
 * Un ecran de reglages est le seul endroit d'une application ou la liste
 * **inseree** n'est pas un tic mais la convention que tout le monde sait lire :
 * chaque groupe pose sa surface (un palier d'elevation au-dessus du fond),
 * les titres de section sont des **etiquettes en capitales espacees**, pas des
 * titres — un titre de section a 20 px grasse criait plus fort que les lignes
 * qu'il nommait, et c'est precisement ce qui faisait amateur. Les separateurs
 * s'alignent sur le texte, la ligne de navigation porte son chevron, et l'etat
 * arme du bouton destructeur gagne une surface, pas seulement une couleur.
 */

/** La courbe de l'app, prete a servir a Reanimated. */
const COURBE = Easing.bezier(...curve.out);

/** Combien de temps « Repartir de zero » reste arme.
 *
 *  Il ne se desarmait jamais : on pouvait armer le bouton, aller regarder
 *  ailleurs, revenir et l'effacement partait au premier appui. Six secondes,
 *  c'est le temps de lire la phrase et de decider. */
const ARME_MS = 6000;

/** Les trois intentions, et ce qu'elles valent pour le moteur. `null` lui rend
 *  la main. */
type Intention = { cle: string; mot: string; dit: string; valeur: number | null };

function intentions(p: Prefs | null): Intention[] {
  return [
    {
      cle: 'sur',
      mot: 'Familier',
      dit: 'Rien d’inconnu. Surtout ce qui ressemble à ce que tu aimes déjà.',
      // Zero explicite, pas le plancher du moteur : « Familier » promet
      // l'absence totale d'inconnu, et le serveur l'accepte desormais.
      valeur: 0,
    },
    {
      cle: 'auto',
      mot: 'Automatique',
      dit: 'Reso ouvre quand ça accroche, resserre quand ça passe mal.',
      valeur: null,
    },
    {
      cle: 'large',
      mot: 'Curieux',
      dit: 'Plus de titres venus du bord de ton goût. Plus de ratés, aussi.',
      valeur: p?.discovery_max ?? 0.55,
    },
  ];
}

/**
 * La phrase d'ouverture : ou en est le fil, maintenant.
 *
 * Le nombre n'apparait jamais. Ce qu'on rend, c'est l'intention en cours et —
 * quand le moteur decide seul — **de quel cote il a penche**, lu dans
 * `discovery_now` rapporte a la fourchette. C'est une information neuve : elle
 * change entre deux visites sans qu'on ait touche a quoi que ce soit, ce qui
 * est exactement ce qu'on attend d'un reglage automatique.
 */
function etatDuFil(p: Prefs | null): { avant: string; fort: string; apres: string } {
  if (!p) {
    return { avant: 'Reso apprend ce que tu aimes, ', fort: 'une carte à la fois', apres: '.' };
  }

  const milieu = (p.discovery_min + p.discovery_max) / 2;

  if (p.discovery !== null) {
    return p.discovery <= milieu
      ? { avant: 'Le fil te propose ', fort: 'surtout ce que tu connais déjà', apres: '.' }
      : { avant: 'Le fil va ', fort: 'chercher au bord de ton goût', apres: '.' };
  }

  const etendue = p.discovery_max - p.discovery_min;
  const place = etendue > 0 ? (p.discovery_now - p.discovery_min) / etendue : 0.5;
  const fort =
    place < 0.34 ? 'il reste près de ce que tu connais'
    : place > 0.66 ? 'il ouvre large'
    : 'il tient le milieu';

  return { avant: 'Le fil s’ajuste tout seul. En ce moment, ', fort, apres: '.' };
}

export default function Reglages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [ancres, setAncres] = useState<Artist[]>([]);
  const [bannis, setBannis] = useState<Artist[]>([]);
  const [haptique, setHaptique] = useState(true);
  const [confirme, setConfirme] = useState(false);
  const [plate, setPlate] = useState<IdPlateforme>('rien');
  const [ouvrePlate, setOuvrePlate] = useState(false);
  const [spot, setSpot] = useState({ relie: false, peutEcrire: false, peutPlaylist: false });
  /** L'import Spotify en cours, et ce qu'il a donne. */
  const [importe, setImporte] = useState(false);
  const [ditImport, setDitImport] = useState<string | null>(null);
  /** Le moteur ignore `/prefs` : les trois intentions n'ont plus de sens. */
  const [sansPrefs, setSansPrefs] = useState(false);

  useEffect(() => {
    void chargerVibration().then(setHaptique);
    void chargerPlateforme().then(setPlate);
    void etatSpotify().then(setSpot);
  }, []);

  useEffect(() => {
    // La decouverte se regle **sans compte** : la question est posee a la fin
    // du demarrage, avant toute connexion.
    prisme.prefs().then(setPrefs).catch(() => setSansPrefs(true));
  }, []);

  useEffect(() => {
    if (!compte.connected) return;
    // Chacun est facultatif : un moteur d'une version anterieure ignore ces
    // routes, et la page doit rester entiere sans elles.
    prisme.anchors().then((r) => setAncres(r.artists)).catch(() => {});
    prisme.blocked().then((r) => setBannis(r.artists)).catch(() => {});
  }, [compte.connected]);

  // Le bouton arme se desarme seul. Sans cela, l'ecran restait indefiniment a
  // un appui de l'effacement.
  useEffect(() => {
    if (!confirme) return;
    const t = setTimeout(() => setConfirme(false), ARME_MS);
    return () => clearTimeout(t);
  }, [confirme]);

  const basculerPlate = useCallback(() => {
    vibrer.choix();
    setOuvrePlate((o) => !o);
  }, []);

  const changerPlateforme = useCallback(async (id: IdPlateforme) => {
    vibrer.choix();
    setPlate(id);
    setOuvrePlate(false);
    await reglerPlateforme(id);
  }, []);

  /**
   * Reprendre ce qu'on ecoute sur Spotify, **apres** l'inscription.
   *
   * C'est le trou qu'il fallait boucher : l'import n'existait qu'au demarrage,
   * sur `app/plateforme.tsx`. Quelqu'un qui s'etait inscrit en choisissant six
   * artistes a la main, puis reliait Spotify ici, voyait sa liaison se poser
   * sans qu'un seul titre soit lu — le bouton ne servait qu'a **ecrire** chez
   * Spotify. Rien ne le disait, et rien ne permettait de s'en sortir.
   *
   * L'import remplace le precedent import Spotify au lieu de s'y ajouter
   * (`remplace`), et ne touche jamais aux artistes choisis a la main.
   */
  const importerSpotify = useCallback(async () => {
    vibrer.action();
    setImporte(true);
    setDitImport(null);
    try {
      const gout = await importTaste();
      // Fenetre fermee : ce n'est pas une erreur, et il n'y a rien a dire.
      if (!gout) return;
      if (gout.artists.length === 0) {
        setDitImport('Spotify n’a renvoyé aucun artiste écouté.');
        return;
      }
      const r = await prisme.seed({ artists: gout.artists, source: 'spotify', remplace: true });
      // Le chiffre annonce est celui que le moteur a **retenu**, pas celui
      // qu'on lui a envoye : un artiste sans voisin chez Deezer est ecarte, et
      // promettre 45 ancres quand il en reste 40 serait faux.
      setDitImport(`${r.anchors} artistes repris de Spotify.`);
      // Le bloc « Ton gout » montre les ancres : il vient de changer.
      prisme.anchors().then((x) => setAncres(x.artists)).catch(() => {});
    } catch (e) {
      setDitImport(e instanceof Error ? e.message : 'Import impossible');
    } finally {
      setImporte(false);
      setSpot(await etatSpotify());
    }
  }, []);

  /**
   * Refaire l'autorisation Spotify.
   *
   * Ce n'est pas une commodite : la portee d'ecriture a ete ajoutee apres que
   * des jetons ont ete ranges sur le telephone, et **rien n'elargit un jeton
   * apres coup**. Sans ce bouton, un ajout aux titres likes echouait en 403
   * sans aucun moyen de s'en sortir depuis l'app.
   *
   * **Une premiere liaison enchaine sur l'import.** Relier Spotify veut dire
   * « prends ce que j'ecoute » : le faire en deux gestes separes laissait le
   * premier sans effet visible. Elargir une liaison qui existe deja, en
   * revanche, ne relit rien — c'est une reparation de permission, pas une
   * arrivee, et l'import reste a un appui de la.
   */
  const reconnecterSpotify = useCallback(async () => {
    vibrer.action();
    const premiereFois = !spot.relie;
    try {
      await autoriser();
    } catch {
      // Le message utile est deja passe dans la console ; ici on se contente
      // de relire l'etat, qui dira si ca a pris.
    }
    const etat = await etatSpotify();
    setSpot(etat);
    if (premiereFois && etat.relie) await importerSpotify();
  }, [spot.relie, importerSpotify]);

  const delierSpotify = useCallback(async () => {
    vibrer.action();
    setDitImport(null);
    await oublierSpotify();
    // La synchronisation continue appartenait a cette liaison : la laisser
    // allumee ferait accumuler une file qui ne partira jamais.
    await oublierSync();
    setSpot(await etatSpotify());
  }, []);

  const choisir = useCallback(async (v: number | null) => {
    vibrer.choix();
    // Optimiste : le reglage se lit dans le fil, pas ici, et attendre le
    // serveur pour deplacer une pastille donne l'impression d'un bouton mou.
    setPrefs((p) => (p ? { ...p, discovery: v } : p));
    await prisme.setPrefs(v).catch(() => {});
    prisme.prefs().then(setPrefs).catch(() => {});
  }, []);

  const debloquer = useCallback(async (a: Artist) => {
    vibrer.action();
    setBannis((xs) => xs.filter((x) => x.id !== a.id));
    await prisme.unblock(a.id).catch(() => {});
  }, []);

  const basculerHaptique = useCallback(async (on: boolean) => {
    setHaptique(on);
    await reglerVibration(on);
  }, []);

  const repartir = useCallback(async () => {
    // Deux temps, sans boite de dialogue : l'app n'en a aucune, et le bouton
    // qui change de mot dit la meme chose sans emprunter un composant a un
    // autre systeme.
    if (!confirme) {
      setConfirme(true);
      vibrer.grave();
      return;
    }
    await resetSession();
    await refreshAccount();
    router.replace('/bienvenue');
  }, [confirme, router]);

  const courante = prefs?.discovery ?? null;
  const actuelle = plateforme(plate);
  const fil = etatDuFil(prefs);

  // Spotify ne se montre que quand il a quelque chose a dire : la plateforme
  // choisie, ou une liaison deja posee qu'il faut pouvoir defaire meme apres
  // avoir change d'avis.
  const montrerSpotify = isSpotifyConfigured() && (plate === 'spotify' || spot.relie);

  // --- La photo de profil ----------------------------------------------------
  // Galerie → recadrage natif carree → 512 px JPEG → data URL vers le moteur.
  // Le recadrage est celui du systeme : c'est le seul que tout le monde sait
  // deja utiliser, et il evite de reinventer un crop maison.
  const [photoOccupe, setPhotoOccupe] = useState(false);
  const [photoDit, setPhotoDit] = useState<string | null>(null);

  const changerPhoto = useCallback(async () => {
    if (photoOccupe) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoDit("L'accès aux photos est refusé.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets[0]) return;
    setPhotoOccupe(true);
    setPhotoDit(null);
    try {
      const rendu = await ImageManipulator.manipulate(res.assets[0].uri)
        .resize({ width: 512 })
        .renderAsync();
      const sortie = await rendu.saveAsync({
        compress: 0.85,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!sortie.base64) throw new Error('Image illisible.');
      const dataUrl = `data:image/jpeg;base64,${sortie.base64}`;
      await prisme.setAvatar(dataUrl);
      await refreshAccount();
      setPhotoDit('Photo mise à jour.');
    } catch (e) {
      setPhotoDit(e instanceof Error ? e.message : 'Impossible de changer la photo.');
    } finally {
      setPhotoOccupe(false);
    }
  }, [photoOccupe]);

  const retirerPhoto = useCallback(async () => {
    setPhotoOccupe(true);
    setPhotoDit(null);
    try {
      await prisme.supprimerAvatar();
      await refreshAccount();
      setPhotoDit('Photo retirée.');
    } catch {
      setPhotoDit('Impossible de retirer la photo.');
    } finally {
      setPhotoOccupe(false);
    }
  }, [photoOccupe]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        style={({ pressed }) => [styles.retour, pressed && styles.pale]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Retour"
        hitSlop={12}
      >
        <IconeRetour couleur={color.textMuted} />
      </Pressable>

      {/* --- L'etiquette ------------------------------------------------- */}
      <View style={styles.etiquette}>
        {compte.connected ? (
          <>
            <View style={styles.identite}>
              <Visage uri={compte.me?.picture ?? null} taille={64} />
              <View style={styles.identiteTexte}>
                <Text style={styles.nom} numberOfLines={1}>
                  {compte.me?.name ?? 'Compte du réseau G'}
                </Text>
                {compte.me?.email ? (
                  <Text style={styles.mail} numberOfLines={1}>
                    {compte.me.email}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Changer / retirer la photo de profil. La galerie ouvre le
                recadrage carre du systeme ; l'envoi part apres compression. */}
            <View style={styles.photoActions}>
              <Pressable
                style={({ pressed }) => [styles.photoAction, pressed && styles.pale]}
                onPress={changerPhoto}
                disabled={photoOccupe}
                accessibilityRole="button"
                accessibilityLabel="Changer la photo de profil"
              >
                <Text style={[styles.photoActionTexte, photoOccupe && styles.pale]}>
                  {photoOccupe ? 'Envoi…' : 'Changer la photo'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.photoAction, pressed && styles.pale]}
                onPress={retirerPhoto}
                disabled={photoOccupe}
                accessibilityRole="button"
                accessibilityLabel="Retirer la photo de profil"
              >
                <Text style={[styles.photoActionTexte, styles.photoActionRetrait]}>Retirer</Text>
              </Pressable>
            </View>
            {photoDit ? <Text style={styles.photoDit}>{photoDit}</Text> : null}
          </>
        ) : null}

        <Text style={styles.phrase}>
          {fil.avant}
          <Text style={styles.phraseFort}>{fil.fort}</Text>
          {fil.apres}
        </Text>
      </View>

      {compte.connected ? null : (
        <View style={styles.corps}>
          <Rang
            titre="Se connecter au réseau G"
            sous="Sans compte, ton goût vit sur ce téléphone et part avec lui."
            accent
            occupe={compte.busy}
            onPress={compte.connect}
          />
          {compte.error ? <Text style={styles.erreur}>{compte.error}</Text> : null}
        </View>
      )}

      {/* --- Le fil ------------------------------------------------------ */}
      <Groupe titre="Le fil">
        {/* Trois etats, un seul cadre. En attente : les lignes sont dessinees
            et muettes, donc la mise en page ne saute pas quand la reponse
            arrive. Route absente : elles disparaissent — un moteur d'une
            version anterieure ne doit pas laisser trois cases mortes. */}
        {sansPrefs ? null : intentions(prefs).map((i) => (
          <Choix
            key={i.cle}
            mot={i.mot}
            dit={i.dit}
            choisi={prefs !== null && i.valeur === courante}
            // Tant que la fourchette du moteur est inconnue, appuyer
            // enverrait une valeur devinee : les lignes sont dessinees, mais
            // muettes. La mise en page ne bouge pas quand la reponse arrive.
            onPress={prefs ? () => choisir(i.valeur) : undefined}
          />
        ))}
        {/* Les styles vivent dans « Le fil » et pas dans « Ou tu ecoutes » :
            ils reglent ce qu'on sert, pas d'ou vient le catalogue. */}
        <Rang
          titre="Tes styles"
          sous="Ce que tu veux entendre plus souvent, sans rien perdre du reste."
          pousse
          onPress={() => router.push('/styles?retour=reglages')}
        />
        {/* La ligne qui retombe le drapeau du didacticiel : au retour sur le
            fil, la carte fantome sera la. `back` suffit — les reglages ne
            s'ouvrent que depuis un ecran qui revient sur le fil. */}
        <Rang
          titre="Revoir les gestes"
          sous="La carte qui explique passer, j'aime et garder."
          pousse
          onPress={async () => {
            vibrer.choix();
            await reinitialiserPasse();
            router.back();
          }}
        />
        <Bascule
          titre="Retour haptique"
          sous="La petite vibration quand une carte part."
          valeur={haptique}
          onChange={basculerHaptique}
        />
      </Groupe>

      {/* --- Ou tu ecoutes ----------------------------------------------- */}
      {/* Deux sections auparavant — « Ta plateforme » et « Spotify » — posees
          l'une sous l'autre alors qu'elles parlent du meme sujet, et qui se
          contredisaient a l'oeil : la premiere annoncait Deezer, la seconde
          proposait Spotify juste en dessous. */}
      <Groupe titre="Où tu écoutes">
        <Deplie
          titre={ouvrePlate ? 'Choisis-en une' : actuelle.nom}
          sous={ouvrePlate ? undefined : actuelle.dit}
          ouvert={ouvrePlate}
          onPress={basculerPlate}
        />
        {ouvrePlate
          ? PLATEFORMES.map((p) => (
              <Choix
                key={p.id}
                mot={p.nom}
                dit={p.dit}
                choisi={p.id === plate}
                onPress={() => changerPlateforme(p.id)}
              />
            ))
          : null}

        {montrerSpotify && !spot.relie ? (
          <Rang
            titre="Connecter Spotify"
            sous="Reprend ce que tu écoutes, et retrouve tes gardés dans tes titres likés."
            accent
            occupe={importe}
            onPress={reconnecterSpotify}
          />
        ) : null}
        {/* L'import, a part et refaisable. Ce qu'on ecoute bouge ; le gout de
            depart, lui, restait fige au jour de l'inscription. */}
        {montrerSpotify && spot.relie ? (
          <Rang
            titre="Reprendre mes goûts Spotify"
            sous={
              ditImport ??
              'Titres likés, artistes suivis, playlists et albums enregistrés. Remplace l’import précédent.'
            }
            occupe={importe}
            onPress={importerSpotify}
          />
        ) : null}
        {montrerSpotify && spot.relie && !spot.peutEcrire ? (
          <Rang
            titre="Autoriser l’ajout aux titres likés"
            sous="Ta connexion date d’avant cette permission. Sans elle, Spotify refuse l’ajout."
            accent
            onPress={reconnecterSpotify}
          />
        ) : null}
        {montrerSpotify && spot.relie && spot.peutEcrire && !spot.peutPlaylist ? (
          <Rang
            titre="Autoriser la playlist « Reso »"
            sous="Ta connexion date d’avant cette permission. Sans elle, l’export des gardés vers une playlist est refusé."
            accent
            onPress={reconnecterSpotify}
          />
        ) : null}
        {montrerSpotify && spot.relie ? (
          <Rang
            titre="Délier Spotify"
            sous={
              !spot.peutEcrire
                ? 'Relié en lecture seule.'
                : spot.peutPlaylist
                  ? 'Relié : titres likés et playlist « Reso ».'
                  : 'Relié : titres likés, sans la playlist.'
            }
            onPress={delierSpotify}
          />
        ) : null}
      </Groupe>

      {/* --- Ton gout ---------------------------------------------------- */}
      {/* « Tes gouts de depart » et « Bannis » etaient deux sections qui
          disparaissaient quand elles etaient vides — donc un ecran dont la
          moitie s'evaporait sans rien dire. Un seul groupe, qui existe
          toujours et qui explique son propre vide. */}
      <Groupe titre="Ton goût">
        {ancres.length > 0 ? (
          <View style={styles.bloc}>
            <Text style={styles.blocNote}>
              Les artistes choisis à l’inscription. Le premier pèse le plus.
            </Text>
            <Portraits gens={ancres} />
          </View>
        ) : null}

        {bannis.length > 0 ? (
          <View style={styles.bloc}>
            <Text style={styles.blocNote}>Bannis — appuie pour lever le bannissement.</Text>
            <View style={styles.pastilles}>
              {bannis.map((a) => (
                <Banni key={a.id} artiste={a} onPress={() => debloquer(a)} />
              ))}
            </View>
          </View>
        ) : null}

        {ancres.length === 0 && bannis.length === 0 ? (
          <View style={styles.bloc}>
            <Text style={styles.blocNote}>
              {compte.connected
                ? 'Tu n’as banni personne, et tes artistes de départ ne sont pas encore revenus du moteur.'
                : 'Tes artistes de départ et tes bannis vivent sur ton compte du réseau G.'}
            </Text>
          </View>
        ) : null}
      </Groupe>

      {/* --- Le pressage -------------------------------------------------- */}
      {/* Se deconnecter etait la deuxieme ligne de l'ecran. C'est-a-dire que la
          premiere chose qu'on proposait de faire dans ses reglages, c'etait de
          partir. Les deux gestes qu'on ne fait qu'une fois sont ici, en bas,
          ensemble. */}
      <View style={styles.pied}>
        <View style={styles.corps}>
          {compte.connected ? <Rang titre="Se déconnecter" onPress={compte.disconnect} /> : null}
          <Rang
            titre={confirme ? 'Confirmer : tout effacer' : 'Repartir de zéro'}
            sous={
              confirme
                ? 'Ceci déconnecte aussi ton compte. Appuie encore pour valider.'
                : 'Efface ce téléphone et te déconnecte. Ce qui est sur le serveur reste.'
            }
            danger={confirme}
            onPress={repartir}
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.credit, pressed && styles.pale]}
          onPress={() => Linking.openURL('https://www.deezer.com')}
          accessibilityRole="link"
        >
          <Text style={styles.creditTexte}>Extraits, pochettes et graphe d’artistes : Deezer.</Text>
        </Pressable>
        <Text style={styles.pressage}>
          Reso {String(Constants.expoConfig?.version ?? '—')}
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * Un groupe de mentions.
 *
 * Le filet se pose **entre** les lignes, jamais au-dessus de la premiere :
 * l'ancien composant donnait a chaque ligne une bordure haute, ce qui collait
 * un trait juste sous le titre du groupe et rendait le bord superieur du
 * groupe indistinct de ses separateurs internes.
 *
 * Il est en retrait de la marge d'ecran, comme sur un tableau natif : un filet
 * qui va d'un bord a l'autre coupe l'ecran en tranches ; un filet en retrait
 * relie les lignes d'une meme liste.
 */
function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  const rangs = flatten(children);
  return (
    <View style={styles.groupe}>
      <Text style={styles.groupeTitre}>{titre}</Text>
      <Animated.View style={styles.corps} layout={LinearTransition.duration(220).easing(COURBE)}>
        {rangs.map((r, i) => (
          <Fragment key={isValidElement(r) && r.key !== null ? r.key : i}>
            {i > 0 ? <View style={styles.filet} /> : null}
            {r}
          </Fragment>
        ))}
      </Animated.View>
    </View>
  );
}

/** Les enfants reellement rendus, tableaux compris : `{condition ? … : null}`
 *  et `.map()` cohabitent dans un meme groupe, et un `null` ne doit pas
 *  recevoir de filet. */
function flatten(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const visiter = (n: React.ReactNode) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (Array.isArray(n)) {
      n.forEach(visiter);
      return;
    }
    out.push(n);
  };
  visiter(children);
  return out;
}

/**
 * Une ligne qui agit.
 *
 * Le retour de pression est un **aplat qui deborde les marges**, pas une
 * opacite. L'ancien ecran faisait palir la ligne entiere a 55 % : un
 * clignotement qui ressemble a une desactivation, et qui n'existe nulle part
 * dans le systeme d'exploitation. Un fond qui va d'un bord a l'autre de
 * l'ecran, si.
 *
 * Deux vocabulaires de fin de ligne, et il ne faut pas les confondre : le
 * **chevron** promet une navigation (on sort de cette page), son absence promet
 * une action sur place. « Tes styles » ouvre un ecran — elle porte le chevron ;
 * « Se deconnecter » agit ici — elle n'en porte pas. C'est ce detail qui fait
 * qu'on sait ce qui va se passer avant d'avoir teste.
 */
function Rang({
  titre,
  sous,
  accent,
  danger,
  occupe,
  pousse,
  onPress,
}: {
  titre: string;
  sous?: string;
  accent?: boolean;
  danger?: boolean;
  occupe?: boolean;
  /** La ligne mene a un autre ecran : afficher le chevron de navigation. */
  pousse?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={occupe}
      accessibilityRole="button"
      accessibilityLabel={titre}
    >
      {({ pressed }) => (
        <View style={[styles.rang, danger && styles.rangAlerte]}>
          {pressed ? <View style={styles.voile} pointerEvents="none" /> : null}
          <View style={styles.rangTexte}>
            <Text style={[styles.rangTitre, accent && styles.enAccent, danger && styles.enAlerte]}>
              {titre}
            </Text>
            {sous ? <Text style={styles.sous}>{sous}</Text> : null}
          </View>
          {occupe ? <ActivityIndicator color={color.accent} /> : null}
          {!occupe && pousse ? <IconeChevron couleur={color.textFaint} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** La ligne qui ouvre un choix. Le chevron tourne d'un quart de tour : c'est
 *  lui qui promet que quelque chose va s'ouvrir ici, et pas ailleurs. */
function Deplie({
  titre,
  sous,
  ouvert,
  onPress,
}: {
  titre: string;
  sous?: string;
  ouvert: boolean;
  onPress: () => void;
}) {
  const tour = useSharedValue(ouvert ? 1 : 0);

  useEffect(() => {
    tour.set(withTiming(ouvert ? 1 : 0, { duration: motion.state, easing: COURBE }));
  }, [ouvert, tour]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tour.get() * 90}deg` }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: ouvert }}
      accessibilityLabel={titre}
    >
      {({ pressed }) => (
        <View style={styles.rang}>
          {pressed ? <View style={styles.voile} pointerEvents="none" /> : null}
          <View style={styles.rangTexte}>
            <Text style={styles.rangTitre}>{titre}</Text>
            {sous ? <Text style={styles.sous}>{sous}</Text> : null}
          </View>
          <Animated.View style={style}>
            <IconeChevron couleur={color.textFaint} />
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Une ligne a cocher.
 *
 * L'etat choisi ne tenait qu'a la couleur du texte et a l'epaisseur d'un
 * anneau — une hierarchie batie sur la couleur seule, la plus fragile de
 * toutes. Ici la ligne choisie prend une **surface** : elle monte d'un palier
 * d'elevation, ce qui se voit avant toute lecture et survit au plein soleil.
 */
function Choix({
  mot,
  dit,
  choisi,
  onPress,
}: {
  mot: string;
  dit: string;
  choisi: boolean;
  onPress?: () => void;
}) {
  const on = useSharedValue(choisi ? 1 : 0);

  useEffect(() => {
    on.set(withTiming(choisi ? 1 : 0, { duration: motion.state, easing: COURBE }));
  }, [choisi, on]);

  const fond = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], ['rgba(19, 19, 22, 0)', SURFACE_CHOISIE]),
  }));
  const anneau = useAnimatedStyle(() => ({
    borderColor: interpolateColor(on.get(), [0, 1], [color.textFaint, color.accent]),
  }));
  const pointe = useAnimatedStyle(() => ({ transform: [{ scale: on.get() }], opacity: on.get() }));

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: choisi, disabled: !onPress }}
      accessibilityLabel={mot}
    >
      {({ pressed }) => (
        <Animated.View style={[styles.rang, fond]}>
          {pressed ? <View style={styles.voile} pointerEvents="none" /> : null}
          <View style={styles.rangTexte}>
            <Text style={[styles.rangTitre, choisi && styles.rangTitreChoisi]}>{mot}</Text>
            <Text style={styles.sous}>{dit}</Text>
          </View>
          <Animated.View style={[styles.anneau, anneau]}>
            <Animated.View style={[styles.pointe, pointe]} />
          </Animated.View>
        </Animated.View>
      )}
    </Pressable>
  );
}

function Bascule({
  titre,
  sous,
  valeur,
  onChange,
}: {
  titre: string;
  sous: string;
  valeur: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.rang}>
      <View style={styles.rangTexte}>
        <Text style={styles.rangTitre}>{titre}</Text>
        <Text style={styles.sous}>{sous}</Text>
      </View>
      <Switch
        value={valeur}
        onValueChange={onChange}
        trackColor={{ false: '#26262B', true: color.accentDim }}
        thumbColor={valeur ? color.accent : color.textMuted}
        ios_backgroundColor="#26262B"
      />
    </View>
  );
}

/** La rangee d'artistes. Deborde volontairement les marges : une rangee qui
 *  defile doit sortir du cadre, sinon rien ne dit qu'elle continue. */
function Portraits({ gens }: { gens: Artist[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.defile}>
      <View style={styles.rangee}>
        {gens.map((a) => (
          <View key={a.id} style={styles.colonne}>
            <Image
              source={{ uri: a.picture }}
              style={styles.portrait}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={160}
              recyclingKey={String(a.id)}
            />
            <Text style={styles.portraitNom} numberOfLines={1}>
              {a.name}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Banni({ artiste, onPress }: { artiste: Artist; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.banni, pressed && styles.banniPresse]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Débannir ${artiste.name}`}
    >
      <Image
        source={{ uri: artiste.picture }}
        style={styles.banniVisage}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={String(artiste.id)}
      />
      <Text style={styles.banniNom} numberOfLines={1}>
        {artiste.name}
      </Text>
      <IconeChevron couleur={color.textFaint} taille={14} />
    </Pressable>
  );
}

/** Marge d'ecran. Le retour de pression la deborde : les lignes portent la
 *  marge en `padding`, jamais le conteneur en `margin`. */
const MARGE = space.lg;

/**
 * Les paliers d'elevation de l'ecran.
 *
 * Fond noir, surface de groupe, surface choisie : trois niveaux, pas un de
 * plus. Sur fond sombre une ombre ne se voit pas — seule la marche entre deux
 * surfaces dit la hierarchie, et elle doit rester lisible au plein soleil.
 * Le niveau choisi est aussi celui que la ligne cochee prend : cocher fait
 * **monter**, c'est ce qui se lit avant toute couleur.
 */
const SURFACE = color.bgElevated;
const SURFACE_CHOISIE = '#1C1C21';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pale: { opacity: 0.5 },

  retour: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: MARGE - space.md,
  },

  // --- L'etiquette ---------------------------------------------------------
  etiquette: { paddingHorizontal: MARGE, paddingTop: space.md, gap: space.lg },
  identite: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identiteTexte: { flex: 1, gap: 2 },
  nom: { ...type.title, color: color.text },
  mail: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textFaint },

  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginTop: space.sm,
  },
  photoAction: { minHeight: 32, justifyContent: 'center' },
  photoActionTexte: { ...type.label, fontSize: 13, lineHeight: 18, color: color.accent },
  photoActionRetrait: { color: color.textFaint },
  photoDit: { ...type.caption, fontSize: 13, lineHeight: 18, color: color.textFaint, marginTop: space.xs },

  // La signature de l'ecran, et la seule chose ecrite en grand. Meme traitement
  // que l'ouverture de « Ton Prisme » : les deux ecrans doivent parler de la
  // meme voix, sinon passer de l'un a l'autre change d'application.
  phrase: { ...type.display, fontSize: 26, lineHeight: 34, color: color.textMuted },
  phraseFort: { color: color.text },

  erreur: { ...type.body, fontSize: 15, lineHeight: 20, color: color.alert, paddingHorizontal: MARGE, paddingTop: space.sm },

  // --- Les groupes ---------------------------------------------------------
  groupe: { marginTop: space.xl },
  // L'etiquette de section, pas un titre : capitales espacees, la plus petite
  // echelle qui reste legible. Elle nomme, elle n'exige rien.
  groupeTitre: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: MARGE + 2,
    marginBottom: space.sm,
  },
  // La surface du groupe : un seul palier au-dessus du fond, coins a rayon
  // moyen. Les lignes gardent leur marge en padding, donc le retour de
  // pression continue de deborder jusqu'aux bords de la surface.
  corps: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: SURFACE,
    marginHorizontal: MARGE,
  },
  // Le separateur s'aligne sur le texte et court jusqu'au bord droit de la
  // surface — la signature des listes inserees natives.
  filet: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
    marginLeft: MARGE,
  },

  // 56 de haut : au-dessus du plancher tactile de 44, et assez pour porter un
  // titre et sa phrase sans les serrer.
  rang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.md,
    paddingHorizontal: MARGE,
  },
  // L'etat arme du geste destructeur : une surface, pas seulement un mot en
  // rouge. On voit que le prochain appui partira, avant de lire.
  rangAlerte: { backgroundColor: 'rgba(232, 146, 124, 0.10)' },
  // Un voile pose par-dessus, pas un fond : la ligne choisie porte deja une
  // surface, et remplacer son fond par la meme teinte ne se voyait pas.
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 255, 255, 0.07)' },
  rangTexte: { flex: 1, gap: 3 },
  // 17 px : le corps de texte. L'ancien ecran ecrivait toutes ses lignes en
  // 15 et toutes ses notes en 13 — c'est ce qui le faisait paraitre petit et
  // dense avant meme qu'on l'ait lu.
  rangTitre: { ...type.lead, color: color.text },
  rangTitreChoisi: { fontWeight: '700' },
  enAccent: { color: color.accent },
  enAlerte: { color: color.alert },
  sous: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textFaint },

  anneau: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointe: { width: 11, height: 11, borderRadius: radius.full, backgroundColor: color.accent },

  // --- Le gout -------------------------------------------------------------
  bloc: { paddingHorizontal: MARGE, paddingVertical: space.md, gap: space.md },
  // Sur la surface du groupe, le gris « note » du fond ne passait plus la
  // barre des 4,5:1 : une phrase qu'on ecrit pour etre lue prend le gris
  // courant.
  blocNote: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textMuted },
  defile: { marginHorizontal: -MARGE, paddingHorizontal: MARGE },
  rangee: { flexDirection: 'row', gap: space.sm },
  colonne: { width: 76, gap: space.xs },
  portrait: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: color.bgElevated },
  portraitNom: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },

  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  banni: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingRight: space.md,
    paddingLeft: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.bgElevated,
    maxWidth: 240,
  },
  banniPresse: { backgroundColor: color.rejectDim },
  banniVisage: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: color.bgSunken },
  banniNom: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text, flexShrink: 1 },

  // --- Le pressage ---------------------------------------------------------
  pied: { marginTop: space.xxl },
  credit: { marginTop: space.xl, minHeight: 44, justifyContent: 'center', paddingHorizontal: MARGE },
  creditTexte: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  pressage: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, opacity: 0.7, paddingHorizontal: MARGE },
});
