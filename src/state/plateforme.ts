import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Track } from '../api/types';

/**
 * La plateforme d'ecoute de cette personne.
 *
 * Reso ne fait ecouter que trente secondes : le titre entier se joue ailleurs.
 * Savoir ou, c'est la difference entre un lien qui tombe sur la bonne app et
 * un lien qui tombe sur Deezer parce que c'est de la que vient le catalogue.
 *
 * **Range sur le telephone, pas sur le compte.** C'est deliberé : la
 * plateforme dit quelle application est installee *ici*. Quelqu'un qui ouvre
 * Reso sur l'iPhone familial et sur son Android n'y ecoute pas forcement au
 * meme endroit, alors que son gout, lui, est bien le meme des deux cotes.
 *
 * Ce que chaque plateforme permet vraiment est ecrit dans la table ci-dessous,
 * et l'interface n'en promet pas plus.
 *
 * **Importer et ecrire sont deux choses differentes**, et elles ne suivent pas
 * la meme frontiere :
 *
 * | | importer un gout | ajouter aux favoris |
 * |---|---|---|
 * | Spotify | oui, par compte (PKCE) ou par lien de playlist publique | oui (`PUT /me/library`) |
 * | Deezer | oui, **par lien** | non |
 * | YouTube Music | oui, **par lien** (si le serveur a la cle) | non |
 * | Apple Music | non | non |
 * | Aucune | non | non |
 *
 * **L'ecriture reste le privilege de Spotify.** Aucun lien ne permet d'ecrire
 * chez qui que ce soit : pour les autres, « ajouter aux likes » ouvre le titre
 * chez eux — c'est honnete, et c'est un geste de moins que d'aller le chercher
 * a la main.
 *
 * **L'import, lui, a change de mecanique.** Il ne passait que par OAuth, et
 * OAuth est ferme partout ailleurs que chez Spotify : Deezer a suspendu la
 * creation de nouvelles applications, YouTube n'expose aucune bibliotheque, et
 * Apple veut un compte developpeur payant. Mais l'import ne depend pas de
 * l'OAuth — il depend d'avoir un **identifiant**, et les routes Deezer par
 * identifiant sont restées ouvertes. D'ou `'lien'` : on ne demande plus une
 * autorisation, on demande une adresse. Voir `Import.scala` cote moteur.
 *
 * Depuis fevrier 2026, Spotify a de son cote ferme la lecture des playlists
 * qui ne nous appartiennent pas — mais le moteur les lit encore via leur page
 * embed, sans jeton. D'ou le second chemin pour Spotify : quand l'app n'a pas
 * d'identifiant OAuth configure, un lien de playlist publique reste accepte.
 */

const CLE = 'reso.plateforme';

export type IdPlateforme = 'rien' | 'spotify' | 'apple' | 'deezer' | 'ytmusic';

export type Plateforme = {
  id: IdPlateforme;
  nom: string;
  /** Ce qu'elle apporte, dit en une ligne, sans promesse creuse. */
  dit: string;
  /**
   * Comment Reso sait y lire un gout deja constitue.
   *
   * - `'compte'` : une autorisation OAuth, sur le telephone. Spotify seul.
   * - `'lien'` : on colle l'adresse d'un profil ou d'une playlist publique.
   * - `false` : pas d'import du tout.
   *
   * Les deux premieres valeurs ne demandent pas le meme geste, et l'ecran doit
   * savoir lequel proposer — d'ou trois etats plutot qu'un booleen.
   */
  importe: 'compte' | 'lien' | false;
  /** Vrai si Reso sait y ajouter un titre aux favoris sans quitter l'app. */
  ecrit: boolean;
};

export const PLATEFORMES: Plateforme[] = [
  {
    id: 'spotify',
    nom: 'Spotify',
    dit: 'Reso reprend tes écoutes, et y ajoute des titres. Sans compte : colle une playlist.',
    importe: 'compte',
    ecrit: true,
  },
  {
    id: 'apple',
    nom: 'Apple Music',
    dit: 'Les titres s’y ouvriront. Apple ne laisse pas lire ta bibliothèque.',
    importe: false,
    ecrit: false,
  },
  {
    id: 'deezer',
    nom: 'Deezer',
    dit: 'Colle le lien de ton profil : Reso reprend tes artistes. Les titres s’y ouvriront directement.',
    importe: 'lien',
    ecrit: false,
  },
  {
    id: 'ytmusic',
    nom: 'YouTube Music',
    dit: 'Colle le lien d’une playlist publique : Reso en tire tes artistes.',
    importe: 'lien',
    ecrit: false,
  },
  {
    id: 'rien',
    nom: 'Aucune',
    dit: 'Tu choisiras tes artistes à la main, et les titres s’ouvriront sur Deezer.',
    importe: false,
    ecrit: false,
  },
];

export function plateforme(id: IdPlateforme): Plateforme {
  return PLATEFORMES.find((p) => p.id === id) ?? PLATEFORMES[PLATEFORMES.length - 1];
}

/** Lue une fois, gardee en memoire : un ecran de bibliotheque ne peut pas
 *  attendre un aller-retour AsyncStorage pour savoir quel mot ecrire sur un
 *  bouton. */
let courante: IdPlateforme = 'rien';
let chargee = false;

export async function chargerPlateforme(): Promise<IdPlateforme> {
  if (chargee) return courante;
  const v = (await AsyncStorage.getItem(CLE).catch(() => null)) as IdPlateforme | null;
  courante = v && PLATEFORMES.some((p) => p.id === v) ? v : 'rien';
  chargee = true;
  return courante;
}

export function plateformeCourante(): IdPlateforme {
  return courante;
}

export async function reglerPlateforme(id: IdPlateforme): Promise<void> {
  courante = id;
  chargee = true;
  await AsyncStorage.setItem(CLE, id).catch(() => {});
}

/**
 * Ou ouvrir ce titre.
 *
 * Deezer est le seul a recevoir un lien direct : le catalogue vient de chez
 * lui, donc on connait l'identifiant exact. Les autres recoivent une
 * **recherche** sur « titre artiste », parce qu'on n'a aucun identifiant chez
 * eux et qu'un lien fabrique au jugé tomberait sur une page vide une fois sur
 * trois.
 */
export function lienVers(t: Track, id: IdPlateforme = courante): string {
  const q = encodeURIComponent(`${t.title} ${t.artist.name}`);
  switch (id) {
    case 'spotify':
      return `https://open.spotify.com/search/${q}`;
    case 'apple':
      return `https://music.apple.com/search?term=${q}`;
    case 'ytmusic':
      return `https://music.youtube.com/search?q=${q}`;
    case 'deezer':
    case 'rien':
    default:
      return `https://www.deezer.com/track/${t.id}`;
  }
}

/** Le mot a ecrire sur le bouton d'ouverture. */
export function ouSecoute(id: IdPlateforme = courante): string {
  return id === 'rien' ? 'Deezer' : plateforme(id).nom;
}
