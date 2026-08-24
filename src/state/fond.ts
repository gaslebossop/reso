import {
  Easing,
  interpolateColor,
  makeMutable,
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSyncExternalStore } from 'react';

import { color } from '../theme/tokens';

/**
 * Les couleurs du fil, et l'encre qui va dessus.
 *
 * ## Pourquoi un magasin de module
 *
 * Trois choses doivent changer **ensemble et exactement au meme instant** : le
 * fond de l'ecran, le texte de la trace en haut, les verbes de la barre en
 * bas. Elles vivent dans trois composants qui ne se connaissent pas, et faire
 * descendre la couleur en propriete jusqu'a chacun obligerait a redessiner
 * tout l'arbre a chaque carte — pour une transition qui doit justement etre
 * fluide.
 *
 * Des valeurs partagees de Reanimated resolvent les deux : elles vivent en
 * dehors de React, elles s'animent sur le fil d'affichage, et n'importe quel
 * composant peut les lire sans que personne ne le lui passe.
 *
 * ## Pourquoi deux couleurs et un avancement, plutot qu'une couleur animee
 *
 * `interpolateColor` est le seul chemin garanti pour melanger deux couleurs
 * dans un worklet. On garde donc **d'ou l'on vient** et **ou l'on va**, et un
 * seul avancement les traverse — ce qui a l'avantage d'etre exactement le meme
 * pour le fond et pour l'encre, donc de ne jamais laisser un texte sombre une
 * demi-seconde sur un fond encore sombre.
 *
 * ## Le piege qui a coute la fonctionnalite entiere
 *
 * `useAnimatedStyle` n'observe **que les valeurs partagees presentes dans la
 * closure du worklet qu'on lui passe** : il fait litteralement
 * `Object.values(updater.__closure)`. L'avancement etait lu a l'interieur d'un
 * worklet auxiliaire (`melange`), donc il vivait dans la closure de *celui-la*
 * — jamais dans celle du style. Le style ne se recalculait donc que quand les
 * couleurs changeaient, et a cet instant precis l'avancement venait d'etre
 * remis a zero dans le meme lot d'ecritures : l'ecran affichait le **d'ou l'on
 * vient**, c'est-a-dire la couleur de la carte precedente, et n'en bougeait
 * plus jamais. Une pochette de ciel gris avec un fond rose vif venu du titre
 * d'avant.
 *
 * D'ou la regle : l'avancement se lit dans le worklet du style, et se **passe
 * en argument** aux auxiliaires. Jamais l'inverse.
 *
 * ## Le seuil de bascule
 *
 * 0,66 de luminance perceptuelle, et pas 0,5 : l'oeil supporte du blanc sur un
 * fond moyen bien plus longtemps que du noir. Basculer a la moitie donnerait
 * du texte noir sur des bleus moyens ou il est moins lisible que du blanc.
 *
 * Il etait a 0,58, et le moteur a depuis descendu sa bande de clarte a 0,30.
 * Un jaune borne a 0,40 de clarte pese quand meme 0,60 de luminance
 * perceptuelle — l'ancien seuil aurait donc pose de l'encre **noire** sur un
 * olive sombre, la seule combinaison illisible de tout l'ecran.
 */
const SEUIL_ENCRE = 0.66;

/** Les trois tons d'un fond : le haut de l'ecran, le milieu — celui qui decide
 *  de l'encre — et le bas. */
export type Palette = { haut: string; base: string; bas: string };

/** Le fond de l'application, quand aucune pochette n'a encore parle.
 *
 *  Il est **degrade lui aussi**. Un neutre plat entre deux cartes se lit comme
 *  un ecran eteint ; la meme profondeur que partout ailleurs le fait lire comme
 *  un fond. */
const NEUTRE: Palette = { haut: '#1A1A21', base: '#101014', bas: '#000000' };

export const fondDe = makeMutable<string>(NEUTRE.base);
export const fondVers = makeMutable<string>(NEUTRE.base);
export const encreDe = makeMutable<string>(color.text);
export const encreVers = makeMutable<string>(color.text);
/** 0 = on est encore sur l'ancienne couleur, 1 = on est arrive. */
export const avancee = makeMutable(1);

/** L'encre franche, et sa version attenuee pour le texte secondaire. */
const CLAIRE = { vive: '#F6F6F8', douce: 'rgba(246, 246, 248, 0.74)' };
const SOMBRE = { vive: '#111116', douce: 'rgba(17, 17, 22, 0.68)' };

export const encreDouceDe = makeMutable<string>(CLAIRE.douce);
export const encreDouceVers = makeMutable<string>(CLAIRE.douce);

/** Luminance perceptuelle d'un `#rrggbb`. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  if (n.length !== 6) return 0;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Le degrade, cote React.
 *
 * ## Pourquoi il ne passe pas par les valeurs partagees
 *
 * Un degrade est une liste de couleurs, pas une couleur : `interpolateColor`
 * ne sait pas l'animer, et pousser un tableau dans la propriete `colors` d'une
 * vue native depuis un worklet n'est garanti par rien. On empile donc **deux
 * degrades complets** — celui d'ou l'on vient, celui ou l'on va — et on anime
 * la seule chose qu'un worklet anime a coup sur : l'opacite du second. Le
 * resultat est le meme melange lineaire, sans propriete exotique.
 *
 * Ces deux palettes changent une fois par carte. C'est donc de l'etat React
 * ordinaire, et un abonnement suffit.
 */
