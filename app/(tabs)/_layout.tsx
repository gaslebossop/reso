import { Tabs } from 'expo-router';

import { BarreOnglets } from '../../src/components/BarreOnglets';

/**
 * Quatre onglets, et une barre dessinee a la main.
 *
 * La barre par defaut est remplacee entierement (voir `BarreOnglets`) : elle
 * imposait des libelles permanents et acceptait des caracteres typographiques
 * en guise d'icones.
 *
 * Aucune animation de bascule : on y passe des dizaines de fois par session,
 * et un glissement d'ecran y ajouterait une profondeur qui n'existe pas entre
 * des pairs.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BarreOnglets {...props} />}
      screenOptions={{ headerShown: false, animation: 'none' }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="gens" />
      <Tabs.Screen name="prism" />
    </Tabs>
  );
}
