import { useCallback, useEffect, useRef, useState } from 'react';
import { prisme } from '../api/client';
import type { Card, SwipeAction } from '../api/types';
import { player } from '../audio/player';

/**
 * Les extraits Deezer sont signes et expirent en quinze minutes ; le lecteur
 * doit savoir en redemander un frais.
 *
 * **Pose ici aussi, et pas seulement dans `useFeed`.** C'est un effet de bord
 * de module : il n'a lieu que si le module est importe, et l'ecran d'un salon
 * n'importe pas le fil normal. Le manque ne se serait pas vu tout de suite —
 * l'app demarre sur le fil, donc `useFeed` a en general deja ete evalue — mais
 * il aurait suffi d'un chemin de navigation different pour que le mix devienne
 * muet, sans erreur ni journal.
 *
 * Et il mord **plus fort ici** qu'ailleurs : le titre d'un accord est relu
 * depuis la base, ou il dort depuis des heures. Sa signature est donc morte a
 * tous les coups, et sans resolveur la popup serait silencieuse par
 * construction. Poser le meme resolveur deux fois ne coute rien.
 */
player.setResolveur(async (trackId) => (await prisme.refreshTrack(trackId)).preview);

/**
 * Le fil d'un salon de mix.
 *
 * Repris terme a terme de [[useFeed]], jusqu'aux seuils : deux personnes qui
 * swipent a des rythmes differents sur le meme paquet, ce sont deux appels a
 * ce hook, un par telephone, chacun avec son propre `roomId`. Rien d'autre a
 * synchroniser cote app — le serveur tient le paquet commun et les positions.
 *
 * Deux differences avec le fil normal, et c'est tout :
 *  - `nextCards`/`event` deviennent `mixNext`/`mixEvent`, scopes au salon ;
 *  - il n'y a pas de mode « remplacer » au premier chargement suivi d'un
 *    « ajouter » ensuite avec deux tailles de lot differentes : un salon de
 *    mix est un usage occasionnel, pas le fil principal, et la meme taille de
 *    lot partout reste largement assez reactive ici.
 */
const LOT = 8;
const REFILL_AT = 4;

type State = {
  cards: Card[];
  loading: boolean;
  error: string | null;
};

function sansDoublon(actuelles: Card[], arrivantes: Card[]): Card[] {
  const connus = new Set(actuelles.map((c) => c.track.id));
  const neuves = arrivantes.filter((c) => {
    if (connus.has(c.track.id)) return false;
    connus.add(c.track.id);
    return true;
  });
  return [...actuelles, ...neuves];
}

/**
 * @param muet coupe la lecture de la carte a l'ecran — le temps qu'un accord
 *        soit revele, c'est **son** extrait qu'on doit entendre, pas celui de
 *        la carte qui attend dessous. Le lecteur etant unique, il suffit que
 *        ce fil se taise : l'ecran joue alors le titre de l'accord, et la
 *        carte reprend d'elle-meme quand le drapeau retombe (l'effet
 *        ci-dessous se rejoue, et le chronometre d'ecoute repart de zero —
 *        le temps passe devant la popup n'est pas du temps d'ecoute).
 */
export function useMixFeed(roomId: number | null, muet = false) {
  const [state, setState] = useState<State>({ cards: [], loading: true, error: null });
  const fetching = useRef(false);
  const modeEnAttente = useRef<'replace' | 'append' | null>(null);
  const startedAt = useRef<number>(Date.now());

  const load = useCallback(
    async (mode: 'replace' | 'append') => {
      if (roomId === null) return;
      if (fetching.current) {
        modeEnAttente.current = mode;
        return;
      }
      fetching.current = true;
      try {
        const { cards } = await prisme.mixNext(roomId, LOT);
        setState((s) => ({
          ...s,
          cards: mode === 'replace' ? cards : sansDoublon(s.cards, cards),
          loading: false,
          error: null,
        }));
      } catch (e) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : 'Erreur inconnue',
        }));
      } finally {
        fetching.current = false;
        const suivant = modeEnAttente.current;
        modeEnAttente.current = null;
        if (suivant && suivant !== mode) void load(suivant);
      }
    },
    [roomId],
  );

  useEffect(() => {
    setState({ cards: [], loading: true, error: null });
    if (roomId !== null) void load('replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const topId = state.cards[0]?.track.id ?? null;

  useEffect(() => {
    const top = state.cards[0];
    // `muet` est dans les dependances a dessein : quand il retombe, cet effet
    // se rejoue et la carte reprend la parole toute seule. Rien n'est mis en
    // pause ici — l'ecran joue l'extrait de l'accord sur le meme lecteur, et
    // `play()` coupe le precedent de lui-meme.
    if (!top || muet) return;
    startedAt.current = Date.now();
    void player.play(top.track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId, muet]);

  useEffect(() => {
    if (state.cards.length === 0) return;
    player.preload(state.cards.slice(1, 3).map((c) => c.track));
    player.keepOnly(state.cards.slice(0, 3).map((c) => c.track.id));
  }, [state.cards]);

  useEffect(() => () => player.release(), []);

  const decide = useCallback(
    async (action: SwipeAction) => {
      const top = state.cards[0];
      if (!top || roomId === null) return;

      const msPlayed = Math.min(player.positionMs(), Date.now() - startedAt.current);
      const previewMs = player.durationMs();

      const rest = state.cards.slice(1);
      setState((s) => ({ ...s, cards: s.cards.slice(1) }));
      if (rest.length <= REFILL_AT) void load('append');

      prisme.mixEvent(roomId, { track: top.track, action, msPlayed, previewMs }).catch(() => {});
    },
    [state.cards, roomId, load],
  );

  return {
    ...state,
    decide,
    reload: () => load('replace'),
    pause: () => player.pause(),
    resume: () => player.resume(),
  };
}
