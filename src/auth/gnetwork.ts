import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * Connexion au reseau G.
 *
 * Reso n'a pas de comptes a lui : l'identite vient de `g.twitninf.duckdns.org`,
 * le fournisseur d'identite du reseau G. C'est ce qui permet a un profil de
 * gout de suivre quelqu'un d'un telephone a l'autre — sans quoi tout ce que
 * l'on apprend d'une personne meurt avec l'installation.
 *
 * Le flux est **Authorization Code + PKCE**, sans `client_secret`. Le client
 * est declare « public » cote G, precisement parce qu'un secret embarque dans
 * une app mobile est lisible par quiconque l'installe : la garantie ne vient
 * pas d'un mot de passe mais du couple PKCE + URI de redirection.
 *
 * **Se connecter est facultatif.** Sans compte, on swipe quand meme et le
 * moteur apprend quand meme ; c'est la bibliotheque et l'ecran « Ton Prisme »
 * qui demandent un compte, parce que ce sont les choses qu'on s'attend a
 * retrouver ailleurs.
 */

WebBrowser.maybeCompleteAuthSession();

const KEY_TOKENS = 'reso.g.tokens';

/** Ce que le moteur nous dit de l'emetteur — jamais code en dur ici. */
export type AuthConfig = {
  enabled: boolean;
  issuer: string | null;
  client_id: string;
  redirect_uri: string;
  scopes: string[];
};

export type Account = {
  sub: string;
  name: string | null;
  email: string | null;
  picture: string | null;
};

type Tokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Millisecondes epoch. */
  expiresAt: number;
};

export class GNetworkError extends Error {}

/**
 * L'URI de redirection reellement utilisable ici.
 *
 * Elle **change selon le contexte** : une app compilee revient sur
 * `reso://callback`, mais dans Expo Go l'app n'a pas de schema a elle et
 * revient sur `exp://<ip-du-poste>:8081/--/callback`. G compare ces URIs
 * caractere pour caractere, sans joker : les deux doivent etre declarees cote
 * client OAuth (voir `registerResoClient.ts` dans g-auth).
 */
export function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'reso', path: 'callback' });
}

/**
 * Un parametre de la redirection, lu a la main.
 *
 * `new URL()` n'est pas fiable sur un schema maison (`reso://…`) : selon la
 * plateforme il rend un `searchParams` vide sans lever d'erreur, ce qui donne
 * une connexion qui echoue en silence. La chaine est courte et le format est
 * fixe, la lire directement coute moins cher qu'un polyfill.
 */
function parametre(url: string, nom: string): string | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  for (const paire of url.slice(q + 1).split('&')) {
    const i = paire.indexOf('=');
    const cle = decodeURIComponent(i < 0 ? paire : paire.slice(0, i));
    if (cle === nom) return i < 0 ? '' : decodeURIComponent(paire.slice(i + 1));
  }
  return null;
}

function discovery(cfg: AuthConfig): AuthSession.DiscoveryDocument {
  if (!cfg.issuer) throw new GNetworkError("Le moteur n'annonce aucun emetteur G.");
  return {
    authorizationEndpoint: `${cfg.issuer}/oauth/authorize`,
    tokenEndpoint: `${cfg.issuer}/oauth/token`,
    revocationEndpoint: `${cfg.issuer}/oauth/revoke`,
  };
}

// --- Stockage -------------------------------------------------------------

async function readTokens(): Promise<Tokens | null> {
  const raw = await AsyncStorage.getItem(KEY_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    // Un enregistrement illisible n'est pas recuperable : on repart propre
    // plutot que de faire echouer chaque appel qui suit.
    await AsyncStorage.removeItem(KEY_TOKENS);
    return null;
  }
}

async function writeTokens(t: Tokens): Promise<void> {
  await AsyncStorage.setItem(KEY_TOKENS, JSON.stringify(t));
}

export async function signOut(): Promise<void> {
  await AsyncStorage.removeItem(KEY_TOKENS);
}

export async function isSignedIn(): Promise<boolean> {
  return (await readTokens()) !== null;
}

// --- Flux -----------------------------------------------------------------

