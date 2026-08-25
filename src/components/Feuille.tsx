import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '../api/types';
import { color, radius, space, type } from '../theme/tokens';

/**
 * La feuille du bas : un titre, et ce qu'on peut en faire.
 *
 * ## Pourquoi un composant plutot qu'une copie de plus
 *
 * La forme existait deja dans la bibliotheque (`Fiche`) et il en fallait deux
 * autres — l'appui long sur le casier de quelqu'un, le choix d'un verbe dans
 * l'historique. Trois copies d'une feuille auraient diverge en une semaine :
 * une avec un voile qui ferme, une sans ; une a 56 px de ligne, une a 44.
 *
 * ## Ce qu'elle impose, et pourquoi
 *
 *  - **le voile ferme.** C'est le geste qu'on tente en premier ; ne rien faire
 *    donne l'impression que l'application s'est bloquee ;
 *  - **une ligne fait 56 px de haut.** Au-dessus de la cible tactile minimale
 *    de 44, parce qu'on vise ces lignes-la au pouce, souvent en marchant ;
 *  - **un filet entre les lignes, pas une carte par ligne.** Une pile de
 *    cartes dans une feuille qui est deja une carte fait trois epaisseurs pour
 *    dire une seule chose.
 *
 * L'ordre des lignes appartient a l'ecran qui l'ouvre : c'est lui qui sait ce
 * que la personne est venue faire.
 */
export function Feuille({
  visible,
  onFermer,
  children,
}: {
  visible: boolean;
  onFermer: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onFermer}>
      <Pressable style={styles.voile} onPress={onFermer} accessibilityLabel="Fermer" />
      <View style={styles.feuille}>{children}</View>
    </Modal>
  );
}

/** L'en-tete d'une feuille ouverte sur un titre : de quoi on parle.
 *
 * Sans elle, un appui long ouvre une liste de verbes sans sujet — et sur un
 * casier de vingt pochettes, on ne sait plus laquelle on a visee. */
export function EnteteTitre({ track, sous }: { track: Track; sous?: string }) {
  return (
    <View style={styles.entete}>
      <Image
        source={{ uri: track.cover }}
        style={styles.cover}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={String(track.id)}
      />
      <View style={styles.texte}>
        <Text style={styles.titre} numberOfLines={2}>
          {track.title}
        </Text>
        <Text style={styles.artiste} numberOfLines={1}>
          {track.artist.name}
        </Text>
        {sous ? (
          <Text style={styles.sous} numberOfLines={1}>
            {sous}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Une ligne d'action. `courante` marque celle qui decrit deja l'etat : on la
 *  montre au lieu de la cacher, sinon la liste change de longueur d'un titre a
 *  l'autre et le doigt vise dans le vide. */
export function LigneAction({
  titre,
  sous,
  accent,
  danger,
  courante,
  occupe,
  onPress,
}: {
  titre: string;
  sous?: string;
  accent?: boolean;
  danger?: boolean;
  courante?: boolean;
  occupe?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.ligne, pressed && styles.pressee]}
      disabled={occupe || courante}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: courante, disabled: occupe }}
    >
      <View style={styles.ligneTexte}>
        <Text
          style={[
            styles.ligneTitre,
            accent && styles.enAccent,
            danger && styles.enAlerte,
            courante && styles.enCours,
          ]}
        >
          {titre}
        </Text>
        {sous ? <Text style={styles.ligneSous}>{sous}</Text> : null}
      </View>
      {occupe ? <ActivityIndicator color={color.accent} /> : null}
      {!occupe && courante ? <Text style={styles.marque}>en cours</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
  feuille: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bgElevated,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },

  entete: { flexDirection: 'row', gap: space.md, paddingBottom: space.lg },
  cover: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: color.bgSunken },
  texte: { flex: 1, gap: 2 },
  titre: { ...type.lead, color: color.text },
  artiste: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  sous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  pressee: { opacity: 0.55 },
  ligneTexte: { flex: 1, gap: 2 },
  ligneTitre: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.text },
  ligneSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  enAccent: { color: color.accent },
  enAlerte: { color: color.alert },
  enCours: { color: color.textFaint },
  marque: { ...type.caption, fontSize: 11, lineHeight: 14, color: color.textFaint, letterSpacing: 0.8 },
});
