import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, space, type } from '../theme/tokens';

/**
 * L'ecran qu'on voit a la place d'un onglet reserve aux comptes.
 *
 * Trois choses ont change, et ce sont les trois qui le faisaient passer pour
 * une page d'attente :
 *
 *  - **Le disque « G » a disparu.** Une pastille de marque inventee, posee au
 *    centre d'un ecran par ailleurs vide, n'apportait rien : le bouton nomme
 *    deja le reseau G, deux lignes plus bas.
 *  - **Le cadre est celui de l'onglet, pas un bloc centre.** Le titre est a sa
 *    place habituelle, en haut a gauche ; l'action est ancree en bas comme
 *    partout ailleurs. Passer de la porte a l'ecran plein ne deplace donc plus
 *    rien : c'est le meme ecran, une fois rempli.
 *  - **Quatre elements, pas sept.** Un titre, une phrase, l'action, et ce
 *    qu'il faut savoir pour ne pas la prendre.
 */
export function AccountGate({
  titre,
  raison,
  busy,
  error,
  onConnect,
  onReset,
}: {
  titre: string;
  /** Ce que cet onglet-ci fera une fois ouvert. Une phrase, pas un argumentaire. */
  raison: string;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
  /** Repartir d'un appareil neuf. Presente uniquement la ou c'est le seul
   *  chemin possible — sans compte, l'ecran Prisme ne s'ouvre pas, et son
   *  bouton de remise a zero serait donc hors d'atteinte. */
  onReset?: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
      ]}
    >
      <Text style={styles.titre}>{titre}</Text>

      <View style={styles.corps}>
        <Text style={styles.raison}>{raison}</Text>
      </View>

      <View style={styles.pied}>
        <Pressable
          style={({ pressed }) => [styles.cta, busy && styles.ctaOccupe, pressed && styles.ctaPresse]}
          disabled={busy}
          onPress={onConnect}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={styles.ctaTexte}>Continuer avec le réseau G</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.erreur}>{error}</Text> : null}

        <Text style={styles.note}>Le fil reste ouvert : tu peux continuer à swiper sans compte.</Text>

        {onReset ? (
          <Pressable style={styles.reset} onPress={onReset} accessibilityRole="button">
            <Text style={styles.resetTexte}>Repartir de zéro</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  titre: { ...type.display, color: color.text },
  // La phrase tient le bas du bloc de lecture, pas le haut : elle arrive juste
  // au-dessus du bouton, la ou l'oeil descend.
  corps: { flex: 1, justifyContent: 'flex-end', paddingBottom: space.xl },
  raison: { ...type.lead, color: color.textMuted },
  pied: { gap: space.sm },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaOccupe: { opacity: 0.6 },
  ctaPresse: { opacity: 0.85 },
  ctaTexte: { ...type.lead, color: color.bg, fontWeight: '700' },
  erreur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.alert, textAlign: 'center' },
  note: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, textAlign: 'center' },
  reset: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  resetTexte: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
});
