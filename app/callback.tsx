import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '../src/theme/tokens';

/**
 * Le retour du reseau G.
 *
 * ## Pourquoi cette route existe alors qu'elle ne fait presque rien
 *
 * `reso://callback?code=…` est cense etre intercepte par l'onglet de
 * navigation integre, sans jamais atteindre le routeur. Mais quand le systeme
 * n'a pas d'onglet integre disponible — un navigateur par defaut qui ne les
 * gere pas, un emulateur comme BlueStacks — la redirection **sort du
 * navigateur et revient a l'app comme un lien profond ordinaire**. expo-router
 * la recoit, ne trouve aucune route `/callback`, et affiche « Unmatched
 * Route ». C'est ce qui a ete observe sur appareil le 2026-08-23 : la
 * connexion aboutissait cote G, et l'app repondait par une page d'erreur avec
 * le code d'autorisation ecrit dedans.
 *
 * Le code, lui, n'est pas lu ici : `signIn` ecoute `Linking` en parallele de
 * l'onglet et le recupere par la, quel que soit le chemin emprunte. Cette route
 * n'a donc qu'un travail — **ne pas etre une page d'erreur**, et rendre la main
 * a l'ecran d'ou l'on vient pendant que l'echange de jetons se termine en
 * arriere-plan.
 *
 * Elle affiche quand meme quelque chose : ce passage dure une fraction de
 * seconde en temps normal, mais si l'echange traine, un ecran vide laisserait
 * croire que l'app a plante.
 */
export default function Callback() {
  const params = useLocalSearchParams<{ error?: string }>();

  useEffect(() => {
    // Rendre la main tout de suite. `back()` plutot que `replace('/')` :
    // l'ecran de connexion est encore dans la pile et c'est lui qui attend la
    // reponse de `signIn` — le remplacer par la racine ferait recommencer
    // l'aiguillage de demarrage au milieu du parcours.
    const t = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.ecran}>
      {params.error ? (
        <Text style={styles.mot}>Connexion interrompue.</Text>
      ) : (
        <>
          <ActivityIndicator color={color.accent} />
          <Text style={styles.mot}>Retour au réseau G…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ecran: {
    flex: 1,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  mot: { ...type.body, color: color.textMuted },
});
