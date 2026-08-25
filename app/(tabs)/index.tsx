import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../src/api/client';
import type { Card, SwipeAction } from '../../src/api/types';
import { player } from '../../src/audio/player';
import { Barre } from '../../src/components/Barre';
import { Envol } from '../../src/components/Envol';
import { cadreCarte, Passage, type Verdict } from '../../src/components/Passage';
import { IconeCoeur, IconeCroix, IconeGarder } from '../../src/components/Icones';
import { RECOUVREMENT, Trace, VIGNETTE } from '../../src/components/Trace';
import {
  poserFond,
  rendreFond,
  useArrivee,
  useDegrade,
  useEncre,
  useEncreDouce,
  useFondAnime,
  type Palette,
} from '../../src/state/fond';
import { getDeviceId } from '../../src/state/session';
import type { Garde } from '../../src/state/gardesSeance';
import { poserDansLaSeance, useGardesSeance } from '../../src/state/gardesSeance';
import { filerVersSpotify } from '../../src/state/spotifySync';
import { marquerPasseFait, passeDejaFait } from '../../src/state/passe';
import { useFeed } from '../../src/state/useFeed';
import { vibrer } from '../../src/state/vibration';
import { color, radius, space, type } from '../../src/theme/tokens';

/** Nombre de cartes rendues simultanement. Au dela, on paie des vues que
 *  personne ne voit. */
const STACK = 3;

/**
 * Le fil.
 *
 * ## La forme n'a pas change, et c'est une consigne
 *
 * Une pile de cartes dans une marge, un en-tete, une barre d'action en pied.
 * Les gestes vont avec : passer a gauche, j'aime a droite, garder en haut,
 * appui long pour bannir. Une refonte en fil pagine plein ecran — defilement
 * vertical, apercu du suivant, geste du haut rendu « gratuit » — a ete
 * essayee et **refusee** : « je veux pas de swipe ou alors fais-le mieux,
 * c'etait bien avant. » La lecon vaut au-dela du cas : refaire la forme
 * n'autorise pas a faire reapprendre l'usage.
 *
 * ## Ce qui a change : le plaisir, pas la disposition
 *
 * 1. **Le geste est paye au moment ou on lache.** L'eclat de la couleur du
 *    verdict et l'haptique arrivent au relachement, en plus du cran du seuil
 *    qui, lui, annonce pendant qu'on decide encore. Il ne se passait rien a cet
 *    instant, alors que c'est celui ou la decision devient un fait.
 * 2. **Ce qu'on garde va quelque part, a vue.** La pochette s'envole vers la
 *    trace au lieu d'apparaitre au meme instant a deux endroits sans lien.
 * 3. **La trace remplace le compteur.** Le nombre etait la bonne intuition —
 *    c'est le *taux* de recompense qui gouverne le comportement, et il ne se
 *    percoit que rendu visible — mais un nombre est un score, il se compare.
 *    Des pochettes s'accumulent.
 * 4. **L'ecran est eclaire par la pochette courante.** La lumiere deborde de la
 *    carte, floutee, et respire lentement. Le fond etait un aplat noir : la
 *    carte y flottait sans rien autour. Rien ne change de place pour autant, et
 *    la carte reste la seule source de couleur nette.
 *
 * ## La ligne qui n'est pas franchie
 *
 * Pas de serie a ne pas rompre, pas d'objectif quotidien, pas de compte a
 * rebours, aucun point de sortie supprime. Une serie transforme l'envie de
 * revenir en peur de perdre, et ce jour-la l'app cesse d'etre un plaisir :
 * c'est ce qui la fait desinstaller, pas ce qui la fait garder.
 *
 * ## La geometrie suit l'appareil, jamais l'inverse
 *
 * La carte est un objet a taille de pochette : elle plafonne sur tablette
 * (un poster n'est pas un disque), passe son cartel en version compacte sur
 * les scenes basses (paysage, pliables), derive sa typographie du cote
 * reellement disponible, et se pose au centre **optique** de la scene — 42 %
 * du jeu au-dessus, parce que le pied pese plus que l'en-tete. Les marges de
 * scene ont trois paliers (telephone / grand telephone / tablette) ; des
 * marges continues rendraient la pose instable d'un appareil a l'autre.
 */
