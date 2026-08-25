import { useCallback, useEffect, useRef, useState } from 'react';
import { prisme } from '../api/client';
import type { Card, SwipeAction } from '../api/types';
import { player } from '../audio/player';

// Les URLs de preview Deezer sont signees et expirent : une carte restee un
// moment dans la file porte une adresse morte, et le lecteur reste alors
// parfaitement muet. On donne au lecteur le moyen d'en redemander une fraiche.
player.setResolveur(async (trackId) => (await prisme.refreshTrack(trackId)).preview);

/** En dessous de ce reste, on demande le lot suivant sans attendre.
 *
 * Le seuil est une duree deguisee : quatre cartes, c'est une douzaine de
 * secondes de swipe. Un lot qui met plus longtemps a venir laisse la file se
 * vider, et l'ecran d'erreur apparait alors qu'aucune requete n'a echoue — elle
 * n'est simplement pas encore revenue. Six cartes donnent une vingtaine de
 * secondes, soit plus que le delai d'abandon du client. */
const REFILL_AT = 6;

type State = {
  cards: Card[];
  loading: boolean;
  error: string | null;
  /** Taux d'accroche renvoye par le moteur, pour l'ecran Prisme. */
};

/**
 * Le fil.
 *
 * Deux invariants tiennent l'experience :
 *  1. **jamais de file vide** — on recharge des qu'il reste quatre cartes, en
 *     tache de fond, pour que l'utilisateur ne voie aucun ecran d'attente ;
 *  2. **jamais de silence** — les extraits suivants sont prepares avant
 *     d'arriver a l'ecran.
 */
/**
 * Ajoute un lot en ecartant ce qu'on tient deja.
 *
 * Le moteur exclut normalement les titres deja servis, mais cette garantie
 * n'est pas absolue : elle repose sur une table `seen_tracks` qui peut avoir
 * ete purgee, dont l'ecriture est tolerante a l'echec, et qui repart de zero
 * si le compte est supprime pendant qu'une file est a l'ecran. Un titre en
 * double n'est alors pas une faute du moteur, c'est un cas legitime.
 *
 * Cote app il n'est pas tolerable pour autant : deux cartes de meme identite
 * donnent deux enfants React avec la meme cle, et React previent alors que les
 * enfants « peuvent etre dupliques et/ou omis ». La cle de rendu doit etre
 * unique quoi qu'annonce le serveur.
 */
function sansDoublon(actuelles: Card[], arrivantes: Card[]): Card[] {
  const connus = new Set(actuelles.map((c) => c.track.id));
  const neuves = arrivantes.filter((c) => {
    if (connus.has(c.track.id)) return false;
    connus.add(c.track.id);
    return true;
  });
  return [...actuelles, ...neuves];
}

export function useFeed(enabled: boolean) {
  const [state, setState] = useState<State>({ cards: [], loading: true, error: null });
  const fetching = useRef(false);
  /** Mode demande pendant qu'un chargement court ; rejoue a sa fin, le dernier gagne. */
  const modeEnAttente = useRef<'replace' | 'append' | null>(null);
  /** Quand la carte du dessus a commence a jouer, pour mesurer l'ecoute. */
  const startedAt = useRef<number>(Date.now());

  const load = useCallback(
    async (mode: 'replace' | 'append') => {
      if (!enabled) return;
      if (fetching.current) {
        // Un chargement est deja en vol : on note la demande et on s'en va.
        // A la fin du vol courant, le dernier mode demande repart — sans quoi
        // un reload arrive pendant un append etait perdu silencieusement,
        // et un append arrive pendant un reload aussi.
        modeEnAttente.current = mode;
        return;
      }
      fetching.current = true;
      try {
        const { cards } = await prisme.nextCards();
        // Aucun appel au lecteur ici. Une fonction de mise a jour d'etat doit
        // rester pure — React se reserve le droit de la rejouer — et le
        // prechargement etait de toute facon fait une seconde fois par l'effet
        // qui suit `state.cards`, avec la carte a l'ecran en plus. Deux ordres
        // pour la meme chose, dont un depuis un endroit ou il n'a rien a faire.
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
        // Le dernier mode demande pendant le vol gagne. Inutile de repartir
        // pour le mode qui vient de finir : la reponse est deja en etat.
        const suivant = modeEnAttente.current;
        modeEnAttente.current = null;
        if (suivant && suivant !== mode) void load(suivant);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (enabled) void load('replace');
  }, [enabled, load]);

  const topId = state.cards[0]?.track.id ?? null;

  /**
   * Joue la carte du dessus et arme le chronometre d'ecoute.
   *
   * Cet effet suit l'identite de la carte, **pas** le tableau `cards` : un lot
   * arrive en tache de fond en remplace la reference sans changer la carte a
   * l'ecran, et relancer la lecture a ce moment-la coupait le son de la carte
   * en cours et faussait la duree d'ecoute envoyee au moteur.
   */
  useEffect(() => {
    const top = state.cards[0];
    if (!top) return;
    startedAt.current = Date.now();
    void player.play(top.track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId]);

  /** Prepare les cartes suivantes et libere celles qu'on a depassees. */
  useEffect(() => {
    if (state.cards.length === 0) return;
    // Precharger large : sur reseau mobile, trois cartes d'avance ne suffisent
    // pas toujours a ce que l'extrait soit charge quand il arrive a l'ecran.
    player.preload(state.cards.slice(1, 3).map((c) => c.track));
    // Peu de lecteurs vivants : au-dela, iOS en coupe un au hasard en pleine
    // lecture. Trois suffisent (le courant et deux d'avance).
    player.keepOnly(state.cards.slice(0, 3).map((c) => c.track.id));
  }, [state.cards]);

  useEffect(() => () => player.release(), []);

  /**
   * Enregistre un verdict.
   *
   * La duree d'ecoute est lue sur le lecteur, pas sur l'horloge murale : si
   * l'app a ete mise en arriere-plan, le temps passe n'est pas du temps
   * ecoute, et le moteur en tirerait une conclusion fausse.
   */
  const decide = useCallback(
    async (action: SwipeAction) => {
      const top = state.cards[0];
      if (!top) return;

      const msPlayed = Math.min(player.positionMs(), Date.now() - startedAt.current);
      const previewMs = player.durationMs();

      // La mise a jour reste **pure** — React se reserve le droit de la
      // rejouer, et elle contenait un effet de bord (le refill) qui aurait
      // pu partir deux fois. Le reste est calcule ici, hors updater ; le
      // refill, lui, part apres coup, garde par `fetching`.
      const rest = state.cards.slice(1);
      setState((s) => ({ ...s, cards: s.cards.slice(1) }));
      if (rest.length <= REFILL_AT) void load('append');

      // Fire-and-forget : aucun swipe n'attend le reseau. Un evenement perdu
      // degrade l'apprentissage, jamais l'experience : la carte est deja
      // partie, on ne la fait pas revenir.
      prisme
        .event({ track: top.track, action, msPlayed, previewMs, fromShare: !!top.envoye_par })
        .catch(() => {});
    },
    [state.cards, load],
  );

  return {
    ...state,
    decide,
    reload: () => load('replace'),
    pause: () => player.pause(),
    resume: () => player.resume(),
  };
}
