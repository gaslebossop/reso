import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import type { Artist, Track } from '../src/api/types';
import { fansLisibles } from '../src/api/titre';
import {
  IconeCoche,
  IconePastilleVerifiee,
  IconePlus,
  IconeRetour,
} from '../src/components/Icones';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * Ajouter à son goût à la main.
 *
 * ## Pourquoi cet écran existe
 *
 * Le fil apprend une carte à la fois, trente secondes par carte. Quand on sait
 * déjà ce qu'on aime — un artiste écouté depuis dix ans, un titre qui compte —
 * attendre qu'il remonte tout seul est une perte de temps, et il peut ne
 * jamais remonter : le moteur ne propose que ce qui est proche de ce qu'il
 * connaît déjà, donc un goût absent des ancres reste absent.
 *
 * ## Les deux matières ne font pas la même chose, et l'écran le dit
 *
 * C'est la décision qui tient l'écran. Un **artiste** devient une ancre du
 * goût *et* il est suivi — les deux ensemble, parce que c'est ce que le geste
 * veut dire. Un **titre** est archivé comme un « je garde » et entre dans la
 * bibliothèque : c'est le geste le plus fort du fil, et c'est celui qui
 * correspond — on n'ajoute pas un titre à la main pour dire « bof ».
 *
 * Cette asymétrie est écrite sous chaque onglet, en une ligne. La taire aurait
 * produit la surprise classique : « pourquoi ce titre est dans mes gardés ? ».
 *
 * ## Une sélection qui s'accumule avant de partir
 *
 * On tape, on coche, on efface, on retape, on coche encore — et on valide une
 * fois. Envoyer à chaque appui aurait été plus simple à écrire et pire à
 * utiliser : chaque ajout serait un aller-retour réseau au milieu d'une
 * recherche, et rien ne permettrait de se raviser avant de valider.
 *
 * La sélection survit donc au changement de recherche ET au changement
 * d'onglet, et le pied la rappelle en permanence.
 *
 * ## Ce que le moteur refuse, et pourquoi on le montre
 *
 * Un artiste sans voisins chez Deezer est une impasse : il ne peut engendrer
 * aucune carte, et il fausserait le regroupement en facettes en y occupant une
 * place isolée. Le moteur l'écarte — c'est la même règle qu'à l'inscription.
 * L'écran le dit au lieu de faire croire à un ajout qui n'a pas eu lieu.
 */

/** Le silence qui déclenche la recherche. Même valeur que la recherche de
 *  profils : chercher lettre par lettre, c'est un aller-retour par frappe. */
const PAUSE_MS = 300;
/** En dessous, la recherche ne rendrait que du bruit. */
const MINIMUM = 2;

type Onglet = 'artistes' | 'titres';

