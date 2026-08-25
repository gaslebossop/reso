import { StyleSheet, View } from 'react-native';

import { color, space } from '../theme/tokens';

/**
 * Ou l'on en est dans le demarrage.
 *
 * Volontairement pauvre : des segments de filet, dont les premiers allumes.
 * Des pastilles rondes ou une barre de progression diraient la meme chose plus
 * fort, et un parcours de quatre ecrans n'a pas besoin qu'on le rassure — il a
 * besoin qu'on ne lui vole pas l'attention destinee au texte.
 *
 * Le troisieme segment — le choix des artistes — est saute quand la plateforme
 * a rendu un gout deja constitue. La barre avance alors de deux d'un coup, et
 * c'est exact : une etape a bien ete evitee.
 */
export function Etapes({ courante, total = 4 }: { courante: number; total?: number }) {
  return (
    <View
      style={styles.rangee}
      accessibilityRole="progressbar"
      accessibilityLabel={`Étape ${courante} sur ${total}`}
      accessibilityValue={{ min: 1, max: total, now: courante }}
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <View key={n} style={[styles.segment, n <= courante && styles.segmentActif]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', gap: space.xs, paddingBottom: space.lg },
  segment: { flex: 1, height: 2, borderRadius: 1, backgroundColor: color.hairline },
  segmentActif: { backgroundColor: color.accent },
});
