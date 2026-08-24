/**
 * Faux `expo-audio`, calque sur le code natif iOS de la version 1.1.1.
 *
 * Ce n'est pas une maquette de complaisance : chaque comportement modelise ici
 * a ete lu dans `node_modules/expo-audio/ios/*.swift`, parce que c'est la que
 * se trouvent les regles qui font taire le son sans rien dire.
 *
 *  - `currentTime` vaut **0** tant qu'aucun item n'est charge
 *    (`AudioPlayer.swift` : `ref.currentItem?.currentTime().seconds ?? 0.0`).
 *  - `downloadFirst: true` cree le lecteur **sans source** et ne lui donne
 *    l'extrait qu'une fois telecharge en entier (`ExpoAudio.js`).
 *  - un `play()` emis avant que l'item existe est perdu, definitivement.
 *  - **`pause()` programme la coupure de la session audio partagee 100 ms plus
 *    tard** (`AudioModule.swift`, `deactivateSession`), et cette coupure n'est
 *    evitee que si un lecteur est deja passe a `timeControlStatus == .playing`.
 *    C'est le piege central : entre le `pause()` de la carte qu'on quitte et le
 *    moment ou la suivante sort vraiment du son, la fenetre est ouverte.
 *  - `keepAudioSessionActive: true` supprime cette programmation.
 *  - `remove()` ne fait que **desinscrire** le lecteur du registre : il ne
 *    l'arrete pas (`Function("remove")` -> `registry.remove(player)`), et
 *    surtout **il ne libere pas le decodeur**. Cote Android l'ExoPlayer n'est
 *    detruit qu'au `sharedObjectDidRelease`, donc au ramasse-miettes JS.
 *  - `release()` (herite de `SharedObject`) detache l'objet de son homologue
 *    natif **tout de suite** : c'est la seule chose qui rende un decodeur, et
 *    apres elle tout acces leve.
 */

import { horloge } from './horloge';

export type AudioStatus = {
  isLoaded: boolean;
  playing: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  didJustFinish: boolean;
  playbackState: string;
  timeControlStatus: string;
  reasonForWaitingToPlay: string | null;
};

export type Ligne = { t: number; ev: string; uri?: string };
export const journal: Ligne[] = [];

/** Duree d'un extrait Deezer. */
const DUREE_S = 30;
/** Delai natif avant coupure de la session (`deactivateSession`). */
const DELAI_COUPURE_MS = 100;
/** Pas du simulateur. */
const PAS_MS = 20;

/**
 * Les deux durees qui decident de tout, et qu'on ne choisit pas.
 *
 * `telechargementMs` : un extrait pese ~1 Mo, et `downloadFirst` le prend en
 * entier avant de jouer. Sur reseau mobile, ca ne se compte pas en centaines de
 * millisecondes.
 *
 * `demarrageMs` : le temps entre `play()` et le son. AVPlayer passe d'abord par
 * `waitingToPlayAtSpecifiedRate`, et il faut y ajouter l'activation de la
 * session audio. **Des qu'il depasse 100 ms, il depasse le delai que le module
 * natif s'accorde avant de couper la session** — c'est la fenetre du defaut.
 */
export type Reseau = { telechargementMs: number; demarrageMs: number };
let reseau: Reseau = { telechargementMs: 600, demarrageMs: 60 };

type Dl = { fait: number; fini: () => void };
const enVol = new Set<Dl>();

/** Ce que le module natif connait. `remove()` en retire. */
const registre = new Set<AudioPlayer>();
/** Tout ce qui existe encore, pour le faire vivre. */
const vivants = new Set<AudioPlayer>();

const session = {
  active: false,
  activer() {
    if (session.active) return;
    session.active = true;
    journal.push({ t: horloge.maintenant(), ev: 'session:on' });
  },
  planifierCoupure() {
    setTimeout(() => {
      if (!session.active) return;
      for (const p of registre) if (p.playing) return; // garde-fou natif
      session.active = false;
      journal.push({ t: horloge.maintenant(), ev: 'session:off' });
      for (const p of vivants) p.__perdreLaRoute();
    }, DELAI_COUPURE_MS);
  },
};

