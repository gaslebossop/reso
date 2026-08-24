import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Artist } from '../src/api/types';
import { MurDePochettes } from '../src/components/MurDePochettes';
import { artistes as chargerArtistes } from '../src/state/catalogue';
import { vibrer } from '../src/state/vibration';
import { color, PIED_SECONDAIRE, radius, space, type } from '../src/theme/tokens';

/**
 * L'arrivee.
 *
 * Ce n'est pas un carrousel en trois volets avec des puces — c'est le tell le
 * plus reconnaissable d'un onboarding, et personne ne lit le deuxieme volet.
 * C'est **une pochette** : le mur des artistes du moment derriere un voile, et
 * une phrase posee dessus. L'app dit ce qu'elle est en le montrant.
 *
 * Cet ecran fait aussi un travail invisible : il declenche le chargement de la
 * grille d'artistes, qui coute plusieurs secondes cote moteur. Le temps qu'on
 * lise la phrase et qu'on tranche la question du compte, elle est prete — et
 * l'ecran de choix s'ouvre plein au lieu de s'ouvrir sur un spinner.
 */
export default function Bienvenue() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [grille, setGrille] = useState<Artist[]>([]);

  useEffect(() => {
    let vivant = true;
    chargerArtistes()
      .then((as) => vivant && setGrille(as))
      // Le mur est un decor : s'il manque, l'ecran reste noir et parfaitement
      // utilisable. Aucune erreur a montrer ici.
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <MurDePochettes artistes={grille} />

      <View
        style={[
          styles.contenu,
          { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg },
        ]}
      >
        <Text style={styles.marque}>RESO</Text>

        <View style={styles.propos}>
          <Text style={styles.titre}>Trente secondes suffisent à savoir.</Text>
          <Text style={styles.texte}>
            Un extrait, un verdict. Reso écoute la seconde où tu passes à la suite — c'est là que
            se dit le plus de choses sur ton goût.
          </Text>
        </View>

        <Pressable
          style={styles.cta}
          onPress={() => {
            vibrer.action();
            router.push('/connexion');
          }}
        >
          <Text style={styles.ctaTexte}>Commencer</Text>
        </Pressable>

        {/* Place vide, et voulue. L'ecran suivant loge une action secondaire
            ici ; sans cette reserve, son bouton principal remonterait de
            cinquante pixels et les deux ecrans cesseraient d'avoir l'air
            d'etre le meme. */}
        <View style={styles.reserve} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  contenu: { flex: 1, paddingHorizontal: space.lg },
  marque: { ...type.caption, fontSize: 12, lineHeight: 16, color: color.accent, letterSpacing: 4 },
  // La phrase est poussee vers le bas : le mur occupe le haut, le texte tient
  // le pied de l'ecran, la main tombe naturellement sur le bouton.
  propos: { flex: 1, justifyContent: 'flex-end', gap: space.md, paddingBottom: space.xl },
  titre: { ...type.display, fontSize: 34, lineHeight: 40, color: color.text },
  texte: { ...type.lead, color: color.textMuted },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaTexte: { ...type.lead, color: color.bg, fontWeight: '700' },
  reserve: { height: PIED_SECONDAIRE, marginTop: space.sm },
});