/**
 * Ouvre la page de connexion du reseau G.
 *
 * **`prompt=select_account` est deliberé.** Sans lui, une session G deja
 * ouverte dans le navigateur systeme fait repartir la connexion en silence sur
 * ce compte-la : la fenetre s'ouvre et se referme, et on se retrouve connecte
 * sans avoir rien choisi. C'est desagreable quand ce n'est pas le bon compte,
 * et surtout **irreparable depuis cet ecran** — il n'y a nulle part ou dire
 * « pas celui-la ».
 *
 * Le reseau G le comprend (`packages/core/src/oauth/authorize.ts`) et son
 * ecran de connexion passe alors en mode liste (`select=1`). On perd un tap
 * pour qui n'a qu'un compte, on rend le choix possible a tout le monde.
 *
 * @returns `null` si la personne a ferme la fenetre — ce n'est pas une erreur.
 */
export async function signIn(cfg: AuthConfig): Promise<Account | null> {
  if (!cfg.enabled || !cfg.issuer) {
    throw new GNetworkError("La connexion au reseau G n'est pas activee sur ce moteur.");
  }

  const d = discovery(cfg);
  const request = new AuthSession.AuthRequest({
    clientId: cfg.client_id,
    scopes: cfg.scopes,
    redirectUri: redirectUri(),
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
    extraParams: { prompt: 'select_account' },
  });

  /**
   * Le code peut arriver par **deux chemins**, et il faut ecouter les deux.
   *
   * Le chemin normal est `promptAsync` : l'onglet de navigation integre
   * intercepte la redirection et la rend directement. Mais quand le systeme
   * n'a pas d'onglet integre disponible — un navigateur par defaut qui ne les
   * gere pas, un emulateur comme BlueStacks — la redirection sort du
   * navigateur et **revient a l'app comme un lien profond ordinaire**.
   * `promptAsync` rend alors `dismiss`, et le code repart avec le lien : c'est
   * expo-router qui le recoit, ne trouve aucune route `/callback`, et affiche
   * « Unmatched Route » — exactement le symptome observe sur appareil le
   * 2026-08-23.
   *
   * On ecoute donc `Linking` en parallele, et le premier des deux qui rend un
   * code gagne. `app/callback.tsx` existe en plus, pour que le routeur ait
   * quelque chose a afficher pendant la fraction de seconde ou il y passe.
   */
  const attendu = redirectUri();
  let recu: (url: string) => void = () => {};
  const parLien = new Promise<string>((resoudre) => {
    recu = resoudre;
  });
  const abonnement = Linking.addEventListener('url', (e) => {
    if (e.url.startsWith(attendu)) recu(e.url);
  });

  let code: string | null = null;
  let etat: string | null = null;
  try {
    const issue = await Promise.race([
      request.promptAsync(d).then((r) => ({ voie: 'onglet' as const, r })),
      parLien.then((url) => ({ voie: 'lien' as const, url })),
    ]);

    if (issue.voie === 'lien') {
      code = parametre(issue.url, 'code');
      etat = parametre(issue.url, 'state');
      // L'onglet est reste ouvert derriere l'app : le refermer, sinon on le
      // retrouve en revenant en arriere, sur une page de connexion perimee.
      void WebBrowser.dismissBrowser();
    } else if (issue.r.type === 'success') {
      code = issue.r.params.code ?? null;
      etat = issue.r.params.state ?? null;
    }
  } finally {
    abonnement.remove();
  }

  if (!code) return null;
  // Le `state` est la seule chose qui distingue notre redirection d'une
  // redirection fabriquee par quelqu'un d'autre. Il a forcement ete emis avec
  // le code : **absent ou different, on rejette** — l'accepter ouvrait la
  // porte a une redirection epuree de son state. PKCE protege deja l'echange,
  // mais la hygiene ne coute qu'une condition.
  if (request.state === null || etat !== request.state) {
    throw new GNetworkError('Réponse de connexion inattendue.');
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: cfg.client_id,
      code,
      redirectUri: redirectUri(),
      // Sans le verifieur, G rejette l'echange : c'est tout l'interet de PKCE.
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    d,
  );

  await writeTokens(toTokens(token));
  return me(cfg, token.accessToken);
}