export class AudioPlayer {
  readonly uri: string;
  private readonly garderSession: boolean;
  private readonly intervalle: number;
  /** L'item AVPlayer : absent tant que le telechargement n'a pas abouti. */
  private item = false;
  private etat: 'paused' | 'attente' | 'playing' = 'paused';
  private position = 0;
  private depuisStatut = 0;
  private auditeurs = new Set<(s: AudioStatus) => void>();
  /** Detache de son homologue natif : plus rien n'est lisible. */
  private detache = false;
  loop = false;

  /**
   * Ce que fait le socle des qu'on touche un objet partage deja rendu.
   *
   * Modelise pour de vrai, parce que c'est ce qui transforme une fuite de
   * decodeur corrigee a la va-vite en plantage : une preparation en vol vise
   * facilement un lecteur qu'on vient de jeter.
   */
  private garde() {
    if (this.detache) {
      throw new Error('Unable to find the native object — it has been released.');
    }
  }

  constructor(
    uri: string,
    o: { downloadFirst?: boolean; updateInterval?: number; keepAudioSessionActive?: boolean },
  ) {
    this.uri = uri;
    this.garderSession = o.keepAudioSessionActive ?? false;
    this.intervalle = o.updateInterval ?? 500;
    journal.push({ t: horloge.maintenant(), ev: 'dl:debut', uri });
    enVol.add({
      fait: 0,
      fini: () => {
        // Le telechargement se termine dans le vide si le lecteur a ete rendu
        // entre-temps — c'est exactement ce que fait le natif, qui a lache le
        // fichier avec l'objet.
        if (this.detache) return;
        this.item = true;
        journal.push({ t: horloge.maintenant(), ev: 'dl:fin', uri });
        this.emettre();
      },
    });
  }

  get isLoaded() {
    this.garde();
    return this.item;
  }
  get playing() {
    this.garde();
    return this.etat === 'playing';
  }
  get isBuffering() {
    this.garde();
    return !this.playing && (this.etat === 'attente' || !this.item);
  }
  get currentTime() {
    this.garde();
    return this.item ? this.position : 0;
  }
  get duration() {
    this.garde();
    return this.item ? DUREE_S : NaN;
  }

  play() {
    session.activer();
    this.etat = 'attente';
    if (!this.item) return; // ordre perdu : il ne partira jamais
    setTimeout(() => {
      if (this.etat === 'attente' && this.item && session.active) {
        this.etat = 'playing';
        this.emettre();
      }
    }, reseau.demarrageMs);
  }

  pause() {
    this.etat = 'paused';
    if (!this.garderSession) session.planifierCoupure();
  }

  async seekTo(s: number) {
    this.position = s;
  }

  /** Desinscrit, sans arreter **ni liberer** : exactement ce que fait le natif. */
  remove() {
    this.garde();
    registre.delete(this);
  }

  /**
   * Rend le decodeur. C'est la seule methode qui en libere un.
   *
   * Le lecteur sort de `vivants` — c'est ce que compte `lecteursVivants()` —
   * et devient inutilisable.
   */
  release() {
    if (this.detache) return;
    this.detache = true;
    this.etat = 'paused';
    registre.delete(this);
    vivants.delete(this);
  }

  addListener(_nom: string, cb: (s: AudioStatus) => void) {
    this.auditeurs.add(cb);
    return { remove: () => void this.auditeurs.delete(cb) };
  }

  /** La session vient d'etre coupee sous les pieds du lecteur. */
  __perdreLaRoute() {
    if (this.detache) return;
    if (this.etat === 'paused') return;
    this.etat = 'paused';
    this.emettre();
  }

  __tick(ms: number) {
    if (this.etat === 'playing' && session.active) {
      this.position += ms / 1000;
      if (this.position >= DUREE_S) this.position = this.loop ? 0 : DUREE_S;
    }
    this.depuisStatut += ms;
    if (this.depuisStatut >= this.intervalle) {
      this.depuisStatut = 0;
      this.emettre();
    }
  }

