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
import { Etapes } from '../src/components/Etapes';
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

  const toggle = useCallback((a: Artist) => {
    vibrer.choix();
    setPicked((p) => (p.some((x) => x.id === a.id) ? p.filter((x) => x.id !== a.id) : [...p, a]));
  }, []);

  const shown = useMemo(() => {
    if (results.length) return results;
    // Les artistes choisis restent visibles en tete, meme apres un defilement.
    const rest = grid.filter((g) => !picked.some((p) => p.id === g.id));
    return [...picked, ...rest];
  }, [grid, picked, results]);

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
        <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
          {shown.map((a) => (
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
