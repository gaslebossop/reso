import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { signOut } from '../auth/gnetwork';

const KEY_DEVICE = 'reso.device_id';
const KEY_ONBOARDED = 'reso.onboarded';
/** Nom historique de l'identifiant local, conserve pour ne pas perdre les
 *  profils des installations anterieures a la connexion par compte. */
const KEY_LEGACY_USER = 'reso.user_id';

/**
 * L'identite de l'appareil.
 *
 * Ce n'est pas un compte : c'est un identifiant tire au premier lancement, qui
 * suffit a swiper et a faire apprendre le moteur. Le compte du reseau G vient
 * par-dessus quand la personne le veut (voir `src/auth/gnetwork.ts`), et c'est
 * lui — pas cet identifiant — qui fait suivre le gout d'un telephone a
 * l'autre.
 *
 * Rien d'autre n'est garde ici. Le profil de gout, la bibliotheque et
 * l'historique vivent en base cote moteur : l'app affiche, elle ne retient
 * pas.
 */
/**
 * L'identifiant, memorise sous forme de promesse : le client l'embarque dans
 * chaque POST, et le relire a chaque fois sur AsyncStorage mettait un
 * aller-retour de stockage sur le chemin chaud. Il ne change jamais au cours
 * d'une session — seul `resetSession` l'invalide.
 */
let identifiant: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (!identifiant) {
    identifiant = (async () => {
      const existing = await AsyncStorage.getItem(KEY_DEVICE);
      if (existing) return existing;

      // Une installation d'avant portait le meme identifiant sous un autre nom.
      // Le reprendre plutot qu'en tirer un neuf evite de rendre orphelin le gout
      // deja construit sur cet appareil.
      const legacy = await AsyncStorage.getItem(KEY_LEGACY_USER);
      const id = legacy ?? Crypto.randomUUID();
      await AsyncStorage.setItem(KEY_DEVICE, id);
      return id;
    })();
    // Un stockage qui echoue ne doit pas condamner tous les appels suivants.
    identifiant.catch(() => {
      identifiant = null;
    });
  }
  return identifiant;
}

export async function isOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_ONBOARDED)) === '1';
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY_ONBOARDED, '1');
}

/** Remet l'app a zero : nouvel appareil, personne de connecte.
 *
 *  **La deconnexion en fait partie.** Garder les jetons reviendrait a repartir
 *  sur le meme compte, donc sur le meme profil cote moteur : l'app aurait l'air
 *  neuve et le fil saurait deja tout. C'est exactement le contraire de ce qu'on
 *  demande en appuyant ici.
 *
 *  Ne touche pas a la base pour autant : les swipes deja envoyes restent
 *  la-bas, et se reconnecter au meme compte G les retrouve. « Recommencer »
 *  veut dire « repartir d'un appareil neuf », pas « effacer mon histoire » —
 *  effacer pour de bon se fait cote moteur (voir AGENTS.md). */
export async function resetSession(): Promise<void> {
  await signOut();
  // La copie en memoire meurt avec la cle : sans cela l'app repartirait avec
  // l'identifiant qu'on vient de supprimer.
  identifiant = null;
  await AsyncStorage.multiRemove([KEY_DEVICE, KEY_ONBOARDED, KEY_LEGACY_USER]);
}
