import type { Stats } from '../api/types';

/**
 * De la mesure a la phrase.
 *
 * Le moteur rend des nombres bruts ; un ecran qui les recopie tels quels
 * produit un tableau de bord, c'est-a-dire la chose que personne ne lit deux
 * fois. Ce module fait le travail inverse : il ramene chaque mesure a la forme
 * sous laquelle un humain la dirait — « 2 h 47 », « vers 23 h », « 1 titre sur
 * 9 » — et refuse de rendre celles qui reposent sur trop peu de faits.
 *
 * C'est aussi ici que vit la seule chose que le serveur ne pouvait pas faire :
 * **remettre les heures dans le bon fuseau**. Prisme compte en temps universel
 * parce qu'il ignore ou vit le telephone, et se tromper de deux heures sur
 * « tu ecoutes vers minuit » rend la phrase fausse, pas approximative.
 */

/** En dessous, une habitude n'en est pas une : c'est un echantillon. */
const MIN_POUR_UNE_HABITUDE = 12;

/** Largeur du creneau d'ecoute, en heures. Trois : en dessous on decrit une
 *  heure precise, ce qui n'est jamais vrai ; au-dela on decrit une soiree. */
const CRENEAU = 3;

/**
 * Les 24 comptes, remis a l'heure du telephone.
 *
 * `getTimezoneOffset` rend des minutes **a soustraire** de l'heure locale pour
 * obtenir l'heure universelle : Paris en ete vaut -120. L'heure locale d'un
 * compte range en UTC `h` est donc `h - offset/60`.
 */
export function heuresLocales(utc: number[]): number[] {
  if (utc.length !== 24) return utc;
  const decalage = -new Date().getTimezoneOffset() / 60;
  return Array.from({ length: 24 }, (_, h) => {
    const source = (((h - decalage) % 24) + 24) % 24;
    return utc[Math.round(source)] ?? 0;
  });
}

/**
 * Le creneau de trois heures ou l'on ecoute le plus.
 *
 * `null` quand l'histoire est trop courte pour qu'il veuille dire quoi que ce
 * soit, ou quand l'ecoute est trop etalee pour qu'un creneau la resume : une
 * fenetre qui ne rassemble pas au moins un tiers des decisions ne decrit pas
 * une habitude, elle decrit le hasard.
 */
export function creneau(locales: number[], total: number): { debut: number; part: number } | null {
  if (total < MIN_POUR_UNE_HABITUDE) return null;
  let meilleur = 0;
  let somme = 0;
  for (let h = 0; h < 24; h++) {
    // La fenetre passe minuit : le modulo est ce qui permet a « 23 h – 2 h »
    // d'exister, et c'est justement l'horaire d'ecoute le plus frequent.
    let s = 0;
    for (let k = 0; k < CRENEAU; k++) s += locales[(h + k) % 24] ?? 0;
    if (s > somme) {
      somme = s;
      meilleur = h;
    }
  }
  const part = somme / total;
  return part >= 0.33 ? { debut: meilleur, part } : null;
}

/** « 2 h 47 », « 47 min », « 40 s ». */
export function duree(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** « 4,2 s » — un verdict se compte en secondes, avec la decimale, parce que
 *  la difference entre trois et quatre secondes est ce qui se raconte. */
export function secondes(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * « 1 sur 9 ».
 *
 * Un pourcentage serait plus precis et moins parlant : personne ne se
 * represente 11 %, tout le monde se represente un titre sur neuf.
 */
export function proportion(part: number, total: number): string | null {
  if (part <= 0 || total <= 0) return null;
  const un = Math.round(total / part);
  return un <= 1 ? 'presque tous' : `1 sur ${un}`;
}

/** Le creneau ecrit : « entre 23 h et 2 h ». */
export function creneauEcrit(c: { debut: number }): string {
  return `entre ${c.debut} h et ${(c.debut + CRENEAU) % 24} h`;
}

/**
 * Les habitudes, prêtes a etre posees en lignes.
 *
 * Chacune est omise plutot qu'affichee a zero : « 0 titre ecoute en entier »
 * n'apprend rien sur quelqu'un qui vient d'arriver, et remplir un ecran de
 * zeros est la facon la plus sure de le rendre deprimant.
 */
export function habitudes(s: Stats): { label: string; valeur: string }[] {
  const lignes: { label: string; valeur: string }[] = [];

  if (s.skipped > 0) lignes.push({ label: 'Tu tranches en', valeur: secondes(s.verdict_ms) });

  const garde = proportion(s.saved + s.liked, s.judged);
  if (garde) lignes.push({ label: 'Tu retiens', valeur: garde });

  if (s.played_whole > 0) {
    lignes.push({ label: 'Écoutés jusqu’au bout', valeur: String(s.played_whole) });
  }

  const locales = heuresLocales(s.hours_utc);
  const c = creneau(locales, s.judged);
  if (c) lignes.push({ label: 'Surtout', valeur: creneauEcrit(c) });

  if (s.active_days > 1) lignes.push({ label: 'Jours d’écoute', valeur: String(s.active_days) });

  if (s.blocked > 0) lignes.push({ label: 'Artistes bannis', valeur: String(s.blocked) });

  return lignes;
}
