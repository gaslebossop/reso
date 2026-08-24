import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import type { Artist } from '../src/api/types';
import { Etapes } from '../src/components/Etapes';
import { MurDePochettes } from '../src/components/MurDePochettes';
import { artistes as chargerArtistes } from '../src/state/catalogue';
import { markOnboarded } from '../src/state/session';
import { vibrer } from '../src/state/vibration';
import { useAccount } from '../src/state/useAccount';
import { color, PIED_SECONDAIRE, radius, space, type } from '../src/theme/tokens';

/**
 * La porte.
 *
 * Deux corrections, et elles vont ensemble.
 *
 * **Le fond.** L'ecran etait le seul noir et vide du parcours, coince entre
 * l'accueil et la grille d'artistes — deux ecrans pleins d'images. Le mur de
 * portraits ne recommence donc pas ici : **il continue**. On ne change pas de
 * decor pour poser une question, on ne change que la phrase.
 *
 * **Le nombre de choses.** Il y avait un sur-titre en capitales, un titre,
 * deux paragraphes jumeaux « avec compte / sans compte » separes d'un filet,
 * un bouton et un lien. Six blocs pour une question binaire. Il en reste
 * quatre, et un seul demande a etre lu.
 *
 * Rien n'est ecrit sous « Plus tard » : ce que l'on renonce a emporter est
 * deja dit juste au-dessus, en positif. Le repeter en negatif au moment de
 * refuser sonne comme une derniere tentative de retenir.
 *
 * Le bouton principal tombe **exactement** a la meme hauteur que celui de
 * l'accueil (voir `PIED_SECONDAIRE`) : c'est ce qui fait que l'ecran a l'air
 * d'avoir change de texte plutot que d'avoir ete remplace.
 */
export default function Connexion() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();
  const [suite, setSuite] = useState(false);
  const [grille, setGrille] = useState<Artist[]>([]);
  // Un seul enchainement, quoi qu'il arrive : `useAccount` se rafraichit
  // plusieurs fois autour d'une connexion, et sans ce verrou on empilerait
  // autant de navigations.
  const enchaine = useRef(false);

  // Deja demandee par l'accueil, donc deja en cache : ceci ne declenche aucune
  // requete, et le mur est en place au premier rendu.
  useEffect(() => {
    let vivant = true;
    chargerArtistes()
      .then((as) => vivant && setGrille(as))
      .catch(() => {});
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
    <View style={styles.screen}>
      <MurDePochettes artistes={grille} />

      <View
        style={[
          styles.contenu,
          { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
        ]}
      >
        <Etapes courante={1} />

        <View style={styles.propos}>
          <Text style={styles.titre}>Ton goût peut te suivre.</Text>
          <Text style={styles.texte}>
            Avec un compte du réseau G, tes titres gardés et ton Prisme te retrouvent sur n'importe
            quel téléphone.
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, occupe && styles.ctaOccupe, pressed && styles.ctaPresse]}
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

        {compte.error ? <Text style={styles.erreur}>{compte.error}</Text> : null}

        <Pressable
          style={styles.plusTard}
          disabled={occupe}
          onPress={() => router.push('/onboarding')}
          accessibilityRole="button"
        >
          <Text style={styles.plusTardTitre}>{suite ? 'Un instant…' : 'Plus tard'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  contenu: { flex: 1, paddingHorizontal: space.lg },
  // Meme construction que l'accueil : le mur tient le haut, le texte tombe au
  // pied de l'ecran, la main arrive naturellement sur le bouton.
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
  // Meme hauteur reservee que sur l'accueil, pour que le bouton principal
  // occupe exactement la meme place sur les deux ecrans.
  plusTard: {
    height: PIED_SECONDAIRE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  plusTardTitre: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.textMuted },
});
