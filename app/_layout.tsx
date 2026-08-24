import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { color } from '../src/theme/tokens';

export default function RootLayout() {
  return (
    // Sans ce conteneur, les gestes ne remontent jamais — et sans aucune erreur.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/*
         * Les transitions sont celles du système, pas des effets : une étape
         * du parcours pousse la précédente latéralement (`slide_from_right`,
         * avec son parallaxe et son geste de retour), et la porte du réseau G
         * monte par-dessus le mur (`slide_from_bottom`) — c'est elle, visuellement,
         * qui vient se poser devant les disques. Le `fade` global qui régnait ici
         * égalisait tous ces mouvements : chaque arrivée disait « écran remplacé »
         * au lieu de dire où l'on va.
         */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.bg },
            animation: 'slide_from_right',
          }}
        >
          {/* La porte monte, elle ne glisse pas : c'est un posage, pas un passage. */}
          <Stack.Screen name="connexion" options={{ animation: 'slide_from_bottom' }} />
          {/* L'app s'ouvre sur le fil, elle ne pousse rien. */}
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