/**
 * Un jeton d'acces valide, ou `null` si personne n'est connecte.
 *
 * Le renouvellement est fait ici, une marge avant l'expiration : une requete
 * partie avec un jeton expire de deux secondes echouerait pour rien.
 *
 * La configuration arrive **paresseusement**, et c'est important : la passer
 * telle quelle deconnectait silencieusement au bout d'une heure. L'appelant ne
 * l'a pas forcement encore chargee, or elle n'est indispensable qu'au moment
 * du renouvellement — la reclamer d'avance a chaque appel ajouterait un
 * aller-retour sur le chemin chaud, et l'exiger d'avance faisait echouer le
 * renouvellement quand elle manquait.
 */
/**
 * Renouvellement en cours, s'il y en a un.
 *
 * Chaque appel a l'API demande un jeton, et les ecrans en emettent plusieurs a
 * la fois. Sans ce verrou, deux appels concurrents lancent deux
 * renouvellements avec le **meme** jeton de rafraichissement — or G le fait
 * tourner : le second echoue, et l'echec est traite comme une session finie,
 * donc par une deconnexion silencieuse au milieu d'une navigation normale.
 */
let renouvellement: Promise<string | null> | null = null;

export async function accessToken(
  loadConfig: () => Promise<AuthConfig | null>,
): Promise<string | null> {
  const t = await readTokens();
  if (!t) return null;
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  if (renouvellement) return renouvellement;
  renouvellement = renouveler(t, loadConfig).finally(() => {
    renouvellement = null;
  });
  return renouvellement;
}

async function renouveler(
  t: Tokens,
  loadConfig: () => Promise<AuthConfig | null>,
): Promise<string | null> {
  const cfg = t.refreshToken ? await loadConfig() : null;
  if (!t.refreshToken || !cfg?.issuer) {
    // Rien pour renouveler : la session est finie, autant le dire tout de
    // suite plutot que de laisser chaque appel repartir en 401.
    await signOut();
    return null;
  }

  try {
    const fresh = await AuthSession.refreshAsync(
      { clientId: cfg.client_id, refreshToken: t.refreshToken },
      discovery(cfg),
    );
    const next = toTokens(fresh, t.refreshToken);
    await writeTokens(next);
    return next.accessToken;
  } catch (e) {
    // **Seule une reponse de l'emetteur tue la session.** Un reseau qui lache,
    // un timeout, une panne DNS : ce ne sont pas des fins de session, et y
    // perdre les jetons etait une deconnexion silencieuse au milieu d'une
    // poche — le pire moment. On ne deconnecte que quand l'emetteur dit
    // explicitement que le jeton de rafraichissement est mort ; sinon on
    // garde tout, et le prochain appel retentera.
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number } | null)?.status;
    const mort = status === 400 || status === 401 || /invalid_grant|invalid_request|unauthorized_client/i.test(message);
    if (mort) await signOut();
    return null;
  }
}

/** Qui est connecte, d'apres G lui-meme. */
export async function me(cfg: AuthConfig, token: string): Promise<Account | null> {
  if (!cfg.issuer) return null;
  const res = await fetch(`${cfg.issuer}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, unknown>;
  const sub = typeof j.sub === 'string' ? j.sub : null;
  if (!sub) return null;
  return {
    sub,
    name: typeof j.name === 'string' ? j.name : null,
    email: typeof j.email === 'string' ? j.email : null,
    picture: typeof j.picture === 'string' ? j.picture : null,
  };
}

function toTokens(r: AuthSession.TokenResponse, fallbackRefresh: string | null = null): Tokens {
  // `expiresIn` est facultatif dans la reponse ; une heure est la valeur
  // usuelle de G, et se tromper par defaut ne coute qu'un renouvellement.
  const ttl = (r.expiresIn ?? 3600) * 1000;
  return {
    accessToken: r.accessToken,
    // Un renouvellement ne renvoie pas toujours un nouveau jeton de
    // rafraichissement : perdre l'ancien deconnecterait a la premiere heure.
    refreshToken: r.refreshToken ?? fallbackRefresh,
    expiresAt: Date.now() + ttl,
  };
}
