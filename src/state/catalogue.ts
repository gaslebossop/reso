import { prisme } from '../api/client';
import type { Artist } from '../api/types';

/**
 * La grille d'artistes de l'amorcage, demandee une seule fois.
 *
 * Elle sert a l'ecran de choix (« Qui ecoutes-tu ? »). Elle coute cher — le
 * moteur interroge six palmares Deezer pour la composer — et l'appel est fait
 * par l'ecran lui-meme au montage : le cache ci-dessous garantit qu'un aller-
 * retour vers la porte du reseau G ou un simple re-render ne repaie jamais
 * ces six palmares.
 *
 * Le cache vit le temps de l'application : ces palmares changent tous les
 * jours, et on ne veut pas les figer sur le disque.
 */
let enCours: Promise<Artist[]> | null = null;

export function artistes(): Promise<Artist[]> {
  if (enCours) return enCours;
  enCours = prisme
    .onboardingArtists()
    .then((r) => r.artists)
    .catch((e) => {
      // Un echec ne doit pas se figer : sans cette remise a zero, une coupure
      // reseau d'une seconde condamnerait l'ecran de choix pour toute la
      // session.
      enCours = null;
      throw e;
    });
  return enCours;
}