type Etat = { de: Palette; vers: Palette; cle: number };

let etat: Etat = { de: NEUTRE, vers: NEUTRE, cle: 0 };
const abonnes = new Set<() => void>();

function sabonner(f: () => void): () => void {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

/** Les deux degrades a empiler, et la cle qui dit quand ils ont change. */
export function useDegrade(): Etat {
  return useSyncExternalStore(sabonner, () => etat);
}

const DUREE = 620;

/**
 * La pochette a change : on part vers sa palette.
 *
 * Ne fait rien si c'est deja la palette en place — l'ecran du fil rappelle
 * cette fonction a chaque carte, et relancer une transition vers l'endroit ou
 * l'on est deja produirait un battement.
 *
 * **A appeler depuis un effet, jamais pendant un rendu** : la fonction previent
 * ses abonnes, et prevenir un abonne React au milieu d'un rendu revient a le
 * faire se redessiner pendant qu'un autre se dessine.
 */
export function poserFond(t?: { couleur?: string | null; couleur_haut?: string | null; couleur_bas?: string | null } | null): void {
  const cible = palette(t);
  if (cible.base === fondVers.value && cible.haut === etat.vers.haut && cible.bas === etat.vers.bas) return;

  const encre = luminance(cible.base) > SEUIL_ENCRE ? SOMBRE : CLAIRE;

  fondDe.value = fondVers.value;
  encreDe.value = encreVers.value;
  encreDouceDe.value = encreDouceVers.value;

  fondVers.value = cible.base;
  encreVers.value = encre.vive;
  encreDouceVers.value = encre.douce;

  etat = { de: etat.vers, vers: cible, cle: etat.cle + 1 };
  abonnes.forEach((f) => f());

  avancee.value = 0;
  avancee.value = withTiming(1, { duration: DUREE, easing: Easing.inOut(Easing.quad) });
}

/**
 * La palette d'un titre, ou le neutre.
 *
 * Le moteur rend les trois tons. Il peut n'en rendre qu'un — une version plus
 * ancienne, un cache d'avant — et dans ce cas le degrade est reconstitue ici
 * en eclaircissant et en assombrissant la base. C'est moins bon (la teinte ne
 * bouge pas, seule la clarte) mais ca reste un degrade, ce qu'un aplat n'est
 * pas.
 */
function palette(t?: { couleur?: string | null; couleur_haut?: string | null; couleur_bas?: string | null } | null): Palette {
  const base = t?.couleur && HEX.test(t.couleur) ? t.couleur : null;
  if (!base) return NEUTRE;
  const haut = t?.couleur_haut && HEX.test(t.couleur_haut) ? t.couleur_haut : voile(base, 0.09);
  const bas = t?.couleur_bas && HEX.test(t.couleur_bas) ? t.couleur_bas : voile(base, -0.3);
  return { haut, base, bas };
}

/** Le meme ton, eclairci (`part > 0`) ou assombri. Repli seulement : le moteur
 *  fait mieux, parce que lui voit la pochette. */
function voile(hex: string, part: number): string {
  const n = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16);
    const cible = part > 0 ? 255 : 0;
    return Math.round(c + (cible - c) * Math.abs(part));
  });
  return `#${v.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Remet le neutre. A la sortie du fil : la couleur du dernier titre n'a rien
 *  a faire derriere un autre ecran. */
export function rendreFond(): void {
  poserFond(null);
}

/** Le melange de deux couleurs a un avancement **recu en argument**.
 *
 *  L'avancement ne se lit pas ici : il doit vivre dans la closure du style
 *  appelant pour que Reanimated l'observe. Voir l'en-tete du fichier. */
function melange(t: number, de: SharedValue<string>, vers: SharedValue<string>): string {
  'worklet';
  return interpolateColor(t, [0, 1], [de.get(), vers.get()]);
}

/** La couleur du fond, animee. Sert de socle sous les deux degrades. */
export function useFondAnime() {
  return useAnimatedStyle(() => ({
    backgroundColor: melange(avancee.get(), fondDe, fondVers),
  }));
}

/** L'opacite du degrade d'arrivee : 0 au depart, 1 une fois arrive. */
export function useArrivee() {
  return useAnimatedStyle(() => ({ opacity: avancee.get() }));
}

/** L'encre franche — titres, chiffres, glyphes. */
export function useEncre() {
  return useAnimatedStyle(() => ({ color: melange(avancee.get(), encreDe, encreVers) }));
}

/** L'encre attenuee — legendes, verbes, mentions. */
export function useEncreDouce() {
  return useAnimatedStyle(() => ({
    color: melange(avancee.get(), encreDouceDe, encreDouceVers),
  }));
}

/** L'encre franche, comme teinte de remplissage plutot que de texte. */
export function useTeinteEncre() {
  return useAnimatedStyle(() => ({
    backgroundColor: melange(avancee.get(), encreDe, encreVers),
  }));
}
