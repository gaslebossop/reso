/**
 * Banc d'essai du fil, hors appareil.
 *
 * Il rejoue une session de swipes contre `src/audio/player.ts` en ne simulant
 * qu'`expo-audio` — la separation que le lecteur s'impose deja pour le
 * resolveur d'extraits. Voir `faux-expo-audio.ts` : chaque comportement du faux
 * est repris du code natif iOS livre dans `node_modules`, pas suppose.
 *
 * Trois regles sont verifiees, et le fil a deja perdu chacune une fois :
 *
 *  A. **Le son arrive vite, et ne se coupe pas.** C'est le defaut signale : le
 *     son arrive, se tait une seconde, revient. On mesure les deux moities —
 *     le delai avant le premier son quand l'extrait etait deja sur le disque,
 *     et les blancs en pleine lecture.
 *  B. **Jamais plus de trois lecteurs vivants.** Au-dela, iOS coupe des
 *     pipelines de decodage sans prevenir.
 *  C. **Rien ne se telecharge tant que l'extrait de la carte a l'ecran n'est
 *     pas arrive.** Ce qu'on entend passe avant ce qu'on entendra : deux
 *     telechargements simultanes vont chacun deux fois moins vite.
 *  E. **La session audio n'est jamais rendue pendant que le fil tourne.** Le
 *     module natif la coupe cent millisecondes apres n'importe quel `pause()`,
 *     et la remonter coute un demarrage complet. C'est la regle la plus utile
 *     du lot : elle se verifie sur un evenement, pas sur un chronometre.
 *
 * Elles sont eprouvees sur quatre reseaux, parce qu'un fil qui ne tient que sur
 * un poste de developpement en wifi ne tient pas. Les deux durees qui varient
 * sont celles qu'on ne choisit pas : le temps de telechargement d'un extrait, et
 * le temps entre `play()` et le son.
 *
 * Lancer : `npm run bench`
 */

import { horloge, EPOCH } from './horloge';
import {
  auditionner,
  demarrerSimulation,
  journal,
  lecteursVivants,
  reinitialiser,
  type Reseau,
} from './faux-expo-audio';
import type { Track } from '../src/api/types';

/** Un blanc plus court que ca ne s'entend pas ; plus long, si. */
const TOLERANCE_BLANC_MS = 200;
/**
 * Marge toleree, au-dela de l'allumage d'AVPlayer, entre l'arrivee d'une carte
 * et son premier son **quand son extrait etait deja telecharge**. Il ne reste
 * alors rien d'autre a attendre : au-dela, quelque chose a coupe la sortie.
 */
const MARGE_ATTAQUE_MS = 250;
const SWIPES = 8;
/** Temps passe sur une carte avant de swiper. */
const ECOUTE_MS = 2500;
const PAS_RELEVE_MS = 20;

const RESEAUX: { nom: string; reseau: Reseau }[] = [
  { nom: 'wifi du bureau', reseau: { telechargementMs: 400, demarrageMs: 40 } },
  { nom: 'demarrage lent', reseau: { telechargementMs: 400, demarrageMs: 300 } },
  { nom: 'reseau mobile', reseau: { telechargementMs: 2200, demarrageMs: 40 } },
  { nom: 'mobile + lent', reseau: { telechargementMs: 2200, demarrageMs: 300 } },
];

const EXP = Math.floor(EPOCH / 1000) + 900;
let prochainId = 1;

function piste(id: number): Track {
  return {
    id,
    isrc: null,
    title: `titre-${id}`,
    artist: { id, name: `artiste-${id}`, picture: '' },
    album: '',
    cover: '',
    preview: `https://cdn.test/${id}.mp3?hdnea=exp=${EXP}~acl=/*`,
    duration_sec: 30,
    rank: 0,
    genre_id: null,
  };
}

const lot = (n: number): Track[] => Array.from({ length: n }, () => piste(prochainId++));