export default function FilScreen() {
  const insets = useSafeAreaInsets();
  const { width: ecran } = useWindowDimensions();

  /**
   * La marge de la scene suit l'appareil.
   *
   * Un telephone tient la carte a distance de pouce avec la marge standard ;
   * une tablette qui gardait la meme marge offrait une carte pleine largeur,
   * un poster plutot qu'un disque. Trois paliers, pas une formule continue :
   * des marges qui bougent a chaque pixel rendent la pose instable.
   */
  const margeScene = ecran >= 768 ? space.xxl : ecran >= 430 ? space.lg : space.md;

  // Le fil est ouvert : aucun compte n'est demande. On attend seulement que
  // l'identifiant d'appareil existe, pour que le tout premier lot soit
  // rattache au bon profil plutot qu'a « inconnu ».
  const [pret, setPret] = useState(false);
  const feed = useFeed(pret);

  /**
   * Le fil est lu par reference dans les rappels ci-dessous.
   *
   * `useFeed` rend un objet neuf a chaque rendu ; entre dans des dependances,
   * il recreeait chaque rappel a chaque fois et cassait la memoisation des
   * cartes — trois remontees completes de la pile a chaque etat de l'ecran
   * (garde pose, vol parti, annonce consommee).
   */
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    void getDeviceId().then(() => setPret(true));
  }, []);

  /** Les titres gardes depuis l'ouverture. Remis a zero en quittant l'app,
   *  volontairement : c'est une trace de seance, pas un score a defendre.
   *
   *  Dans un magasin de module et non dans cet etat-ci : la bibliotheque et
   *  l'historique doivent pouvoir en **retirer** un titre, et ils ne sont pas
   *  montes en meme temps que le fil. Voir [[gardesSeance]] — c'est ce qui
   *  laissait une pochette retiree des gardes trainer dans la trace jusqu'a
   *  la fermeture de l'application. */
  const gardes = useGardesSeance();
  /** L'artiste dont on envisage de ne plus jamais entendre parler. */
  const [aBannir, setABannir] = useState<Card | null>(null);
  /**
   * La pochette en cours de vol vers la trace, s'il y en a une.
   *
   * Elle est aussi tenue dans une reference : deux « je garde » enchaines plus
   * vite que le vol (430 ms) remplaceraient sinon la premiere pochette par la
   * seconde en plein vol, et la premiere ne serait **jamais** comptee — elle
   * disparaitrait de la trace sans que rien ne le dise. Le vol interrompu est
   * donc pose immediatement.
   */
  const [enVol, setEnVol] = useState<{
    id: number;
    cover: string;
    /** Ou la carte etait quand le doigt s'est leve, par rapport a son repos. */
    dx: number;
    dy: number;
  } | null>(null);
  const volEnCours = useRef<Garde | null>(null);
  const prochainVol = useRef(0);

  /**
   * Ou la pile de cartes se trouve dans l'ecran.
   *
   * Mesuree et non deduite : c'est le point de depart du vol vers la trace, et
   * il depend de la hauteur de l'en-tete, du pied et des marges de l'appareil.
   * Le calculer a la main ferait partir la pochette d'a cote sur un modele
   * qu'on n'a pas sous la main.
   */
  const [scene, setScene] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const mesurer = useCallback((e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    setScene((s) =>
      s.x === x && s.y === y && s.w === width && s.h === height
        ? s
        : { x, y, w: width, h: height },
    );
  }, []);

  /**
   * Couper le son en quittant l'onglet.
   *
   * Les onglets ne se demontent pas quand on en change : l'ecran du fil reste
   * monte, son lecteur avec, et l'extrait continuait donc de tourner pendant
   * qu'on lisait sa bibliotheque. `AppState` ne dit rien de ce cas — l'app est
   * toujours au premier plan, c'est l'ecran qui a perdu le focus.
   *
   * On parle au lecteur directement plutot qu'a travers `feed` : celui-ci est
   * un objet neuf a chaque rendu, et l'effet de focus se rejouerait donc en
   * boucle, coupant le son qu'il vient de relancer.
   */
  const auFil = useRef(false);

  /**
   * La carte du dessus, tenue dans une reference.
   *
   * L'effet de focus en a besoin, et il ne peut pas dependre de `feed` : celui-ci
   * est un objet neuf a chaque rendu, l'effet se rejouerait donc en boucle et
   * couperait le son qu'il vient de relancer. La reference donne la valeur sans
   * la dependance.
   */
  const hautRef = useRef<Card['track'] | null>(null);
  useEffect(() => {
    hautRef.current = feed.cards[0]?.track ?? null;
  }, [feed.cards]);

  useFocusEffect(
    useCallback(() => {
      auFil.current = true;
      // **Redemander SA carte, pas reprendre ce qui trainait.** Un autre ecran
      // peut avoir joue autre chose entre-temps — la story des titres en commun
      // le fait — et `resume()` relancerait alors le titre de cet ecran-la sous
      // la pochette du fil. `play()` sait reprendre la carte deja en cours sans
      // la relancer, donc le cas normal ne coute rien.
      const haut = hautRef.current;
      if (haut) void player.play(haut).catch(() => {});
      else player.resume();
      return () => {
        auFil.current = false;
        player.pause();
      };
    }, []),
  );

  /** Couper le son quand l'app part en arriere-plan : une app musicale qui
   *  continue a jouer seule dans la poche est desinstallee le jour meme. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (__DEV__) console.log(`[snd] AppState -> ${s}`);
      // Ne couper que sur un vrai passage en arriere-plan. iOS emet aussi
      // `inactive` pour des broutilles transitoires — centre de controle
      // entrouvert, banniere de notification, selecteur d'apps — et couper le
      // son a chacune donne des interruptions incomprehensibles en pleine
      // ecoute.
      if (s === 'background') player.suspend();
      // Et ne relancer que si le fil est bien l'ecran regarde : revenir dans
      // l'app depuis l'onglet Gardes ne doit pas remettre la musique.
      else if (s === 'active' && auFil.current) player.resume();
    });
    return () => sub.remove();
    // Aucune dependance : l'abonnement doit vivre autant que l'ecran. Il
    // dependait de `feed`, un objet neuf a chaque rendu, et se reabonnait donc
    // des dizaines de fois par session.
  }, []);

  const top = feed.cards[0];

  // Le fond prend les couleurs de la pochette a l'ecran. Dans un effet et non
  // pendant le rendu : `poserFond` previent des abonnes React, et les prevenir
  // au milieu d'un rendu ferait se redessiner un composant pendant qu'un autre
  // se dessine. La cle est l'identifiant du titre — c'est lui qui change.
  const titreHaut = top?.track;
  useEffect(() => {
    poserFond(titreHaut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titreHaut?.id]);

  // En quittant le fil, le neutre revient : la couleur du dernier titre n'a
  // rien a faire derriere la bibliotheque ou les reglages.
  useEffect(() => () => rendreFond(), []);
  // Scene non mesuree : les cartes rendraient toutes nulles (pas de cadre)
  // mais paieraient montage, gestes et effets. On ne pose la pile qu'apres.
  const visible = feed.cards.slice(0, scene.w > 0 ? STACK : 0);

  /**
   * Le didacticiel des gestes, au tout premier fil.
   *
   * Il n'apparait qu'une fois la premiere carte reelle en main : expliquer un
   * geste sur un ecran vide n'apprend rien, le faire decouvrir sur l'objet
   * meme qu'on va juger laisse une trace. Le drapeau vit dans
   * `src/state/passe.ts`, et les reglages savent le retomber.
   */
  const [passe, setPasse] = useState(false);
  const passeVerifie = useRef(false);

  // Le didacticiel se decide une fois par montage : des que la premiere carte
  // est la. Ni avant (rien a montrer), ni deux fois (le drapeau tranche).
  useEffect(() => {
    if (passeVerifie.current || !pret || feed.loading || feed.cards.length === 0) return;
    passeVerifie.current = true;
    void passeDejaFait().then((faite) => {
      if (!faite) setPasse(true);
    });
  }, [pret, feed.loading, feed.cards.length]);

  const fermerPasse = useCallback(async () => {
    vibrer.choix();
    setPasse(false);
    await marquerPasseFait();
  }, []);

  /**
   * La serie froide, et son annonce unique.
   *
   * Trois passages d'affilee, et le fil ne dit plus rien : chaque carte
   * arrive pareil, le pouce s'emballe, la seance meurt d'ennui — alors que
   * cote moteur, c'est precisement l'instant ou l'exploration se rouvre et ou
   * quelque chose de different arrive. La prochaine carte apres trois skips
   * recoit donc l'annonce complete, **une seule fois** : des qu'elle s'est
   * fait entendre (retour surprise) ou qu'un geste positif est parti, la
   * serie est soldee et les arrives redeviennent calmes.
   */
  const froidRef = useRef(0);
  const [annonceFroide, setAnnonceFroide] = useState(false);

  /** Le paiement du like **au geste** : synchronise sur l'eclat du worklet.
   *  Le bouton, lui, sonne deja (`vibrer.action`) — le doubler ici faisait
   *  deux impacts a moins de cinquante millisecondes, une bouillee. */
  const payerGeste = useCallback((v: Verdict) => {
    if (v === 'like') vibrer.aime();
  }, []);

  const onVerdict = useCallback(
    (v: Verdict, dx = 0, dy = 0) => {
      if (v === 'skip') {
        froidRef.current += 1;
        if (froidRef.current >= 3) setAnnonceFroide(true);
      } else if (froidRef.current > 0) {
        froidRef.current = 0;
        setAnnonceFroide(false);
      }
      if (v === 'save') {
        const garde = feedRef.current.cards[0]?.track;
        // Vers la playlist Spotify, si la synchronisation est allumee. Ne rend
        // rien et n'attend rien : le versement se fait apres, une fois le
        // doigt arrete.
        if (garde) filerVersSpotify(garde);
        const cover = garde?.cover;
        // La pochette part vers la trace. Le titre n'y sera compte qu'a
        // l'atterrissage : c'est le vol qui explique ou il va, le compter
        // avant le rendrait muet.
        if (garde && cover) {
          const interrompu = volEnCours.current;
          if (interrompu) poserDansLaSeance(interrompu);
          volEnCours.current = { id: garde.id, cover };
          setEnVol({ id: ++prochainVol.current, cover, dx, dy });
        }
      }
      setABannir(null);
      void feedRef.current.decide(v as SwipeAction);
    },
    // Le fil est lu par reference : le rappel reste stable entre les rendus,
    // et `Passage` memo ne se remonte plus pour rien.
    [],
  );

  /** Le vol est arrive : c'est maintenant que la trace compte le titre, et
   *  maintenant que la secousse tombe — sur l'objet qui se pose. */
  const atterri = useCallback(() => {
    const arrive = volEnCours.current;
    volEnCours.current = null;
    setEnVol(null);
    if (!arrive) return;
    vibrer.garde();
    poserDansLaSeance(arrive);
  }, []);

  const onSeuil = useCallback(() => vibrer.seuil(), []);

  /** L'annonce s'est faite entendre : elle est consommee. Les decouvertes du
   *  moteur passent aussi ici — le drapeau n'etait peut-etre pas leve. */
  const onSurprise = useCallback(() => {
    vibrer.surprise();
    setAnnonceFroide(false);
  }, []);

  const demanderBannir = useCallback(() => {
    vibrer.grave();
    setABannir(feedRef.current.cards[0] ?? null);
  }, []);

  const bannir = useCallback(() => {
    setABannir(null);
    void feedRef.current.decide('block');
  }, []);

  /**
   * Les artistes suivis, tels que CET ecran les connait.
   *
   * Une carte arrive du moteur avec son `followed`, qui est juste au moment
   * ou le lot a ete servi. Ce qu'il ne peut pas savoir, c'est ce qu'on vient
   * d'appuyer : cette table-la porte les basculements faits depuis, et elle
   * prime sur la carte.
   *
   * Elle vit dans l'ecran et pas dans la carte parce qu'un meme artiste peut
   * occuper deux cartes de la pile — deux titres d'un artiste ramenes par le
   * meme lot. Un etat par carte aurait laisse la seconde afficher le
   * contraire de la premiere jusqu'au lot suivant.
   */
  const [suivisLocaux, setSuivisLocaux] = useState<Record<number, boolean>>({});

  const estSuivi = useCallback(
    (c: Card) => suivisLocaux[c.track.artist.id] ?? !!c.followed,
    [suivisLocaux],
  );

  /**
   * Suivre / ne plus suivre, sans faire attendre le doigt.
   *
   * On bascule d'abord et on appelle ensuite. Attendre la reponse, c'est un
   * bouton inerte une demi-seconde au milieu d'un ecran ou tout le reste est
   * instantane — et sur un reseau mobile, la carte est souvent deja partie
   * quand elle arrive.
   *
   * En cas d'echec on revient a l'etat d'avant, en silence. Pas de message :
   * suivre est un geste mineur, et une alerte modale par-dessus le fil
   * couterait plus d'immersion que le suivi n'en valait. Le bouton qui reprend
   * sa forme dit deja que ca n'a pas pris.
   */
  const suivre = useCallback((artistId: number, on: boolean) => {
    setSuivisLocaux((s) => ({ ...s, [artistId]: on }));
    prisme.suivreArtiste(artistId, on).catch(() => {
      setSuivisLocaux((s) => ({ ...s, [artistId]: !on }));
    });
  }, []);

  /**
   * Le vol part de la pochette elle-meme.
   *
   * La geometrie vient de `cadreCarte`, la meme fonction que la carte utilise
   * pour se placer : faire partir la pochette d'un rectangle calcule a part
   * ici, c'est garantir qu'elle partira d'a cote le jour ou la carte changera
   * de taille.
   */
  const carte = cadreCarte(scene.w, scene.h);
  // Le vol part de la pochette **telle qu'elle etait au lacher**, deplacement
  // du doigt compris : pour garder, la carte a deja ete tiree de cent trente
  // pixels vers le haut.
  const departVol = {
    x: scene.x + carte.x + (enVol?.dx ?? 0),
    y: scene.y + carte.y + (enVol?.dy ?? 0),
    cote: carte.cote,
  };
  const arriveeVol = {
    x: space.lg + Math.min(gardes.length, 4) * (VIGNETTE - RECOUVREMENT),
    y: insets.top + space.sm,
    cote: VIGNETTE,
  };

  /**
   * Le palier de seance, marque par la pile elle-meme.
   *
   * Tous les cinq titres gardes, la trace gonfle une fois et se repose. C'est
   * tout : pas de fanfare, pas de chiffre qui apparaitrait — la pile dit deja
   * ce qu'elle vaut. Un palier de **seance** n'a rien d'un objectif quotidien :
   * il ne survit pas a l'app, il ne promet rien, il constate.
   */
  const reducedMotion = useReducedMotion();
  const pile = useSharedValue(1);
  const pileStyle = useAnimatedStyle(() => ({ transform: [{ scale: pile.get() }] }));

  useEffect(() => {
    if (gardes.length === 0 || gardes.length % 5 !== 0 || reducedMotion) return;
    pile.set(
      withSequence(
        withTiming(1.06, { duration: 150, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
      ),
    );
  }, [gardes.length, pile, reducedMotion]);

  return (
    <View style={styles.screen}>
      <Fond />

      <View style={[styles.entete, { paddingTop: insets.top + space.sm }]}>
        {/* La trace (et son aide « glisse vers le haut ») se tait pendant le
            didacticiel : deux voix qui expliquent la meme chose n'en
            expliquent aucune. */}
        {passe ? null : (
          <Animated.View style={pileStyle}>
            <Trace gardes={gardes} />
          </Animated.View>
        )}
      </View>

      <View style={[styles.scene, { marginHorizontal: margeScene }]} onLayout={mesurer}>
        {top ? (
          // Rendu a l'envers : la carte du dessus doit etre la derniere posee.
          visible
            .map((card, i) => ({ card, i }))
            .reverse()
            .map(({ card, i }) => (
              <Passage
                key={card.track.id}
                card={card}
                depth={i}
                active={i === 0}
                largeurScene={scene.w}
                hauteurScene={scene.h}
                onVerdict={onVerdict}
                onPaiement={payerGeste}
                annonce={annonceFroide}
                onSeuil={onSeuil}
                onSurprise={onSurprise}
                onDemandeBannir={demanderBannir}
                suivi={estSuivi(card)}
                onSuivre={(on) => suivre(card.track.artist.id, on)}
              />
            ))
        ) : (
          <Etat feed={feed} gardes={gardes.length} />
        )}
      </View>

      <View style={[styles.pied, { paddingBottom: insets.bottom + space.md }]}>
        {aBannir ? (
          <Bannissement
            artiste={aBannir.track.artist.name}
            onAnnuler={() => setABannir(null)}
            onConfirmer={bannir}
          />
        ) : (
          <Barre onAction={onVerdict} disabled={!top} />
        )}
      </View>

      {enVol && scene.w > 0 ? (
        <Envol
          key={enVol.id}
          cover={enVol.cover}
          depart={departVol}
          arrivee={arriveeVol}
          onArrive={atterri}
        />
      ) : null}

      {/* Le didacticiel couvre TOUT l'ecran, pas seulement la scene : la barre
          d'action et l'aide de l'en-tete doivent s'estomper sous le voile, sans
          quoi deux niveaux d'explication se battent en meme temps. Il vit au
          niveau de l'ecran pour cette unique raison. */}
      {passe && top && scene.w > 0 ? (
        <Didacticiel largeurCarte={carte.cote} onClose={fermerPasse} />
      ) : null}
    </View>
  );
}

/**
 * Le didacticiel des gestes, au tout premier fil.
 *
 * Il couvre **tout l'ecran** et non la seule scene : l'en-tete et la barre
 * d'action doivent s'estomper sous le meme voile, sans quoi deux niveaux
 * d'explication se disputent l'attention en meme temps.
 *
 * La carte fantome reprend la largeur de la vraie carte — c'est ce qui fait
 * comprendre de quoi on parle avant d'avoir lu une ligne. Sa hauteur est
 * libre, simplement plafonnee : le contenu decide, l'ecran retient.
 *
 * Il ne se montre qu'une fois par installation, et au moment ou la premiere
 * carte arrive : expliquer un geste avant qu'il y ait quoi que ce soit a en
 * faire ne laisse aucun souvenir. Les reglages savent le faire revenir.
 */
function Didacticiel({
  largeurCarte,
  onClose,
}: {
  largeurCarte: number;
  onClose: () => void;
}) {
  const gestes = [
    {
      mot: 'Passe',
      dit: 'Glisse vers la gauche.',
      teinte: color.reject,
      icone: <IconeCroix couleur={color.reject} taille={20} />,
    },
    {
      mot: "J'aime",
      dit: 'Glisse vers la droite.',
      teinte: color.accent,
      icone: <IconeCoeur actif couleur={color.accent} taille={20} />,
    },
    {
      mot: 'Je garde',
      dit: 'Glisse vers le haut. Le titre rejoint tes gardés.',
      teinte: color.save,
      icone: <IconeGarder couleur={color.save} taille={20} />,
    },
  ];

  return (
    <View style={[StyleSheet.absoluteFill, styles.passeScene]}>
      <Pressable
        style={styles.passeVoile}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer l’explication"
      />
      <View style={[styles.passeCarte, { width: largeurCarte }]}>
        <View style={styles.passeContenu}>
          <Text style={styles.passeTitre}>Trois gestes</Text>

          <View style={styles.passeGestes}>
            {gestes.map((g) => (
              <View key={g.mot} style={styles.passeGeste}>
                <View style={[styles.passeRond, { borderColor: g.teinte }]}>{g.icone}</View>
                <View style={styles.passeGesteTexte}>
                  <Text style={[styles.passeGesteMot, { color: g.teinte }]}>{g.mot}</Text>
                  <Text style={styles.passeGesteDit}>{g.dit}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.passeNote}>
            Appui long sur la pochette pour ne plus jamais entendre parler d’un artiste.
          </Text>

          <Pressable
            style={styles.passeBouton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Commencer"
          >
            <Text style={styles.passeBoutonTexte}>C’est parti</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Le fond du fil, peint avec les couleurs de la pochette.
 *
 * ## Ce qu'il remplace
 *
 * La pochette elle-meme, floutee et posee en fond. C'etait joli et **ca ne
 * marchait pas** : le flou d'un artwork clair reste clair, donc le texte gris
 * pose dessus disparaissait une pochette sur trois. Et un flou n'a pas de
 * couleur qu'on puisse interroger — impossible d'en deduire de quelle encre
 * ecrire.
 *
 * ## Pourquoi ce n'etait toujours pas un degrade
 *
 * La version d'avant prenait **une** couleur et la versait dans un voile de
 * blanc en haut puis de noir en bas. Un degrade se lit a la teinte, pas a la
 * clarte : eclaircir puis assombrir un meme rose donne trois roses, et l'oeil
 * appelle ca un aplat. C'est le reproche qui a ete fait, et il etait juste.
 *
 * Le moteur rend maintenant **trois tons pris dans la pochette** — le haut, le
 * milieu, le bas — ou la teinte bouge vraiment : la seconde famille de couleur
 * de l'artwork quand il en a une, un virage chaud/froid quand il n'en a pas.
 * Les trois restent dans une bande de clarte etroite, ce qui est la condition
 * pour qu'une seule encre soit valable du haut au bas de l'ecran.
 *
 * ## Comment il s'anime
 *
 * Pas en animant la liste de couleurs — aucun worklet ne sait pousser un
 * tableau dans une vue native de facon garantie. Les deux degrades sont
 * empiles, celui d'arrivee monte en opacite, et le socle sous eux porte la
 * couleur moyenne animee pour qu'aucun pixel ne soit jamais transparent
 * pendant la traversee.
 */
function Fond() {
  const fond = useFondAnime();
  const arrivee = useArrivee();
  const { de, vers } = useDegrade();

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fond]} pointerEvents="none">
      <Rampe palette={de} />
      {/* Pas de cle qui forcerait une vue neuve a chaque carte : l'opacite ne
          vient pas du montage mais de l'avancement, que `poserFond` remet a
          zero. Remonter une vue native par swipe se paierait pour rien. */}
      <Animated.View style={[StyleSheet.absoluteFill, arrivee]}>
        <Rampe palette={vers} />
      </Animated.View>
      {/* Le pied s'eteint dans le noir de la barre d'onglets. Sans lui, le bas
          du degrade rencontre un aplat noir sur une ligne nette, et cette ligne
          est la seule arete visible de l'ecran. Il est pose hors du croisement :
          il ne depend d'aucune pochette, donc il n'a pas a etre anime. */}
      <LinearGradient
        style={styles.piedVoile}
        colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.34)', 'rgba(0, 0, 0, 0.72)']}
        locations={[0, 0.55, 1]}
      />
    </Animated.View>
  );
}

/**
 * Un degrade vertical, **sans arete nulle part**.
 *
 * ## Pourquoi ce n'est pas trois arrets de couleur
 *
 * Trois arrets relies en droite font un degrade correct en theorie et cassant a
 * l'oeil : la pente change brutalement au point du milieu, et cette rupture se
 * voit comme une ligne horizontale en travers de l'ecran. Les arrets sont donc
 * echantillonnes sur une **courbe de Bezier quadratique** dont les trois tons
 * sont les points de controle — la pente y est continue de bout en bout, donc
 * il n'y a aucun endroit ou l'oeil puisse accrocher.
 *
 * Douze arrets suffisent : au-dela, l'ecart entre deux voisins est inferieur au
 * pas de quantification de l'ecran et on paie des arrets pour rien.
 */
const ARRETS = 12;

function Rampe({ palette }: { palette: Palette }) {
  const couleurs = useMemo(() => nuancer(palette), [palette.haut, palette.base, palette.bas]);
  return <LinearGradient style={StyleSheet.absoluteFill} colors={couleurs} />;
}

function nuancer(p: Palette): [string, string, ...string[]] {
  const out: string[] = [];
  for (let i = 0; i < ARRETS; i += 1) {
    const t = i / (ARRETS - 1);
    const u = 1 - t;
    // Bezier quadratique : haut et bas sont atteints exactement, le milieu est
    // approche. C'est le prix de l'absence de cassure, et il ne se voit pas.
    out.push(peser([p.haut, p.base, p.bas], [u * u, 2 * u * t, t * t]));
  }
  // Le type demande par `LinearGradient` exige deux couleurs au minimum ;
  // `ARRETS` en garantit douze, mais TypeScript ne le sait pas.
  return out as [string, string, ...string[]];
}

/** Une somme ponderee de couleurs `#rrggbb`. */
function peser(couleurs: string[], poids: number[]): string {
  const canal = (i: number) =>
    Math.round(
      couleurs.reduce((acc, c, k) => acc + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16) * poids[k], 0),
    );
  return `#${[0, 1, 2].map((i) => Math.max(0, Math.min(255, canal(i))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Chargement, file tarie, moteur muet — **dans le cadre de la carte**.
 *
 * Ces trois etats avaient chacun leur mise en page plein ecran, sans en-tete ni
 * barre d'action. Passer de l'un a l'autre donnait donc l'impression de changer
 * d'ecran alors qu'on n'avait pas bouge, et le fil semblait avoir disparu au
 * lieu d'etre simplement en train de charger.
 *
 * ## La file tarie se termine sur ce qu'on y a gagne
 *
 * Arriver au bout du lot n'est pas une panne, c'est une fin de seance. La
 * dire « Plus rien pour l'instant » transformait un moment d'achevement en
 * penurie. Quand des titres ont ete gardes pendant cette seance, l'ecran le
 * dit : on repart avec quelque chose, et il est nomme ou il attend — dans la
 * bibliotheque. C'est un bilan, pas un objectif : aucun compteur ne survit a
 * la fermeture de l'app, et aucune phrase ne presse de revenir.
 */
function Etat({ feed, gardes }: { feed: ReturnType<typeof useFeed>; gardes: number }) {
  // Le chargement passe avant l'erreur : une requete en cours efface la
  // precedente qui a echoue, sinon relancer laisse l'ecran d'erreur affiche
  // pendant qu'on attend, et le bouton semble n'avoir rien fait.
  if (feed.loading) {
    return (
      <Cadre titre="Prisme cherche" detail="ce qui te ressemble…">
        <ActivityIndicator color={color.accent} />
      </Cadre>
    );
  }
  if (feed.error) {
    return (
      <Cadre
        titre="Prisme ne répond pas"
        detail={feed.error}
        action="Réessayer"
        onAction={feed.reload}
      />
    );
  }
  if (gardes > 0) {
    return (
      <Cadre
        titre="C'est tout pour cette fois"
        detail={
          gardes === 1
            ? 'Tu repars avec un titre gardé. Il t’attend dans ta bibliothèque.'
            : `Tu repars avec ${gardes} titres gardés. Ils t’attendent dans ta bibliothèque.`
        }
        action="Relancer"
        onAction={feed.reload}
      />
    );
  }
  return (
    <Cadre
      titre="Plus rien pour l'instant"
      detail="Prisme a servi ce qu'il avait de sûr. Reviens quand tu veux."
      action="Relancer"
      onAction={feed.reload}
    />
  );
}

function Cadre({
  titre,
  detail,
  action,
  onAction,
  children,
}: {
  titre: string;
  detail: string;
  action?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.cadre}>
      {children}
      <Text style={styles.cadreTitre}>{titre}</Text>
      <Text style={styles.cadreDetail}>{detail}</Text>
      {action && onAction ? (
        <Pressable style={styles.bouton} hitSlop={12} onPress={onAction}>
          <Text style={styles.boutonTexte}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * La confirmation de bannissement, a la place de la barre d'action.
 *
 * Au meme endroit et a la meme hauteur : rien ne bouge sous le pouce, et il n'y
 * a pas de fenetre a chasser. Bannir est irreversible depuis cet ecran — il
 * faut passer par les reglages pour defaire — donc la question se pose, mais
 * une seule fois et sans ceremonie.
 */
function Bannissement({
  artiste,
  onAnnuler,
  onConfirmer,
}: {
  artiste: string;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  return (
    <View style={styles.bannissement}>
      <Text style={styles.bannirQuestion} numberOfLines={2}>
        Ne plus jamais proposer {artiste} ?
      </Text>
      <View style={styles.bannirActions}>
        <Pressable style={styles.bannirSecondaire} hitSlop={12} onPress={onAnnuler}>
          <Text style={styles.bannirSecondaireTexte}>Annuler</Text>
        </Pressable>
        <Pressable style={styles.bannirPrincipal} hitSlop={12} onPress={onConfirmer}>
          <Text style={styles.bannirPrincipalTexte}>Bannir</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  // Le coeur colore ne doit jamais etre lisible : c'est une teinte, pas une
  // image. A 45 % d'opacite sous le rideau, il colore sans decrire.
  coeurTeinte: { opacity: 0.45 },
  // Les marges de zone sure vivent dans l'en-tete et le pied, jamais sur
  // l'ecran : un padding sur le parent decalerait `Lumiere` et `Envol`, qui
  // sont en position absolue et se placent par rapport a la boite de padding.
  entete: { paddingHorizontal: space.lg, paddingBottom: space.md, minHeight: 32 },
  scene: { flex: 1, marginHorizontal: space.md },
  pied: { paddingTop: space.lg, minHeight: 128, justifyContent: 'center' },

  /** Le voile qui eteint le bas du fond dans le noir de la barre d'onglets.
   *  Un tiers de l'ecran : plus court, l'extinction se lit comme une bande ;
   *  plus haut, elle mange la barre d'action. */
  piedVoile: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%' },

  cadre: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.card,
    backgroundColor: color.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  cadreTitre: { ...type.title, color: color.text, textAlign: 'center' },
  cadreDetail: { ...type.body, color: color.textMuted, textAlign: 'center' },

  // --- Le didacticiel -------------------------------------------------------
  // Le conteneur couvre l'ecran et centre la carte ; le voile, pose avant,
  // estompe en-tete et barre d'action sous le meme ride.
  passeScene: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  passeVoile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 8, 10, 0.82)' },
  // La carte fantome : largeur de la vraie carte, HAUTEUR LIBRE bornee a
  // l'ecran — le contenu decide, le plafond retient. Le conteneur absolu
  // centre verticalement, et l'overflow coupe avant de deborder sur l'en-tete.
  passeCarte: {
    backgroundColor: 'rgba(15, 15, 18, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    borderRadius: radius.card,
    overflow: 'hidden',
    maxHeight: '86%',
  },
  passeContenu: { paddingHorizontal: space.xl, paddingVertical: space.xl + space.sm, gap: space.lg },
  passeTitre: { ...type.display, fontSize: 26, lineHeight: 32, color: color.text, textAlign: 'center' },
  passeGestes: { alignSelf: 'stretch', gap: space.md },
  passeGeste: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  passeRond: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 8, 10, 0.6)',
  },
  passeGesteTexte: { flex: 1, gap: 1 },
  passeGesteMot: { ...type.lead, fontWeight: '700' },
  passeGesteDit: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  passeNote: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.textFaint,
    textAlign: 'center',
  },
  passeBouton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  passeBoutonTexte: { ...type.lead, fontWeight: '700', color: color.bg },
  bouton: {
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
    backgroundColor: color.accentDim,
    borderWidth: 1,
    borderColor: color.accent,
  },
  boutonTexte: { ...type.label, color: color.accent },

  bannissement: { paddingHorizontal: space.lg, gap: space.md },
  bannirQuestion: { ...type.lead, color: color.text, textAlign: 'center' },
  bannirActions: { flexDirection: 'row', justifyContent: 'center', gap: space.md },
  bannirSecondaire: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
  },
  bannirSecondaireTexte: { ...type.label, color: color.textMuted },
  bannirPrincipal: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.alert,
  },
  bannirPrincipalTexte: { ...type.label, color: color.alert },
});
