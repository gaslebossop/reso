import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Track } from '../src/api/types';
import { MurAccueil } from '../src/components/MurAccueil';
import { pochettesAccueil } from '../src/state/accueil';
import { vibrer } from '../src/state/vibration';
import { color, PIED_SECONDAIRE, radius, space, type } from '../src/theme/tokens';

/**
 * L'arrivée.
 *
 * ## L'objet : la cale de disques
 *
 * Pas une page d'accueil avec une illustration — **le stock lui-même** :
 * deux douzaines de pochettes posées bord à bord sur tout l'écran, la matière
 * que la personne viendra juger carte par carte dix secondes plus tard. Le
 * mur est le produit ; la phrase ne fait que le nombrer.
 *
 * Le mur s'affiche **au fil de l'arrivée** des images — jamais d'écran noir
 * qui attend sa grille — et chaque pochette est demandée en 250 px, une
 * cellule n'en montrant jamais plus.
 *
 * ## La phrase vit dans le mur
 *
 * Un dégradé fonctionnel — le seul de l'écran, là pour la lisibilité, pas
 * pour décorer — assoit le pied du mur dans le noir de l'app, et le bloc
 * texte centré s'y pose : « Le fil est prêt », puis la promesse. L'écran
 * suivant reprend **exactement ce même mur** — le cache de session rend les
 * mêmes pochettes instantanément — mais il y répond autrement : chez lui, une
 * porte pleine se pose devant les disques. Deux réponses au même objet, et
 * une continuité qui est celle des images elles-mêmes.
 *
 * ## Ce qui a disparu en son temps, et ne revient pas
 *
 * - **`RESO` en capitales espacées** au-dessus du titre : un sur-titre de
 *   marque posé sur un écran de marque est un doublon, et le tell le plus sûr
 *   de la page d'accueil générique.
 * - **La pile de trois cartes** : une pile statique ne montrait rien de ce
 *   qu'elle prétendait, et un carré isolé sur du noir, voilà le gabarit qu'on
 *   cherche à éviter. La demande était claire : qu'on voie les pochettes.
 */
export default function Bienvenue() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pochettes, setPochettes] = useState<Track[]>([]);

  useEffect(() => {
    let vivant = true;
    pochettesAccueil().then((ts) => vivant && setPochettes(ts));
    return () => {
      vivant = false;
    };
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Plein bord volontaire : le mur passe sous les encoches, seul le pied
          porte des marges. La racine n'a donc AUCUN padding horizontal — un
          enfant absolu se place dans la boîte de padding, et le mur serait
          resté encadré de noir. */}
      <View style={styles.scene}>
        <MurAccueil tracks={pochettes} />

        {/* Le seul dégradé de l'écran : il assoit le texte, il ne décore rien. */}
        <LinearGradient
          style={styles.assise}
          colors={['rgba(8, 8, 10, 0)', 'rgba(8, 8, 10, 0.72)', color.bg]}
          locations={[0, 0.55, 1]}
        />

        <View style={styles.textes}>
          <Text style={styles.caption} numberOfLines={1}>
            Le fil est prêt
          </Text>
          <Text
            style={styles.titre}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.86}
          >
            Trente secondes suffisent à savoir.
          </Text>
          <Text style={styles.legende} numberOfLines={2}>
            Un extrait, un verdict.
          </Text>
        </View>
      </View>

      <View style={styles.pied}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPresse]}
          onPress={() => {
            vibrer.action();
            router.push('/connexion');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.ctaTexte}>Commencer</Text>
        </Pressable>

        {/* La place de « Plus tard », qui vit sur l'ecran suivant. Sans cette
            reserve le bouton ci-dessus saute d'une cinquantaine de points
            d'une page a l'autre. Voir PIED_SECONDAIRE. */}
        <View style={styles.reserve} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  scene: { flex: 1 },
  assise: { ...StyleSheet.absoluteFillObject, top: '38%' },
  textes: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  caption: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 1.4,
    color: color.textMuted,
  },
  titre: { ...type.display, fontSize: 28, lineHeight: 34, color: color.text, textAlign: 'center' },
  legende: { ...type.body, fontSize: 15, lineHeight: 21, color: color.textMuted, textAlign: 'center' },
  pied: { paddingHorizontal: space.lg },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaPresse: { opacity: 0.85 },
  ctaTexte: { ...type.lead, color: color.bg, fontWeight: '700' },
  reserve: { height: PIED_SECONDAIRE, marginTop: space.xs },
});
