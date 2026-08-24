import { useSyncExternalStore } from 'react';

import { prisme } from '../api/client';

/**
 * Combien de notifications n'ont pas encore ete lues.
 *
 * ## Pourquoi un magasin de module et pas un `useState`
 *
 * Le nombre est affiche a **deux endroits qui ne se connaissent pas** : la
 * pastille sur l'onglet « Gens », visible depuis n'importe quel ecran, et la
 * ligne « Notifications » a l'interieur de cet onglet. Un etat par ecran
 * laisserait la pastille mentir des qu'on lit ses notifications depuis
 * ailleurs — et les onglets ne se demontent jamais, donc elle mentirait
 * jusqu'au redemarrage de l'app. C'est exactement le defaut qu'a connu
 * `useAccount`, et pour la meme raison.
 *
 * `useSyncExternalStore` plutot qu'un tableau d'abonnes ecrit a la main : il
 * garantit l'instantane stable que React exige, ce qui evite l'autre piege
 * deja rencontre ici — un objet reconstruit a chaque rendu qui fait repartir
 * en boucle l'effet qui en depend.
 *
 * ## Ce qui n'est pas fait, et c'est deliberé
 *
 * **Aucun sondage.** Le compte se rafraichit quand un onglet prend le focus,
 * et au retour de l'ecran des notifications. Une app qui interroge le serveur
 * toutes les trente secondes pour afficher une pastille depense de la batterie
 * pour un chiffre que personne ne regarde entre deux gestes.
 */

let nouvelles = 0;
let enCours: Promise<void> | null = null;
/** Quand le compte a ete redemande pour la derniere fois. */
let dernier = 0;

/** En dessous, on ne redemande pas : la barre d'onglets appelle a chaque
 *  bascule, et personne ne recoit une notification entre deux taps. */
const REPOS_MS = 20_000;
const abonnes = new Set<() => void>();

function prevenir(): void {
  for (const f of [...abonnes]) f();
}

function souscrire(f: () => void): () => void {
  abonnes.add(f);
  return () => void abonnes.delete(f);
}

function lire(): number {
  return nouvelles;
}

/** Le nombre non lu, tel qu'il est connu localement. Ne declenche aucun appel. */
export function useNouvellesNotifs(): number {
  return useSyncExternalStore(souscrire, lire, lire);
}

/**
 * Redemande le compte au moteur.
 *
 * **A vol unique**, et **au repos entre deux** : plusieurs onglets peuvent
 * prendre le focus dans la meme milliseconde au demarrage, et la barre
 * d'onglets rappelle a chaque bascule — trois appels concurrents pour un seul
 * chiffre sont trois fois trop, et un appel par tap sur la barre est du bruit.
 *
 * Un echec est ignore volontairement — un compte de notifications n'est pas
 * une information dont l'absence merite un message d'erreur, et l'appelant est
 * en general un effet de focus qui n'a nulle part ou l'afficher.
 */
export function rafraichirNotifs(force = false): Promise<void> {
  if (enCours) return enCours;
  if (!force && Date.now() - dernier < REPOS_MS) return Promise.resolve();
  dernier = Date.now();
  enCours = prisme
    .notifs()
    .then((r) => {
      poser(r.nouvelles);
    })
    .catch(() => {})
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

/** Ecrit le compte connu, sans aller-retour. L'ecran des notifications s'en
 *  sert : il vient de recevoir la liste, il connait deja la reponse. */
export function poser(n: number): void {
  if (n === nouvelles) return;
  nouvelles = n;
  prevenir();
}

/** Tout est lu. Remet a zero tout de suite — la pastille doit disparaitre au
 *  moment ou l'ecran s'ouvre, pas quand le serveur a fini de repondre. */
export async function toutLu(): Promise<void> {
  poser(0);
  await prisme.notifsVues().catch(() => {});
}

/** A la deconnexion : le compte du precedent n'a rien a faire sur l'onglet du
 *  suivant. */
export function oublierNotifs(): void {
  dernier = 0;
  poser(0);
}
