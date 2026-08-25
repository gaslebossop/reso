import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useEncreDouce } from '../state/fond';
import type { Garde } from '../state/gardesSeance';
import { chiffres, color, radius, space, type } from '../theme/tokens';

/**
 * Ce que la seance a produit : les pochettes gardees, empilees.
 *
 * ## Pourquoi ce n'est plus un nombre
 *
 * L'ecran affichait « ↑ 7 gardés ». Le nombre etait la bonne intuition — c'est
 * le **taux** de recompense qui gouverne le comportement, et un taux ne se
 * percoit que s'il est rendu visible — mais un nombre est la forme la plus
 * pauvre de cette visibilite. Sept est un score ; sept pochettes sont sept
 * disques qu'on a trouves. La premiere forme se compare, la seconde
 * s'accumule, et c'est l'accumulation qui donne le sentiment que la seance a
 * servi a quelque chose.
 *
 * Le geste « je garde » part vers la **gauche**, et la trace se depose en haut
 * a gauche : le titre va la ou on l'a envoye. C'est ce qui fait qu'on n'a pas
 * a expliquer ou il est parti.
 *
 * ## Ce qu'elle ne fait pas, deliberement
 *
 * Aucune serie a ne pas rompre, aucun objectif quotidien, aucun compte a
 * rebours. Une serie transforme l'envie de revenir en peur de perdre, et ce
 * jour-la l'app cesse d'etre un plaisir. Elle repart aussi de zero a chaque
 * ouverture : c'est une trace de seance, pas un score a defendre.
 */

/** Combien de pochettes tiennent avant de basculer sur un decompte. */
const VISIBLES = 5;
export const VIGNETTE = 34;
/** Recouvrement : une pile de disques, pas une rangee de cases. */
export const RECOUVREMENT = 11;

type Props = {
  /** Les titres gardes depuis l'ouverture du fil, dans l'ordre.
   *
   * Des objets et non des adresses de pochettes : la trace doit pouvoir
   * **perdre** un titre — retire des gardes, ou geste corrige — et deux titres
   * peuvent partager une pochette (un album, une compilation). L'identifiant
   * est le seul moyen de savoir lequel s'en va. */
  gardes: Garde[];
};

/**
 * A zero, la trace n'affiche pas une pile vide : elle apprend le geste qu'elle
 * comptera ensuite. « 0 gardés » serait un reproche, et un cadre vide au meme
 * endroit ferait sauter tout ce qui est dessous des la premiere sauvegarde.
 */

function TraceImpl({ gardes }: Props) {
  const reduced = useReducedMotion();
  // L'encre suit le fond : le fil n'est plus noir, il est de la couleur de la
  // pochette, et un gris fixe y devient illisible des qu'elle est claire.
  const encreDouce = useEncreDouce();
  const pose = useSharedValue(1);
  const precedent = useRef(gardes.length);

  useEffect(() => {
    if (gardes.length <= precedent.current) {
      precedent.current = gardes.length;
      return;
    }
    precedent.current = gardes.length;
    if (reduced) return;
    // La derniere arrivee se pose : elle vient de plus loin et se range. Pas de
    // ressort — un disque qu'on range ne rebondit pas.
    pose.set(0);
    pose.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [gardes.length, pose, reduced]);

  const derniere = useAnimatedStyle(() => ({
    opacity: pose.get(),
    transform: [
      { scale: 0.7 + pose.get() * 0.3 },
      { translateX: (1 - pose.get()) * -14 },
    ],
  }));

  if (gardes.length === 0) {
    return (
      <View style={styles.ligne}>
        <Animated.Text style={[styles.fleche, encreDouce]}>↑</Animated.Text>
        <Animated.Text style={[styles.amorce, encreDouce]}>
          glisse vers le haut pour garder un titre
        </Animated.Text>
      </View>
    );
  }

  const montrees = gardes.slice(-VISIBLES);
  const reste = gardes.length - montrees.length;
  // La cle suit la place dans la seance, pas dans la fenetre : sinon chaque
  // garde au-dela de cinq change la cle des cinq vignettes et les remonte
  // toutes, images comprises.
  const premierePlace = reste;

  return (
    <View style={styles.trace} pointerEvents="none" accessibilityElementsHidden>
      {reste > 0 ? (
        <View style={[styles.vignette, styles.reste]}>
          <Text style={[styles.resteTexte, chiffres]}>+{reste}</Text>
        </View>
      ) : null}
      {montrees.map(({ id, cover }, i) => {
        const premiere = i === 0 && reste === 0;
        // Un seul type de conteneur pour toutes : si la derniere repassait de
        // Animated.View a View, elle changerait d'identite et serait remontee
        // a chaque garde.
        return (
          <Animated.View
            key={`${id}-${premierePlace + i}`}
            style={[
              styles.vignette,
              premiere ? null : { marginLeft: -RECOUVREMENT },
              // La plus recente est devant, et c'est la seule pleinement
              // opaque : la pile a une profondeur, sinon c'est une frise.
              { zIndex: i + 1, opacity: 0.55 + (i / Math.max(1, montrees.length - 1)) * 0.45 },
              i === montrees.length - 1 && derniere,
            ]}
          >
            <Image
              source={{ uri: cover }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={cover}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

/** La pile ne bouge qu'a chaque garde : les autres etats du fil la laissent posee. */
export const Trace = memo(TraceImpl);

const styles = StyleSheet.create({
  trace: { flexDirection: 'row', alignItems: 'center' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: VIGNETTE },
  fleche: { ...type.label, color: color.save },
  // `textMuted` et non `textFaint` : cette ligne est posee sur la lumiere de
  // la pochette, dont la clarte change a chaque titre. Le gris le plus sombre
  // de la palette y passait sous le seuil de lisibilite.
  amorce: { ...type.label, color: color.textMuted, letterSpacing: 0.2 },
  vignette: {
    width: VIGNETTE,
    height: VIGNETTE,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: color.bgElevated,
    // Un filet clair detache chaque pochette de celle qu'elle recouvre. Sans
    // lui, deux pochettes sombres consecutives fusionnent en une tache.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  image: { width: '100%', height: '100%' },
  reste: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 8, 10, 0.72)',
    marginRight: space.xs,
  },
  resteTexte: { ...type.label, fontSize: 13, color: color.textMuted },
});
