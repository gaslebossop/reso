import Svg, { Path, Rect } from 'react-native-svg';

/**
 * Les trois icones de la barre du bas.
 *
 * Elles remplacent des formes assemblees en `View` (des rectangles, et un
 * triangle fabrique avec des `borderWidth`). Ce procede se voit : les masses
 * optiques ne sont pas comparables d'une icone a l'autre, aucune epaisseur de
 * trait n'est partagee, et l'encoche du signet devait etre peinte de la
 * couleur du fond — l'icone cessait donc d'etre juste des qu'elle n'etait plus
 * posee sur ce fond-la.
 *
 * Ici tout est vectoriel, sur **une grille de 24**, avec **une seule epaisseur
 * de trait**, et la convention native : contour quand l'onglet dort, aplat
 * quand il est actif. C'est ce contraste plein/creux qui dit ou l'on est —
 * la couleur ne fait que confirmer, elle ne porte pas l'information seule.
 */

const GRILLE = 24;
const TRAIT = 1.7;

export type ProprietesIcone = {
  /** Aplat plutot que contour. */
  actif: boolean;
  couleur: string;
  taille?: number;
};

function Cadre({ taille = GRILLE, children }: { taille?: number; children: React.ReactNode }) {
  return (
    <Svg width={taille} height={taille} viewBox={`0 0 ${GRILLE} ${GRILLE}`} fill="none">
      {children}
    </Svg>
  );
}

/**
 * Le fil : la carte qu'on regarde, et celle qui attend derriere.
 *
 * Les deux formes ne se recouvrent pas — un contour qui passerait derriere un
 * aplat vide se verrait au travers.
 */
export function IconeFil({ actif, couleur, taille }: ProprietesIcone) {
  return (
    <Cadre taille={taille}>
      <Rect
        x={6.25}
        y={3.25}
        width={11.5}
        height={3.5}
        rx={1.75}
        fill={actif ? couleur : 'none'}
        fillOpacity={actif ? 0.45 : 0}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
        strokeOpacity={0.55}
      />
      <Rect
        x={3.25}
        y={7.25}
        width={17.5}
        height={13.5}
        rx={3.25}
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
      />
    </Cadre>
  );
}

/** Les gardes : un signet, encoche comprise — decoupee dans le trace, pas
 *  peinte par-dessus. */
export function IconeGardes({ actif, couleur, taille }: ProprietesIcone) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M6.75 3.75 h10.5 a1.5 1.5 0 0 1 1.5 1.5 v14.9 a1 1 0 0 1 -1.53 0.85 L12 17.6 l-5.22 3.4 a1 1 0 0 1 -1.53 -0.85 V5.25 a1.5 1.5 0 0 1 1.5 -1.5 z"
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/** Le prisme : le triangle qui donne son nom au moteur. Legerement rentre dans
 *  la grille — a taille egale, un triangle pese plus lourd qu'un rectangle. */
export function IconePrisme({ actif, couleur, taille }: ProprietesIcone) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 4.4 L20.1 19.6 H3.9 Z"
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/**
 * Les gens : deux profils, un devant l'autre.
 *
 * Celui de derriere reste toujours en contour atténué, actif ou non — c'est
 * lui qui dit « plusieurs » sans voler la masse du premier. Le premier seul
 * passe au plein quand l'onglet vit : la convention contour/aplat porte sur
 * lui, et lui seul.
 */
export function IconeGens({ actif, couleur, taille }: ProprietesIcone) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M15.7 5.7 a3 3 0 0 1 0 5.9"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
        strokeLinecap="round"
        strokeOpacity={0.55}
      />
      <Path
        d="M16.6 12.1 a4.8 4.8 0 0 1 4 4.7 v2.2 h-2.4"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
        strokeLinecap="round"
        strokeOpacity={0.55}
      />
      <Path
        d="M9.3 5.2 a3.3 3.3 0 1 1 0 6.6 a3.3 3.3 0 0 1 0-6.6 z"
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
      />
      <Path
        d="M3 19.3 v-1 a4.9 4.9 0 0 1 9.8 0 v1 z"
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/**
 * Les reglages : un rouage.
 *
 * Six dents, pas huit ni douze : a 22 px, au-dela de six, les creux se
 * referment au rendu et la roue redevient un disque cranele.
 */