type Releve = { t: number; attendu: string | null; entendu: string | null; lecteurs: number };
type Lecteur = typeof import('../src/audio/player').player;

async function scenario(player: Lecteur, r: Reseau): Promise<string[]> {
  reinitialiser(r);
  player.release();

  let file: Track[] = lot(12);
  let topPrecedent: number | null = null;
  let enChargement = false;

  /**
   * Ce que React commet : l'effet `[topId]` puis l'effet `[state.cards]`, dans
   * l'ordre de declaration et de facon synchrone. `play` est asynchrone et rend
   * la main a son premier `await` — `keepOnly` s'execute donc **avant** que
   * `play` ait fini. C'est precisement ce que ce banc doit reproduire.
   */
  const commit = () => {
    const top = file[0];
    if (top && top.id !== topPrecedent) {
      topPrecedent = top.id;
      void player.play(top);
    }
    player.preload(file.slice(1, 3));
    player.keepOnly(file.slice(0, 3).map((t) => t.id));
  };

  const swipe = () => {
    file = file.slice(1);
    commit();
    if (file.length <= 4 && !enChargement) {
      enChargement = true;
      setTimeout(() => {
        enChargement = false;
        file = [...file, ...lot(12)];
        commit(); // un lot en tache de fond : la carte a l'ecran ne change pas
      }, 300);
    }
  };

  const releves: Releve[] = [];
  const echantillon = setInterval(() => {
    releves.push({
      t: horloge.maintenant(),
      attendu: file[0]?.preview ?? null,
      entendu: auditionner(),
      lecteurs: lecteursVivants(),
    });
  }, PAS_RELEVE_MS);

  commit();
  // De quoi laisser la premiere carte se telecharger quel que soit le reseau.
  await horloge.avancer(r.telechargementMs + 1500);
  for (let i = 0; i < SWIPES; i++) {
    swipe();
    await horloge.avancer(ECOUTE_MS);
  }
  clearInterval(echantillon);

  return analyser(releves, r);
}

function analyser(releves: Releve[], r: Reseau): string[] {
  const echecs: string[] = [];

  const maxLecteurs = Math.max(...releves.map((x) => x.lecteurs));
  if (maxLecteurs > 3) echecs.push(`B. ${maxLecteurs} lecteurs vivants a la fois (3 au plus)`);

  const coupures = journal.filter((l) => l.ev === 'session:off');
  if (coupures.length > 0) {
    echecs.push(
      `E. session audio rendue ${coupures.length} fois en plein fil (t=${coupures.map((l) => l.t).join(', ')})`,
    );
  }

  const cartes: Releve[][] = [];
  for (const x of releves) {
    const derniere = cartes[cartes.length - 1];
    if (!derniere || derniere[0].attendu !== x.attendu) cartes.push([x]);
    else derniere.push(x);
  }

  for (const carte of cartes) {
    const uri = carte[0].attendu;
    if (!uri) continue;
    // La derniere carte est encore a l'ecran quand le scenario s'arrete.
    const derniere = carte === cartes[cartes.length - 1];

    const i = carte.findIndex((x) => x.entendu === uri);
    if (i < 0) {
      if (!derniere) echecs.push(`A. ${court(uri)} : aucun son du tout`);
      continue;
    }

    // Extrait deja sur le disque a l'arrivee de la carte : plus rien ne
    // justifie d'attendre, sinon l'allumage du lecteur.
    const pret = journal.find((l) => l.ev === 'dl:fin' && l.uri === uri);
    const attaque = carte[i].t - carte[0].t;
    if (pret && pret.t <= carte[0].t && attaque > r.demarrageMs + MARGE_ATTAQUE_MS) {
      echecs.push(`A. ${court(uri)} : ${attaque} ms avant le premier son, extrait deja pret`);
    }

    let courant = 0;
    let pire = 0;
    let quand = 0;
    for (const x of carte.slice(i)) {
      if (x.entendu === uri) courant = 0;
      else if ((courant += PAS_RELEVE_MS) > pire) [pire, quand] = [courant, x.t];
    }
    if (pire > TOLERANCE_BLANC_MS) {
      echecs.push(`A. ${court(uri)} : ${pire} ms de silence en pleine lecture (t=${quand} ms)`);
    }

    // La fenetre a proteger va de l'arrivee de la carte a l'ecran jusqu'a ce
    // que **son** extrait soit sur le disque. Une carte deja telechargee quand
    // elle arrive n'a aucune fenetre : le reseau est libre pour la suite.
    const arrivee = journal.find((l) => l.ev === 'dl:fin' && l.uri === uri);
    const fin = arrivee ? arrivee.t : carte[carte.length - 1].t;
    if (fin > carte[0].t) {
      const precoces = journal.filter(
        (l) => l.ev === 'dl:debut' && l.uri !== uri && l.t >= carte[0].t && l.t < fin,
      );
      if (precoces.length > 0) {
        echecs.push(
          `C. ${court(uri)} : ${precoces.length} telechargement(s) pendant qu'elle attendait le sien`,
        );
      }
    }
  }

  return echecs;
}

