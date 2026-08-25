import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import type { Track } from '../src/api/types';
import { Etapes } from '../src/components/Etapes';
import { MurAccueil } from '../src/components/MurAccueil';
import { pochettesAccueil } from '../src/state/accueil';
import { markOnboarded } from '../src/state/session';
import { vibrer } from '../src/state/vibration';
import { useAccount } from '../src/state/useAccount';
import { color, PIED_SECONDAIRE, radius, space, type } from '../src/theme/tokens';

/**
 * La porte.
 *
 * ## Le paradigme : une porte pleine, posée devant le mur
 *
 * Le même mur que l'accueil — les mêmes pochettes, le cache de session les
 * rend instantanément — mais l'écran n'y répond pas de la même façon : ici,
 * **une surface pleine et calme se pose sur le bas du mur**, comme une porte
 * qu'on ferme devant une cale de disques pour poser une question. Rien ne
 * flotte sur les photos, donc plus rien n'a besoin de voile ni de dégradé :
 * le haut de l'écran reste des pochettes entières et nettes, le bas porte la
 * question sur du noir plein.
 *
 * Ce qui a été refusé ici, et pourquoi : la variante précédente posait un
 * texte centré sur un dégradé au milieu des images — la composition splash
 * que tout le monde reconnaît et que personne ne regarde. Le texte y vivait
 * d'une position (au milieu, en grand, centré) qui ne disait rien ; là, il
 * vit dans un objet — la porte — aligné comme le reste de l'application.
 *
 * ## La hiérarchie, une fois tranchée
 *
 * Les étapes du démarrage, puis la promesse (« Ton goût peut te suivre »),
 * puis ce que la porte ouvre exactement, puis l'action. Un seul bloc domine ;
 * l'accent est réservé au seul bouton qui fait avancer. « Plus tard » est une
 * ligne, pas un bouton : les deux issues n'ont pas le même poids, et c'est ce
 * qui laisse sortir ceux qui veulent écouter tout de suite.
 *
 * ## Ce qui a disparu
 *
 * - La caption en capitales espacées : « Réseau G », le bouton juste en
 *   dessous le disait déjà.
 * - Le dégradé, et avec lui toute superposition de texte sur image.
 *
 * `PIED_SECONDAIRE` reste : « Plus tard » occupe exactement la hauteur que
 * l'accueil réserve à sa place, pour que le pouce retrouve toujours le bouton
 * principal là où il l'a quitté.
 */
export default function Connexion() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();
  const [suite, setSuite] = useState(false);
  const [pochettes, setPochettes] = useState<Track[]>([]);
  // Un seul enchainement, quoi qu'il arrive : `useAccount` se rafraichit
  // plusieurs fois autour d'une connexion, et sans ce verrou on empilerait
  // autant de navigations.
  const enchaine = useRef(false);

  // Deja demandee par l'accueil, donc deja en cache : ceci ne declenche aucune
  // requete, et le mur est en place au premier rendu.
  useEffect(() => {
    let vivant = true;
    pochettesAccueil().then((ts) => vivant && setPochettes(ts));
    return () => {
      vivant = false;
    };
  }, []);

  /**
   * Ou aller apres.
   *
   * Un compte du reseau G peut deja porter un gout, construit sur un autre
   * telephone : le redemander serait absurde, et donnerait l'impression que le
   * compte n'a rien fait suivre. On saute alors droit au fil.
   */
  const continuer = useCallback(async () => {
    if (enchaine.current) return;
    enchaine.current = true;
    setSuite(true);
    const p = await prisme.prism().catch(() => null);
    if (p && p.facets.length > 0) {
      await markOnboarded();
      router.replace('/(tabs)');
      return;
    }
    router.push('/plateforme');
  }, [router]);

  const avecCompte = useCallback(async () => {
    vibrer.action();
    await compte.connect();
  }, [compte]);

  // La connexion a abouti : on enchaine sans faire retaper quoi que ce soit.
  // Dans un effet et non dans le rendu — naviguer pendant un rendu laisse
  // React se plaindre et peut partir deux fois.
  useEffect(() => {
    if (compte.connected) void continuer();
  }, [compte.connected, continuer]);

  const occupe = compte.busy || suite;

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      {/* Plein bord volontaire : voir la note sur le padding de la racine dans
          bienvenue.tsx. Le mur passe derrière la porte, visible au-dessus
          d'elle sur toute la largeur. */}
      <MurAccueil tracks={pochettes} />

      <View style={styles.porte}>
        <Etapes courante={1} />

        <Text
          style={styles.titre}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.86}
        >
          Ton goût peut te suivre.
        </Text>
        <Text style={styles.legende}>
          Tes gardés et ton Prisme te suivent sur chaque appareil.
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.cta,
            occupe && styles.ctaOccupe,
            pressed && styles.ctaPresse,
          ]}
          disabled={occupe}
          onPress={avecCompte}
          accessibilityRole="button"
        >
          {compte.busy ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={styles.ctaTexte}>Continuer avec le réseau G</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.plusTard}
          disabled={occupe}
          onPress={() => router.push('/onboarding')}
          accessibilityRole="button"
        >
          <Text style={styles.plusTardTitre}>{suite ? 'Un instant…' : 'Plus tard'}</Text>
        </Pressable>

        {/* Dernier enfant, volontairement : la porte etant ancree en bas,
            l'erreur l'allonge vers le haut sans deplacer ni le CTA ni
            « Plus tard ». Inseree entre les deux, elle faisait sauter le
            bouton secondaire sous le pouce. */}
        {compte.error ? <Text style={styles.erreur}>{compte.error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  porte: {
    marginTop: 'auto',
    backgroundColor: color.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  titre: { ...type.display, fontSize: 28, lineHeight: 34, color: color.text },
  legende: {
    ...type.body,
    fontSize: 15,
    lineHeight: 21,
    color: color.textMuted,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
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
  erreur: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.alert,
    textAlign: 'center',
    marginTop: space.sm,
  },
  // Exactement la hauteur que l'accueil reserve a cette place, pour que le
  // bouton principal ne bouge pas d'un ecran a l'autre. Voir PIED_SECONDAIRE.
  plusTard: {
    height: PIED_SECONDAIRE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  plusTardTitre: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.textMuted },
});