export default function AjouterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [onglet, setOnglet] = useState<Onglet>('artistes');
  const [texte, setTexte] = useState('');
  const [artistes, setArtistes] = useState<Artist[] | null>(null);
  const [titres, setTitres] = useState<Track[] | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  /**
   * La sélection, par matière.
   *
   * Les fiches entières et pas seulement les identifiants : le pied doit
   * pouvoir nommer ce qui est retenu même quand la recherche qui l'a fait
   * apparaître a été effacée depuis.
   */
  const [artistesRetenus, setArtistesRetenus] = useState<Artist[]>([]);
  const [titresRetenus, setTitresRetenus] = useState<Track[]>([]);

  const [envoi, setEnvoi] = useState(false);
  const [bilan, setBilan] = useState<string | null>(null);

  // Le minuteur vit dans une référence : il survit aux rendus, et un caractère
  // tapé vite annule la recherche du caractère d'avant.
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le jeton écarte les réponses d'une recherche abandonnée : sans lui, une
  // réponse lente écrase une réponse récente et la liste ment.
  const jeton = useRef(0);

  const chercher = useCallback(
    async (q: string, ou: Onglet) => {
      const propre = q.trim();
      const mien = ++jeton.current;
      if (propre.length < MINIMUM) {
        setArtistes(null);
        setTitres(null);
        setErreur(null);
        setOccupe(false);
        return;
      }
      setOccupe(true);
      try {
        if (ou === 'artistes') {
          const r = await prisme.searchArtists(propre);
          if (mien !== jeton.current) return;
          setArtistes(r.artists);
        } else {
          const r = await prisme.searchTracks(propre);
          if (mien !== jeton.current) return;
          setTitres(r.tracks);
        }
        setErreur(null);
      } catch (e) {
        if (mien !== jeton.current) return;
        setErreur(e instanceof Error ? e.message : 'Recherche impossible');
      } finally {
        if (mien === jeton.current) setOccupe(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => void chercher(texte, onglet), PAUSE_MS);
    return () => {
      if (minuteur.current) clearTimeout(minuteur.current);
    };
  }, [texte, onglet, chercher]);

  const basculerArtiste = useCallback((a: Artist) => {
    vibrer.action();
    setArtistesRetenus((xs) =>
      xs.some((x) => x.id === a.id) ? xs.filter((x) => x.id !== a.id) : [...xs, a],
    );
  }, []);

  const basculerTitre = useCallback((t: Track) => {
    vibrer.action();
    setTitresRetenus((xs) =>
      xs.some((x) => x.id === t.id) ? xs.filter((x) => x.id !== t.id) : [...xs, t],
    );
  }, []);

  const total = artistesRetenus.length + titresRetenus.length;

  const valider = useCallback(async () => {
    if (total === 0 || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await prisme.ajouterAuGout({
        artistIds: artistesRetenus.map((a) => a.id),
        trackIds: titresRetenus.map((t) => t.id),
      });
      const refuses = r.artistes_refuses.length + r.titres_refuses.length;
      // Le refus n'est pas une erreur, mais il ne doit pas passer sous
      // silence : sans cette phrase, on repart en croyant avoir ajouté
      // quelque chose qui n'est nulle part.
      if (refuses > 0) {
        const noms = artistesRetenus
          .filter((a) => r.artistes_refuses.includes(a.id))
          .map((a) => a.name);
        setBilan(
          noms.length > 0
            ? `Ajouté. ${noms.join(', ')} n’a pas pu l’être : Deezer ne lui connaît aucun artiste voisin, le moteur ne saurait pas quoi en tirer.`
            : 'Ajouté, sauf quelques éléments introuvables chez Deezer.',
        );
      } else {
        setBilan('Ajouté à ton goût.');
      }
      setArtistesRetenus([]);
      setTitresRetenus([]);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Ajout impossible');
    } finally {
      setEnvoi(false);
    }
  }, [artistesRetenus, titresRetenus, total, envoi]);

  const liste = onglet === 'artistes' ? artistes : titres;
  const rienTrouve = liste !== null && liste.length === 0 && texte.trim().length >= MINIMUM;

  const note = useMemo(
    () =>
      onglet === 'artistes'
        ? 'Un artiste ajouté devient une ancre de ton goût, et tu le suis.'
        : 'Un titre ajouté compte comme « je garde » : il nourrit ton goût et rejoint tes gardés.',
    [onglet],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.entete}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <IconeRetour couleur={color.textMuted} />
        </Pressable>
        <Text style={styles.titre}>Ajouter</Text>
      </View>

      {/* Deux onglets et pas deux écrans : la sélection se construit souvent
          des deux côtés — un artiste, puis le titre qu'on avait en tête — et
          deux écrans obligeraient à valider deux fois. */}
      <View style={styles.bascule}>
        {(['artistes', 'titres'] as const).map((o) => (
          <Pressable
            key={o}
            onPress={() => setOnglet(o)}
            style={[styles.onglet, onglet === o && styles.ongletActif]}
            accessibilityRole="tab"
            accessibilityState={{ selected: onglet === o }}
          >
            <Text style={[styles.ongletTexte, onglet === o && styles.ongletTexteActif]}>
              {o === 'artistes' ? 'Artistes' : 'Titres'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.note}>{note}</Text>

      <TextInput
        style={styles.champ}
        placeholder={onglet === 'artistes' ? 'Chercher un artiste…' : 'Chercher un titre…'}
        placeholderTextColor={color.textFaint}
        value={texte}
        onChangeText={(t) => {
          setTexte(t);
          setBilan(null);
        }}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={onglet === 'artistes' ? 'Rechercher un artiste' : 'Rechercher un titre'}
      />

      {occupe ? <ActivityIndicator color={color.accent} style={styles.attente} /> : null}
      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}
      {bilan ? <Text style={styles.bilan}>{bilan}</Text> : null}
      {rienTrouve ? <Text style={styles.vide}>Rien trouvé sous ce nom.</Text> : null}

      <ScrollView
        style={styles.resultats}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {onglet === 'artistes'
          ? (artistes ?? []).map((a) => {
              const pris = artistesRetenus.some((x) => x.id === a.id);
              return (
                <Ligne
                  key={a.id}
                  image={a.picture}
                  ronde
                  titre={a.name}
                  // De quoi verifier que c'est le bon : les titres d'abord,
                  // qui sont ce qui tranche vraiment, les abonnes ensuite.
                  // Voir la note sur `Artist.titres` pour le cas PNL /
                  // Pink Floyd que le seul nombre d'abonnes ne resout pas.
                  sous={a.titres?.length ? a.titres.join(' · ') : 'Aucun titre connu sous cette fiche'}
                  creuse={!a.titres?.length}
                  pied={fansLisibles(a.fans)}
                  principal={!!a.principal}
                  pris={pris}
                  onPress={() => basculerArtiste(a)}
                />
              );
            })
          : (titres ?? []).map((t) => {
              const pris = titresRetenus.some((x) => x.id === t.id);
              return (
                <Ligne
                  key={t.id}
                  image={t.cover}
                  ronde={false}
                  titre={t.title}
                  sous={t.artist.name}
                  creuse={false}
                  pied={null}
                  principal={false}
                  pris={pris}
                  onPress={() => basculerTitre(t)}
                />
              );
            })}
      </ScrollView>

      {/* Le pied ne disparaît pas quand la sélection est vide : il dit alors
          ce qu'il attend. Un bouton qui apparaît d'un coup fait sursauter la
          liste au premier appui. */}
      <View style={[styles.pied, { paddingBottom: insets.bottom + space.md }]}>
        <Pressable
          onPress={valider}
          disabled={total === 0 || envoi}
          style={({ pressed }) => [
            styles.valider,
            (total === 0 || envoi) && styles.validerInerte,
            pressed && styles.validerPresse,
          ]}
          accessibilityRole="button"
          accessibilityLabel={total === 0 ? 'Rien à ajouter' : `Ajouter ${total} éléments`}
        >
          {envoi ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={[styles.validerTexte, total === 0 && styles.validerTexteInerte]}>
              {total === 0 ? 'Choisis ce que tu veux ajouter' : `Ajouter (${total})`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** Une ligne de résultat. La même forme pour un artiste et pour un titre :
 *  seule la pochette change de coupe — ronde pour un visage, carrée pour un
 *  disque, comme partout ailleurs dans l'app. */
function Ligne({
  image,
  ronde,
  titre,
  sous,
  creuse,
  pied,
  principal,
  pris,
  onPress,
}: {
  image: string;
  ronde: boolean;
  titre: string;
  sous: string | null;
  /** `sous` dit qu'aucun titre n'est connu : c'est un avertissement, pas une
   *  legende, et il se lit dans la couleur d'alerte. */
  creuse: boolean;
  /** Troisieme ligne, plus faible : les abonnes. */
  pied: string | null;
  /** La fiche principale pour ce nom — voir `Artist.principal`. Ne dit pas
   *  « compte verifie » : Deezer n'en expose aucun. */
  principal: boolean;
  pris: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ligne, pressed && styles.lignePressee]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: pris }}
      accessibilityLabel={sous ? `${titre}, ${sous}` : titre}
    >
      <Image
        source={{ uri: image }}
        style={[styles.vignette, ronde && styles.vignetteRonde]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={160}
        recyclingKey={image}
      />
      <View style={styles.ligneTextes}>
        <View style={styles.ligneTitreRang}>
          <Text style={styles.ligneTitre} numberOfLines={1}>
            {titre}
          </Text>
          {principal ? <IconePastilleVerifiee couleur={color.accent} taille={14} /> : null}
        </View>
        {sous ? (
          <Text style={[styles.ligneSous, creuse && styles.ligneCreuse]} numberOfLines={1}>
            {sous}
          </Text>
        ) : null}
        {pied ? <Text style={styles.ligneFans}>{pied}</Text> : null}
      </View>
      <View style={[styles.marque, pris && styles.marquePrise]}>
        {pris ? (
          <IconeCoche couleur={color.bg} taille={16} />
        ) : (
          <IconePlus couleur={color.textFaint} taille={16} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },

  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  titre: { ...type.title, color: color.text },

  bascule: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
    paddingHorizontal: space.lg,
  },
  onglet: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.full,
    backgroundColor: color.bgElevated,
  },
  ongletActif: { backgroundColor: color.accent },
  ongletTexte: { ...type.label, color: color.textMuted },
  ongletTexteActif: { color: color.bg },

  note: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.textFaint,
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },

  champ: {
    ...type.body,
    color: color.text,
    backgroundColor: color.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.md,
    marginHorizontal: space.lg,
  },

  attente: { marginTop: space.lg },
  erreur: {
    ...type.body,
    fontSize: 15,
    lineHeight: 20,
    color: color.alert,
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },
  bilan: {
    ...type.body,
    fontSize: 15,
    lineHeight: 21,
    color: color.save,
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },
  vide: {
    ...type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMuted,
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },

  resultats: { flex: 1, marginTop: space.md },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  lignePressee: { backgroundColor: color.bgElevated },
  vignette: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: color.bgElevated },
  vignetteRonde: { borderRadius: radius.full },
  ligneTextes: { flex: 1, gap: 2 },
  ligneTitreRang: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  ligneTitre: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text },
  ligneSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  ligneCreuse: { color: color.alert },
  ligneFans: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  marque: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marquePrise: { backgroundColor: color.accent, borderColor: color.accent },

  pied: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  valider: {
    minHeight: 52,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validerInerte: { backgroundColor: color.bgElevated },
  validerPresse: { opacity: 0.75 },
  validerTexte: { ...type.lead, fontWeight: '700', color: color.bg },
  validerTexteInerte: { color: color.textFaint, fontWeight: '500' },
});
