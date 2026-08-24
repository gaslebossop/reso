import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Track } from '../api/types';
import { ajouterAPlaylist, SpotifyError } from '../auth/spotify';

/**
 * Le versement continu des gardes vers la playlist « Reso ».
 *
 * ## Pourquoi une file, et pas un appel par swipe
 *
 * Garder un titre coute deja un appel au moteur. Y ajouter, dans le meme
 * geste, une recherche Spotify puis un ajout de playlist, c'est deux
 * aller-retours de plus **sur le chemin du pouce** — et cinquante gardes dans
 * une seance en feraient cent. La file les absorbe : le geste rend la main
 * immediatement, et le versement se fait deux secondes plus tard, une fois que
 * le doigt s'est arrete.
 *
 * ## Pourquoi elle est ecrite sur le disque
 *
 * Un titre garde dans le metro, avec un reseau qui ne repond pas, doit se
 * retrouver dans la playlist au prochain lancement. Une file en memoire seule
 * l'aurait perdu sans que rien ne le dise — et c'est precisement le genre de
 * perte silencieuse qui fait cesser de faire confiance a une synchronisation.
 *
 * ## Ce qui sort de la file, et ce qui y reste
 *
 * Un titre que Spotify ne connait pas **sort** : le remettre en file le ferait
 * rechercher a chaque lancement, indefiniment, pour une reponse qui ne
 * changera pas. Une panne reseau, elle, laisse le titre en place. Et un refus
 * de permission **arrete la synchronisation** au lieu de vider la file : la
 * liaison est a refaire, et continuer a essayer ne ferait que bruler des
 * appels.
 */

const CLE_AUTO = 'reso.spotify.auto';
const CLE_FILE = 'reso.spotify.file';

/** Le temps de repos avant de verser. Assez pour qu'une rafale de swipes ne
 *  parte pas titre par titre. */
const REPOS_MS = 2000;

/** Au-dela, la file cesse de grossir : elle protege d'un oubli, pas d'un mois
 *  hors ligne, et une file sans fin devient un journal. */
const PLAFOND = 200;

let actif = false;
let charge = false;
let file: Track[] = [];
let minuteur: ReturnType<typeof setTimeout> | null = null;
let versement: Promise<void> | null = null;
const abonnes = new Set<() => void>();

function prevenir(): void {
  for (const f of [...abonnes]) f();
}

export function souscrireAuto(f: () => void): () => void {
  abonnes.add(f);
  return () => void abonnes.delete(f);
}

/** L'etat connu localement, sans aller-retour. */
export function autoActif(): boolean {
  return actif;
}

/** Lit la preference et la file au demarrage. Sans attendre personne : tant
 *  qu'elle n'est pas arrivee, la synchronisation est consideree eteinte, ce
 *  qui est le sens le plus prudent des deux. */
export async function chargerSync(): Promise<void> {
  if (charge) return;
  charge = true;
  const [v, f] = await Promise.all([
    AsyncStorage.getItem(CLE_AUTO).catch(() => null),
    AsyncStorage.getItem(CLE_FILE).catch(() => null),
  ]);
  actif = v === 'on';
  if (f) {
    try {
      const lu = JSON.parse(f);
      if (Array.isArray(lu)) file = lu as Track[];
    } catch {
      // Une file illisible n'est pas recuperable : repartir vide vaut mieux
      // que faire echouer chaque versement qui suit.
      await AsyncStorage.removeItem(CLE_FILE).catch(() => {});
    }
  }
  prevenir();
  if (actif && file.length > 0) programmer();
}

export async function reglerSync(on: boolean): Promise<void> {
  actif = on;
  charge = true;
  prevenir();
  await AsyncStorage.setItem(CLE_AUTO, on ? 'on' : 'off').catch(() => {});
  // Eteindre vide la file : ce qui n'a pas ete verse ne doit pas partir en
  // rafale le jour ou l'on rallume, des mois plus tard.
  if (!on) {
    file = [];
    await AsyncStorage.removeItem(CLE_FILE).catch(() => {});
    return;
  }
  if (file.length > 0) programmer();
}

async function ecrireFile(): Promise<void> {
  if (file.length === 0) {
    await AsyncStorage.removeItem(CLE_FILE).catch(() => {});
    return;
  }
  await AsyncStorage.setItem(CLE_FILE, JSON.stringify(file)).catch(() => {});
}

function programmer(): void {
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    minuteur = null;
    void verserLaFile();
  }, REPOS_MS);
}

/**
 * Un titre vient d'etre garde.
 *
 * Ne rend jamais d'erreur et n'attend rien : l'appelant est le geste de swipe,
 * et un versement Spotify n'a aucune raison de ralentir la carte suivante.
 */
export function filerVersSpotify(t: Track): void {
  if (!actif) return;
  if (file.some((x) => x.id === t.id)) return;
  file.push(t);
  if (file.length > PLAFOND) file = file.slice(-PLAFOND);
  void ecrireFile();
  programmer();
}

/** Vide la file, un titre a la fois. A vol unique. */
async function verserLaFile(): Promise<void> {
  if (versement) return versement;
  versement = (async () => {
    while (actif && file.length > 0) {
      const t = file[0];
      try {
        await ajouterAPlaylist(t);
        // Verse, ou introuvable : dans les deux cas il quitte la file. Un
        // titre absent du catalogue Spotify le restera.
        file.shift();
      } catch (e) {
        if (e instanceof SpotifyError) {
          // Permission retiree ou liaison finie : la file ne partira pas en
          // insistant. On s'arrete et on la garde pour plus tard.
          return;
        }
        // Panne reseau : on garde le titre et on reessaiera au prochain
        // versement, sans boucler tout de suite.
        return;
      } finally {
        await ecrireFile();
      }
    }
  })().finally(() => {
    versement = null;
  });
  return versement;
}

/** Combien attendent encore. Sert a l'ecran des gardes, pas a decider. */
export function enAttente(): number {
  return file.length;
}

/** La liaison Spotify est rompue : la preference et la file n'ont plus d'objet. */
export async function oublierSync(): Promise<void> {
  actif = false;
  file = [];
  prevenir();
  await Promise.all([
    AsyncStorage.removeItem(CLE_AUTO).catch(() => {}),
    AsyncStorage.removeItem(CLE_FILE).catch(() => {}),
  ]);
}
