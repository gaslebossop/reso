import type { AuthConfig } from '../auth/gnetwork';
import { accessToken } from '../auth/gnetwork';
import { getDeviceId } from '../state/session';
import type {
  Artist, Card, EventResult, Gen, Me, Notifs, Prefs, Prism, ProfilSocial, Stats, SwipeAction, Track,
} from './types';

/**
 * Client du moteur Prisme.
 *
 * Tout ce que l'app sait d'un utilisateur vient d'ici. Elle ne calcule ni
 * profil, ni score, ni classement : elle envoie ce qui s'est passe et affiche
 * ce qu'on lui rend.
 *
 * L'adresse par defaut vise le moteur deploye. Un poste de developpement la
 * remplace par l'IP de la machine dans `.env` — sur un appareil physique,
 * `localhost` designe le telephone lui-meme.
 */
const BASE = (
  process.env.EXPO_PUBLIC_PRISME_URL ?? 'https://reso.twitninf.duckdns.org'
).replace(/\/+$/, '');

const TIMEOUT_MS = 20000;

/**
 * Au-dela, l'appel est signale comme lent dans la console.
 *
 * Choisi juste au-dessus de ce que coute un rejeu complet de profil sur le
 * moteur deploye : en dessous, tout est normal ; au-dessus, quelque chose
 * merite d'etre regarde.
 */
const LENT_MS = 1500;

/**
 * Trace de chaque appel, avec sa duree.
 *
 * Sans elle, un ecran qui met trente secondes a s'ouvrir ne dit pas **ou**
 * elles sont passees : le moteur peut etre lent, mais l'attente peut aussi
 * venir de l'obtention du jeton, ou d'un premier appel qui expire avant qu'un
 * second reparte. Ces trois causes se ressemblent depuis le telephone et
 * demandent trois corrections differentes.
 *
 * Le temps d'authentification est mesure a part pour cette raison exacte :
 * c'est le seul segment invisible depuis les journaux du serveur.
 */
function tracer(path: string, methode: string, debut: number, authMs: number, issue: string) {
  // Chaque appel de l'app passait ici, y compris en production : des I/O
  // console sur le chemin chaud, pour un journal que personne ne lit hors
  // developpement. Les lenteurs cote moteur se lisent dans prisme.log.
  if (!__DEV__) return;
  const total = Math.round(Date.now() - debut);
  const marque = total >= LENT_MS ? '!! LENT ' : '';
  const auth = authMs >= 50 ? ` (dont ${Math.round(authMs)} ms de jeton)` : '';
  console.log(`[api] ${marque}${methode} ${path} — ${total} ms${auth} — ${issue}`);
}

export class PrismeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /**
     * Le code nomme que le moteur renvoie (`profil_prive`, `injoignable`...).
     *
     * Present seulement quand le moteur en donne un. L'ecran s'en sert pour
     * proposer une suite — pas pour reecrire le message, qui vient deja du
     * serveur et dit quoi faire.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PrismeError';
  }
}

/** Le moteur a repondu « il faut un compte du reseau G pour ceci ». */
export class AccountRequiredError extends PrismeError {
  constructor(readonly config: AuthConfig | null) {
    super('Connecte-toi avec ton compte G pour retrouver ceci partout.', 403);
    this.name = 'AccountRequiredError';
  }
}

/**
 * La configuration d'authentification, telle que le moteur l'annonce.
 *
 * Gardee en memoire pour la duree de l'application : elle ne change qu'au
 * redeploiement du moteur, et la relire a chaque appel ajouterait un
 * aller-retour sur le chemin chaud.
 */
let authConfig: AuthConfig | null = null;

export async function getAuthConfig(): Promise<AuthConfig> {
  if (authConfig) return authConfig;
  authConfig = await call<AuthConfig>('/auth/config', undefined, { anonymous: true });
  return authConfig;
}

type CallOptions = {
  /** N'attache aucun jeton — pour les routes qui n'en veulent pas. */
  anonymous?: boolean;
};

