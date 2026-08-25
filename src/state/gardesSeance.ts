import { useSyncExternalStore } from 'react';

/**
 * Les pochettes gardées pendant la séance, celles qu'on voit s'empiler en haut
 * du fil.
 *
 * ## Pourquoi ce n'est plus un état de l'écran
 *
 * La trace vivait dans un `useState` du fil. Elle ne pouvait donc apprendre
 * qu'une chose : « un titre vient d'atterrir ». Le bug qui en découlait était
 * visible et incompréhensible de l'extérieur : on garde un titre, il se pose
 * dans la trace ; on va dans ses gardés, on le retire ; **il est toujours dans
 * la trace**, et il y reste jusqu'à la fermeture de l'application. On avait
 * donc une pile qui prétendait montrer ce qu'on avait gardé et qui montrait
 * autre chose.
 *
 * Trois écrans doivent pouvoir y toucher — le fil qui pose, la bibliothèque
 * qui retire, l'historique qui corrige un geste — et deux d'entre eux ne sont
 * même pas montés en même temps que le fil. C'est exactement ce à quoi sert un
 * magasin de module : la donnée vit en dehors de l'arbre, chacun s'y adresse
 * sans passer par un parent commun qui n'existe pas.
 *
 * ## Ce qu'elle reste
 *
 * Une trace de **séance**, pas un score : le magasin est vidé à chaque
 * démarrage de l'application, comme avant, et personne ne le persiste. Il n'y
 * a rien à défendre, rien qui expire.
 */
export type Garde = {
  id: number;
  cover: string;
};

/** L'instantané rendu à React. Remplacé — jamais muté — à chaque changement :
 *  `useSyncExternalStore` compare les références et ne redessinerait pas. */
let liste: Garde[] = [];

const abonnes = new Set<() => void>();

function publier(suivante: Garde[]): void {
  liste = suivante;
  for (const f of abonnes) f();
}

/** Un titre vient d'atterrir dans la trace.
 *
 * Le même titre gardé deux fois ne l'empile pas deux fois : cela arrive quand
 * un titre revient dans le fil après avoir été retiré des gardés, et deux
 * pochettes identiques côte à côte se lisent comme un bug. */
export function poserDansLaSeance(g: Garde): void {
  if (liste.some((x) => x.id === g.id)) return;
  publier([...liste, g]);
}

/** Ce titre n'est plus gardé — retiré de la bibliothèque, ou geste corrigé.
 *
 * Sans bruit si le titre n'y est pas : l'appelant n'a pas à savoir ce que la
 * trace contient, et la plupart des retraits portent sur des titres gardés
 * lors d'une séance précédente. */
export function retirerDeLaSeance(id: number): void {
  if (!liste.some((x) => x.id === id)) return;
  publier(liste.filter((x) => x.id !== id));
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

export function useGardesSeance(): Garde[] {
  return useSyncExternalStore(abonner, () => liste);
}
