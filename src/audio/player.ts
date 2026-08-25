import {
  AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
import type { Track } from '../api/types';

/**
 * Lecture des extraits, avec prechargement.
 *
 * La regle qui gouverne ce fichier : **il ne doit jamais y avoir de silence
 * entre deux cartes**. Un temps de chargement d'une seconde suffit a casser la
 * boucle de swipe — l'utilisateur regarde un ecran muet, se demande si l'app a
 * plante, et sort.
 *
 * Le piege, mesure sur appareil : `createAudioPlayer` ne charge pas
 * immediatement, et **`play()` sur un lecteur dont `isLoaded` est encore faux
 * ne fait rien du tout** — sans erreur, sans exception, et sans jamais
 * demarrer une fois le chargement termine. C'etait la cause d'un extrait muet
 * sur deux. Precharger ne suffit donc pas : precharger ne fait que *lancer* le
 * chargement, il faut aussi **attendre qu'il aboutisse** avant de jouer.
 *
 * Les URLs de preview Deezer sont signees et expirent ; ce cache est en
 * memoire et meurt avec l'app, ce qui est exactement la bonne duree de vie.
 */

/** Combien de cartes d'avance on prepare.
 *
 * Volontairement bas : chaque lecteur est un pipeline de decodage iOS, et
 * au-dela d'une poignee, le systeme en coupe silencieusement — le son se fige
 * en pleine lecture, sans erreur, sans `buffering`, et sans qu'aucun evenement
 * de statut ne soit plus emis. Deux cartes d'avance suffisent a masquer la
 * latence reseau sans saturer le decodeur. */
const PRELOAD_AHEAD = 2;

/** Au dela, on renonce a attendre le chargement d'un extrait. */
const LOAD_TIMEOUT_MS = 8000;

/** Periode de verification que la lecture est bien en cours. */
const SUSTAIN_TICK_MS = 150;

/** Position au dela de laquelle on considere que le son sort vraiment. */
const PLAYING_THRESHOLD_S = 0.05;

/** Combien de fois on redemande la lecture avant de declarer le lecteur mort.
 *
 * Un `play()` ignore une ou deux fois est normal — iOS n'a pas fini de
 * basculer sa session audio. Ignore trois fois de suite, l'objet ne repondra
 * plus jamais : le systeme a coupe son pipeline de decodage sans rien dire.
 * Continuer a lui parler est ce qui produisait le son qui va et vient. */
const MAX_RELANCES = 3;

/** Marge exigee sur la signature d'un extrait avant de le jouer.
 *
 * Une preview Deezer est signee et **vaut quinze minutes**. Passe ce delai
 * l'URL rend 403, le lecteur ne charge jamais, et rien ne le dit : ni erreur,
 * ni exception, ni statut. La bonne nouvelle est que la date limite voyage en
 * clair dans l'URL — on n'a donc aucune raison d'attendre huit secondes pour
 * decouvrir ce qu'elle annonce d'avance. */
const MARGE_EXTRAIT_S = 20;

/** Combien de fois on refait un lecteur pour la meme carte avant d'abandonner.
 *
 * Sans cette borne, une URL de preview expiree ferait tourner la
 * reconstruction sans fin — et le probleme ne serait plus le silence mais la
 * batterie. */
const MAX_RECONSTRUCTIONS = 2;

/**
 * La montee du son d'une carte neuve.
 *
 * Salimpoor et al. (Nature Neuroscience, 2011) mesurent une dissociation
 * anatomique : la dopamine de l'**anticipation** musicale se libere dans le
 * caudate pendant la montee vers le pic, celle du pic dans le noyau accumbens
 * — « l'anticipation d'une recompense abstraite libere la dopamine dans une
 * voie distincte du plaisir lui-meme ». Un extrait qui claque d'un bloc saute
 * la moitie du mecanisme : la montee EST du plaisir, pas un delai avant lui.
 *
 * Trois cent cinquante millisecondes, et pas plus : c'est un arc
 * tension-resolution, pas un temps de chargement. Et il est **garanti fini**
 * — un minuteur independant ramene le volume a un meme si la rampe echoue,
 * parce qu'une carte muette par accident serait exactement le defaut que ce
 * fichier existe pour rendre impossible.
 */
const MONTREE_MS = 350;
const MONTREE_PAS_MS = 40;

/**
 * Comment obtenir une URL de preview fraiche pour une carte.
 *
 * Injecte, et non importe : le lecteur n'a pas a connaitre l'API du moteur,
 * et cette separation permet de l'eprouver hors appareil en ne simulant
 * qu'`expo-audio`.
 */
export type ResolveurExtrait = (trackId: number) => Promise<string | null>;

/**
 * Jusqu'a quand cette URL d'extrait est valable, en secondes epoch.
 *
 * Deezer joint la date limite en clair : `?hdnea=exp=1787435790~acl=...`.
 * `null` quand l'URL n'est pas signee — on la considere alors valable, faute
 * de savoir dire le contraire.
 */
function peremption(url: string): number | null {
  const i = url.indexOf('hdnea=');
  if (i < 0) return null;
  const exp = url
    .slice(i + 6)
    .split('~')
    .find((p) => p.startsWith('exp='));
  if (!exp) return null;
  const n = Number.parseInt(exp.slice(4), 10);
  return Number.isFinite(n) ? n : null;
}

/** Vrai si l'extrait tiendra encore `MARGE_EXTRAIT_S` secondes. */
function extraitValable(url: string): boolean {
  const exp = peremption(url);
  return exp === null || exp - Date.now() / 1000 >= MARGE_EXTRAIT_S;
}

class PreviewPlayer {
  private resolveur: ResolveurExtrait | null = null;

  /** Branche la re-resolution des extraits expires. */
  setResolveur(r: ResolveurExtrait) {
    this.resolveur = r;
  }

  private players = new Map<number, AudioPlayer>();

  /**
   * De quoi refaire un lecteur.
   *
   * On garde la carte a cote du lecteur, et pas seulement le lecteur : un
   * lecteur peut mourir — le systeme en coupe, l'arriere-plan les invalide —
   * et sans l'URL de l'extrait il n'y a aucun moyen d'en refaire un. C'est
   * leger : quelques champs de texte par carte.
   */
  private tracks = new Map<number, Track>();

  private current: AudioPlayer | null = null;
  private currentId: number | null = null;
  private currentTrack: Track | null = null;
  private configured = false;

  /** Combien de fois on a deja refait le lecteur de telle carte. */
  private reconstructions = new Map<number, number>();

  /**
   * Numero de la demande de lecture en cours.
   *
   * Chaque appel a `play()` l'incremente. Toute etape asynchrone verifie
   * ensuite qu'elle appartient toujours a la demande courante : sans ce
   * garde-fou, un extrait dont le chargement se termine tard demarrerait
   * par-dessus la carte suivante, deux sons en meme temps.
   */
  private generation = 0;

  /** Vrai tant que l'app veut du son (faux en arriere-plan). */
  private wantPlaying = false;

  private sustainTimer: ReturnType<typeof setInterval> | null = null;

  private relances = 0;

  /**
   * Les extraits a preparer, mis de cote tant que celui de la carte a l'ecran
   * n'est pas arrive.
   *
   * Le prechargement telecharge chaque extrait **en entier** (1 Mo environ).
   * Lance pendant que le titre a l'ecran est lui-meme en train de se charger,
   * il lui dispute la bande passante et le fait arriver deux fois plus tard.
   *
   * La condition de liberation a longtemps ete « le titre courant a du son ».
   * C'est trop tard, et surtout ca se bloque : sur un reseau ou une carte
   * n'arrive jamais a sonner avant le swipe suivant, la file n'etait plus jamais
   * videe, donc rien n'etait plus jamais prepare, donc plus aucune carte
   * n'arrivait a sonner. Le bon signal est **l'extrait entierement telecharge**.
   * Passe ce point le reseau est libre : ce qui reste avant le son est
   * l'allumage d'AVPlayer, pas du debit.
   *
   * Et c'est bien ce que `isLoaded` veut dire ici. Le commentaire de ce fichier
   * a longtemps affirme le contraire — « `isLoaded` passe a vrai des que la
   * lecture est possible, pas quand tout est arrive ». C'est vrai en streaming,
   * faux avec `downloadFirst` : dans ce mode `createAudioPlayer` fabrique le
   * lecteur **sans source**, telecharge le fichier en entier, puis seulement
   * lui donne l'extrait local (`ExpoAudio.js`). Tant que le telechargement dure
   * il n'y a pas d'item, donc pas de `isLoaded`.
   */
  private enAttente: Track[] = [];

  /** Vrai tant qu'une preparation est en cours : elles se font a la queue leu leu. */
  private preparation = false;

  /** Change de valeur quand la preparation en cours n'a plus lieu d'etre. */
  private preparationJeton = 0;

  /** Vrai des que l'extrait de la carte a l'ecran est entierement telecharge. */
  private extraitCourantArrive = false;

  /** Autorise le son meme si le telephone est en mode silencieux (iOS). */
  private async configure() {
    if (this.configured) return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    // **Reactiver la session explicitement.**
    //
    // `suspend()` la desactive lui-meme (`setIsAudioActiveAsync(false)`) —
    // donc la reaction doit etre symetrique, et elle ne l'etait pas :
    // `setAudioModeAsync` avec des options **identiques** peut court-circuiter
    // sans reactiver la session AVAudioSession sous-jacente. Or un `play()`
    // sur une session inactive ne fait **rien du tout** — ni erreur, ni
    // exception, ni statut. C'etait le silence du retour d'arriere-plan long :
    // le chien de garde relancait trois fois, reconstruisait deux fois, puis
    // abandonnait sur un lecteur qui n'avait jamais pu sortir un son, parce
    // que la porte etait fermee — pas le lecteur.
    await setIsAudioActiveAsync(true).catch(() => {});
    this.configured = true;
  }

  private acquire(track: Track): AudioPlayer {
    const known = this.players.get(track.id);
    if (known) return known;
    const p = createAudioPlayer(
      { uri: track.preview },
      {
        // Telecharger l'extrait en entier avant de le lire, au lieu de le
        // streamer.
        //
        // C'est la correction du figeage a ~0,5 s, diagnostique sur appareil :
        // AVPlayer passait en `waitingToPlayAtSpecifiedRate` avec la raison
        // `evaluatingBufferingRate`. Autrement dit il ne bufferisait pas — il
        // *jugeait* le debit reseau insuffisant et refusait de demarrer. Et
        // c'etait notre propre prechargement qui saturait la bande passante :
        // le mecanisme cense supprimer les blancs les provoquait.
        //
        // Un extrait de 30 s pese environ 1 Mo. Une fois sur le disque, la
        // lecture ne depend plus du reseau.
        downloadFirst: true,
        updateInterval: 250,
        // Ne jamais laisser un lecteur rendre la session audio en se mettant
        // en pause.
        //
        // C'est la cause du son qui part une seconde et revient une seconde, et
        // elle est dans le module natif, pas ici. `pause()` y **programme la
        // coupure de la session audio partagee cent millisecondes plus tard**
        // (`deactivateSession`, AudioModule.swift), et cette coupure n'est
        // annulee que si un lecteur est deja passe a
        // `timeControlStatus == .playing`. Or on met en pause la carte qu'on
        // quitte et on lance la suivante dans la meme milliseconde : entre les
        // deux, AVPlayer traverse `waitingToPlayAtSpecifiedRate`, le temps
        // d'activer la session et de monter la route audio. Des que ce temps
        // depasse cent millisecondes, la session est coupee **sous** une carte
        // qui venait de commencer. Le son s'arrete, `sustain` le voit deux
        // releves plus tard et relance, et le son revient.
        //
        // `keepAudioSessionActive` supprime cette programmation. La session est
        // alors rendue explicitement, dans `suspend()` et `release()`. Aucune
        // consequence pour les autres apps : le mode est `mixWithOthers`.
        keepAudioSessionActive: true,
      },
    );
    p.loop = true; // 30 s passent vite ; reboucler vaut mieux que du silence
    this.players.set(track.id, p);
    this.tracks.set(track.id, track);
    return p;
  }

  /**
   * Rend vraiment le lecteur au systeme.
   *
   * **`remove()` ne libere rien.** Cote Android il se contente de retirer
   * l'entree de la map du module (`AudioModule.kt` :
   * `Function("remove") { players.remove(player.id) }`), et l'ExoPlayer sous-
   * jacent n'est detruit qu'au `sharedObjectDidRelease`, c'est-a-dire **quand
   * le ramasse-miettes JS finit par passer sur l'objet**. Or chaque ExoPlayer
   * retient un `MediaCodec`, et Android en plafonne le nombre par processus :
   * au douzieme titre environ, plus aucun decodeur n'est disponible, le son
   * s'arrete **sans la moindre erreur**, et seul un redemarrage de l'app le
   * ramene. Signale sur appareil le 2026-08-23.
   *
   * `release()`, herite de `SharedObject`, detache l'objet JS de son homologue
   * natif immediatement et declenche donc `ref.release()` sans attendre le
   * ramasse-miettes. C'est la seule facon de rendre un decodeur.
   *
   * L'ordre compte : **pause, puis `remove`, puis `release`**. La pause parce
   * qu'un lecteur abandonne en pleine lecture continue de jouer (iOS) ;
   * `remove` avant `release` parce qu'apres detachement, passer l'objet a une
   * fonction native leve.
   *
   * **Apres cet appel l'objet est mort** : lire n'importe laquelle de ses
   * proprietes leve. C'est pourquoi `awaitLoaded` et `sustain` protegent leurs
   * acces — une preparation en vol peut viser un lecteur qu'on vient de jeter.
   */
  private rendre(p: AudioPlayer) {
    try {
      p.pause();
    } catch {
      // Deja detache : il n'y a plus rien a mettre en pause.
    }
    try {
      p.remove();
    } catch {
      // Deja hors du registre du module.
    }
    try {
      p.release();
    } catch {
      // Socle plus ancien sans `release()` : on retombe sur l'ancien
      // comportement — le decodeur partira au ramasse-miettes — plutot que de
      // faire echouer la liberation des autres.
    }
  }

  /** Jette le lecteur d'une carte. Le suivant sera refait a neuf. */
  private discard(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    this.rendre(p);
    this.players.delete(id);
    if (this.currentId === id) this.current = null;
  }

  /** Prepare les prochaines cartes sans les jouer.
   *
   *  Les extraits deja perimes sont ignores : fabriquer un lecteur condamne ne
   *  ferait qu'occuper un pipeline de decodage pour rien. `play` les
   *  re-resoudra le moment venu. */
  preload(tracks: Track[]) {
    // La file de preparation est **remplacee**, pas allongee : `preload` recoit
    // les cartes du moment, et celles d'avant ne valent plus rien.
    this.enAttente = tracks
      .slice(0, PRELOAD_AHEAD)
      .filter((t) => extraitValable(t.preview) && !this.players.has(t.id));

    // Rien ne se telecharge tant que l'extrait a l'ecran n'est pas arrive : ce
    // qu'on entend passe avant ce qu'on entendra.
    if (!this.extraitCourantArrive) {
      this.trace(`preload differe (${this.enAttente.length}) — l'extrait courant n'est pas arrive`);
      return;
    }
    void this.servirAttente();
  }

  /** Lance les preparations mises de cote. */
  private viderAttente() {
    if (this.enAttente.length === 0) return;
    this.trace(`preload relance (${this.enAttente.length})`);
    void this.servirAttente();
  }

  /**
   * Prepare les extraits **un par un**.
   *
   * Deux telechargements simultanes ne vont pas deux fois plus vite : ils vont
   * chacun deux fois moins vite. Sur reseau mobile, preparer la carte suivante
   * et celle d'apres en meme temps faisait arriver la suivante deux fois trop
   * tard — elle passait a l'ecran muette, alors que seule sa voisine avait
   * besoin d'attendre. La regle du fichier vaut aussi entre deux cartes a
   * venir : ce qu'on entendra tout de suite passe avant ce qu'on entendra
   * apres.
   *
   * La boucle relit `enAttente` a chaque tour, et l'attente est abandonnee des
   * qu'un swipe change de carte : la file a alors ete refaite avec les bonnes
   * priorites, et il n'y a aucune raison de finir de preparer l'ancienne.
   */
  private async servirAttente() {
    if (this.preparation) return;
    this.preparation = true;
    const jeton = this.preparationJeton;
    try {
      for (;;) {
        if (jeton !== this.preparationJeton) return;
        if (!this.extraitCourantArrive) return;
        const t = this.enAttente.shift();
        if (!t) return;
        if (this.players.has(t.id)) continue;
        const p = this.acquire(t);
        if (!p.isLoaded) await this.awaitLoaded(p, this.generation);
      }
    } finally {
      // Ne pas rendre la place si elle a change de main entre-temps.
      if (jeton === this.preparationJeton) this.preparation = false;
    }
  }

  /**
   * Abandonne la preparation en cours.
   *
   * Une preparation vit dans une promesse, et on ne peut pas la rappeler : le
   * jeton est le seul moyen de lui faire savoir qu'elle ne sert plus a rien.
   * Sans lui, un lecteur mis en attente juste avant un `release()` gardait le
   * verrou de preparation — et la session suivante ne preparait plus rien tant
   * qu'il n'avait pas rendu la main.
   */
  private annulerPreparation() {
    this.preparationJeton++;
    this.preparation = false;
    this.enAttente = [];
  }

  private trace(msg: string) {
    // Diagnostique precieux en developpement, I/O de plus sur le chemin chaud
    // en production : chaque swipe, chaque preload, chaque releve passait ici.
    if (!__DEV__) return;
    console.log(`[snd ${Date.now() % 100000}] ${msg} cur=${this.currentId} gen=${this.generation}`);
  }

  /**
   * Fait monter le volume d'un lecteur qui vient de partir.
   *
   * Seulement sur un **demarrage neuf** — une reprise ou un retour
   * d'arriere-plan rejoue une carte deja ecoutee, et lui refaire traverser le
   * silence serait une panne, pas une montee. La rampe s'arrete d'elle-meme si
   * la carte change (generation) ou si le lecteur est rendu au systeme ; le
   * minuteur final garantit le plein volume quoi qu'il arrive.
   */
  private monter(p: AudioPlayer, gen: number) {
    const total = Math.ceil(MONTREE_MS / MONTREE_PAS_MS);
    let i = 0;
    const iv = setInterval(() => {
      if (gen !== this.generation || this.currentId === null) {
        clearInterval(iv);
        return;
      }
      i++;
      try {
        p.volume = Math.min(1, i / total);
      } catch {
        // Lecteur rendu entre-temps : la garantie finale ci-dessous ne le
        // ressuscitera pas, mais elle ne coutera rien non plus.
        clearInterval(iv);
        return;
      }
      if (i >= total) clearInterval(iv);
    }, MONTREE_PAS_MS);
    setTimeout(() => {
      try {
        p.volume = 1;
      } catch {
        // Mort : il n'y a plus rien a monter.
      }
    }, MONTREE_MS + 120);
  }

  /** Echantillonne la position pour reperer une coupure apres demarrage. */
  private probe(p: AudioPlayer, id: number, gen: number) {
    let started = false;
    let n = 0;
    let last = -1;
    /** Releves consecutifs ou tout avance normalement. */
    let sains = 0;
    let statut: import('expo-audio').AudioStatus | null = null;
    const sub = p.addListener('playbackStatusUpdate', (st) => {
      statut = st;
    });
    const iv = setInterval(() => {
      n++;
      // Ce releve est un mouchard, pas une fonction : si le lecteur a ete rendu
      // au systeme entre-temps, il n'a plus rien a observer et doit s'arreter
      // en silence. Sans cette garde, la sonde faisait planter l'app **apres**
      // que la fuite de decodeurs a ete corrigee — le correctif rendait
      // reellement les lecteurs, et elle continuait de les lire.
      let pos: number;
      try {
        pos = p.currentTime;
      } catch {
        clearInterval(iv);
        sub.remove();
        return;
      }
      if (pos > 0.05) started = true;
      const vivants = [...this.players.entries()]
        .filter(([, q]) => {
          try {
            return q.playing;
          } catch {
            return false;
          }
        })
        .map(([k]) => k);
      const fige = pos === last;
      last = pos;
      const courant = gen === this.generation && this.currentId === id;
      if (courant && started && (!p.playing || fige)) {
        this.trace(
          `!! STOP id=${id} pos=${pos.toFixed(2)} playing=${p.playing} ` +
            `buffering=${p.isBuffering} loaded=${p.isLoaded} ` +
            `attente="${statut?.reasonForWaitingToPlay}" ` +
            `ctrl="${statut?.timeControlStatus}" etat="${statut?.playbackState}" ` +
            `fini=${statut?.didJustFinish} vivants=[${vivants}]`,
        );
      }
      if (vivants.length > 1) this.trace(`!! SUPERPOSE vivants=[${vivants}]`);
      // Trois releves consecutifs ou la carte courante avance toute seule :
      // la sonde a ce qu'elle cherchait, partir avant son terme plutot que de
      // rester huit secondes par play — intervalle et ecouteur liberes.
      sains = courant && started && !fige && p.playing ? sains + 1 : 0;
      if (sains >= 3) {
        clearInterval(iv);
        sub.remove();
        return;
      }
      if (n >= 20 || gen !== this.generation) {
        clearInterval(iv);
        sub.remove();
      }
    }, 400);
  }

  async play(track: Track) {
    const gen = ++this.generation;
    this.wantPlaying = true;
    // Une nouvelle carte : on redonne la priorite a son extrait, et les
    // preparations attendront qu'il soit arrive.
    this.extraitCourantArrive = false;
    if (this.sustainTimer) clearInterval(this.sustainTimer);
    this.trace(`play(${track.id})`);

    // Rejouer la carte deja a l'ecran n'est pas un cas rare : l'ecran relance
    // sa demande de lecture des que la file de cartes change d'identite, et un
    // lot arrive en tache de fond suffit. Ce cas passait autrefois par un
    // raccourci — un `play()` sec, sans attendre le chargement ni armer la
    // surveillance. Quand le raccourci tombait pendant le chargement de
    // l'extrait, l'ordre etait perdu en silence et la carte restait muette
    // jusqu'au swipe suivant. Une reprise emprunte donc exactement le meme
    // chemin qu'un demarrage ; seuls le lecteur et la position sont conserves.
    const reprise = this.currentId === track.id && this.current !== null;
    const precedentId = this.currentId;
    const precedent = reprise ? null : this.current;

    // Prendre la carte **avant** le premier `await`.
    //
    // Tout ce qui suit est asynchrone ; l'ecran, lui, ne l'est pas. React
    // execute l'effet qui appelle `keepOnly` dans la foulee de celui qui appelle
    // `play`, sans laisser passer la moindre promesse — `keepOnly` lisait donc
    // encore l'identite de la carte qu'on vient de quitter. Il epargnait le
    // lecteur de celle-la et jetait celui d'une carte a venir : quatre
    // pipelines de decodage vivants la ou ce fichier n'en tolere que trois, et
    // c'est au-dela de trois qu'iOS en coupe un au hasard.
    this.currentId = track.id;
    this.currentTrack = track;
    if (!reprise) this.current = null;

    // Couper le precedent tout de suite, pour la meme raison : l'attente qui
    // suit peut durer plusieurs secondes sur reseau mobile, et deux extraits ne
    // doivent jamais se chevaucher.
    if (precedent) {
      this.trace(`pause(precedent=${precedentId})`);
      precedent.pause();
    }

    await this.configure();
    if (gen !== this.generation) return;

    // L'URL annonce sa propre date limite : autant la lire tout de suite. Sans
    // cela on fabriquait un lecteur condamne, on attendait huit secondes qu'il
    // ne charge pas, et le son arrivait dix secondes apres le swipe.
    let courant = track;
    if (!extraitValable(courant.preview)) {
      this.trace(`extrait perime id=${courant.id} -> re-resolution avant lecture`);
      const frais = await this.reResoudre(courant, gen);
      if (gen !== this.generation) return;
      if (frais) courant = frais;
    }

    // Deux essais : le second avec une URL d'extrait fraichement re-resolue.
    for (let essai = 0; essai < 2; essai++) {
      // `this.current` a pu etre remis a zero entre-temps par `discard` (une
      // re-resolution d'extrait perime) : une reprise n'a alors plus de lecteur
      // a reprendre, et il faut en refaire un.
      const reprend = reprise && essai === 0 && this.current !== null;
      const p = reprend ? this.current! : this.acquire(courant);
      this.current = p;
      this.currentId = courant.id;
      this.currentTrack = courant;

      // Attendre le chargement : c'est l'etape qui manquait a l'origine.
      if (!p.isLoaded) {
        const charge = await this.awaitLoaded(p, gen);
        if (gen !== this.generation) return;
        if (!charge) {
          // Ne PAS renoncer ici sans rien dire : c'etait le trou. Le chien de
          // garde n'est pas encore arme a ce stade, donc un abandon laissait
          // la carte definitivement muette, jusqu'au swipe suivant.
          const frais = await this.reResoudre(courant, gen);
          if (!frais) return;
          courant = frais;
          continue;
        }
      }

      // `seekTo` est asynchrone (il rend une promesse). Le declencher sans
      // l'attendre laisse le repositionnement se terminer apres le `play()` et
      // annuler la lecture. On ne l'appelle donc que si la position a vraiment
      // bouge, et on l'attend. Sur une reprise on ne rembobine pas : la carte
      // est deja a l'ecran, l'utilisateur est en train de l'ecouter.
      if (!reprend && p.currentTime > PLAYING_THRESHOLD_S) {
        await p.seekTo(0);
        if (gen !== this.generation) return;
      }

      this.trace(`START id=${courant.id}${reprend ? ' (reprise)' : ''}`);
      // La montee ne concerne que les cartes NEUVES : une reprise est une
      // carte deja en cours d'ecoute, la faire repartir du silence serait une
      // coupure deguisee.
      if (!reprend) {
        try {
          p.volume = 0;
        } catch {
          // Rien : le minuteur de garantie remettra le plein volume.
        }
      }
      p.play();
      if (!reprend) this.monter(p, gen);

      // L'extrait a l'ecran est sur le disque : le reseau ne lui sert plus a
      // rien, les suivants peuvent enfin s'y mettre.
      this.extraitCourantArrive = true;
      this.viderAttente();
      this.sustain(p, courant.id, gen);
      this.probe(p, courant.id, gen);
      return;
    }

    this.trace(`!! MUET id=${track.id} — deux essais, aucun extrait jouable`);
  }

  /**
   * Redemande au moteur une URL d'extrait, et refait un lecteur avec.
   *
   * **Les URLs de preview Deezer sont signees et expirent** (`?hdnea=exp=...`).
   * Une carte restee un moment dans la file porte donc une URL morte, et le
   * lecteur ne charge jamais : silence complet, sans erreur ni exception. Le
   * moteur sait re-resoudre un titre (`GET /track/{id}`) — cette capacite
   * existait depuis le debut mais n'etait appelee de nulle part.
   *
   * @returns la carte avec un extrait frais, ou `null` s'il n'y a rien a tenter
   */
  private async reResoudre(track: Track, gen: number): Promise<Track | null> {
    if (!this.resolveur) {
      this.trace(`!! CHARGEMENT ECHOUE id=${track.id} (aucun resolveur branche)`);
      return null;
    }
    this.trace(`re-resolution de l'extrait id=${track.id}`);

    const preview = await this.resolveur(track.id).catch(() => null);
    if (gen !== this.generation) return null;
    if (!preview) {
      this.trace(`!! RE-RESOLUTION SANS REPONSE id=${track.id}`);
      return null;
    }
    if (preview === track.preview) {
      // Meme adresse : ce n'est donc pas une expiration, et refaire un lecteur
      // sur exactement la meme source ne donnerait rien de plus.
      this.trace(`!! MEME URL id=${track.id} — le probleme est ailleurs`);
      return null;
    }

    this.discard(track.id);
    return { ...track, preview };
  }

  /**
   * Attend que le lecteur soit chargé, ou renonce.
   *
   * L'abonnement au statut ne suffit pas, et c'est contre-intuitif : **un
   * lecteur en cours de telechargement n'emet rien**. Avec `downloadFirst` il
   * n'a pas encore d'item, donc pas d'observateur de temps, et la seule chose
   * qui declenche un statut est le passage de l'item a `readyToPlay` — c'est-a-
   * dire la fin de l'attente elle-meme. Tant qu'on n'ecoutait que le statut, la
   * seule facon de sortir plus tot etait le delai d'abandon de huit secondes :
   * un swipe ne reveillait rien, et une preparation restait accrochee a une
   * carte que l'utilisateur avait deja quittee.
   *
   * D'ou le releve periodique, qui rend le garde-fou de generation reellement
   * operant.
   *
   * @returns `false` si le chargement n'a pas abouti, ou si la carte a change.
   */
  private awaitLoaded(p: AudioPlayer, gen: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(releve);
        sub.remove();
        resolve(ok);
      };

      const juger = () => {
        if (gen !== this.generation) return finish(false);
        // Le lecteur a pu etre rendu au systeme pendant l'attente. Lire une de
        // ses proprietes leve alors, et l'exception remonterait depuis un
        // `setInterval`, ou personne ne l'attrape.
        try {
          if (p.isLoaded) finish(true);
        } catch {
          finish(false);
        }
      };

      const sub = p.addListener('playbackStatusUpdate', juger);
      const releve = setInterval(juger, SUSTAIN_TICK_MS);
      const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

      // Le statut a pu passer a « chargé » entre le test appelant et
      // l'abonnement ci-dessus.
      juger();
    });
  }

  /**
   * Maintient la lecture, en la reclamant jusqu'a ce qu'elle parte vraiment.
   *
   * Mesure sur appareil : un `play()` emis dans la meme milliseconde que le
   * `pause()` du titre precedent est **ignore une fois sur deux**, sans erreur
   * ni exception — iOS n'a pas fini de basculer sa session audio. Un `play()`
   * n'est donc pas un ordre mais une requete, et il faut la confirmer.
   *
   * On surveille aussi la stagnation apres demarrage : si la position cesse
   * d'avancer alors que la carte est toujours a l'ecran, on relance.
   */
  private sustain(p: AudioPlayer, id: number, gen: number) {
    // Partir de la position reelle, jamais d'une valeur impossible.
    //
    // `last` valait `-1`, et `currentTime` rend **zero** tant qu'aucun extrait
    // n'est charge (`ref.currentItem?.currentTime().seconds ?? 0.0`, cote
    // natif). Le tout premier releve concluait donc que le son avait avance —
    // de `-1` a `0` — alors qu'il n'etait pas encore sorti : la carte etait
    // declaree partie cent cinquante millisecondes apres chaque `play()`, quoi
    // qu'il arrive. Un chien de garde qui se croit toujours rassure ne garde
    // rien.
    let last = p.currentTime;
    let stalls = 0;
    let demandes = 0;
    const iv = setInterval(() => {
      // La carte a change, ou l'app a demande le silence : on lache.
      if (gen !== this.generation || this.currentId !== id || !this.wantPlaying) {
        clearInterval(iv);
        return;
      }
      // Meme raison qu'en haut : si le lecteur a ete rendu, tout acces leve.
      let pos: number;
      try {
        pos = p.currentTime;
      } catch {
        clearInterval(iv);
        return;
      }
      const avance = pos > last + 0.01;
      last = pos;
      if (avance) {
        // Le son sort : on efface l'ardoise, y compris les reconstructions,
        // pour qu'un hoquet passager ne compte pas contre la carte suivante.
        stalls = 0;
        demandes = 0;
        this.reconstructions.delete(id);
        return;
      }
      // Bufferisation : le lecteur n'est pas mort, il attend des donnees.
      // Le relancer ne sert a rien, et le reconstruire est nuisible — cela
      // jette l'extrait a moitie telecharge pour le retelecharger depuis le
      // debut, ce qui allonge le silence au lieu de l'abreger. On laisse donc
      // filer sans rien compter contre lui.
      if (p.isBuffering) {
        this.trace(`bufferise id=${id} pos=${pos.toFixed(2)} — on attend`);
        return;
      }

      // Deux releves sans progression : la lecture n'est pas partie, ou s'est
      // arretee seule.
      if (++stalls < 2 || !p.isLoaded) return;
      stalls = 0;

      if (++demandes <= MAX_RELANCES) {
        this.relances++;
        this.trace(`sustain relance ${demandes}/${MAX_RELANCES} id=${id} pos=${pos.toFixed(2)}`);
        p.play();
        return;
      }

      // Trois demandes ignorees d'affilee : cet objet ne joue plus et ne
      // rejouera plus. Lui reparler indefiniment est exactement ce qui faisait
      // apparaitre et disparaitre le son. On en refait un.
      clearInterval(iv);
      const track = this.tracks.get(id);
      const deja = this.reconstructions.get(id) ?? 0;
      if (!track || deja >= MAX_RECONSTRUCTIONS) {
        this.trace(`!! ABANDON id=${id} apres ${deja} reconstruction(s)`);
        return;
      }
      this.reconstructions.set(id, deja + 1);
      this.trace(`!! LECTEUR MORT id=${id} -> reconstruction ${deja + 1}/${MAX_RECONSTRUCTIONS}`);
      this.discard(id);
      // `currentId` remis a zero pour que `play` reparte d'un lecteur neuf au
      // lieu de croire a une reprise et de reprendre le mort.
      this.currentId = null;
      void this.play(track);
    }, SUSTAIN_TICK_MS);
    this.sustainTimer = iv;
  }

  pause() {
    this.trace('pause() externe');
    this.wantPlaying = false;
    if (this.sustainTimer) clearInterval(this.sustainTimer);
    this.current?.pause();
  }

  /**
   * L'app part en arriere-plan.
   *
   * Mettre en pause ne suffit pas. iOS desactive la session audio, et **les
   * lecteurs crees avant en sortent inutilisables** : `play()` sur eux ne fait
   * plus rien, sans erreur ni log. C'est ce qui rendait muette la carte
   * suivant un retour d'arriere-plan alors que celle d'apres marchait — le
   * lecteur de la premiere avait ete prepare avant la mise en veille, celui de
   * la seconde naissait apres.
   *
   * On les jette donc tous. Les cartes, elles, sont conservees : c'est tout ce
   * qu'il faut pour en refaire.
   */
  suspend() {
    this.trace(`suspend() lecteurs=${this.players.size}`);
    this.wantPlaying = false;
    this.extraitCourantArrive = false;
    this.annulerPreparation();
    this.generation++;
    if (this.sustainTimer) clearInterval(this.sustainTimer);
    // Arreter avant de jeter. `remove()` ne fait que **desinscrire** le lecteur
    // du module natif (`Function("remove")` -> `registry.remove`) : il ne
    // l'arrete pas. Un lecteur jete en pleine lecture continuerait donc de
    // jouer, et plus personne ne tiendrait la reference pour l'interrompre.
    this.current?.pause();
    for (const p of this.players.values()) this.rendre(p);
    this.players.clear();
    this.current = null;
    this.currentId = null;
    // Rendre la session audio. Nos lecteurs ne la lachent plus d'eux-memes
    // (`keepAudioSessionActive`), et rien ne doit rester accroche a la sortie
    // audio pendant que l'app dort. C'est fait ici, une fois le registre natif
    // vide, pour qu'aucun lecteur ne soit marque « jouait avant » et remis en
    // route tout seul au retour au premier plan.
    void setIsAudioActiveAsync(false).catch(() => {});
    // La session audio devra etre reappliquee : sans cela le son ne sortirait
    // plus en mode silencieux au retour.
    this.configured = false;
  }

  /**
   * Reprend apres un retour d'arriere-plan ou un retour sur l'onglet.
   *
   * Si l'arriere-plan a tout emporte, on refait le lecteur de la carte
   * courante au lieu de relancer un objet qui n'existe plus.
   */
  resume() {
    if (!this.current && this.currentTrack) {
      this.trace('resume() -> reconstruction');
      void this.play(this.currentTrack);
      return;
    }

    const p = this.current;
    const id = this.currentId;
    if (!p || id === null) return;
    this.trace('resume()');
    this.wantPlaying = true;
    if (this.sustainTimer) clearInterval(this.sustainTimer);
    const gen = ++this.generation;
    void (async () => {
      // Ce chemin ne passe pas par `play()`, donc pas par `configure()` : si
      // la session a ete desactivee sous nos pieds (suspend suivi d'un etat
      // improbable ou le lecteur aurait survecu), la reactiver AVANT de
      // parler au lecteur — un play() sur session inactive est un silence
      // sans erreur.
      if (!this.configured) await this.configure();
      if (gen !== this.generation || this.currentId !== id) return;
      if (!p.isLoaded) {
        const ok = await this.awaitLoaded(p, gen);
        if (!ok) return;
      }
      if (gen !== this.generation || this.currentId !== id) return;
      p.play();
      this.sustain(p, id, gen);
    })();
  }

  /** Position de lecture en millisecondes — la matiere du signal envoye au moteur.
   *
   *  Le lecteur peut avoir ete rendu au systeme entre le test `current` et la
   *  lecture de sa propriete (un swipe qui declenche `discard`) : lire leve
   *  alors, et l'exception partirait dans le handler du geste. Zero est la
   *  reponse honnete d'un lecteur mort — un skip a zero milliseconde, pas un
   *  crash. */
  positionMs(): number {
    try {
      return Math.max(0, (this.current?.currentTime ?? 0) * 1000);
    } catch {
      return 0;
    }
  }

  durationMs(): number {
    try {
      const d = (this.current?.duration ?? 0) * 1000;
      return d > 0 && Number.isFinite(d) ? d : 30000;
    } catch {
      return 30000;
    }
  }

  /** Libere tout sauf les titres encore utiles. */
  keepOnly(ids: number[]) {
    const keep = new Set(ids);
    for (const [id, p] of this.players) {
      if (keep.has(id)) continue;
      if (id === this.currentId) continue;
      if (p.playing) this.trace(`!! REMOVE d'un lecteur EN LECTURE id=${id}`);
      this.rendre(p);
      this.players.delete(id);
      this.tracks.delete(id);
      this.reconstructions.delete(id);
    }
  }

  release() {
    this.generation++;
    this.wantPlaying = false;
    this.extraitCourantArrive = false;
    this.annulerPreparation();
    if (this.sustainTimer) clearInterval(this.sustainTimer);
    this.current?.pause();
    for (const p of this.players.values()) this.rendre(p);
    this.players.clear();
    this.tracks.clear();
    this.reconstructions.clear();
    this.current = null;
    this.currentId = null;
    this.currentTrack = null;
    void setIsAudioActiveAsync(false).catch(() => {});
  }
}

export const player = new PreviewPlayer();
