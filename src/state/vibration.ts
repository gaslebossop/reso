import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

/**
 * Le retour haptique, et son interrupteur.
 *
 * Chaque ecran appelait `expo-haptics` directement. Un reglage « retour
 * haptique » aurait donc voulu dire passer une preference a huit endroits, ou
 * — bien pire — poser un `if` a chacun d'eux et en oublier un. Le passage par
 * ce module est ce qui rend le reglage possible du tout.
 *
 * L'etat est **lu depuis la memoire**, jamais depuis le disque au moment de
 * vibrer : un swipe ne peut pas attendre un aller-retour AsyncStorage, et un
 * retour qui arrive apres le geste est pire que pas de retour.
 */

const CLE = 'reso.haptique';

/** Actif par defaut : c'est le comportement d'une app de swipe, et une
 *  fonctionnalite qu'il faut decouvrir pour l'avoir n'existe pas. */
let actif = true;
let charge = false;

/** Lit la preference au demarrage. Sans attendre : tant qu'elle n'est pas
 *  arrivee, on vibre — se tromper dans ce sens-la est le moindre mal. */
export async function chargerVibration(): Promise<boolean> {
  if (charge) return actif;
  const v = await AsyncStorage.getItem(CLE).catch(() => null);
  actif = v !== 'off';
  charge = true;
  return actif;
}

export function vibrationActive(): boolean {
  return actif;
}

export async function reglerVibration(on: boolean): Promise<void> {
  actif = on;
  charge = true;
  await AsyncStorage.setItem(CLE, on ? 'on' : 'off').catch(() => {});
  // Confirmer par le sens qu'on vient d'allumer : sans cela, activer un
  // reglage haptique ne produit rien, ce qui donne l'impression qu'il est
  // casse.
  if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Les trois intensites que l'app utilise, nommees par ce qu'elles disent
 * plutot que par leur force — le choix de l'intensite se fait ici, une fois,
 * et pas dans chaque ecran.
 */
export const vibrer = {
  /** Un choix pris : onglet, artiste coche. */
  choix() {
    if (actif) void Haptics.selectionAsync();
  },
  /** Une action lancee : bouton, ouverture. */
  action() {
    if (actif) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  /**
   * Le seuil du geste vient d'etre franchi, **le doigt est encore pose**.
   *
   * C'est le retour le plus utile de l'app, et il n'existait pas : jusqu'ici
   * la vibration arrivait au lacher, c'est-a-dire une fois la decision prise et
   * la carte partie. Elle confirmait, elle n'annoncait rien. Poser le cran au
   * franchissement rend le geste **relachable a coup sur** — on sent que ca va
   * partir avant de lever le doigt — et c'est aussi le seul instant ou
   * l'interface peut dire « c'est gagne » avant que ce le soit.
   */
  seuil() {
    if (actif) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  },
  /**
   * Un « j'aime » vient de partir.
   *
   * Le geste le plus frequent de l'app n'avait, au lacher, **aucun retour** :
   * le cran du seuil sonnait pendant qu'on decidait, puis plus rien. Or c'est
   * au relachement que la decision devient un fait, et un geste de plaisir qui
   * ne rend rien est un geste qu'on finit par ne plus faire.
   */
  aime() {
    if (actif) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  /**
   * Le moteur vient de prendre un risque, et il l'annonce.
   *
   * Le seul retour de l'app que l'utilisateur n'a pas provoque. Il ne sonne que
   * sur les titres « hors de tes habitudes » — quelques-uns par seance — et
   * c'est justement son irregularite qui le rend audible : un retour qui arrive
   * a chaque carte n'est plus un signal, c'est un metronome.
   *
   * `Soft` et non `Light` : il accompagne une arrivee, il n'accuse pas
   * reception d'un geste. Une pression molle se remarque sans interrompre.
   */
  surprise() {
    if (actif) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  },
  /** Un titre range dans la bibliotheque : le seul geste qui produit un objet. */
  garde() {
    if (actif) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  /** Un geste lourd et rare : bannir un artiste. */
  grave() {
    if (actif) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
  /**
   * Un match, dans un salon de mix : les deux ont aime ou garde le meme titre.
   *
   * Le pic de l'experience a deux — plus rare qu'un « je garde » du fil
   * normal, et plus fort : une double confirmation vaut plus que la somme des
   * deux. Meme intensite que `garde()` (le seul autre evenement qui produit
   * un objet), volontairement distingue par son nom pour que l'appelant dise
   * ce qu'il fete sans avoir a le commenter.
   */
  match() {
    if (actif) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
};
