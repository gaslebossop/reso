import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import type { Track } from '../api/types';

/**
 * Import du gout depuis Spotify.
 *
 * Spotify a ferme en novembre 2024 les extraits audio et l'endpoint de
 * recommandation pour toute application nouvelle — c'est pourquoi la musique
 * de Reso vient de Deezer. Restent ouverts les endpoints de **lecture du
 * gout** (`/me/top/artists`, `/me/top/tracks`), et c'est tout ce qu'on veut
 * ici : recuperer les artistes les plus ecoutes pour amorcer le profil en une
 * seconde, au lieu de faire taper huit noms a la main.
 *
 * Le flux est **Authorization Code + PKCE**, sans `client_secret` : un secret
 * embarque dans une application mobile est extractible par n'importe qui, et
 * PKCE existe precisement pour s'en passer.
 *
 * Ce qu'on lit exactement, et pourquoi c'est plus large qu'un simple
 * `me/top/artists`, est detaille au-dessus de `topArtists` plus bas.
 */

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

/**
 * Ce qu'on demande a Spotify.
 *
 * Les trois premieres portees sont en lecture et servent a amorcer le gout.
 * `user-library-modify` est la seule qui ecrit, et elle n'existe que pour un
 * geste explicite : « ajoute ce titre a mes titres likes » depuis l'ecran des
 * gardes. Reso n'ecrit jamais chez Spotify de sa propre initiative.
 */
const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'user-follow-read',
  'user-library-modify',
  // La playlist « Reso ». Privee : c'est un export personnel, pas une
  // publication. `playlist-read-private` est indispensable pour la
  // **retrouver** — sans elle, `GET /me/playlists` ne rend pas les playlists
  // privees, et on en recreerait une a chaque export.
  'playlist-modify-private',
  'playlist-read-private',
];

/** Les portees qu'exige la playlist. Ajoutees apres coup : tout jeton anterieur
 *  est relie sans les avoir, et c'est exactement le cas qui produit un 403 au
 *  milieu d'un export si on ne le verifie pas d'avance. */
const PORTEES_PLAYLIST = ['playlist-modify-private', 'playlist-read-private'];

/**
 * Les jetons Spotify, gardes sur le telephone.
 *
 * Ils ne l'etaient pas : l'autorisation servait a lire le gout une fois, puis
 * le jeton etait perdu avec la fonction qui l'avait obtenu. Ajouter un titre
 * aux favoris des semaines plus tard demande de pouvoir reparler a Spotify
 * sans redemander l'autorisation — d'ou cette conservation, et le
 * renouvellement plus bas.
 */
const CLE_JETONS = 'reso.spotify.tokens';

type Jetons = {
  accessToken: string;
  refreshToken: string | null;
  /** Millisecondes epoch. */
  expiresAt: number;
  /**
   * Les portees **reellement accordees**, telles que Spotify les renvoie.
   *
   * Demander une portee ne suffit pas a l'obtenir : quelqu'un qui avait deja
   * autorise Reso avec un jeu plus etroit peut etre re-autorise sans que
   * l'ecran de consentement reapparaisse, et le jeton qui en sort ne porte
   * alors que les anciennes portees. L'ecriture echoue plus tard en 403, loin
   * de sa cause — d'ou cette verification a la source.
   */
  scope: string;
};

async function lireJetons(): Promise<Jetons | null> {
  const brut = await AsyncStorage.getItem(CLE_JETONS).catch(() => null);
  if (!brut) return null;
  try {
    return JSON.parse(brut) as Jetons;
  } catch {
    return null;
  }
}

async function ecrireJetons(j: Jetons): Promise<void> {
  await AsyncStorage.setItem(CLE_JETONS, JSON.stringify(j)).catch(() => {});
}

export async function oublierSpotify(): Promise<void> {
  await AsyncStorage.removeItem(CLE_JETONS).catch(() => {});
  // La playlist retenue appartenait a cette liaison-la : la garder ferait
  // verser la prochaine connexion dans la playlist d'un autre compte.
  await AsyncStorage.removeItem(CLE_PLAYLIST).catch(() => {});
}

export async function spotifyRelie(): Promise<boolean> {
  return (await lireJetons()) !== null;
}

/**
 * Refait l'autorisation, sans toucher au gout.
 *
 * Indispensable des qu'une portee s'ajoute : le jeton range sur le telephone
 * porte les portees du jour ou il a ete obtenu, et rien ne les elargit apres
 * coup. `show_dialog` force l'ecran de consentement a reapparaitre — sans lui,
 * Spotify re-autorise en silence avec l'ancien jeu et le probleme se reproduit
 * a l'identique.
 *
 * @returns `false` si la personne a ferme la fenetre.
 */
export async function autoriser(): Promise<boolean> {
  return (await echanger(true)) !== null;
}

function versJetons(
  t: AuthSession.TokenResponse,
  secours: string | null,
  scopeSecours = '',
): Jetons {
  return {
    accessToken: t.accessToken,
    // Spotify ne renvoie pas toujours un nouveau jeton de rafraichissement :
    // garder l'ancien est ce qui evite de perdre la liaison au premier
    // renouvellement.
    refreshToken: t.refreshToken ?? secours,
    expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000,
    scope: t.scope ?? scopeSecours,
  };
}

/** La portee sans laquelle « ajouter aux titres likes » ne peut pas marcher. */
const ECRITURE = 'user-library-modify';

/**
 * L'etat de la liaison Spotify, tel qu'un ecran de reglages doit le montrer.
 *
 * `peutEcrire` faux alors que `relie` est vrai est exactement le cas qui
 * produisait un 403 incomprehensible : la liaison existe, mais elle est trop
 * etroite.
 */
export async function etatSpotify(): Promise<{
  relie: boolean;
  peutEcrire: boolean;
  peutPlaylist: boolean;
}> {
  const j = await lireJetons();
  if (!j) return { relie: false, peutEcrire: false, peutPlaylist: false };
  const portees = (j.scope ?? '').split(' ');
  return {
    relie: true,
    peutEcrire: portees.includes(ECRITURE),
    peutPlaylist: PORTEES_PLAYLIST.every((x) => portees.includes(x)),
  };
}

/**
 * Un jeton d'acces valable, ou `null` si la liaison est finie.
 *
 * A vol unique, pour la meme raison que du cote du reseau G : deux
 * renouvellements concurrents avec le meme jeton de rafraichissement en font
 * echouer un, et l'echec vaut deconnexion.
 */
let renouvellement: Promise<string | null> | null = null;

