/**
 * Separer le titre de ceux qui jouent dessus.
 *
 * Deezer met les invites **dans le titre** : « No Friends In The Industry
 * (feat. Lil Durk) ». Comme le titre est affiche en gros sur deux lignes
 * maximum, la parenthese tombait systematiquement dans la troncature — les
 * featurings n'apparaissaient donc nulle part dans l'app, alors que la donnee
 * etait la depuis le debut.
 *
 * Ce n'est pas un detail de mise en page : sur beaucoup de titres, l'invite est
 * precisement l'artiste que la personne connait. Le cacher, c'est cacher la
 * raison pour laquelle elle garderait le morceau.
 */

/** `(feat. X)`, `[ft X]`, `(with X)`, `(avec X)` — parenthese ou crochet. */
const PARENTHESE = /\s*[([]\s*(?:feat|ft|featuring|with|avec)\.?\s+([^)\]]+)\s*[)\]]/i;

/** `Titre - feat. X` ou `Titre feat. X`, sans parenthese. */
const SUFFIXE = /\s+(?:[-–—]\s*)?(?:feat|ft|featuring)\.?\s+(.+)$/i;

/** `A, B & C` / `A et B` -> trois noms. */
const SEPARATEURS = /\s*(?:,|&|\bet\b|\band\b)\s*/i;

export type Titre = {
  /** Le titre seul, sans la mention des invites. */
  titre: string;
  /** Les artistes invites, dans l'ordre. Vide s'il n'y en a pas. */
  avec: string[];
};

export function separerTitre(brut: string): Titre {
  const parenthese = brut.match(PARENTHESE);
  if (parenthese) {
    return {
      titre: brut.replace(PARENTHESE, '').trim(),
      avec: noms(parenthese[1]),
    };
  }

  const suffixe = brut.match(SUFFIXE);
  if (suffixe) {
    return {
      titre: brut.replace(SUFFIXE, '').trim(),
      avec: noms(suffixe[1]),
    };
  }

  return { titre: brut.trim(), avec: [] };
}

function noms(liste: string): string[] {
  return liste
    .split(SEPARATEURS)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/**
 * La ligne des interpretes : le principal, puis les invites.
 *
 * Une seule ligne plutot que deux : « Drake » et « avec Lil Durk » disent la
 * meme chose — qui joue — et deux lignes de meme poids sous un titre en donnent
 * trois, ce qui aplatit la carte.
 */
export function ligneInterpretes(principal: string, avec: string[]): string {
  if (avec.length === 0) return principal;
  return `${principal}  ·  avec ${avec.join(', ')}`;
}

/**
 * Le nombre d'abonnes, lisible d'un coup d'oeil.
 *
 * Sert a distinguer le vrai artiste de sa coquille vide dans les resultats de
 * recherche : le catalogue Deezer porte des doublons de distributeurs qui ont
 * quelques dizaines d'abonnes la ou l'original en a des millions.
 *
 * Arrondi volontairement grossier — on compare des ordres de grandeur, pas des
 * chiffres. « 2,4 M » et « 2 412 883 » disent la meme chose ici, et le second
 * demande de compter les rangs.
 */
export function fansLisibles(n: number | undefined): string | null {
  if (n === undefined || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace('.', ',')} M d'abonnés`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)} k abonnés`;
  return `${n} abonné${n > 1 ? 's' : ''}`;
}
