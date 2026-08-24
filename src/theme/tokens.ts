/**
 * Les jetons visuels de Reso.
 *
 * Parti pris : l'ecran est noir et la pochette est la seule source de couleur.
 * Une app d'ecoute doit disparaitre derriere la musique — tout chrome colore
 * entre en concurrence avec l'artwork, qui est justement ce qu'on demande a
 * l'utilisateur de juger.
 */

import type { TextStyle } from 'react-native';

export const color = {
  /** Noir profond, pas #000 : le vrai noir ecrase les ombres sur OLED. */
  bg: '#08080A',
  bgElevated: '#131316',
  bgSunken: '#000000',

  text: '#F4F4F5',
  textMuted: '#A1A1AA',
  textFaint: '#52525B',

  /** L'accent unique. Sert au « j'aime » et a rien d'autre. */
  accent: '#22D3A5',
  accentDim: 'rgba(34, 211, 165, 0.16)',

  /** Le rejet. Volontairement sourd : passer un titre n'est pas une erreur. */
  reject: '#71717A',
  rejectDim: 'rgba(113, 113, 122, 0.18)',

  /** La sauvegarde, geste rare et fort. */
  save: '#F5B841',
  saveDim: 'rgba(245, 184, 65, 0.18)',

  /** Ce qui n'a pas marché. Désaturé : sur fond sombre, un rouge franc vibre
   *  et dramatise une panne réseau qui n'en vaut pas la peine. */
  alert: '#E8927C',

  hairline: 'rgba(255, 255, 255, 0.08)',
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  card: 28,
  full: 999,
} as const;

/**
 * Hauteur du bloc secondaire sous le bouton principal, sur les deux ecrans
 * d'ouverture.
 *
 * **Retiree une fois, et le defaut est revenu immediatement** : sans elle,
 * l'accueil n'a rien sous son bouton alors que la porte du reseau G porte
 * « Plus tard », et le bouton principal saute d'une cinquantaine de points
 * entre deux pages faites pour se lire comme une seule. C'est le premier
 * mouvement de l'application, et c'est celui qu'on remarque.
 *
 * L'accueil reserve donc cette hauteur sans rien mettre dedans. Ce n'est pas
 * du vide decoratif : c'est la place d'un element qui existe sur l'ecran
 * suivant.
 *
 * 52 = la cible tactile de « Plus tard » (16 + 20 + 16).
 */
export const PIED_SECONDAIRE = 52;

export const type = {
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  /** Le texte qu'on lit vraiment, pas celui qu'on survole.
   *
   *  16 px conviennent a une legende posee sous une pochette ; une phrase
   *  qu'on demande a quelqu'un de lire en arrivant dans l'app en demande 17,
   *  avec l'interligne qui va avec. */
  lead: { fontSize: 17, lineHeight: 25, fontWeight: '500', letterSpacing: -0.2 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 16, fontWeight: '500', letterSpacing: -0.1 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
} as const;


/**
 * Chiffres alignes.
 *
 * A appliquer des qu'un nombre est lu en colonne ou compare a un autre : sans
 * cela `38 %` et `112` n'ont pas la meme avance par caractere, et une colonne
 * de valeurs cesse d'etre balayable.
 */
export const chiffres: TextStyle = { fontVariant: ['tabular-nums'] };

/** Courbes. `ease-in` est volontairement absent : il retarde l'instant que
 *  l'oeil regarde. */
export const curve = {
  out: [0.23, 1, 0.32, 1] as const,
  inOut: [0.77, 0, 0.175, 1] as const,
} as const;

export const motion = {
  /** Retour de pression. */
  press: 120,
  /** Petit changement d'etat. */
  state: 180,
  /** Retour d'une carte a sa place apres un drag avorte. */
  settle: { duration: 400, dampingRatio: 0.8 },
  /** Sortie d'une carte validee : ferme, sans rebond. */
  eject: { duration: 260, dampingRatio: 1, overshootClamping: true },
} as const;