async function jetonValable(): Promise<string | null> {
  const j = await lireJetons();
  if (!j) return null;
  if (Date.now() < j.expiresAt - 60_000) return j.accessToken;
  if (!j.refreshToken) {
    await oublierSpotify();
    return null;
  }
  if (renouvellement) return renouvellement;
  renouvellement = (async () => {
    try {
      const frais = await AuthSession.refreshAsync(
        { clientId: CLIENT_ID, refreshToken: j.refreshToken! },
        discovery,
      );
      // Un renouvellement ne rend pas toujours la portee : reprendre celle du
      // jeton precedent evite de croire la liaison retrecie a chaque heure.
      const suivant = versJetons(frais, j.refreshToken, j.scope);
      await ecrireJetons(suivant);
      return suivant.accessToken;
    } catch {
      await oublierSpotify();
      return null;
    }
  })().finally(() => {
    renouvellement = null;
  });
  return renouvellement;
}

export type SpotifyTaste = {
  /** Artistes du plus au moins ecoute — l'ordre porte le poids cote moteur. */
  artists: string[];
};

/**
 * **Les genres de Spotify sont vides. Ne rebatis pas l'ecran des styles ici.**
 *
 * Il l'a ete, sur le champ `genres` de l'objet artiste : gratuit en apparence,
 * puisque `me/top/artists` et `me/following` le rendaient deja. Mesure sur un
 * vrai compte le 2026-08-23, en instrumentant l'import :
 *
 *     [spotify] styles : 0/45 artistes ont un genre, 0 genres distincts
 *
 * Le champ n'a pas ete supprime de l'API — il ne figure pas dans la liste des
 * champs retires en fevrier 2026, qui pour l'artiste ne compte que `followers`
 * et `popularity`. Spotify a **vide son contenu** : tableau vide pour tout le
 * monde. Plusieurs developpeurs signalent la meme chose depuis 2025.
 *
 * Le calcul vit donc cote moteur, sur les genres **Deezer** des ancres
 * (`GET /taste/styles/suggestions`). Bonus qui n'etait pas cherche : il couvre
 * aussi les imports Deezer et YouTube, que ce chemin-ci laissait dehors.
 */

export function isSpotifyConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

/**
 * L'URI de redirection attendue par Spotify.
 *
 * Elle **change selon le contexte d'execution** : dans Expo Go elle vaut
 * quelque chose comme `exp://192.168.1.41:8081/--/callback`, alors qu'une
 * application compilee utilise `reso://callback`. Spotify n'accepte que des
 * URIs declarees au caractere pres dans son tableau de bord : les deux doivent
 * y figurer, sinon l'autorisation echoue avec `INVALID_CLIENT`.
 */
export function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'reso', path: 'callback' });
}

export class SpotifyError extends Error {}

/**
 * Rend les artistes les plus ecoutes, en ouvrant l'autorisation s'il le faut.
 *
 * **Une liaison deja posee suffit.** L'import demandait systematiquement une
 * nouvelle autorisation : sans consequence au demarrage, ou personne n'est
 * encore relie, mais absurde depuis les reglages d'un compte qui l'est depuis
 * des mois — on lui reclamait sa permission pour une permission qu'il avait
 * deja donnee. Le jeton range sur le telephone est utilise tel quel, et
 * renouvelle tout seul s'il a expire.
 *
 * @returns `null` si la personne a annule — ce n'est pas une erreur.
 */
export async function importTaste(): Promise<SpotifyTaste | null> {
  if (!CLIENT_ID) {
    throw new SpotifyError(
      "Aucun identifiant Spotify : renseigne EXPO_PUBLIC_SPOTIFY_CLIENT_ID dans .env",
    );
  }

  const dispo = await jetonValable();
  if (dispo) return topArtists(dispo);

  const token = await echanger(false);
  if (!token) return null;
  return topArtists(token.accessToken);
}

/**
 * Le va-et-vient d'autorisation, et le rangement du jeton.
 *
 * @param forcerConsentement rejoue l'ecran de consentement meme si Reso est
 *        deja autorise — le seul moyen d'obtenir une portee ajoutee depuis.
 * @returns `null` si la fenetre a ete fermee. Ce n'est pas une erreur.
 */
async function echanger(forcerConsentement: boolean): Promise<AuthSession.TokenResponse | null> {
  if (!CLIENT_ID) {
    throw new SpotifyError(
      "Aucun identifiant Spotify : renseigne EXPO_PUBLIC_SPOTIFY_CLIENT_ID dans .env",
    );
  }

  const uri = redirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    scopes: SCOPES,
    redirectUri: uri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: forcerConsentement ? { show_dialog: 'true' } : undefined,
  });

  const result = await request.promptAsync(discovery);
  if (result.type === 'dismiss' || result.type === 'cancel') return null;
  if (result.type !== 'success') {
    throw new SpotifyError(describe(result, uri));
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: CLIENT_ID,
      code: result.params.code,
      redirectUri: uri,
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
    },
    discovery,
  );

  await ecrireJetons(versJetons(token, null));
  // Ce que Spotify a REELLEMENT accorde. C'est la ligne qui aurait fait gagner
  // le diagnostic du 403 : demander quatre portees et en recevoir deux ne
  // produit aucune erreur au moment de la connexion.
  console.log(`[spotify] portees accordees : ${token.scope ?? '(aucune annoncee)'}`);
  return token;
}

/**
 * Ajoute un titre aux « Titres likes » de Spotify.
 *
 * Le pont entre les deux catalogues est l'**ISRC** : c'est le seul
 * identifiant qu'un titre porte chez tout le monde, et Deezer le donne. Une
 * recherche par titre et artiste sert de secours, mais elle se trompe — les
 * reeditions, les versions live et les albums « deluxe » portent le meme nom
 * sans etre le meme enregistrement.
 *
 * L'ecriture passe par `PUT /me/library` : voir le commentaire a l'interieur,
 * `/me/tracks` a ete supprime et son 403 ne dit pas pourquoi.
 *
 * @returns `false` si la liaison Spotify est finie — l'appelant propose alors
 *          de la refaire, plutot que d'echouer en silence.
 */
