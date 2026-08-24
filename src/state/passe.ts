import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Le didacticiel des gestes, et son drapeau.
 *
 * Il ne se montre qu'une fois par installation, au moment ou la premiere carte
 * arrive : expliquer les gestes avant qu'il y ait quoi que ce soit a en faire
 * ne laisse aucun souvenir. Revenir dessus reste possible depuis les
 * reglages — c'est le seul cas ou le drapeau retombe sans effacer la seance.
 */

const CLE = 'reso.passe';

let chargee = false;
let faite = false;

export async function passeDejaFait(): Promise<boolean> {
  if (chargee) return faite;
  const v = await AsyncStorage.getItem(CLE).catch(() => null);
  faite = v === 'fait';
  chargee = true;
  return faite;
}

export async function marquerPasseFait(): Promise<void> {
  faite = true;
  chargee = true;
  await AsyncStorage.setItem(CLE, 'fait').catch(() => {});
}

export async function reinitialiserPasse(): Promise<void> {
  faite = false;
  chargee = true;
  await AsyncStorage.removeItem(CLE).catch(() => {});
}