async function call<T>(path: string, init?: RequestInit, opts?: CallOptions): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const debut = Date.now();
  const methode = init?.method ?? 'GET';
  let authMs = 0;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };

    if (!opts?.anonymous) {
      const avantAuth = Date.now();
      const token = await accessToken(() => getAuthConfig().catch(() => null));
      authMs = Date.now() - avantAuth;
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal, headers });
    tracer(path, methode, debut, authMs, String(res.status));

    if (res.status === 403) {
      // Le moteur joint sa configuration d'authentification au refus : l'app
      // peut donc proposer la connexion sans avoir a la connaitre d'avance.
      const body = (await res.json().catch(() => null)) as { auth_config?: AuthConfig } | null;
      if (body?.auth_config) authConfig = body.auth_config;
      throw new AccountRequiredError(body?.auth_config ?? null);
    }

    if (!res.ok) {
      // **Le moteur joint souvent une phrase destinee a l'ecran** (`message`),
      // et la jeter pour n'afficher qu'un code de statut est exactement ce qui
      // a fait chercher le 403 de Spotify du mauvais cote pendant une journee.
      // « Ce profil Deezer est prive » se repare ; « a repondu 400 » non.
      const corps = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      throw new PrismeError(
        corps?.message ?? `${methode} ${path} a repondu ${res.status}`,
        res.status,
        corps?.error,
      );
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof PrismeError) throw e;
    if ((e as Error).name === 'AbortError') {
      tracer(path, methode, debut, authMs, `ABANDON apres ${TIMEOUT_MS / 1000} s`);
      throw new PrismeError(`${path} n'a pas repondu en ${TIMEOUT_MS / 1000} s`);
    }
    tracer(path, methode, debut, authMs, `INJOIGNABLE (${(e as Error).message})`);
    throw new PrismeError(`Prisme est injoignable sur ${BASE}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Un POST au moteur.
 *
 * L'identifiant d'appareil accompagne systematiquement le corps : c'est lui
 * qui porte l'identite quand personne n'est connecte. Quand un jeton est
 * present, le moteur l'ignore — l'identite vient alors du compte, jamais de ce
 * que le corps pretend.
 */
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const deviceId = await getDeviceId();
  return call<T>(path, { method: 'POST', body: JSON.stringify({ device_id: deviceId, ...body }) });
}

export const prisme = {
  baseUrl: BASE,

  health: () =>
    call<{ status: string; base: string; cache: string; g_auth: boolean }>('/health', undefined, {
      anonymous: true,
    }),

  authConfig: getAuthConfig,

  /** Qui le moteur croit que je suis. */
  me: async () => {
    const deviceId = await getDeviceId();
    return call<Me>(`/me`, {
      method: 'GET',
      headers: { 'X-Device-Id': deviceId },
    });
  },

  /**
   * La pochette des ecrans d'ouverture : une seule, en grand.
   *
   * Remplace la grille de trente-six portraits que l'accueil demandait pour
   * son mur — soixante telechargements d'images sur le premier ecran de
   * l'app. `track` peut etre `null` : l'accueil doit s'ouvrir sans reseau.
   */
  accueil: () => call<{ tracks: Track[] }>('/accueil', undefined, { anonymous: true }),

  /** Grille d'artistes pour l'onboarding. */
  onboardingArtists: () => call<{ artists: Artist[] }>('/onboarding/artists'),

  searchArtists: (q: string) =>
    call<{ artists: Artist[] }>(`/search/artists?q=${encodeURIComponent(q)}`),

  /**
   * Les voisins d'un artiste : « si tu aimes lui, alors eux aussi ».
   *
   * Le graphe `related` de Deezer, celui dont tout le moteur depend. Sert a
   * l'amorcage : choisir six artistes de memoire est difficile, et un
   * palmares ne propose que des tubes. Partir d'un nom qu'on a en tete et
   * derouler ses voisins donne des choix qu'on n'aurait pas formules.
   *
   * Ces fiches-la portent le nombre d'abonnes, contrairement a celles du
   * palmares d'amorcage — c'est `related` qui le rend, sans appel de plus.
   */
  voisinsArtiste: (artistId: number) =>
    call<{ artists: Artist[] }>(`/artists/${artistId}/voisins`),

  /** Le pendant pour les titres : on cherche un artiste quand on sait qui on
   *  aime, un titre quand on se souvient d'une chanson sans savoir de qui. */
  searchTracks: (q: string) =>
    call<{ tracks: Track[] }>(`/search/tracks?q=${encodeURIComponent(q)}`),

  /**
   * Ajouter du gout a la main, sans passer par le fil.
   *
   * Les deux matieres ne sont pas traitees pareil cote moteur, et l'ecran doit
   * le dire : un **artiste** devient une ancre du gout ET il est suivi ; un
   * **titre** est archive comme un « je garde » et entre en bibliotheque.
   *
   * Les listes `refuses` ne sont pas un detail : un artiste sans voisins chez
   * Deezer est une impasse pour le moteur — il ne peut engendrer aucune carte
   * — et il est ecarte. Le taire ferait croire a un ajout qui n'a pas eu lieu.
   */
  ajouterAuGout: (input: { artistIds?: number[]; trackIds?: number[] }) =>
    post<{
      artistes_ajoutes: number[];
      artistes_refuses: number[];
      titres_ajoutes: number[];
      titres_refuses: number[];
    }>('/taste/ajout', {
      artist_ids: input.artistIds ?? [],
      track_ids: input.trackIds ?? [],
    }),

  /**
   * Ce que le moteur sait importer.
   *
   * Deezer ne demande aucune cle et y est toujours ; YouTube Music n'y est que
   * si la cle d'API Google est posee sur le serveur. L'app le demande avant
   * d'afficher l'ecran de choix : proposer un import qui echouera **apres**
   * qu'on a colle son lien serait pire que de ne pas le proposer.
   */
  importSources: () => call<{ sources: string[] }>('/import/sources', undefined, { anonymous: true }),

  /**
   * Importe un gout depuis un lien colle.
   *
   * Ni OAuth ni compte : Deezer a ferme la creation d'applications et YouTube
   * n'expose aucune bibliotheque, mais leurs routes **par identifiant**
   * restent ouvertes. D'ou le lien plutot que l'autorisation.
   *
   * Rend des ancres, sans rien ecrire : c'est l'appelant qui enchaine sur
   * `seed`. Un import Deezer rend des `artist_ids` — des identifiants Deezer
   * natifs, donc aucune resolution par nom et aucun homonyme possible.
   */
  importLien: (url: string) =>
    post<{ source: string; artist_ids: number[]; artists: string[]; titres: number }>(
      '/import/lien',
      { url },
    ),

  /** Amorce le gout. Accepte des ids Deezer et/ou des noms a resoudre.
   *
   * `resolved` rend la correspondance nom -> identifiant Deezer que le moteur
   * vient d'etablir. Sans elle, l'ecran des styles devrait repayer une
   * recherche Deezer par artiste pour savoir quelles ancres un style recouvre.
   *
   * `source` et `remplace` servent aux **reimports**, pas au demarrage : ils
   * disent au moteur d'effacer le precedent import de cette source-la avant
   * d'ecrire celui-ci. Sans eux, relier Spotify une seconde fois donnait a
   * Spotify deux parts de voix et gardait en vie une lecture perimee. Un
   * moteur d'une version anterieure les ignore et se contente d'ajouter.
   *
   * `total` est le nombre d'ancres que le profil retient **apres** fusion de
   * tous les imports — c'est lui qui dit si le reimport a change quelque
   * chose, pas `anchors`, qui ne compte que ce qui vient d'etre envoye. */
  seed: (input: {
    artistIds?: number[];
    artists?: string[];
    source?: 'spotify' | 'deezer' | 'ytmusic';
    remplace?: boolean;
  }) =>
    post<{
      user_id: string;
      anchors: number;
      total?: number;
      resolved: Record<string, number>;
    }>('/taste/seed', {
      artist_ids: input.artistIds ?? [],
      artists: input.artists ?? [],
      ...(input.source ? { source: input.source } : {}),
      ...(input.remplace ? { remplace: true } : {}),
    }),

  /** Les styles proposables, tires des ancres par le moteur.
   *
   * Ce calcul a vecu dans l'app, sur les genres de Spotify. Il en est parti le
   * 2026-08-23 : mesure sur un vrai compte, **zero artiste sur quarante-cinq**
   * en portait un — Spotify a vide le champ. Cote moteur, les genres viennent
   * de Deezer et marchent pour tous les imports.
   *
   * Peut etre lent au premier appel (un palmares par ancre, ~5 s a froid),
   * quasi instantane ensuite : les palmares sont en cache pour trois jours. */
  styleSuggestions: async () => {
    const deviceId = await getDeviceId();
    return call<{ styles: { name: string; artist_ids: number[]; artists: string[] }[] }>(
      '/taste/styles/suggestions',
      { method: 'GET', headers: { 'X-Device-Id': deviceId } },
    );
  },

  /** Les styles retenus a la main, tels que le moteur les applique. */
  styles: () =>
    call<{ styles: { name: string; artist_ids: number[] }[]; boost: number }>('/taste/styles', {
      method: 'GET',
    }),

  /** Remplace la selection entiere. Une liste vide retire le reglage et rend
   *  le fil au seul gout appris. */
  setStyles: (styles: { name: string; artist_ids: number[] }[]) =>
    call<{ styles: string[]; anchors: number }>('/taste/styles', {
      method: 'PUT',
      body: JSON.stringify({ styles }),
    }),

  nextCards: (limit = 12) => post<{ user_id: string; cards: Card[] }>('/feed/next', { limit }),

  /**
   * Remonte un swipe.
   *
   * `msPlayed` est le signal le plus riche du systeme : c'est lui qui permet
   * de distinguer un rejet violent d'un « bien mais suivant ». Toujours le
   * renseigner honnetement.
   */
  event: (p: { track: Track; action: SwipeAction; msPlayed: number; previewMs: number }) =>
    post<EventResult>('/feed/event', {
      track_id: p.track.id,
      artist_id: p.track.artist.id,
      genre_id: p.track.genre_id,
      action: p.action,
      ms_played: Math.round(p.msPlayed),
      preview_ms: Math.round(p.previewMs),
    }),

  /** Ecran « Ton Prisme ». Exige un compte du reseau G. */
  prism: () => call<Prism>('/profile'),

  /** La bibliotheque. Exige un compte du reseau G. */
  library: () => call<{ tracks: Track[] }>('/library'),

  /** Le portrait : ce que l'histoire dit de toi. Exige un compte. */
  stats: () => call<Stats>('/stats'),

  /** Les artistes choisis a l'inscription, dans l'ordre ou ils l'ont ete. */
  anchors: () => call<{ artists: Artist[] }>('/taste/anchors'),

  /** Les artistes suivis, du plus recemment suivi au plus ancien.
   *  Exige un compte du reseau G : c'est justement ce qu'on veut retrouver
   *  sur un autre telephone. */
  artistesSuivis: () => call<{ artists: Artist[] }>('/artists/suivis'),

  /** Suivre / ne plus suivre un artiste.
   *
   *  Idempotent cote moteur : l'app peut donc etre optimiste — basculer le
   *  bouton tout de suite et appeler ensuite — sans avoir a se demander ce
   *  qu'elle croit savoir de l'etat reel. */
  suivreArtiste: (artistId: number, on: boolean) =>
    call<{ artist_id: number; suivi: boolean }>(`/artists/${artistId}/suivre`, {
      method: on ? 'PUT' : 'DELETE',
    }),

  /** Les artistes bannis d'un swipe vers le bas. */
  blocked: () => call<{ artists: Artist[] }>('/blocked'),

  /** Revient sur un bannissement : le moteur efface la decision, il ne pose
   *  pas un contre-drapeau. L'artiste peut donc revenir dans le fil. */
  unblock: (artistId: number) =>
    call<{ unblocked: number }>(`/blocked/${artistId}`, { method: 'DELETE' }),

  /** La photo de profil personnelle.
   *  `dataUrl` est un data URL JPEG deja recadre et redimensionne cote app
   *  (512 px, compresse) : le moteur ne fait que stocker et diffuser.
   *  Exige un compte du reseau G — l'avatar est une identite sociale. */
  setAvatar: (dataUrl: string) =>
    call<{ ok: boolean }>('/social/avatar', {
      method: 'PUT',
      body: JSON.stringify({ image: dataUrl }),
    }),

  /** Retire la photo personnelle : la photo du compte G redevient celle que
   *  tout le monde voit. */
  supprimerAvatar: () => call<{ ok: boolean }>('/social/avatar', { method: 'DELETE' }),

  /** Les reglages qui vivent sur le serveur.
   *  Ouverts aux appareils sans compte : la question de la decouverte est
   *  posee a la fin du demarrage, avant toute connexion. D'ou l'identifiant
   *  d'appareil, comme sur `/me`. */
  prefs: async () => {
    const deviceId = await getDeviceId();
    return call<Prefs>('/prefs', { method: 'GET', headers: { 'X-Device-Id': deviceId } });
  },

  /** `discovery: null` rend la main au moteur. */
  setPrefs: async (discovery: number | null) => {
    const deviceId = await getDeviceId();
    return call<{ discovery: number | null }>('/prefs', {
      method: 'PUT',
      body: JSON.stringify({ device_id: deviceId, discovery }),
    });
  },

  /** Range un titre hors des gardes. Le swipe qui l'y a mis reste dans
   *  l'histoire : retirer de la bibliotheque n'est pas se dedire. */
  removeFromLibrary: (trackId: number) =>
    call<{ removed: number }>(`/library/${trackId}`, { method: 'DELETE' }),

  /** Re-resout un titre pour obtenir une URL de preview fraiche. */
  refreshTrack: (id: number) => call<Track>(`/track/${id}`),

  // -- Le social -------------------------------------------------------------

  /** Cherche des profils par nom. Deux caracteres minimum cote moteur ;
   *  en dessous, la route rend une liste vide sans meme etre utile. */
  rechercheGens: (q: string) =>
    call<{ gens: Gen[] }>(`/social/recherche?q=${encodeURIComponent(q)}`),

  /** Le profil public d'un compte : ses gardes et ses artistes aimes.
   *  Un profil cache repond 404 — l'app l'affiche comme introuvable. */
  profilPublic: (id: string) => call<ProfilSocial>(`/social/profil/${encodeURIComponent(id)}`),

  /** L'etat de la bascule de visibilite. */
  visibilite: () => call<{ visible: boolean }>('/social/visibilite'),

  /** Changer de visibilite. Cache = absent de la recherche, profil en 404. */
  setVisibilite: (visible: boolean) =>
    call<{ visible: boolean }>('/social/visibilite', {
      method: 'PUT',
      body: JSON.stringify({ visible }),
    }),

  /** Suivre / ne plus suivre, par identifiant ou @handle. */
  suivre: (ref: string, on: boolean) =>
    call<{ suivi: boolean; abonnes: number }>(`/social/suivre/${encodeURIComponent(ref)}`, {
      method: on ? 'PUT' : 'DELETE',
    }),

  /** Ce qui s'est passe : nouveaux abonnes, titres repris. */
  notifs: () => call<Notifs>('/social/notifs'),

  /** Tout est lu. Rend le compte remis a zero, pour ne pas avoir a relire la
   *  liste juste apres l'avoir ouverte. */
  notifsVues: () =>
    call<{ nouvelles: number }>('/social/notifs/vues', { method: 'PUT' }),

  /** Les abonnes (`abonnes`) ou les abonnements (`abonnements`) d'un profil. */
  gensDuProfil: (ref: string, type: 'abonnes' | 'abonnements') =>
    call<{ gens: Gen[] }>(
      `/social/profil/${encodeURIComponent(ref)}/gens?type=${type}`,
    ),
};
