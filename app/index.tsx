import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { getDeviceId, isOnboarded } from '../src/state/session';
import { color } from '../src/theme/tokens';

/** Aiguillage au lancement : le parcours de demarrage la premiere fois
 *  (accueil -> compte -> gouts), le fil ensuite. */
export default function Index() {
  const [route, setRoute] = useState<'/bienvenue' | '/(tabs)' | null>(null);

  useEffect(() => {
    (async () => {
      await getDeviceId(); // cree l'identite d'appareil si besoin
      setRoute((await isOnboarded()) ? '/(tabs)' : '/bienvenue');
    })();
  }, []);

  if (!route) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }
  return <Redirect href={route} />;
}
