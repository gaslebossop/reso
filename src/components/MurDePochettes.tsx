import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { Artist } from '../api/types';
import { color, radius, space } from '../theme/tokens';

/**
 * Le fond des deux premiers ecrans : un mur de portraits qui derive.
 *
 * Le parti pris de Reso est que l'ecran est noir et que la pochette est la
 * seule source de couleur. L'accueil applique la meme regle a lui-meme : il ne
 * decrit pas l'application avec des icones et des puces, **il la montre**. Ce
 * qui derive derriere le texte est exactement la matiere de l'app — et ce sont
 * les vrais artistes du moment, pas un decor.
 *
 * La derive est **lineaire**, contrairement a la regle qui bannit `linear`
 * pour les transitions : une boucle perpetuelle adoucie donnerait un battement
 * visible a chaque tour. Elle est lente au point de ne pas se remarquer — on
 * la sent, on ne la regarde pas.
 */

/** Hauteur d'une vignette, gouttiere comprise. */
const TUILE = 108;
const GOUTTIERE = space.sm;
const PAS = TUILE + GOUTTIERE;

/** Duree d'un tour complet, par colonne. Des vitesses differentes evitent
 *  l'effet « bloc unique qui glisse ». */
const DUREES = [64000, 82000, 71000];

/**
 * Instant du tout premier affichage du mur, pour toute la duree de l'app.
 *
 * Le mur apparait sur deux ecrans qui se suivent — l'accueil, puis la porte du
 * reseau G. Chaque ecran monte son propre exemplaire, et sans cette memoire le
 * second repartait du haut : le mur sautait en arriere au moment precis de la
 * transition, ce qui trahissait qu'on avait change de page alors que tout le
 * reste est fait pour donner l'impression du contraire.
 *
 * On ne conserve pas la position, on conserve l'heure de depart : chaque
 * colonne en deduit ou elle devrait etre, quelle que soit sa vitesse.
 */
let depart: number | null = null;

export function MurDePochettes({ artistes }: { artistes: Artist[] }) {
  const { width } = useWindowDimensions();
  const [sobre, setSobre] = useState(false);

  // « Reduire les animations » : le mur reste, il cesse de bouger.
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSobre);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSobre);
    return () => sub.remove();
  }, []);

  // Tant qu'on n'a rien a montrer, on ne montre rien : un mur a moitie vide
  // est pire qu'un fond noir, qui est de toute facon la couleur de l'app.
  if (artistes.length < 6) return null;

  const colonnes = 3;
  const parColonne = Math.ceil(height(width) / PAS) + 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <View style={styles.mur}>
        {Array.from({ length: colonnes }, (_, c) => (
          <Colonne
            key={c}
            artistes={decaler(artistes, c * 5).slice(0, parColonne)}
            duree={DUREES[c % DUREES.length]}
            fige={sobre}
            // Une colonne sur deux part decalee : sans cela les trois rangees
            // s'alignent et le mur redevient une grille.
            decalage={c % 2 === 0 ? 0 : -PAS / 2}
          />
        ))}
      </View>

      {/* Le voile. Les pochettes doivent etre presentes, jamais lisibles :
          elles perdraient au jeu de la lecture contre le texte. */}
      <View style={styles.voile} />
      <LinearGradient
        colors={['transparent', color.bg]}
        locations={[0, 0.72]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function Colonne({
  artistes,
  duree,
  decalage,
  fige,
}: {
  artistes: Artist[];
  duree: number;
  decalage: number;
  fige: boolean;
}) {
  const y = useSharedValue(0);
  const hauteur = artistes.length * PAS;

  useEffect(() => {
    if (fige) return;
    if (depart === null) depart = Date.now();

    // Ou cette colonne en serait si elle n'avait jamais ete demontee.
    const avancement = ((Date.now() - depart) % duree) / duree;

    y.set(-avancement * hauteur);
    y.set(
      withSequence(
        // Le reste du tour en cours, a la vitesse normale.
        withTiming(-hauteur, { duration: duree * (1 - avancement), easing: Easing.linear }),
        // La liste est posee deux fois : -hauteur et 0 montrent exactement la
        // meme chose, ce retour instantane est donc invisible. Il est
        // indispensable, sinon la boucle suivante animerait -hauteur vers
        // -hauteur, c'est-a-dire rien.
        withTiming(0, { duration: 0 }),
        withRepeat(withTiming(-hauteur, { duration: duree, easing: Easing.linear }), -1, false),
      ),
    );
  }, [y, hauteur, duree, fige]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() + decalage }] }));

  return (
    <Animated.View style={[styles.colonne, style]}>
      {/* La liste est posee deux fois : la seconde copie prend la place de la
          premiere quand elle sort, et la boucle ne se voit pas. */}
      {[...artistes, ...artistes].map((a, i) => (
        <Image
          key={`${a.id}-${i}`}
          source={{ uri: a.picture }}
          style={styles.tuile}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={220}
          recyclingKey={String(a.id)}
        />
      ))}
    </Animated.View>
  );
}

/** Fait tourner la liste pour qu'aucune colonne ne commence par le meme visage. */
function decaler<T>(xs: T[], n: number): T[] {
  if (xs.length === 0) return xs;
  const k = n % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}

/** Hauteur a couvrir : large, l'ecran d'accueil n'a pas de defilement. */
function height(width: number): number {
  return Math.max(900, width * 2);
}

const styles = StyleSheet.create({
  mur: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: GOUTTIERE,
    justifyContent: 'center',
    // Legerement plus large que l'ecran : les bords du mur ne doivent jamais
    // se voir.
    marginHorizontal: -PAS / 2,
  },
  colonne: { gap: GOUTTIERE },
  tuile: {
    width: TUILE,
    height: TUILE,
    borderRadius: radius.md,
    backgroundColor: color.bgElevated,
  },
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 8, 10, 0.78)' },
});
