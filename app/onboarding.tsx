import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { redirectUri } from '../src/auth/spotify';
import type { Artist } from '../src/api/types';
import { fansLisibles } from '../src/api/titre';
import { Etapes } from '../src/components/Etapes';
import { IconePastilleVerifiee } from '../src/components/Icones';
import { artistes as chargerArtistes } from '../src/state/catalogue';
import { markOnboarded } from '../src/state/session';
import { vibrer } from '../src/state/vibration';
import { color, motion, radius, space, type } from '../src/theme/tokens';

/** En dessous, le profil est trop maigre pour que le premier fil soit juste. */
const MIN_PICKS = 3;

/**
 * La derniere etape du demarrage : de qui part-on ?
 *
 * C'est une **liste d'invites** — on coche qui vient. L'ordre compte, et il
 * est dit : le premier choisi pese plus que le dernier.
 *
 * La grille arrive presque toujours instantanement : l'ecran d'accueil l'a
 * demandee pendant qu'on lisait (voir `src/state/catalogue.ts`).
 *
 * **Le bouton « Reprendre mes ecoutes Spotify » n'est plus ici.** Il vivait au
 * milieu de cet ecran, sous un separateur « OU CHOISIS A LA MAIN » : il
 * proposait de rendre inutile la page sur laquelle il etait pose, apres qu'on
 * avait commence a la remplir. La question est posee avant, sur
 * `app/plateforme.tsx`, et cet ecran n'est plus atteint du tout quand la
 * plateforme a rendu un gout deja constitue.
 */
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [grid, setGrid] = useState<Artist[]>([]);
  const [picked, setPicked] = useState<Artist[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'adresse de retour depend du contexte (Expo Go / application compilee) et
  // doit etre declaree telle quelle chez Spotify : on l'affiche pour pouvoir
  // la recopier sans se tromper.
  useEffect(() => {
    console.log(`[spotify] redirect_uri a declarer : ${redirectUri()}`);
  }, []);

  const charger = useCallback(() => {
    setError(null);
    setLoading(true);
    chargerArtistes()
      .then(setGrid)
      .catch((e) => setError(e instanceof Error ? e.message : 'Chargement impossible'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(charger, [charger]);

  /** Recherche differee : une requete par frappe saturerait Deezer. */
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      prisme.searchArtists(query.trim()).then((r) => setResults(r.artists)).catch(() => {});
    }, 320);
    return () => clearTimeout(t);
  }, [query]);

  /**
   * Les voisins deroules sous un artiste qu'on vient de choisir.
   *
   * Choisir six artistes de memoire est un exercice difficile, et un palmares
   * ne propose que des tubes mondiaux. Partir d'un nom qu'on a en tete et
   * laisser le catalogue derouler ses voisins donne des choix qu'on n'aurait
   * pas formules soi-meme — c'est le ressort de l'amorcage de Spotify, et il
   * marche parce qu'il transforme un effort de rappel en simple
   * reconnaissance.
   *
   * Indexe par artiste et jamais vide apres coup : deselectionner puis
   * reselectionner ne redemande rien au reseau.
   */
  const [voisins, setVoisins] = useState<Record<number, Artist[]>>({});

  const toggle = useCallback((a: Artist) => {
    vibrer.choix();
    setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : [...p, a]));
    // On ne demande qu'une fois par artiste, et seulement au premier choix :
    // un aller-retour Deezer par appui rendrait la grille poussive, et le
    // graphe `related` ne bouge pas d'une seconde a l'autre.
    setVoisins((v) => {
      if (v[a.id]) return v;
      prisme
        .voisinsArtiste(a.id)
        .then((r) => setVoisins((x) => ({ ...x, [a.id]: r.artists })))
        // Un voisinage qui n'arrive pas ne casse rien : la grille reste ce
        // qu'elle etait. Rien a dire a l'ecran, il n'y avait rien de promis.
        .catch(() => {});
      return v;
    });
  }, []);

  /**
   * La grille, avec les voisins deroules a leur place.
   *
   * Les voisins d'un arteste choisi se posent **juste apres lui**, pas en fin
   * de liste : c'est ce qui rend le lien visible. Poses ailleurs, ils
   * passeraient pour un rafraichissement du palmares.
   *
   * Dedoublonnage global : un voisin deja present dans le palmares, ou deja
   * deroule sous un autre artiste, ne s'ajoute pas une seconde fois — deux
   * pastilles du meme artiste dans une grille de choix se cochent
   * separement, et l'une des deux ne repond alors plus.
   */
  const shown = useMemo(() => {
    if (results.length) return results;
    const rest = grid.filter((g) => !picked.some((p) => p.id === g.id));
    const out: Artist[] = [];
    const vus = new Set<number>();
    const poser = (a: Artist) => {
      if (vus.has(a.id)) return;
      vus.add(a.id);
      out.push(a);
    };
    // Les artistes choisis restent visibles en tete, meme apres un defilement,
    // chacun suivi de ses voisins.
    for (const p of picked) {
      poser(p);
      for (const v of voisins[p.id] ?? []) poser(v);
    }
    for (const g of rest) poser(g);
    return out;
  }, [grid, picked, results, voisins]);

  const start = async () => {
    setSending(true);
    try {
      // L'ordre porte le poids : le premier choisi compte davantage.
      await prisme.seed({ artistIds: picked.map((a) => a.id) });
      router.push('/habitude');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de demarrer');
      setSending(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Etapes courante={3} />

      <View style={styles.head}>
        <Text style={styles.title}>Qui écoutes-tu ?</Text>
        <Text style={styles.sub}>
          Au moins {MIN_PICKS}. L'ordre compte : le premier choisi pèse le plus.
        </Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Chercher un artiste"
        placeholderTextColor={color.textFaint}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {loading ? (
        // Squelette à la forme de la grille : des pastilles de la taille des
        // vraies, pour qu'aucun saut ne se produise à l'arrivée des données.
        <View style={styles.grid}>
          {Array.from({ length: 14 }, (_, i) => (
            <View key={i} style={[styles.chip, styles.chipFantome, { width: 120 + (i % 4) * 34 }]} />
          ))}
        </View>
      ) : error && grid.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>La liste n'est pas arrivée</Text>
          <Text style={styles.sub}>{error}</Text>
          <Pressable style={styles.retry} onPress={charger}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={results.length ? styles.liste : styles.grid}
          keyboardShouldPersistTaps="handled"
        >
          {/* Deux formes pour deux situations, et pas par gout de la variete.
              La grille de pastilles montre le catalogue : des fiches choisies,
              sans ambiguite possible — un nom et un visage suffisent.
              La recherche, elle, tape dans tout le catalogue Deezer, ou
              plusieurs entrees portent le meme nom et ou le classement
              textuel se trompe. Il y faut de quoi verifier, donc des lignes
              assez larges pour porter les titres qui identifient l'artiste. */}
          {results.length
            ? results.map((a) => (
                <LigneArtiste
                  key={a.id}
                  artist={a}
                  selected={picked.some((p) => p.id === a.id)}
                  onPress={() => toggle(a)}
                />
              ))
            : shown.map((a) => (
                <ArtistChip
                  key={a.id}
                  artist={a}
                  selected={picked.some((p) => p.id === a.id)}
                  onPress={() => toggle(a)}
                />
              ))}
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <Pressable
          style={[styles.cta, picked.length < MIN_PICKS && styles.ctaOff]}
          disabled={picked.length < MIN_PICKS || sending}
          onPress={start}
        >
          {sending ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={styles.ctaText}>
              {picked.length < MIN_PICKS
                ? `Encore ${MIN_PICKS - picked.length}`
                : `Ouvrir le fil (${picked.length})`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Un resultat de recherche, avec de quoi verifier que c'est le bon.
 *
 * Trois informations, dans cet ordre de pouvoir discriminant :
 *
 *  1. **les titres** — on reconnait un artiste a ce qu'il a fait. C'est la
 *     seule chose qui tranche entre deux artistes tres connus qui se
 *     disputent la meme requete (« PNL » remonte Pink Floyd) ;
 *  2. **les abonnes** — ce qui ecarte les coquilles vides du catalogue, ces
 *     doublons de distributeurs qui portent le bon nom et rien d'autre ;
 *  3. **le visage**, qui ne sert que pour les artistes qu'on connait deja.
 *
 * Une fiche sans titres s'affiche quand meme, et sans titres : c'est
 * precisement le signe d'une coquille vide, et le montrer en dit plus long
 * que de la cacher.
 */
function LigneArtiste({
  artist, selected, onPress,
}: { artist: Artist; selected: boolean; onPress: () => void }) {
  const fans = fansLisibles(artist.fans);
  const titres = artist.titres?.length ? artist.titres.join(' · ') : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ligne, selected && styles.ligneOn, pressed && styles.lignePressee]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[
        artist.name,
        artist.principal ? 'fiche principale' : null,
        titres ? `connu pour ${titres}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <Image
        source={{ uri: artist.picture }}
        style={styles.ligneAvatar}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={160}
        recyclingKey={String(artist.id)}
      />
      <View style={styles.ligneTextes}>
        {/* Le badge colle au nom, pas au bord de la ligne : c'est le nom
            qu'il qualifie, et pose a l'autre bout il se lirait comme un
            etat de selection. */}
        <View style={styles.ligneNomRang}>
          <Text style={[styles.ligneNom, selected && styles.ligneNomOn]} numberOfLines={1}>
            {artist.name}
          </Text>
          {artist.principal ? (
            <IconePastilleVerifiee couleur={color.accent} taille={14} />
          ) : null}
        </View>
        {titres ? (
          <Text style={styles.ligneTitres} numberOfLines={1}>
            {titres}
          </Text>
        ) : (
          <Text style={styles.ligneCreuse} numberOfLines={1}>
            Aucun titre connu sous cette fiche
          </Text>
        )}
        {fans ? <Text style={styles.ligneFans}>{fans}</Text> : null}
      </View>
    </Pressable>
  );
}

function ArtistChip({
  artist, selected, onPress,
}: { artist: Artist; selected: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Pressable
      onPressIn={() => scale.set(withTiming(0.95, { duration: motion.press }))}
      onPressOut={() => scale.set(withTiming(1, { duration: motion.press }))}
      onPress={onPress}
      hitSlop={4}
    >
      <Animated.View style={[styles.chip, selected && styles.chipOn, style]}>
        <Image
          source={{ uri: artist.picture }}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={160}
        />
        <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>
          {artist.name}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  head: { gap: space.sm, marginBottom: space.md },
  title: { ...type.display, fontSize: 32, lineHeight: 38, color: color.text },
  sub: { ...type.lead, fontSize: 15, lineHeight: 22, color: color.textMuted },
  search: {
    ...type.body,
    color: color.text,
    backgroundColor: color.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  errorTitle: { ...type.body, lineHeight: 22, color: color.text },
  retry: {
    marginTop: space.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  retryText: { ...type.label, fontSize: 14, lineHeight: 20, color: color.text },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingRight: space.md,
    paddingLeft: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.bgElevated,
    borderWidth: 1.5,
    borderColor: 'transparent',
    maxWidth: 220,
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentDim },
  chipFantome: { height: 44, backgroundColor: color.bgElevated },

  liste: { paddingBottom: space.lg },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  ligneOn: { borderColor: color.accent, backgroundColor: color.accentDim },
  lignePressee: { backgroundColor: color.bgElevated },
  ligneAvatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: color.bgSunken },
  ligneTextes: { flex: 1, gap: 2 },
  ligneNomRang: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  ligneNom: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textMuted },
  ligneNomOn: { color: color.text },
  ligneTitres: { ...type.label, fontSize: 13, lineHeight: 17, color: color.textFaint },
  // Une fiche creuse se dit, elle ne se cache pas : c'est l'information la
  // plus utile de la ligne quand elle s'applique.
  ligneCreuse: { ...type.label, fontSize: 13, lineHeight: 17, color: color.alert },
  ligneFans: { ...type.label, fontSize: 12, lineHeight: 16, color: color.textFaint },
  avatar: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: color.bgSunken },
  chipText: { ...type.label, fontSize: 14, lineHeight: 20, color: color.textMuted, flexShrink: 1 },
  chipTextOn: { color: color.text },
  footer: { paddingTop: space.md },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md + 2,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaOff: { backgroundColor: color.bgElevated },
  ctaText: { ...type.lead, color: color.bg, fontWeight: '700' },
});