export async function ajouterAuxLikes(t: Track): Promise<boolean> {
  const { relie, peutEcrire } = await etatSpotify();
  if (!relie) return false;
  if (!peutEcrire) {
    // Diagnostique avant d'appeler : sinon Spotify rend un 403 nu, qui
    // ressemble a s'y meprendre a un refus de compte.
    throw new SpotifyError(
      "Reso n'a pas la permission d'ecrire chez Spotify. Reconnecte Spotify " +
        'depuis les reglages : cette permission a ete ajoutee apres ta connexion.',
    );
  }

  const token = await jetonValable();
  if (!token) return false;

  const id = await trouverChezSpotify(token, t);
  if (!id) throw new SpotifyError(`« ${t.title} » est introuvable dans le catalogue Spotify.`);

  // `PUT /me/library`, et surtout **pas** `PUT /me/tracks`.
  //
  // Spotify a supprime les points d'entree par type — `/me/tracks`,
  // `/me/albums`, `/me/episodes`… — en fevrier 2026, au profit d'un seul
  // `/me/library` qui prend des URI Spotify. Le piege est que l'ancien ne
  // repond pas 404 ni 410 : il rend **403 Forbidden**, exactement comme un
  // refus de permission. On a donc cherche du cote des portees et du
  // « Development mode » un probleme qui n'y etait pas — la portee
  // `user-library-modify` etait bien accordee, et le journal le montrait.
  //
  // La forme est imposee : URI complete en parametre d'URL, 40 au maximum.
  const uri = encodeURIComponent(`spotify:track:${id}`);
  const res = await fetch(`https://api.spotify.com/v1/me/library?uris=${uri}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    await oublierSpotify();
    return false;
  }
  if (!res.ok) {
    // Spotify joint toujours un motif ; le taire laissait « 403 » tout seul a
    // l'ecran, ce qui ne permet de corriger quoi que ce soit.
    // Le corps entier, pas seulement `error.message` : c'est la seule facon
    // de distinguer un refus de portee d'un refus de compte, et les deux
    // s'ecrivent « Forbidden ».
    // Le corps entier, pas seulement `error.message` : c'est ce qui manquait
    // pour distinguer un refus de portee d'un point d'entree disparu.
    const brut = await res.text().catch(() => '');
    console.log(`[spotify] PUT /me/library -> ${res.status} ${brut}`);
    if (res.status === 403) {
      throw new SpotifyError(
        "Spotify refuse l'ajout alors que la permission est accordee. Si " +
          "l'application est en « Development mode », ce compte doit figurer " +
          'dans Settings > User Management.',
      );
    }
    throw new SpotifyError(`Spotify a refuse l'ajout (${res.status})`);
  }
  return true;
}

/**
 * Ce que Spotify autorise vraiment, endpoint par endpoint.
 *
 * Un `403 Forbidden` sur une ecriture alors que la portee est accordee n'a que
 * deux causes possibles, et elles demandent deux corrections opposees :
 *
 *  - **l'application est en « Development mode »** et ce compte n'est pas
 *    inscrit dans Settings > User Management. La lecture privee echoue alors
 *    elle aussi ;
 *  - **la requete elle-meme est refusee** alors que le compte est autorise :
 *    la lecture privee, elle, passe.
 *
 * Une lecture privee suffit donc a trancher, et c'est tout ce que fait ce
 * diagnostic : il n'ecrit rien.
 */