export function IconeReglages({ couleur, taille = 22 }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 15.2 a3.2 3.2 0 1 0 0-6.4 a3.2 3.2 0 0 0 0 6.4 z"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
      />
      <Path
        d="M19.2 14.1 a7.4 7.4 0 0 0 0-4.2 l1.9-1.4 -2-3.5 -2.2 0.9 a7.5 7.5 0 0 0-3.6-2.1 L12.9 1.4 h-1.8 l-0.4 2.4 a7.5 7.5 0 0 0-3.6 2.1 L4.9 5 l-2 3.5 1.9 1.4 a7.4 7.4 0 0 0 0 4.2 L2.9 15.5 l2 3.5 2.2-0.9 a7.5 7.5 0 0 0 3.6 2.1 l0.4 2.4 h1.8 l0.4-2.4 a7.5 7.5 0 0 0 3.6-2.1 l2.2 0.9 2-3.5 z"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/**
 * Le chevron d'un depliant.
 *
 * Pointe a droite au repos ; l'ecran le fait tourner d'un quart de tour quand
 * le groupe s'ouvre. C'est le seul indice qui distingue une ligne qui deplie
 * d'une ligne qui part ailleurs, et sans lui le sujet de la plateforme
 * s'ouvrait sans que rien n'ait annonce qu'il pouvait s'ouvrir.
 */
export function IconeChevron({ couleur, taille = 18 }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M9.5 4.8 L16.7 12 l-7.2 7.2"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/** Retour : un chevron seul, sans le mot. */
export function IconeRetour({ couleur, taille = 22 }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M14.5 4.8 L7.3 12 l7.2 7.2"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

export const ICONES: Record<string, (p: ProprietesIcone) => React.ReactNode> = {
  index: IconeFil,
  library: IconeGardes,
  prism: IconePrisme,
  gens: IconeGens,
};

/**
 * Le coeur du rail.
 *
 * Il remplace le caractere « ♥ » que la barre d'action posait dans un `Text`.
 * Un glyphe typographique n'a ni la grille, ni l'epaisseur, ni la masse
 * optique des trois icones ci-dessus : pose a cote d'un signet vectoriel, il
 * se voit immediatement. Meme grille de 24, meme trait, meme convention
 * contour/aplat.
 */
export function IconeCoeur({ actif, couleur, taille }: ProprietesIcone) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 20.3 C12 20.3 3.7 15.2 3.7 9.3 A4.55 4.55 0 0 1 12 6.75 a4.55 4.55 0 0 1 8.3 2.55 c0 5.9-8.3 11-8.3 11 z"
        fill={actif ? couleur : 'none'}
        stroke={actif ? 'none' : couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/**
 * Passer : une croix.
 *
 * Meme raison que le coeur ci-dessus — le caractere « ✕ » n'a ni la grille ni
 * l'epaisseur des autres. Bouts arrondis, comme les chevrons : c'est un rejet
 * sans consequence, pas une suppression.
 */
export function IconeCroix({ couleur, taille = GRILLE }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M6.6 6.6 L17.4 17.4 M17.4 6.6 L6.6 17.4"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Cadre>
  );
}

/** Garder : le signet, mais avec la fleche du geste — vers le haut. */
export function IconeGarder({ couleur, taille = GRILLE }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 4.2 L12 15.6 M7.6 8.6 L12 4.2 l4.4 4.4"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.4 18.4 h13.2"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Cadre>
  );
}

/**
 * La cloche des notifications.
 *
 * Battant compris — une cloche sans battant se lit comme un dome, et a 22 px
 * la difference est ce qui la rend reconnaissable au premier coup d'oeil.
 */
export function IconeCloche({ couleur, taille = 22 }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 3.4 a5.6 5.6 0 0 0-5.6 5.6 c0 3.2-1 4.6-1.7 5.4 a0.8 0.8 0 0 0 0.6 1.3 h13.4 a0.8 0.8 0 0 0 0.6-1.3 c-0.7-0.8-1.7-2.2-1.7-5.4 A5.6 5.6 0 0 0 12 3.4 z"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
        strokeLinejoin="round"
      />
      <Path
        d="M10.1 18.6 a2 2 0 0 0 3.8 0"
        fill="none"
        stroke={couleur}
        strokeWidth={TRAIT}
        strokeLinecap="round"
      />
    </Cadre>
  );
}

/**
 * Partager : la fleche qui sort de la boite.
 *
 * Le glyphe systeme d'iOS, redessine sur la grille commune. C'est le seul
 * dessin que tout le monde reconnait sans l'avoir appris, et « donne ton
 * profil » est precisement un geste qu'on ne doit pas avoir a apprendre.
 */
export function IconePartage({ couleur, taille = 20 }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path
        d="M12 3.6 V14.4 M8.2 7.4 L12 3.6 l3.8 3.8"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.2 12.6 v6.2 a1.4 1.4 0 0 0 1.4 1.4 h8.8 a1.4 1.4 0 0 0 1.4-1.4 v-6.2"
        fill="none"
        stroke={couleur}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Cadre>
  );
}

/**
 * La silhouette d'un compte sans photo.
 *
 * **Elle remplit sa grille de bord a bord**, et c'est tout le sujet. Dessinee
 * plus petite et centree, elle flottait au milieu du rond comme un bonhomme
 * decoupe : le repli avait l'air casse plutot que par defaut. Ici les epaules
 * sont un demi-disque assez large pour que le rond qui l'entoure les **rogne**
 * — c'est ce rognage qui fait lire « une personne dans un cadre » plutot que
 * « une forme posee sur un fond ».
 *
 * Un ecart de deux unites entre le bas de la tete et le haut des epaules :
 * sans lui, les deux formes fusionnent en bonhomme de neige.
 */
export function IconePersonne({ couleur, taille = GRILLE }: { couleur: string; taille?: number }) {
  return (
    <Cadre taille={taille}>
      <Path d="M12 12.9 a4.3 4.3 0 1 0 0-8.6 a4.3 4.3 0 0 0 0 8.6 z" fill={couleur} />
      <Path d="M2.7 24.6 a9.3 9.3 0 0 1 18.6 0 z" fill={couleur} />
    </Cadre>
  );
}
