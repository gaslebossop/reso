import { prisme } from '../api/client';
import type { Artist } from '../api/types';

/**
 * La grille d'artistes de l'amorcage, demandee une seule fois.
 *
 * Elle sert deux fois : le mur de pochettes de l'ecran d'accueil, puis la
 * grille ou l'on choisit ses artistes. Or elle coute cher — le moteur
 * interroge six palmares Deezer pour la composer. La demander des l'accueil et
 * la garder ici fait que l'ecran de choix est deja rempli quand on y arrive,
 * au lieu d'ouvrir sur un spinner.
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
