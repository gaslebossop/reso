import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICONES } from './Icones';
import { rafraichirNotifs, useNouvellesNotifs } from '../state/notifs';
import { vibrer } from '../state/vibration';
import { color, motion, space, type } from '../theme/tokens';

/**
 * La barre du bas.
 *
 * Trois partis pris, et ce sont les trois qui la font passer pour une barre
 * d'application plutot que pour un gabarit :
 *
 *  - **Les icones sont vectorielles** (`Icones.tsx`), sur une grille commune et
 *    une seule epaisseur de trait. La version precedente assemblait des `View`
 *    et fabriquait un triangle avec des bordures : trois dessins sans rapport
 *    d'echelle entre eux.
 *  - **Les trois libelles sont ecrits en permanence.** Ils ne l'etaient pas :
 *    seul l'onglet courant nommait sa destination, et le mot apparaissait en
 *    fondu a chaque bascule. Une barre dont le texte bouge attire l'oeil sur
 *    la navigation au lieu du contenu, et « Gardes » comme « Prisme » ne se
 *    devinent pas depuis un pictogramme.
 *  - **L'etat courant ne repose pas sur la couleur.** L'icone passe du contour
 *    a l'aplat et le libelle prend du gras ; la teinte d'accent ne fait que
 *    confirmer. Une hierarchie construite sur la couleur seule s'effondre en
 *    plein soleil et pour un daltonien.
 *
 * L'anneau qui signalait les onglets reserves aux comptes a disparu : c'etait
 * une pastille decorative de 7 px cense porter une nuance que l'ecran d'accueil
 * de l'onglet explique en une phrase, mieux et sans code.
 */

const ONGLETS: Record<string, string> = {
  index: 'Fil',
  library: 'Gardés',
  gens: 'Gens',
  prism: 'Prisme',
};

/** Taille de dessin des icones. */
const ICONE = 24;

export function BarreOnglets({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const nouvelles = useNouvellesNotifs();

  /**
   * Le compte se redemande a chaque bascule d'onglet.
   *
   * C'est le seul moment ou l'on sait que quelqu'un regarde, et il n'y a donc
   * aucune raison de sonder le serveur en continu pour une pastille. Le
   * magasin garde un repos de vingt secondes entre deux appels : personne ne
   * recoit de notification entre deux taps sur la barre.
   */
  useEffect(() => {
    void rafraichirNotifs();
  }, [state.index]);

  return (
    <View style={[styles.barre, { paddingBottom: insets.bottom }]}>
      <View style={styles.filet} />
      <View style={styles.rangee}>
        {state.routes.map((route, i) => {
          const mot = ONGLETS[route.name];
          const Icone = ICONES[route.name];
          if (!mot || !Icone) return null;

          return (
            <Onglet
              key={route.key}
              mot={mot}
              actif={state.index === i}
              // La pastille vit sur « Gens » parce que c'est la que les
              // notifications s'ouvrent. Un chiffre serait illisible a cette
              // taille ; un point dit « il y a quelque chose », ce qui est
              // tout ce qu'une barre d'onglets a a dire.
              pastille={route.name === 'gens' && nouvelles > 0}
              rendreIcone={(actif, couleur) => Icone({ actif, couleur, taille: ICONE })}
              onPress={() => {
                if (state.index === i) return;
                vibrer.choix();
                navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

/**
 * Une cible.
 *
 * Le retour de pression porte sur l'icone seule, pas sur toute la colonne :
 * faire palir un libelle en meme temps donne l'impression que l'onglet se
 * desactive.
 */
function Onglet({
  mot,
  actif,
  pastille,
  rendreIcone,
  onPress,
}: {
  mot: string;
  actif: boolean;
  pastille?: boolean;
  rendreIcone: (actif: boolean, couleur: string) => React.ReactNode;
  onPress: () => void;
}) {
  const echelle = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: echelle.get() }] }));

  return (
    <Pressable
      style={styles.cible}
      accessibilityRole="tab"
      accessibilityState={{ selected: actif }}
      accessibilityLabel={mot}
      onPressIn={() => echelle.set(withTiming(0.88, { duration: motion.press }))}
      onPressOut={() => echelle.set(withTiming(1, { duration: motion.press }))}
      onPress={onPress}
    >
      <Animated.View style={style}>
        {rendreIcone(actif, actif ? color.accent : color.textFaint)}
        {pastille ? <View style={styles.pastille} /> : null}
      </Animated.View>
      <Text style={[styles.mot, actif && styles.motActif]} numberOfLines={1}>
        {mot}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Aplat opaque, pas de flou ni de transparence : les pochettes du fil
  // defileraient derriere et la barre deviendrait illisible une carte sur deux.
  barre: { backgroundColor: color.bgSunken },
  filet: { height: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
  rangee: { flexDirection: 'row' },
  cible: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.xs,
  },
  mot: { ...type.caption, fontSize: 12, lineHeight: 14, letterSpacing: 0, color: color.textFaint },
  pastille: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: color.accent,
    // Un liseré de la couleur de la barre detache le point du trait de
    // l'icone : sans lui, les deux se touchent et le point ressemble a une
    // bavure du dessin.
    borderWidth: 2,
    borderColor: color.bgSunken,
  },
  motActif: { color: color.accent, fontWeight: '700' },
});
