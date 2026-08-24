import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { color, radius } from '../theme/tokens';

/**
 * La pochette qu'on garde rejoint la trace, a vue.
 *
 * ## Pourquoi
 *
 * « Je garde » etait le seul geste de l'app qui **produit un objet**, et
 * pourtant l'objet n'allait nulle part : la carte sortait par le haut, et une
 * vignette apparaissait au meme instant en haut a gauche. Deux evenements
 * simultanes et sans lien visible, donc deux evenements qu'on ne relie pas.
 *
 * Faire voyager la pochette est le seul moyen de dire, sans un mot, ou est
 * parti le titre — et c'est aussi le moment de plaisir du geste : on voit son
 * butin se poser sur la pile. C'est la difference entre un compteur qui
 * s'incremente et une collection qui grossit.
 *
 * ## Comment
 *
 * L'echelle part du coin haut-gauche (`transformOrigin`), ce qui permet de
 * viser des **coordonnees**, pas des centres : la vignette se pose exactement
 * la ou la trace l'attend, quelle que soit la taille de depart.
 *
 * L'echelle est en `out` quand la course est en `inOut` : la pochette rapetisse
 * d'abord et voyage ensuite. Les deux sur la meme courbe donnaient un objet qui
 * fond en glissant, ce qui se lit comme une disparition et non comme un
 * rangement.
 */

const DUREE = 430;

type Rect = { x: number; y: number; cote: number };

type Props = {
  cover: string;
  /** Ou la pochette est a l'ecran au moment du geste. */
  depart: Rect;
  /** Ou la trace l'attend. */
  arrivee: Rect;
  /** Le vol est fini : c'est maintenant que la trace doit compter le titre. */
  onArrive: () => void;
};

export function Envol({ cover, depart, arrivee, onArrive }: Props) {
  const p = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    // « Reduire les animations » : le titre est range immediatement, sans vol.
    if (reduced) {
      onArrive();
      return;
    }
    p.set(
      withTiming(1, { duration: DUREE, easing: Easing.inOut(Easing.cubic) }, (fini) => {
        if (fini) scheduleOnRN(onArrive);
      }),
    );
    // Volontairement sans dependances : un vol commence ne se rejoue pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const t = p.get();
    // La reduction est en avance sur la course : l'objet rapetisse, puis part.
    const r = 1 - Math.pow(1 - t, 3);
    return {
      transform: [
        { translateX: interpolate(t, [0, 1], [0, arrivee.x - depart.x]) },
        { translateY: interpolate(t, [0, 1], [0, arrivee.y - depart.y]) },
        { scale: interpolate(r, [0, 1], [1, arrivee.cote / depart.cote]) },
      ],
      // Le fondu ne commence qu'a la toute fin, pour croiser l'arrivee de la
      // vignette dans la trace au lieu de laisser un trou entre les deux.
      opacity: interpolate(t, [0, 0.88, 1], [1, 1, 0]),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      style={[
        styles.vol,
        { left: depart.x, top: depart.y, width: depart.cote, height: depart.cote },
        style,
      ]}
    >
      <Image
        source={{ uri: cover }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  vol: {
    position: 'absolute',
    // L'origine en haut a gauche est ce qui rend le vol adressable : sans elle,
    // reduire l'echelle deplace aussi le coin, et la cible se derobe.
    transformOrigin: 'top left',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: color.bgElevated,
    zIndex: 20,
  },
});