export async function diagnostiquer(): Promise<string> {
  const j = await lireJetons();
  if (!j) return 'Aucune liaison Spotify.';

  const token = await jetonValable();
  if (!token) return 'La liaison Spotify a expiré. Reconnecte-toi.';

  const lignes: string[] = [];
  lignes.push(`Permissions : ${j.scope || '(aucune annoncée)'}`);

  const essai = async (nom: string, chemin: string) => {
    try {
      const res = await fetch(`https://api.spotify.com/v1/${chemin}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const brut = res.ok ? '' : ` — ${(await res.text().catch(() => '')).slice(0, 120)}`;
      lignes.push(`${nom} : ${res.status}${brut}`);
      return res.ok;
    } catch {
      lignes.push(`${nom} : injoignable`);
      return false;
    }
  };

  // `me` marche meme sans allowlist ; la bibliotheque est une lecture privee,
  // donc le vrai revelateur du « Development mode ».
  //
  // `me/tracks` a ete supprime en meme temps que `PUT /me/tracks` : c'est
  // `me/library` qui l'a remplace, pour la lecture comme pour l'ecriture.
  await essai('Profil (me)', 'me');
  const priveOk = await essai('Bibliothèque (lecture privée)', 'me/library?limit=1');
  await essai(
    'Point d’entrée d’écriture',
    'me/library/contains?uris=spotify%3Atrack%3A7a3LWj5xSFhFRYmztS8wgK',
  );

  lignes.push(
    priveOk
      ? "Lecture privée acceptée : ton compte est bien autorisé sur l'application. Le refus d'écriture vient d'ailleurs."
      : "Lecture privée refusée : ton compte n'est pas autorisé sur l'application. Ajoute-le dans le tableau de bord Spotify, Settings > User Management.",
  );

  const texte = lignes.join('\n');
  console.log(`[spotify] diagnostic\n${texte}`);
  return texte;
}

/** L'identifiant Spotify du meme enregistrement, par ISRC puis par nom. */
async function trouverChezSpotify(token: string, t: Track): Promise<string | null> {
  const requetes = [
    t.isrc ? `isrc:${t.isrc}` : null,
    `track:${t.title} artist:${t.artist.name}`,
  ].filter(Boolean) as string[];

  for (const q of requetes) {
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const j = (await res.json()) as { tracks?: { items?: { id?: string }[] } };
    const id = j.tracks?.items?.[0]?.id;
    if (id) return id;
  }
  return null;
}

/**
 * Ce que l'on prend chez Spotify.
 *
 * L'import ne lisait que deux listes d'artistes (20 + 30 noms). C'est peu, et
 * surtout c'est biaise : `me/top/artists` ne retient qu'un artiste ecoute
 * regulierement en album. Quelqu'un dont l'ecoute passe par des playlists a un
 * « top artists » maigre alors que son « top tracks » est riche — et les deux
 * decrivent le meme gout.
 *
 * On lit donc **six sources** :
 *
 * | Source | Ce qu'elle dit |
 * |---|---|
 * | top artists, 4 semaines | ce qui tourne en ce moment |
 * | top artists, 6 mois | le gout installe |
 * | top artists, tout l'historique | le socle, ce qu'on ecoute depuis toujours |
 * | top tracks, 4 semaines | les artistes croises en playlist, invisibles au-dessus |
 * | top tracks, 6 mois | idem, sur la duree |
 * | ecoutes recentes | les derniers jours, avec les repetitions qui comptent |
 *
 * Puis on les **fusionne par score** plutot que de les concatener. Un artiste
 * present dans plusieurs sources doit passer devant un artiste premier d'une
 * seule : la concatenation, elle, gardait betement l'ordre de la premiere
 * liste ou le nom apparaissait.
 */

/** Combien de noms on envoie au moteur.
 *
 * Le profil plafonne a 60 ancres cote Prisme (`Tuning.MaxAnchors`), et chaque
 * nom coute une recherche Deezer a la resolution. Au-dela de 45, on paie de
 * l'attente pour des artistes qui seront ecartes. */
const MAX_ANCRES = 45;

/** Poids d'une source dans le score final.
 *
 * Le recent pese plus que l'ancien parce que le premier fil doit ressembler a
 * ce qu'on ecoute maintenant. Les artistes tires des titres pesent moins que
 * les artistes declares tels : un titre peut avoir ete ecoute pour lui-meme.
 */
const SOURCES = [
  { chemin: 'me/top/artists?limit=50&time_range=short_term', poids: 1.0, via: 'artistes' },
  { chemin: 'me/top/artists?limit=50&time_range=medium_term', poids: 0.8, via: 'artistes' },
  { chemin: 'me/top/artists?limit=50&time_range=long_term', poids: 0.5, via: 'artistes' },
  { chemin: 'me/top/tracks?limit=50&time_range=short_term', poids: 0.6, via: 'titres' },
  { chemin: 'me/top/tracks?limit=50&time_range=medium_term', poids: 0.45, via: 'titres' },
  { chemin: 'me/player/recently-played?limit=50', poids: 0.7, via: 'ecoutes' },
  { chemin: 'me/library?type=track&limit=50', poids: 0.85, via: 'likes' },
  { chemin: 'me/following?type=artist&limit=50', poids: 0.35, via: 'suivis' },
  // Les playlists. Elles manquaient, et c'est la source la plus riche apres
  // les likes : quelqu'un qui range sa musique en playlists y met des annees
  // d'ecoute que `top` (quatre semaines a six mois) ne voit pas du tout.
  { chemin: 'me/playlists?limit=50', poids: 0.7, via: 'playlists' },
  // Les albums enregistres. Geste rare, donc peu d'entrees, mais tres
  // deliberatif : on ne garde pas un album entier par hasard.
  { chemin: 'me/albums?limit=50', poids: 0.5, via: 'albums' },
] as const;

/** La demi-vie d'un titre like, en jours. Voir `Import.fraicheur` cote Prisme,
 * qui applique la meme forme aux likes Deezer : les deux imports doivent
 * classer pareil, sinon le fil de depart depend de la plateforme d'origine. */
const DEMI_VIE_JOURS = 548;

/** Ce qu'un like tres ancien pese encore. Sans plancher, le socle disparait
 * derriere le coup de tete de la semaine. */
const PLANCHER_FRAICHEUR = 0.25;

/** Le poids d'un like selon son age. Sans date lisible, poids plein.
 *
 * Quand toutes les dates sont les memes — une bibliotheque importee d'un bloc
 * — tous les poids le sont aussi, et le classement retombe exactement sur le
 * comptage d'occurrences. Il n'y a donc pas de cas degenere a detecter. */
function fraicheur(ajouteLe: string | undefined, maintenant: number): number {
  if (!ajouteLe) return 1;
  const t = Date.parse(ajouteLe);
  if (!Number.isFinite(t)) return 1;
  const jours = Math.max(0, (maintenant - t) / 86_400_000);
  return PLANCHER_FRAICHEUR + (1 - PLANCHER_FRAICHEUR) * Math.pow(2, -jours / DEMI_VIE_JOURS);
}

/** Un garde-fou, pas une limite de lecture : **on lit toute la bibliotheque**.
 *
 * La pagination s'arrete d'elle-meme quand Spotify ne rend plus de `next` ;
 * ce plafond n'existe que pour qu'une reponse anormale ne fasse pas tourner la
 * boucle sans fin. A cinquante titres par page, dix mille likes coutent deux
 * cents appels — au-dela, personne.
 *
 * Ce que lire tout change vraiment : le nombre d'ancres reste plafonne a
 * `MAX_ANCRES`, donc la lecture profonde ne rajoute pas d'artistes — elle
 * decide **lesquels** des quarante-cinq gagnent. Un artiste avec quarante
 * likes disperses ne se voyait pas dans les cinquante premiers ; il se voit
 * maintenant. */
const PLAFOND_LIKES = 10_000;

/** Les points d'entree qui peuvent rendre les titres likes, dans l'ordre.
 *
 * Il en faut plusieurs parce que la documentation de Spotify se contredit.
 * `GET /me/tracks` est liste parmi les points d'entree **supprimes** par le
 * changelog de fevrier 2026, mais sa page de reference existe toujours et le
 * decrit comme vivant. Le changelog, lui, annonce `/me/library` sans
 * documenter sa lecture.
 *
 * Deviner lequel est le bon a deja coute une session : on essaie, dans
 * l'ordre du plus probable, et **on garde le premier qui rend des entrees**.
 * Chaque tentative est journalisee avec son code, donc le jour ou Spotify
 * change encore, la console le dit au lieu de rendre une liste vide. */
const CHEMINS_LIKES = [
  'me/library?type=track&limit=50',
  'me/library?limit=50',
  'me/tracks?limit=50',
];

/** Meme regle que pour les likes : on prend tout, ceci n'est qu'un garde-fou.
 *
 * Tronquer serait ici particulierement mauvais : `me/following` rend les
 * artistes **par ordre alphabetique**, donc une coupe donnerait un gout qui
 * commence par A. */
const PLAFOND_SUIVIS = 5_000;

/** Combien de playlists on ouvre, et jusqu'ou.
 *
 * Ici le plafond n'est pas un garde-fou, il **mord** : chaque playlist coute
 * au moins un appel de plus, et une bibliotheque bien rangee en compte
 * facilement cent. Cinquante playlists de deux cents titres suffisent
 * largement a departager quarante-cinq ancres, et bornent l'import a une
 * poignee de secondes.
 */
const MAX_PLAYLISTS = 50;
const PLAFOND_TITRES_PLAYLIST = 200;

/** Ce que pese une playlist qu'on suit sans l'avoir faite.
 *
 * Elle dit quelque chose — on ne suit pas « Metal Essentials » par hasard —
 * mais elle a ete remplie par quelqu'un d'autre, souvent par un editeur, et
 * elle contient donc des artistes qu'on n'a jamais choisis. Moitie moins
 * qu'une playlist qu'on a faite soi-meme.
 */
const POIDS_PLAYLIST_SUIVIE = 0.5;

type Via = (typeof SOURCES)[number]['via'];

/** Un nom d'artiste et ce qu'il pese **dans sa source**. Le poids de la source
 * elle-meme est applique par-dessus, dans `topArtists`. */
type Pesee = { nom: string; poids: number; genres?: string[] };

/** L'amortissement par rang, pour les sources qui sont des classements.
 *
 * Le 1er d'une liste pese environ le double du 20e, sans que la queue tombe a
 * zero. Meme forme que la ponderation par rang cote moteur. */
const parRang = (rang: number) => 1 / Math.log2(2 + rang);

/**
 * Les artistes les plus ecoutes, toutes sources confondues.
 *
 * Chaque source est lue en parallele et **echoue seule** : `long_term` est
 * vide sur un compte neuf, et `recently-played` peut manquer sa permission
 * sans que cela doive faire perdre les cinq autres.
 */
async function topArtists(accessToken: string): Promise<SpotifyTaste> {
  const lots = await Promise.allSettled(
    SOURCES.map((s) => lire(accessToken, s.chemin, s.via).then((noms) => ({ noms, poids: s.poids }))),
  );

  // Une source qui echoue ne doit plus disparaitre sans bruit : c'est ce
  // silence qui a fait chercher le probleme cote moteur alors qu'il etait ici.
  lots.forEach((l, i) => {
    const src = SOURCES[i].chemin;
    if (l.status === 'fulfilled') console.log(`[spotify] ${src} -> ${l.value.noms.length} artistes`);
    else console.log(`[spotify] ${src} -> ECHEC : ${(l.reason as Error)?.message ?? l.reason}`);
  });

  const retenus = lots.filter((l) => l.status === 'fulfilled').map((l) => l.value);
  if (retenus.length === 0) {
    // Les six ont echoue : la premiere erreur est la vraie, on la relaie.
    const premier = lots[0];
    if (premier.status === 'rejected') throw premier.reason;
    throw new SpotifyError("Spotify n'a rien renvoye.");
  }

  const score = new Map<string, { nom: string; points: number; genres: Set<string> }>();
  for (const { noms, poids } of retenus) {
    // **Chaque source est ramenee a la meme masse avant d'etre ponderee.**
    //
    // Sans ca, le tableau des poids ci-dessus est un mensonge : les sources
    // `top` rendent cinquante entrees, les titres likes en rendent un millier,
    // et une somme brute laisse les likes ecraser tout le reste. Mesure reelle
    // sur un compte : 1087 likes, donc un artiste a trente titres pesait ~12
    // points quand le premier des `top artists` en pesait 1. Les sept autres
    // sources ne servaient plus a rien.
    //
    // En normalisant, `poids` redevient ce qu'il pretend etre : la part de
    // voix d'une source dans le classement final, quelle que soit sa longueur.
    const masse = noms.reduce((t, x) => t + x.poids, 0);
    if (masse <= 0) continue;

    noms.forEach(({ nom, poids: interne, genres: g }) => {
      // Deux amortissements, selon ce que la source sait dire : le rang pour
      // un classement, la date pour des titres likes. Chaque source rend deja
      // le sien ; ici on le normalise, puis on applique le poids de la source.
      const points = (poids * interne) / masse;
      const cle = nom.toLowerCase();
      const vu = score.get(cle);
      // On cumule : un artiste present dans quatre sources doit passer devant
      // le premier d'une seule. C'est tout l'interet de croiser les sources.
      if (vu) {
        vu.points += points;
        // Les genres s'unissent au lieu de s'ecraser : le meme artiste est vu
        // par plusieurs sources, et une seule d'entre elles peut les porter.
        for (const x of g ?? []) vu.genres.add(x);
      } else {
        score.set(cle, { nom, points, genres: new Set(g ?? []) });
      }
    });
  }

  return {
    artists: [...score.values()]
      .sort((a, b) => b.points - a.points)
      .slice(0, MAX_ANCRES)
      .map((x) => x.nom),
  };
}


type Page = {
  items?: {
    id?: string;
    name?: string;
    genres?: string[];
    added_at?: string;
    artists?: { name?: string }[];
    track?: { artists?: { name?: string }[] };
    // Emballage de la bibliotheque generique, qui melange les types.
    item?: { artists?: { name?: string }[] };
    // `me/albums` : l'artiste est sur l'album, pas sur l'entree.
    album?: { artists?: { name?: string }[] };
    // `me/playlists` : de qui elle est, et combien elle porte. Une playlist
    // vide ne vaut pas un appel.
    owner?: { id?: string };
    tracks?: { total?: number };
  }[];
  next?: string | null;
  // Certains points d'entree enveloppent la page dans `tracks`.
  tracks?: { items?: Page['items']; next?: string | null };
  // `me/following` enveloppe sa page dans `artists`, et pagine au curseur.
  artists?: {
    items?: { name?: string; genres?: string[] }[];
    next?: string | null;
    cursors?: { after?: string | null };
  };
};

/** Un appel a l'API, avec les deux erreurs qui se disent autrement qu'un code. */
async function appel(accessToken: string, chemin: string): Promise<Page> {
  const res = await fetch(`https://api.spotify.com/v1/${chemin}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 403) {
    // Piege classique : une application Spotify neuve est en « Development
    // mode » et n'autorise que les comptes inscrits a la main dans son
    // tableau de bord, sous User Management.
    throw new SpotifyError(
      "Ce compte Spotify n'est pas autorise sur l'application. Ajoute-le dans " +
        'le tableau de bord Spotify, section User Management.',
    );
  }
  if (!res.ok) throw new SpotifyError(`Spotify a repondu ${res.status} sur ${chemin}`);
  return (await res.json()) as Page;
}

/** Comme `appel`, mais rend le code au lieu de jeter : c'est ce qui permet
 * d'essayer un point d'entree et de passer au suivant. */
async function sonder(accessToken: string, chemin: string): Promise<{ code: number; page: Page | null }> {
  try {
    const res = await fetch(`https://api.spotify.com/v1/${chemin}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { code: res.status, page: null };
    return { code: res.status, page: (await res.json()) as Page };
  } catch {
    return { code: 0, page: null };
  }
}

/** Les entrees d'une page, quel que soit l'emballage. */
function entrees(page: Page | null): NonNullable<Page['items']> {
  if (!page) return [];
  return page.items ?? page.tracks?.items ?? [];
}

/** L'artiste principal d'une entree de bibliotheque.
 *
 * Trois emballages possibles selon le point d'entree : `track` (ancien
 * `me/tracks`), `item` (bibliotheque generique, qui melange les types) ou
 * l'objet a plat. On ne devine pas lequel, on les essaie. */
function artisteDeLike(it: NonNullable<Page['items']>[number]): string {
  return (
    it.track?.artists?.[0]?.name ??
    it.item?.artists?.[0]?.name ??
    it.artists?.[0]?.name ??
    ''
  );
}

/** Lit une source et en tire des artistes peses, quelle que soit sa forme.
 *
 * Chaque source echoue seule, plus haut dans `topArtists` : si Spotify
 * retirait `GET me/tracks` comme il a retire `PUT /me/tracks`, l'import
 * perdrait les likes et garderait les sept autres sources. */
async function lire(accessToken: string, chemin: string, via: Via): Promise<Pesee[]> {
  switch (via) {
    case 'likes':
      return likes(accessToken, chemin);
    case 'suivis':
      return suivis(accessToken, chemin);
    case 'playlists':
      return playlists(accessToken, chemin);
    case 'albums':
      return albums(accessToken, chemin);
    default: {
      const items = (await appel(accessToken, chemin)).items ?? [];
      // Seules les sources qui rendent des **objets artiste** portent des
      // genres : Spotify les attache a l'artiste, jamais au titre. C'est ce
      // qui rend l'ecran des styles gratuit — aucun appel de plus.
      const genres = via === 'artistes' ? items.map((a) => a.genres ?? []) : [];
      const noms =
        via === 'artistes'
          ? items.map((a) => a.name ?? '')
          : via === 'titres'
            ? // Le premier artiste credite seulement : sur un featuring, le
              // second est un invite, pas une preference.
              items.map((t) => t.artists?.[0]?.name ?? '')
            : // `recently-played` repete le meme titre autant de fois qu'il a
              // ete joue. On garde ces repetitions : trois ecoutes du meme
              // artiste en deux jours sont un signal.
              items.map((e) => e.track?.artists?.[0]?.name ?? '');
      return noms
        .map((nom, rang) => ({ nom, poids: parRang(rang), genres: genres[rang] }))
        .filter((x) => x.nom.length > 0);
    }
  }
}

/** Les titres likes, peses par la date du like.
 *
 * C'est la source que l'import n'avait pas, et celle qui porte le plus
 * d'information : liker est un geste courant — donc nombreux — **et** date,
 * ce qu'aucun `top` ne dit. Un artiste represente par six likes de 2022 doit
 * passer derriere un artiste represente par trois likes du mois dernier. */
async function likes(accessToken: string, premier: string): Promise<Pesee[]> {
  // Le chemin annonce dans SOURCES passe en tete, les secours derriere.
  const candidats = [premier, ...CHEMINS_LIKES.filter((c) => c !== premier)];

  for (const depart of candidats) {
    const { code, page } = await sonder(accessToken, depart);
    const premieres = entrees(page);
    const nommees = premieres.filter((it) => artisteDeLike(it).length > 0);
    console.log(
      `[spotify] likes via ${depart} -> ${code}, ${premieres.length} entrees, ${nommees.length} avec artiste`,
    );
    if (nommees.length === 0) continue;
    return paginerLikes(accessToken, page as Page);
  }

  console.log(
    '[spotify] aucun point d entree ne rend les titres likes — ' +
      'ni me/library ni me/tracks. Les autres sources restent.',
  );
  return [];
}

/** Deroule la pagination a partir de la page qui a marche. */
async function paginerLikes(accessToken: string, premiere: Page): Promise<Pesee[]> {
  const maintenant = Date.now();
  const sortie: Pesee[] = [];
  let page: Page | null = premiere;
  let lus = 0;

  while (page && lus < PLAFOND_LIKES) {
    const items = entrees(page);
    lus += items.length;
    for (const it of items) {
      const nom = artisteDeLike(it);
      if (nom) sortie.push({ nom, poids: fraicheur(it.added_at, maintenant) });
    }
    // On suit le `next` de Spotify au lieu de recalculer un offset : c'est lui
    // qui sait ou il en est.
    const suite: string | null = items.length > 0 ? relatif(page.next ?? page.tracks?.next) : null;
    page = suite ? (await sonder(accessToken, suite)).page : null;
  }

  console.log(`[spotify] ${lus} titres likes lus, ${sortie.length} artistes retenus`);
  return sortie;
}

/** Le `next` de Spotify est une URL absolue ; `appel` attend un chemin. */
function relatif(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf('/v1/');
  return i === -1 ? null : url.slice(i + 4);
}

/** Les artistes suivis, tous du meme poids.
 *
 * Suivre est un geste **delibere mais non date** : Spotify ne dit pas quand.
 * On ne peut donc ni les classer entre eux, ni les amortir — d'ou le poids
 * plat, compense par un poids de source faible. Les amortir par rang serait
 * pire que plat : l'ordre rendu est alphabetique, pas un gout. */
async function suivis(accessToken: string, chemin: string): Promise<Pesee[]> {
  const sortie: Pesee[] = [];
  let url: string | null = chemin;
  let premier = true;

  while (url && sortie.length < PLAFOND_SUIVIS) {
    const { code, page }: { code: number; page: Page | null } = await sonder(accessToken, url);
    // `me/following` figure aussi parmi les points d'entree remanies en
    // fevrier 2026 : s'il a disparu, on veut le lire dans la console, pas le
    // deduire d'une liste courte.
    if (premier) {
      console.log(`[spotify] suivis via ${url} -> ${code}, ${page?.artists?.items?.length ?? 0} artistes`);
      premier = false;
    }
    if (!page) break;

    const items = page.artists?.items ?? page.items ?? [];
    for (const a of items) if (a.name) sortie.push({ nom: a.name, poids: 1, genres: a.genres ?? [] });

    const apres = page.artists?.cursors?.after;
    url = items.length > 0 && apres ? `${chemin}&after=${encodeURIComponent(apres)}` : null;
  }

  return sortie;
}

/** Les artistes des playlists, peses par la date d'ajout de chaque titre.
 *
 * **C'est la source qui manquait**, et elle ne se lit pas comme les autres :
 * `me/playlists` ne rend que des couvertures et des noms. Il faut ouvrir
 * chaque playlist pour savoir ce qu'il y a dedans, donc un appel par playlist
 * au minimum — d'ou les plafonds, qui mordent vraiment ici.
 *
 * **La playlist « Reso » est ecartee, et ce n'est pas un detail.** C'est nous
 * qui l'ecrivons, a partir des titres gardes dans le fil ; la relire ferait
 * du gout une boucle qui se recopie et se renforce elle-meme a chaque import.
 *
 * Une playlist qu'on suit sans l'avoir faite compte moitie moins : elle dit
 * quelque chose, mais son contenu a ete choisi par quelqu'un d'autre.
 */
async function playlists(accessToken: string, chemin: string): Promise<Pesee[]> {
  const maintenant = Date.now();
  const moi = await identifiant(accessToken);

  // 1. La liste des playlists.
  const listes: { id: string; nom: string; mienne: boolean }[] = [];
  let url: string | null = chemin;
  let premier = true;

  while (url && listes.length < MAX_PLAYLISTS) {
    const { code, page }: { code: number; page: Page | null } = await sonder(accessToken, url);
    if (premier) {
      console.log(`[spotify] playlists via ${url} -> ${code}, ${page?.items?.length ?? 0} listes`);
      premier = false;
    }
    if (!page) break;
    for (const pl of page.items ?? []) {
      if (!pl.id) continue;
      // Une playlist vide ne vaut pas l'appel qu'elle couterait.
      if ((pl.tracks?.total ?? 1) === 0) continue;
      if ((pl.name ?? '').trim().toLowerCase() === NOM_PLAYLIST.toLowerCase()) continue;
      listes.push({
        id: pl.id,
        nom: pl.name ?? pl.id,
        mienne: moi === null || pl.owner?.id === moi,
      });
    }
    url = (page.items ?? []).length > 0 ? relatif(page.next) : null;
  }

  // 2. Le contenu, quelques playlists a la fois.
  //
  // En serie, cinquante playlists font cinquante allers-retours bout a bout et
  // l'import passe la minute ; toutes ensemble, Spotify repond 429. Quatre de
  // front est le compromis qui tient — meme ordre de grandeur que la
  // parallelisation cote moteur.
  const sortie: Pesee[] = [];
  let lus = 0;

  for (let i = 0; i < listes.length; i += 4) {
    const lots = await Promise.all(
      listes.slice(i, i + 4).map(async (pl) => {
        const trouves: Pesee[] = [];
        // `fields` reduit la reponse a ce qu'on lit vraiment : sans lui, chaque
        // page transporte les pochettes, les marches disponibles et les liens
        // externes de cent titres.
        let suite: string | null =
          `playlists/${pl.id}/tracks?limit=100&fields=next,items(added_at,track(artists(name)))`;
        let vus = 0;
        const facteur = pl.mienne ? 1 : POIDS_PLAYLIST_SUIVIE;

        while (suite && vus < PLAFOND_TITRES_PLAYLIST) {
          const { page }: { page: Page | null } = await sonder(accessToken, suite);
          if (!page) break;
          const items = page.items ?? [];
          vus += items.length;
          for (const it of items) {
            const nom = it.track?.artists?.[0]?.name ?? '';
            if (nom) trouves.push({ nom, poids: fraicheur(it.added_at, maintenant) * facteur });
          }
          suite = items.length > 0 ? relatif(page.next) : null;
        }
        return { nom: pl.nom, mienne: pl.mienne, trouves, vus };
      }),
    );
    for (const l of lots) {
      lus += l.vus;
      sortie.push(...l.trouves);
    }
  }

  console.log(
    `[spotify] ${listes.length} playlists ouvertes (${listes.filter((l) => l.mienne).length} a moi), ` +
      `${lus} titres lus, ${sortie.length} artistes retenus`,
  );
  return sortie;
}

/** Les albums enregistres, pesés par la date d'ajout.
 *
 * Peu d'entrees, mais chacune est un geste : garder un album entier demande
 * plus d'intention que liker un titre. */
async function albums(accessToken: string, chemin: string): Promise<Pesee[]> {
  const maintenant = Date.now();
  const sortie: Pesee[] = [];
  let url: string | null = chemin;
  let premier = true;

  while (url && sortie.length < PLAFOND_SUIVIS) {
    const { code, page }: { code: number; page: Page | null } = await sonder(accessToken, url);
    if (premier) {
      console.log(`[spotify] albums via ${url} -> ${code}, ${page?.items?.length ?? 0} albums`);
      premier = false;
    }
    if (!page) break;
    const items = page.items ?? [];
    for (const it of items) {
      const nom = it.album?.artists?.[0]?.name ?? it.artists?.[0]?.name ?? '';
      if (nom) sortie.push({ nom, poids: fraicheur(it.added_at, maintenant) });
    }
    url = items.length > 0 ? relatif(page.next) : null;
  }

  return sortie;
}

/** L'identifiant Spotify de la personne connectee.
 *
 * Sert a distinguer ses playlists de celles qu'elle suit. `null` si l'appel
 * echoue : on considere alors toutes les playlists comme siennes, ce qui est
 * le bon repli — mieux vaut surponderer une playlist editoriale que perdre
 * toutes les vraies.
 */
async function identifiant(accessToken: string): Promise<string | null> {
  const { page } = await sonder(accessToken, 'me');
  return (page as unknown as { id?: string } | null)?.id ?? null;
}

function describe(result: AuthSession.AuthSessionResult, uri: string): string {
  if (result.type === 'error') {
    const code = result.params?.error ?? result.error?.code ?? 'inconnu';
    if (String(code).includes('redirect_uri') || String(code) === 'invalid_client') {
      return `Spotify refuse l'adresse de retour. Ajoute exactement ceci dans le tableau de bord : ${uri}`;
    }
    return `Spotify a refuse la connexion (${code})`;
  }
  return 'La connexion Spotify a echoue';
}


// -- La playlist « Reso » ----------------------------------------------------

/**
 * L'export des gardes vers une playlist Spotify.
 *
 * ## Le piege des chemins, une seconde fois
 *
 * Spotify a **renomme les points d'entree de playlist en fevrier 2026**, dans
 * la meme vague que `PUT /me/tracks` -> `PUT /me/library` documente plus haut :
 *
 * | mort | vivant |
 * |---|---|
 * | `POST /users/{id}/playlists` | `POST /me/playlists` |
 * | `POST /playlists/{id}/tracks` | `POST /playlists/{id}/items` |
 * | `GET /playlists/{id}/tracks` | `GET /playlists/{id}/items` |
 *
 * Les champs de reponse suivent (`tracks` devient `items`). Ecrire contre les
 * anciens chemins ne rend pas 404 mais un code qui ressemble a un refus de
 * permission — c'est ce qui avait fait chercher du cote des portees un
 * probleme qui n'y etait pas.
 *
 * ## Pourquoi la playlist se retrouve au lieu d'etre seulement memorisee
 *
 * Son identifiant est mis en cache, mais il ne fait pas foi : elle peut avoir
 * ete supprimee depuis Spotify, et un ajout sur une playlist disparue rend
 * 404. On repart alors de la recherche par nom, puis de la creation. Sans
 * cela, l'export cessait de marcher **definitivement** le jour ou quelqu'un
 * faisait le menage dans ses playlists.
 */

const NOM_PLAYLIST = 'Reso';
const CLE_PLAYLIST = 'reso.spotify.playlist';

/** Spotify accepte cent URI par appel d'ajout. */
const LOT = 100;

export type Export = {
  /** Combien de titres ont ete ajoutes cette fois-ci. */
  ajoutes: number;
  /** Combien y etaient deja. */
  deja: number;
  /** Ceux que le catalogue Spotify ne connait pas, par leur titre. */
  introuvables: string[];
};

type Reponse = { code: number; corps: any };

async function spotifyJson(token: string, chemin: string, init?: RequestInit): Promise<Reponse> {
  const res = await fetch(`https://api.spotify.com/v1${chemin}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    await oublierSpotify();
    return { code: 401, corps: null };
  }
  const texte = await res.text();
  try {
    return { code: res.status, corps: texte ? JSON.parse(texte) : null };
  } catch {
    return { code: res.status, corps: texte };
  }
}

/** Le motif joint par Spotify, quand il y en a un. Le taire laisse un code nu
 *  a l'ecran, avec lequel on ne peut rien corriger. */
function motif(corps: any): string {
  const m = corps?.error?.message ?? corps?.error_description;
  return typeof m === 'string' ? m : '';
}

/** Le chemin relatif d'une URL de pagination. */
function suite(url: unknown): string | null {
  return typeof url === 'string' ? url.replace('https://api.spotify.com/v1', '') : null;
}

/** L'identifiant de la playlist « Reso », retrouvee ou creee. */
async function playlistReso(token: string, forcerRecherche = false): Promise<string> {
  if (!forcerRecherche) {
    const memo = await AsyncStorage.getItem(CLE_PLAYLIST).catch(() => null);
    if (memo) return memo;
  }

  // La chercher parmi les siennes, par le nom seul : une playlist « Reso »
  // creee a la main est la sienne, et en fabriquer une seconde du meme nom
  // serait le pire des deux mondes.
  let chemin: string | null = '/me/playlists?limit=50';
  while (chemin) {
    const { code, corps }: Reponse = await spotifyJson(token, chemin);
    if (code !== 200 || !corps) break;
    const trouvee = (corps.items ?? []).find(
      (pl: any) => typeof pl?.name === 'string' && pl.name.trim().toLowerCase() === 'reso',
    );
    if (trouvee?.id) {
      await AsyncStorage.setItem(CLE_PLAYLIST, String(trouvee.id)).catch(() => {});
      return String(trouvee.id);
    }
    chemin = suite(corps.next);
  }

  const { code, corps } = await spotifyJson(token, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: NOM_PLAYLIST,
      public: false,
      description: 'Les titres gardés depuis Reso.',
    }),
  });
  if (code === 401) throw new SpotifyError('La liaison Spotify a expiré.');
  if (!corps?.id) {
    throw new SpotifyError(`Spotify a refusé de créer la playlist (${code}). ${motif(corps)}`.trim());
  }
  await AsyncStorage.setItem(CLE_PLAYLIST, String(corps.id)).catch(() => {});
  return String(corps.id);
}

/** Les URI deja dans la playlist, pour ne rien y mettre deux fois. */
async function dejaDedans(token: string, playlist: string): Promise<Set<string>> {
  const vus = new Set<string>();
  let chemin: string | null = `/playlists/${playlist}/items?limit=50`;
  while (chemin) {
    const { code, corps }: Reponse = await spotifyJson(token, chemin);
    if (code !== 200 || !corps) break;
    for (const it of corps.items ?? []) {
      // La forme exacte a bouge avec le renommage : on lit les trois places
      // possibles plutot que de parier sur une.
      const uri = it?.track?.uri ?? it?.item?.uri ?? it?.uri;
      if (typeof uri === 'string') vus.add(uri);
    }
    chemin = suite(corps.next);
  }
  return vus;
}

/** Verse un lot d'URI, en refaisant la playlist si elle a disparu. */
async function verser(token: string, playlist: string, uris: string[]): Promise<string> {
  let cible = playlist;
  for (let essai = 0; essai < 2; essai++) {
    const { code, corps } = await spotifyJson(token, `/playlists/${cible}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris }),
    });
    if (code >= 200 && code < 300) return cible;
    if (code === 404 && essai === 0) {
      await AsyncStorage.removeItem(CLE_PLAYLIST).catch(() => {});
      cible = await playlistReso(token, true);
      continue;
    }
    throw new SpotifyError(`Spotify a refusé l'ajout (${code}). ${motif(corps)}`.trim());
  }
  return cible;
}