const court = (uri: string) => uri.replace(/^https:\/\/cdn\.test\//, '').replace(/\?.*$/, '');

/**
 * Aller-retour par l'arriere-plan.
 *
 * Un lecteur cree avant une mise en veille est inutilisable au retour : `play()`
 * sur lui ne fait plus rien, en silence, alors que `isLoaded` reste vrai. D'ou
 * `suspend()`, qui les detruit tous — et qui doit aussi **arreter** le lecteur
 * courant avant de le jeter, puisque `remove()` ne fait que le desinscrire du
 * module natif sans l'interrompre.
 */
async function scenarioArrierePlan(player: Lecteur, r: Reseau): Promise<string[]> {
  reinitialiser(r);
  player.release();

  const echecs: string[] = [];
  const file = lot(4);
  const commit = () => {
    player.preload(file.slice(1, 3));
    player.keepOnly(file.slice(0, 3).map((t) => t.id));
  };

  void player.play(file[0]);
  commit();
  await horloge.avancer(r.telechargementMs + 1500);
  if (auditionner() !== file[0].preview) echecs.push('D. rien ne joue avant la mise en veille');

  player.suspend();
  await horloge.avancer(800);
  if (auditionner() !== null) echecs.push('D. le son continue en arriere-plan');

  player.resume();
  await horloge.avancer(r.telechargementMs + 1500);
  if (auditionner() !== file[0].preview) echecs.push('D. le son ne revient pas au retour');

  // Et le swipe suivant doit repartir normalement.
  void player.play(file[1]);
  player.preload(file.slice(2, 4));
  player.keepOnly(file.slice(1, 4).map((t) => t.id));
  await horloge.avancer(r.telechargementMs + 1500);
  if (auditionner() !== file[1].preview) echecs.push('D. la carte suivante reste muette apres un retour');

  return echecs;
}

async function main() {
  horloge.installer();
  const { player } = await import('../src/audio/player');
  player.setResolveur(async () => null);
  demarrerSimulation();

  let total = 0;
  for (const { nom, reseau } of RESEAUX) {
    const echecs = [...(await scenario(player, reseau)), ...(await scenarioArrierePlan(player, reseau))];
    total += echecs.length;
    const etat = echecs.length === 0 ? 'OK    ' : 'ECHEC ';
    console.log(`\n${etat} ${nom} (extrait ${reseau.telechargementMs} ms, demarrage ${reseau.demarrageMs} ms)`);
    for (const e of echecs) console.log(`         ${e}`);
  }

  console.log(total === 0 ? '\nLe fil ne se tait jamais.\n' : `\n${total} manquement(s).\n`);
  return total === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
