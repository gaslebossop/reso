import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useEncreDouce } from '../state/fond';
import { vibrer } from '../state/vibration';
import { color, motion, space, type } from '../theme/tokens';
import { IconeCoeur, IconeCroix, IconeGarder } from './Icones';
import type { Verdict } from './Passage';

type Props = {
  onAction: (v: Verdict) => void;
  disabled?: boolean;
};

/**
 * Les trois verdicts, **disposes comme les gestes**.
 *
 * Passer a gauche, garder en haut, j'aime a droite : la barre est la legende
 * des gestes, et non un second chemin a memoriser separement. Et chaque bouton
 * porte son verbe — il y avait un coeur et une coche cote a cote, sans un mot
 * pour dire lequel range le titre dans la bibliotheque, et personne ne peut
 * deviner ca.
 *
 * Le bouton « garder » est souleve, parce que son geste va vers le haut : le
 * voir plus haut suffit a le dire sans l'ecrire.
 *
 * « Bannir » n'y figure pas. C'est le geste le plus destructeur de l'app — il
 * retire un artiste pour toujours — et il n'a rien a faire sous le pouce a cote
 * de trois boutons qu'on martele cinquante fois par session. Il vit dans un
 * appui long sur la carte, avec une confirmation.
 *
 * **Seul changement : les glyphes typographiques ont disparu.** `✕ ↑ ♥` etaient
 * trois caracteres de trois graisses et de trois masses optiques differentes,
 * poses cote a cote dans trois cercles de meme facture — et ca se voyait. Ce
 * sont maintenant les icones de `Icones.tsx`, sur la meme grille de 24 et la
 * meme epaisseur de trait que celles des onglets.
 */
export function Barre({ onAction, disabled }: Props) {
  return (
    <View style={styles.rangee}>
      <Bouton
        rendre={(c, t) => <IconeCroix couleur={c} taille={t} />}
        mot="passer"
        teinte={color.reject}
        fond={color.rejectDim}
        taille={56}
        disabled={disabled}
        onPress={() => onAction('skip')}
      />
      <Bouton
        rendre={(c, t) => <IconeGarder couleur={c} taille={t} />}
        mot="garder"
        teinte={color.save}
        fond={color.saveDim}
        taille={56}
        souleve
        disabled={disabled}
        onPress={() => onAction('save')}
      />
      <Bouton
        rendre={(c, t) => <IconeCoeur actif couleur={c} taille={t} />}
        mot="j'aime"
        teinte={color.accent}
        fond={color.accentDim}
        taille={68}
        disabled={disabled}
        onPress={() => onAction('like')}
      />
    </View>
  );
}

function Bouton({
  rendre,
  mot,
  teinte,
  fond,
  taille,
  souleve,
  onPress,
  disabled,
}: {
  rendre: (couleur: string, taille: number) => React.ReactNode;
  mot: string;
  teinte: string;
  fond: string;
  taille: number;
  souleve?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const echelle = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: echelle.get() }] }));
  // Meme raison que la trace : le verbe est pose sur la couleur de la
  // pochette, pas sur le noir de l'ecran.
  const encreDouce = useEncreDouce();

  return (
    <Pressable
      // Un doigt qui derive de quelques pixels ne doit pas annuler l'appui.
      pressRetentionOffset={16}
      hitSlop={12}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={mot}
      onPressIn={() => echelle.set(withTiming(0.92, { duration: motion.press }))}
      onPressOut={() => echelle.set(withTiming(1, { duration: motion.press }))}
      onPress={() => {
        vibrer.action();
        onPress();
      }}
      style={[styles.colonne, souleve && styles.souleve]}
    >
      <Animated.View
        style={[
          styles.orbe,
          {
            width: taille,
            height: taille,
            borderRadius: taille / 2,
            backgroundColor: fond,
            borderColor: teinte,
          },
          disabled && styles.eteint,
          style,
        ]}
      >
        {rendre(teinte, Math.round(taille * 0.42))}
      </Animated.View>
      <Animated.Text style={[styles.mot, encreDouce, disabled && styles.eteint]}>
        {mot}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rangee: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xl,
  },
  colonne: { alignItems: 'center', gap: space.sm },
  souleve: { marginBottom: space.lg },
  orbe: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  eteint: { opacity: 0.35 },
  // Meme raison que la trace : les verbes sont poses sur la lumiere de la
  // pochette, dont la clarte change a chaque titre, et non sur le noir de
  // l'ecran.
  mot: { ...type.label, color: color.textMuted, letterSpacing: 0.2 },
});