  private emettre() {
    // Un objet rendu n'a plus d'homologue natif : il n'emet plus rien. Sans
    // cette sortie, le faux module devient plus bavard que le vrai et fait
    // echouer le banc sur un evenement qui n'existe pas en vrai.
    if (this.detache) return;
    const s: AudioStatus = {
      isLoaded: this.isLoaded,
      playing: this.playing,
      isBuffering: this.isBuffering,
      currentTime: this.currentTime,
      duration: this.duration,
      didJustFinish: false,
      playbackState: this.item ? 'readyToPlay' : 'unknown',
      timeControlStatus: this.etat,
      reasonForWaitingToPlay: this.etat === 'attente' ? 'evaluatingBufferingRate' : null,
    };
    for (const cb of [...this.auditeurs]) cb(s);
  }
}

export function createAudioPlayer(
  source: { uri: string },
  options: { downloadFirst?: boolean; updateInterval?: number; keepAudioSessionActive?: boolean } = {},
) {
  const p = new AudioPlayer(source.uri, options);
  registre.add(p);
  vivants.add(p);
  return p;
}

export async function setAudioModeAsync(_mode: unknown) {
  /* rien a simuler : le mode n'influence pas ce qu'on mesure ici */
}

/** L'extrait qu'on entend reellement, ou `null` si l'appareil est muet. */
export function auditionner(): string | null {
  if (!session.active) return null;
  for (const p of vivants) if (p.playing) return p.uri;
  return null;
}

/**
 * Combien de **decodeurs** sont encore alloues.
 *
 * Ce compteur rendait `registre.size`, c'est-a-dire la taille de la map du
 * module — que `remove()` vide. Il ne mesurait donc pas ce qui coute, et la
 * regle B passait au vert pendant qu'Android accumulait les `MediaCodec`
 * jusqu'a n'en avoir plus un seul de libre. Il compte maintenant les lecteurs
 * reellement vivants, que seul `release()` fait disparaitre.
 */
export function lecteursVivants(): number {
  return vivants.size;
}

/** Combien d'extraits se disputent le reseau en ce moment. */
export function telechargementsEnCours(): number {
  return enVol.size;
}

/** Remet le faux module a neuf, pour enchainer plusieurs scenarios. */
export function reinitialiser(r: Reseau) {
  reseau = r;
  enVol.clear();
  registre.clear();
  vivants.clear();
  journal.length = 0;
  session.active = false;
}

let simulationLancee = false;

export function demarrerSimulation() {
  if (simulationLancee) return;
  simulationLancee = true;
  setInterval(() => {
    if (enVol.size > 0) {
      // La bande passante se partage : deux extraits a la fois, chacun deux
      // fois plus lent. C'est ce qui rend le prechargement precoce couteux.
      const part = PAS_MS / enVol.size;
      for (const d of [...enVol]) {
        d.fait += part;
        if (d.fait >= reseau.telechargementMs) {
          enVol.delete(d);
          d.fini();
        }
      }
    }
    for (const p of [...vivants]) p.__tick(PAS_MS);
  }, PAS_MS);
}

/**
 * Rendre ou reprendre la session audio a la main.
 *
 * Cote natif (`setIsAudioActive`), une desactivation met d'abord en pause tous
 * les lecteurs **encore inscrits** au registre, en les marquant « jouait avant »
 * — et le retour au premier plan les redemarre. D'ou l'ordre impose dans
 * `suspend()` : vider le registre d'abord, rendre la session ensuite.
 */
export async function setIsAudioActiveAsync(actif: boolean) {
  if (actif) {
    session.activer();
    return;
  }
  for (const p of registre) p.pause();
  if (!session.active) return;
  session.active = false;
  journal.push({ t: horloge.maintenant(), ev: 'session:off' });
  for (const p of vivants) p.__perdreLaRoute();
}