/** Le jeton, si et seulement si l'export est possible. Leve avec la raison. */
async function exigerPlaylist(): Promise<string> {
  const { relie, peutPlaylist } = await etatSpotify();
  if (!relie) throw new SpotifyError('Spotify n’est pas relié.');
  if (!peutPlaylist) {
    throw new SpotifyError(
      'Reso n’a pas la permission de gérer tes playlists. Reconnecte Spotify depuis les ' +
        'réglages : cette permission a été ajoutée après ta connexion.',
    );
  }
  const token = await jetonValable();
  if (!token) throw new SpotifyError('La liaison Spotify a expiré.');
  return token;
}

/**
 * Verse toute une liste de gardes dans la playlist « Reso ».
 *
 * **Une recherche par titre, et rien pour y couper.** Le pont entre les deux
 * catalogues est l'ISRC, et Spotify n'offre aucun appel groupe pour le
 * traverser : quatre-vingts gardes valent quatre-vingts recherches. Elles
 * partent par quatre — assez pour que l'attente reste tenable, assez peu pour
 * ne pas se faire brider — et `onAvance` permet de montrer ou on en est plutot
 * que de laisser tourner un rond.
 */
export async function exporterVersPlaylist(
  tracks: Track[],
  onAvance?: (fait: number, total: number) => void,
): Promise<Export> {
  const token = await exigerPlaylist();
  const playlist = await playlistReso(token);
  const presents = await dejaDedans(token, playlist);

  const introuvables: string[] = [];
  const aVerser: string[] = [];
  const retenus = new Set<string>();
  let deja = 0;
  let fait = 0;

  const file = [...tracks];
  const ouvrier = async () => {
    for (;;) {
      const t = file.shift();
      if (!t) return;
      try {
        const id = await trouverChezSpotify(token, t);
        if (!id) introuvables.push(t.title);
        else {
          const uri = `spotify:track:${id}`;
          if (presents.has(uri)) deja++;
          else if (!retenus.has(uri)) {
            retenus.add(uri);
            aVerser.push(uri);
          }
        }
      } catch {
        introuvables.push(t.title);
      } finally {
        onAvance?.(++fait, tracks.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tracks.length) }, ouvrier));

  for (let i = 0; i < aVerser.length; i += LOT) {
    await verser(token, playlist, aVerser.slice(i, i + LOT));
  }

  return { ajoutes: aVerser.length, deja, introuvables };
}

/**
 * Ajoute un seul titre a la playlist.
 *
 * Rend `false` quand Spotify ne connait pas le titre : ce n'est pas une panne,
 * et l'appelant ne doit pas le remettre en file indefiniment.
 */
export async function ajouterAPlaylist(t: Track): Promise<boolean> {
  const token = await exigerPlaylist();
  const id = await trouverChezSpotify(token, t);
  if (!id) return false;
  const playlist = await playlistReso(token);
  await verser(token, playlist, [`spotify:track:${id}`]);
  return true;
}

/** Oublie la playlist retenue. Appelee quand la liaison est rompue : la
 *  prochaine refera sa propre recherche. */
export async function oublierPlaylist(): Promise<void> {
  await AsyncStorage.removeItem(CLE_PLAYLIST).catch(() => {});
}
