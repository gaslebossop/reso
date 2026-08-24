import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  type SharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ligneInterpretes, separerTitre } from '../api/titre';
import type { Card } from '../api/types';
import { color, motion, radius, space, type } from '../theme/tokens';
import { IconeCoche, IconeCoeur, IconeCroix, IconeGarder, IconePlus } from './Icones';
import { vibrer } from '../state/vibration';

export type Verdict = 'like' | 'skip' | 'save';

/**
 * Une carte du fil : une pochette, et son cartel.
 *
 * ## La carte est un objet, pas un panneau etire
 *
 * Elle remplissait toute la scene, et la pochette y etait recadree en `cover` :
 * **une pochette est carree, la scene ne l'est pas, donc pres d'un tiers de
 * l'artwork etait coupe sur les cotes.** Dans une app dont on demande de juger
 * la pochette, c'est la faute la plus couteuse — et c'est ce qui donnait ces
 * cartes ternes, un bord d'image etire sous un aplat noir.
 *
 * La carte a maintenant **la taille de son contenu** : un carre exact pour la
 * pochette, entiere, et dessous un cartel de hauteur fixe qui porte le texte.
 * Elle est centree dans la scene, ce qui la fait lire comme un objet pose la —
 * une pochette de disque — au lieu d'un panneau qui remplit ce qu'on lui donne.
 *
 * Le cartel a une **hauteur constante** : un titre sur une ligne et un titre
 * sur deux donneraient sinon deux cartes de hauteurs differentes, et la pile
 * changerait de forme a chaque swipe.
 *
 * ## Les gestes ne bougent pas
 *
 * Passer a gauche, j'aime a droite, garder en haut, appui long pour bannir —
 * memes seuils qu'avant (`0,28 × largeur`, `130 px`, ou la vitesse). Une
 * refonte en fil pagine qui les avait reattribues a ete refusee : refaire la
 * forme n'autorise pas a faire reapprendre l'usage.
 *
 * ## Un seul verdict a la fois
 *
 * Les trois voiles de verdict etaient pilotes chacun par son axe : tirer vers
 * le haut en derivant de vingt pixels affichait **« JE GARDE » et « J'AIME »
 * en meme temps**, a deux forces differentes. Ils lisent maintenant l'axe
 * dominant — la meme regle exactement que celle qui tranche au lacher — donc ce
 * qui s'affiche est ce qui va se produire.
 */

/** Part de la largeur d'ecran a franchir pour valider au ralenti. */
const DISTANCE_RATIO = 0.28;
/** Vitesse suffisante pour valider sans franchir la distance : un coup sec. */
const VELOCITY = 900;
/** Deplacement vertical validant une sauvegarde. */
const SAVE_DISTANCE = 130;

/** Hauteur du cartel — mention, titre sur deux lignes, interpretes. Fixe
 *  pour une classe d'appareils donnee, sinon la pile changerait de forme a
 *  chaque swipe. */
const CARTEL = 154;
/** Le meme cartel, en mode compact : scenes basses (paysage, telephones
 *  plies fermes). La mention et les interpretes tiennent sur leurs lignes ;
 *  seul le titre perd de la hauteur utile. */
const CARTEL_COMPACT = 116;
/** Plafond du cote : sur tablette, une pochette qui remplit la largeur n'est
 *  plus un disque qu'on tient, c'est un poster. On borne et on centre. */
const COTE_MAX = 560;

/**
 * La geometrie de la carte dans une scene de cette taille.
 *
 * Exportee parce que l'ecran en a besoin lui aussi : c'est de ce carre que
 * part la pochette qui s'envole vers la trace, et la faire partir d'ailleurs se
 * verrait immediatement.
 *
 * ## Les trois reglages, et ce qui les commande
 *
 * - **Le plafond** (`COTE_MAX`) : au-dela d'un certain cote, l'aiguisage des
 *   pochettes sources ne suit plus et le geste de swipe s'allonge sans gain.
 * - **Le mode compact** : sous 480 px de hauteur de scene (paysage, pliables),
 *   le cartel passe a sa version courte plutot que de laisser la carte deborder.
 * - **Le plancher** : en dessous de 120 px rien n'est jugeable ; il ne s'applique
 *   que s'il tient dans la scene, jamais au prix d'un debordement.
 *
 * Et un detail qui se voit sans se dire : le centrage vertical est fait a
 * **42 %**, pas a 50 %. Le pied de l'ecran porte la barre d'action et pese
 * visuellement plus que l'en-tete ; centrer mathematiquement affaisse la carte,
 * centrer optiquement la pose.
 */
export function cadreCarte(largeur: number, hauteur: number) {
  const compact = hauteur > 0 && hauteur < 480;
  const cartel = compact ? CARTEL_COMPACT : CARTEL;
  const dispo = Math.max(100, hauteur - cartel);
  const cote = Math.round(Math.max(120, Math.min(largeur, dispo, COTE_MAX)));
  const hauteurCarte = cote + cartel;
  const jeu = Math.max(0, hauteur - hauteurCarte);
  return {
    /** Cote de la pochette, qui est aussi la largeur de la carte. */
    cote,
    hauteur: hauteurCarte,
    x: Math.round((largeur - cote) / 2),
    y: Math.round(jeu * 0.42),
    cartel,
    compact,
  };
}

type Ton = 'decouverte' | 'fort' | 'discret';

/**
 * Le ton de la mention, deduit de ce que le moteur a repondu.
 *
 * Le moteur produit des phrases de force tres inegale. On lit cette force et
 * on lui donne trois traitements separes, pour que l'irregularite se voie : la
 * plupart des cartes sont discretes, et celles qui ont vraiment quelque chose
 * a annoncer se detachent.
 *
 * La pepite rejoint la decouverte : toutes deux sont les moments ou le moteur
 * a quelque chose d'inattendu a dire — un artiste qu'il n'aurait pas du
 * connaitre, une perle que personne ne connait. Ce sont les seuls arrives qui
 * meritent d'attendre et de se signaler ; en faire deux traitements distincts
 * diluerait les deux.
 */
export function tonDe(raison: string): Ton {
  const r = raison.toLowerCase();
  if (r.startsWith('hors de tes habitudes') || r.includes('pepite')) return 'decouverte';
  const n = Number.parseInt(r.replace(/\D+/g, ''), 10);
  if (Number.isFinite(n) && n >= 3) return 'fort';
  return 'discret';
}

type Props = {
  card: Card;
  /** Seule la carte du dessus reagit au doigt. */
  active: boolean;
  /** Profondeur dans la pile : 0 devant, 1 derriere, etc. */
  depth: number;
  /** La scene mesuree. Zero tant que la mise en page n'a pas eu lieu. */
  largeurScene: number;
  hauteurScene: number;
  /**
   * Le verdict, **avec le deplacement du doigt au moment du lacher**.
   *
   * Ce deplacement n'est pas un detail : pour garder, il faut avoir tire la
   * carte de cent trente pixels vers le haut. L'ecran fait partir de la la
   * pochette qui s'envole vers la trace ; sans lui, elle repartait de la
   * position de repos de la carte, cent trente pixels plus bas — et le vol
   * commencait par un saut.
   */
  onVerdict: (v: Verdict, dx: number, dy: number) => void;
  /**
   * Le retour haptique du geste, **au moment de l'eclat**.
   *
   * Separe de [[onVerdict]] pour une raison precise : le bouton « j'aime »
   * passe aussi par la, et il a deja sonne au tap (`vibrer.action`). Payer le
   * like aux deux endroits faisait deux impacts a moins de cinquante
   * millisecondes — une bouillee haptique, pas un signal.
   */
  onPaiement: (v: Verdict) => void;
  /** Le seuil vient d'etre franchi, le doigt est encore pose. */
  onSeuil: () => void;
  /** Le moteur a pris un risque sur ce titre, et il vient de s'afficher. */
  onSurprise: () => void;
  /**
   * Faire de cette arrivee un **evenement**, meme si sa mention est discrete.
   *
   * Apres une serie de passages, la premiere carte qui marque la reprise
   * merite l'annonce complete — arrivee tardive et retour haptique — sans que
   * sa raison ait besoin de le dire. L'ecran la pose sur une seule carte par
   * serie froide : annoncee a chaque carte, elle redeviendrait un metronome.
   */
  annonce?: boolean;
  /** Appui long : on demande a ne plus jamais voir cet artiste. */
  onDemandeBannir: () => void;
  /**
   * L'artiste principal est suivi.
   *
   * Pilote par l'ecran et non par un etat local a la carte : un meme artiste
   * peut occuper deux cartes de la pile, et elles doivent basculer ensemble.
   * Un etat par carte aurait laisse la seconde afficher le contraire de la
   * premiere jusqu'au prochain lot.
   */
  suivi: boolean;
  /**
   * Suivre / ne plus suivre. L'ecran bascule tout de suite et appelle le
   * moteur ensuite : voir [[Suivre]] pour pourquoi l'optimisme est ici la
   * bonne reponse et pas un raccourci.
   */
  onSuivre: (on: boolean) => void;
};

function PassageImpl({
  card,
  active,
  depth,
  largeurScene,
  hauteurScene,
  onVerdict,
  onPaiement,
  onSeuil,
  onSurprise,
  annonce,
  onDemandeBannir,
  suivi,
  onSuivre,
}: Props) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gone = useSharedValue(0);
  /** 1 des que le seuil est franchi : sert a ne sonner qu'une fois. */
  const arme = useSharedValue(0);
  /** L'effacement sur place, quand la pochette prend son envol vers la trace. */
  const fondu = useSharedValue(1);
  /** La bouffee de couleur du verdict, au relachement. */
  const eclatAime = useSharedValue(0);
  const eclatGarde = useSharedValue(0);
  /**
   * 1 tant qu'un doigt est pose sur le bouton « suivre ».
   *
   * Le bouton est un enfant de la carte, donc l'appui long de la carte — qui
   * demande a bannir l'artiste au bout de 600 ms — le voit passer comme
   * n'importe quel autre appui. Sans ce drapeau, un appui un peu lent sur
   * « suivre » ouvrait la demande de bannissement : le geste le plus
   * destructeur de l'app declenche par le plus anodin, et pile sur le meme
   * artiste.
   *
   * Une valeur partagee et non une `ref` : `onStart` est un worklet, il
   * s'execute sur le fil d'animation et n'a pas acces aux refs React.
   */
  const surBouton = useSharedValue(0);

  const threshold = width * DISTANCE_RATIO;
  const cadre = cadreCarte(largeurScene, hauteurScene);
  /**
   * Le titre suit la pochette, pas le modele du telephone.
   *
   * Un titre a 26 px sur une pochette de 300 px et le meme a 26 px sur une de
   * 560 px ne disent pas la meme chose : l'un est un cartel, l'autre une
   * apostrophe. L'echelle est derivee du cote reellement disponible — bornee
   * ou elle devient illisible d'un cote, grotesque de l'autre.
   */
  const tailleTitre = Math.round(Math.max(19, Math.min(30, cadre.cote * 0.072)));

  const { titre, avec: dansLeTitre } = separerTitre(card.track.title);
  const avec = card.track.featuring?.length ? card.track.featuring : dansLeTitre;
  const ton = tonDe(card.reason);

  /**
   * L'arrivee de la carte suivante.
   *
   * C'est le seul moment de la boucle ou il ne se passait rien : le doigt
   * relache, la carte precedente part, et la nouvelle etait deja la, entiere,
   * avant meme que le son commence. Or l'attente d'une recompense compte au
   * moins autant que la recompense.
   *
   * La pochette arrive donc d'abord, et le texte ensuite : l'oeil recoit
   * l'image, puis apprend ce que c'est, au moment ou le son sort.
   *
   * **L'attente varie, meme pour les cartes banales.** Hollerman & Schultz
   * (Nature Neuroscience, 1998) montrent que les neurones dopaminergiques
   * codent l'erreur sur **le moment** de la recompense autant que sur sa
   * survenue — une recompense qui tombe toujours a la meme milliseconde ne
   * provoque plus rien. Les cartes discretes tirent donc leur attente dans une
   * fenetre courte (60-140 ms) ; les evenements gardent leur delai long fixe,
   * c'est lui qui les distingue.
   */
  const revele = useSharedValue(active ? 1 : 0);
  const aEteDerriere = useRef(false);

  /**
   * L'annonce est **gelee au moment ou la carte devient active**.
   *
   * Lue dans une reference plutot que dans les dependances : l'ecran la
   * retire des qu'elle a ete consommee (au premier retour surprise), et si
   * elle entrait dans l'effet, ce retrait rejouerait l'arrivee de la carte
   * encore affichee — un clignotement, en plein geste.
   */
  const annonceRef = useRef(annonce);
  annonceRef.current = annonce;

  useEffect(() => {
    if (!active) {
      aEteDerriere.current = true;
      revele.set(0);
      return;
    }
    // La toute premiere carte est deja la : on ne fait pas entrer un ecran.
    if (!aEteDerriere.current || reduced) {
      revele.set(1);
      return;
    }
    const evenement = ton === 'decouverte' || annonceRef.current;
    const attente = evenement ? 190 : 60 + Math.random() * 80;
    revele.set(0);
    revele.set(
      withDelay(attente, withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) })),
    );
    if (evenement) {
      const t = setTimeout(onSurprise, attente + 120);
      return () => clearTimeout(t);
    }
  }, [active, reduced, revele, ton, onSurprise]);

  /**
   * Le paiement du geste **varie**, volontairement.
   *
   * Il etait fige : meme amplitude, meme duree, a chaque swipe. Or une
   * recompense parfaitement prevue ne provoque plus rien — l'erreur de
   * prediction s'eteint, et le geste qui la produisait avec elle. L'amplitude,
   * la montee et la descente sont donc tirees a chaque verdict, et une fois
   * sur six environ la bouffee est double : deux battements au lieu d'un.
   * C'est le meme mecanisme que la pepite cote moteur, applique au doigt :
   * ni chaque geste, ni jamais.
   */
  const fly = (toX: number, toY: number, verdict: Verdict, vx: number, vy: number) => {
    'worklet';
    gone.set(1);
    const dx = x.get();
    const dy = y.get();

    // « Passer » n'en recoit pas : ce n'est pas une recompense, et lui en
    // donner une reviendrait a dire que les trois se valent.
    if (verdict !== 'skip') {
      const pic = 0.72 + Math.random() * 0.28;
      const chute = 240 + Math.random() * 200;
      const montee = { duration: 70 + Math.random() * 40, easing: Easing.out(Easing.cubic) };
      const retombee = { duration: chute, easing: Easing.out(Easing.cubic) };
      const simple = withSequence(withTiming(pic, montee), withTiming(0, retombee));
      const doubleBattement = withSequence(
        withTiming(1, montee),
        withTiming(0.12, { duration: 90, easing: Easing.in(Easing.quad) }),
        withTiming(pic * 0.85, { duration: 80, easing: Easing.out(Easing.cubic) }),
        withTiming(0, retombee),
      );
      const bouffee = Math.random() < 0.16 ? doubleBattement : simple;
      if (verdict === 'like') eclatAime.set(bouffee);
      else eclatGarde.set(bouffee);
      scheduleOnRN(onPaiement, verdict);
    }

    if (verdict === 'save') {
      // La carte **ne part pas** : elle se change en la pochette qui rejoint la
      // trace. L'envoyer hors de l'ecran pendant qu'une copie s'envole donnait
      // deux mouvements concurrents partant de deux endroits. Elle s'efface sur
      // place, et l'envol prend le relais exactement ou elle etait.
      fondu.set(withTiming(0, { duration: 140, easing: Easing.out(Easing.cubic) }));
    } else {
      x.set(withSpring(toX, { ...motion.eject, velocity: vx }));
      y.set(withSpring(toY, { ...motion.eject, velocity: vy }));
    }
    scheduleOnRN(onVerdict, verdict, dx, dy);
  };

  const pan = Gesture.Pan()
    .enabled(active)
    .onUpdate((e) => {
      x.set(e.translationX);
      y.set(e.translationY);

      // Sonner au franchissement, pas au lacher. Le retour arrive alors pendant
      // que le doigt decide encore, ce qui est le seul instant ou il sert.
      const franchi = Math.abs(e.translationX) > threshold || e.translationY < -SAVE_DISTANCE;
      if (franchi && arme.get() === 0) {
        arme.set(1);
        scheduleOnRN(onSeuil);
      } else if (!franchi && arme.get() === 1) {
        arme.set(0);
      }
    })
    .onEnd((e) => {
      arme.set(0);
      // Distance OU vitesse : un flick bref doit suffire, sinon le geste
      // demande un effort que personne ne fournit cinquante fois de suite.
      const right = e.translationX > threshold || e.velocityX > VELOCITY;
      const left = e.translationX < -threshold || e.velocityX < -VELOCITY;
      const up = e.translationY < -SAVE_DISTANCE || e.velocityY < -VELOCITY;

      // La sauvegarde ne doit pas voler un geste horizontal franc. **Cette
      // regle est aussi celle qui pilote l'affichage du verdict** — les deux
      // doivent rester identiques, sinon la carte annonce autre chose que ce
      // qu'elle va faire.
      const vertical = Math.abs(e.translationY) > Math.abs(e.translationX);

      if (up && vertical) fly(e.translationX, -height * 1.2, 'save', e.velocityX, e.velocityY);
      else if (right) fly(width * 1.4, e.translationY, 'like', e.velocityX, e.velocityY);
      else if (left) fly(-width * 1.4, e.translationY, 'skip', e.velocityX, e.velocityY);
      else {
        // Retour en place : ressort avec la velocite du doigt, pas un timing.
        x.set(withSpring(0, { ...motion.settle, velocity: e.velocityX }));
        y.set(withSpring(0, { ...motion.settle, velocity: e.velocityY }));
      }
    });

  // Bannir a quitte la barre d'action : c'est le geste le plus destructeur de
  // l'app, il n'a rien a faire sous le pouce entre deux boutons qu'on martele.
  const appuiLong = Gesture.LongPress()
    .enabled(active)
    .minDuration(600)
    .onStart(() => {
      // Le doigt est sur « suivre » : cet appui-la ne s'adresse pas a la carte.
      if (surBouton.get() === 1) return;
      scheduleOnRN(onDemandeBannir);
    });

  const gestes = Gesture.Race(pan, appuiLong);

  const carteStyle = useAnimatedStyle(() => {
    const rot = reduced
      ? 0
      : interpolate(x.get(), [-width, 0, width], [-12, 0, 12], Extrapolation.CLAMP);
    // Les cartes du dessous reculent legerement : la profondeur se lit sans ombre.
    const rest = 1 - depth * 0.045;
    const lift = interpolate(Math.abs(x.get()), [0, threshold], [0, 0.045], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: x.get() },
        { translateY: y.get() - depth * 10 },
        { rotateZ: `${rot}deg` },
        { scale: active ? 1 : rest + lift },
      ],
      opacity:
        fondu.get() *
        (gone.get()
          ? interpolate(Math.abs(x.get()), [0, width], [1, 0.2], Extrapolation.CLAMP)
          : 1),
    };
  });

  const cartelStyle = useAnimatedStyle(() => ({
    opacity: revele.get(),
    transform: [
      { translateY: interpolate(revele.get(), [0, 1], [ton === 'decouverte' ? 14 : 8, 0]) },
    ],
  }));

  const bouffeeAime = useAnimatedStyle(() => ({ opacity: eclatAime.get() * 0.26 }));
  const bouffeeGarde = useAnimatedStyle(() => ({ opacity: eclatGarde.get() * 0.26 }));

  /**
   * L'avance du geste **sur l'axe dominant seulement**.
   *
   * C'est le correctif du defaut le plus visible de l'ecran : chaque voile
   * lisait son propre axe, donc un geste vers le haut legerement de biais
   * affichait deux verdicts contradictoires a la fois.
   */
  const aimer = useAnimatedStyle(() => {
    const v = Math.abs(y.get()) > Math.abs(x.get());
    return avancement(v ? 0 : x.get() / threshold);
  });
  const passer = useAnimatedStyle(() => {
    const v = Math.abs(y.get()) > Math.abs(x.get());
    return avancement(v ? 0 : -x.get() / threshold);
  });
  const garder = useAnimatedStyle(() => {
    const v = Math.abs(y.get()) > Math.abs(x.get());
    return avancement(v ? -y.get() / SAVE_DISTANCE : 0);
  });

  // Tant que la scene n'est pas mesuree, il n'y a pas de carte a poser.
  if (largeurScene === 0 || hauteurScene === 0) return null;

  return (
    <GestureDetector gesture={gestes}>
      <Animated.View
        style={[
          styles.carte,
          { width: cadre.cote, height: cadre.hauteur, left: cadre.x, top: cadre.y },
          carteStyle,
        ]}
        pointerEvents={active ? 'auto' : 'none'}
        accessible={active}
        accessibilityLabel={`${titre}, ${ligneInterpretes(card.track.artist.name, avec)}`}
        accessibilityRole="button"
        accessibilityActions={[
          { name: 'like', label: "J'aime" },
          { name: 'save', label: 'Je garde' },
          { name: 'skip', label: 'Passer' },
        ]}
        onAccessibilityAction={(e) => {
          if (!active) return;
          // Les actions d'assistance empruntent le meme chemin que le doigt :
          // meme vol, meme paiement, meme verdict — rien n'est degrade.
          const a = e.nativeEvent.actionName;
          if (a === 'like') fly(width * 1.4, 0, 'like', VELOCITY, 0);
          else if (a === 'save') fly(0, -height * 1.2, 'save', 0, -VELOCITY);
          else if (a === 'skip') fly(-width * 1.4, 0, 'skip', -VELOCITY, 0);
        }}
      >
        {/* La pochette, entiere : carre dans un carre, donc aucun recadrage. */}
        <Image
          source={{ uri: card.track.cover }}
          style={{ width: cadre.cote, height: cadre.cote }}
          contentFit="cover"
          transition={220}
          // La pochette est l'element le plus lourd de l'ecran : sans cache
          // disque, chaque retour au fil la retelecharge.
          cachePolicy="memory-disk"
          recyclingKey={String(card.track.id)}
        />

        {/* Le cartel. Fond teinte par la pochette elle-meme, tres assourdie :
            un aplat gris sous une pochette coloree fait ressembler la carte a
            un gabarit, et une couleur franche se battrait avec l'artwork. */}
        <View style={[styles.cartel, { height: cadre.cartel }]}>
          <Image
            source={{ uri: card.track.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={48}
            cachePolicy="memory-disk"
            recyclingKey={String(card.track.id)}
          />
          <View style={styles.cartelVoile} />
          <Animated.View style={[styles.texte, cadre.compact && styles.texteCompact, cartelStyle]}>
            <Text style={[styles.mention, mentionTon[ton]]} numberOfLines={1}>
              {card.reason}
            </Text>
            <Text
              style={[
                styles.titre,
                { fontSize: tailleTitre, lineHeight: Math.round(tailleTitre * 1.18) },
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {titre}
            </Text>
            {/* Le nom, puis le bouton — et surtout pas l'inverse. Le bouton
                pose avant volerait la premiere chose lue de la ligne, qui est
                l'artiste. `flexShrink` sur le texte seul : c'est le nom qui
                se tronque quand il est long, jamais le bouton qui sort de la
                carte. */}
            <View style={[styles.ligneArtiste, cadre.compact && styles.ligneArtisteCompacte]}>
              <Text
                style={[
                  styles.interpretes,
                  cadre.compact && styles.interpretesCompact,
                  styles.interpretesFlex,
                ]}
                numberOfLines={1}
              >
                {ligneInterpretes(card.track.artist.name, avec)}
              </Text>
              <Suivre
                actif={active}
                suivi={suivi}
                nom={card.track.artist.name}
                taille={cadre.compact ? 18 : 22}
                onBascule={() => onSuivre(!suivi)}
                surBouton={surBouton}
              />
            </View>
          </Animated.View>
        </View>

        <Voeu style={passer} teinte={color.reject} mot="passer" quoi="skip" />
        <Voeu style={garder} teinte={color.save} mot="je garde" quoi="save" />
        <Voeu style={aimer} teinte={color.accent} mot="j'aime" quoi="like" />

        {/* L'eclat passe par-dessus tout, y compris le verdict : c'est le
            paiement, il doit couvrir la carte une fraction de seconde. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: color.accent }, bouffeeAime]}
          pointerEvents="none"
        />
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: color.save }, bouffeeGarde]}
          pointerEvents="none"
        />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Le verdict en cours : un voile teinte, et une pastille qui grossit.
 *
 * Ce qu'il remplace : un liseré de trois pixels autour de la carte entiere, un
 * glyphe de soixante-douze pixels et un mot en capitales espacees, le tout en
 * pleine saturation. C'etait l'element le plus bruyant de l'ecran et il
 * apparaissait a chaque geste — cinquante fois par seance. Une pastille sombre
 * posee sur la pochette dit la meme chose sans salir l'artwork.
 *
 * Ce qui ne change pas : il **grossit avec le deplacement** au lieu
 * d'apparaitre d'un bloc a mi-course, et c'est ce qui rend le geste corrigeable
 * a vue. `p` vaut 1 quand le seuil est atteint.
 */
function Voeu({
  style,
  teinte,
  mot,
  quoi,
}: {
  style: StyleProp<ViewStyle>;
  teinte: string;
  mot: string;
  quoi: Verdict;
}) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.voeu, style]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, styles.teinture, { backgroundColor: teinte }]} />
      <View style={styles.pastille}>
        {quoi === 'like' ? (
          <IconeCoeur actif couleur={teinte} taille={26} />
        ) : quoi === 'skip' ? (
          <IconeCroix couleur={teinte} taille={26} />
        ) : (
          <IconeGarder couleur={teinte} taille={26} />
        )}
        <Text style={[styles.mot, { color: teinte }]}>{mot}</Text>
      </View>
    </Animated.View>
  );
}

/** Opacite et grossissement d'un verdict, en fonction de l'avance du geste. */
function avancement(p: number) {
  'worklet';
  return {
    opacity: interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p, [0, 1], [0.82, 1], Extrapolation.CLAMP) }],
  };
}

/**
 * Suivre l'artiste, sans sortir du fil.
 *
 * ## Ce qui aurait casse l'immersion, et qui a ete ecarte
 *
 * Le fil n'a que trois issues — passer, j'aime, garder — et chacune fait
 * partir la carte. Un quatrieme geste qui, lui, ne la fait PAS partir est
 * exactement l'endroit ou l'on brise le rythme si on le traite comme les
 * autres. D'ou ce qu'il ne fait pas :
 *
 *  - **aucun mot.** « Suivre » / « Suivi » ecrit en toutes lettres double la
 *    largeur du bouton selon l'etat, donc la ligne de l'artiste se recompose
 *    sous les yeux a chaque appui. Une forme qui reste a sa place et change
 *    de dessin ne bouge rien autour d'elle ;
 *  - **aucun toast, aucune modale, aucune navigation.** Rien ne recouvre la
 *    carte, rien ne demande de revenir. Le seul retour est le bouton lui-meme
 *    et une impulsion haptique legere ;
 *  - **aucune confirmation pour se retirer.** Ne plus suivre n'efface rien :
 *    c'est un geste sans consequence, il merite un geste sans ceremonie —
 *    la meme regle que sur le profil d'une personne ;
 *  - **aucun changement de hauteur.** Le bouton est plus petit que la ligne
 *    qui le porte, et sa zone tactile est etendue par `hitSlop`, qui ne
 *    participe pas a la mise en page. Le cartel a une hauteur fixe, et une
 *    carte qui grandirait d'un pixel ferait respirer toute la pile.
 *
 * ## Pourquoi le geste ne vole rien au swipe
 *
 * Le `Pressable` est un enfant du `GestureDetector` de la carte. Le pan de
 * la carte ne s'active qu'au mouvement : un doigt pose et releve au meme
 * endroit ne l'arme jamais, l'appui va donc au bouton. Des que le doigt
 * derive, le pan prend la main et le `Pressable` est annule par le systeme
 * tactile — la carte part, sans suivre l'artiste au passage.
 *
 * ## L'optimisme n'est pas un raccourci
 *
 * Le bouton bascule avant la reponse du moteur. C'est la bonne reponse ici et
 * pas une facilite : attendre l'aller-retour, c'est un bouton inerte pendant
 * une demi-seconde au milieu d'un geste qui, lui, est instantane — et sur un
 * reseau mobile, la carte est deja partie quand la reponse arrive. La route
 * est idempotente cote moteur, donc un doublon ne coute rien, et l'ecran
 * remet le bouton dans son etat d'avant si l'appel echoue.
 */
function Suivre({
  actif,
  suivi,
  nom,
  taille,
  onBascule,
  surBouton,
}: {
  actif: boolean;
  suivi: boolean;
  nom: string;
  taille: number;
  onBascule: () => void;
  /** Leve tant que le doigt est pose ici : voir sa declaration dans la carte. */
  surBouton: SharedValue<number>;
}) {
  const echelle = useSharedValue(1);
  const reduced = useReducedMotion();

  const style = useAnimatedStyle(() => ({ transform: [{ scale: echelle.get() }] }));

  const appuyer = () => {
    // L'haptique la plus legere de la palette : `action`, celle des boutons.
    // Le verdict d'un swipe a la sienne, plus lourde, et les deux ne doivent
    // pas se confondre — suivre n'est pas juger.
    vibrer.action();
    if (!reduced) {
      // Pas de ressort : la feuille de style de cette app n'en veut aucun qui
      // rebondisse, et un bouton qui tressaute apres un appui appelle l'oeil
      // pile au moment ou l'on veut qu'il retourne a la pochette.
      echelle.set(
        withSequence(
          withTiming(0.82, { duration: motion.press / 2 }),
          withTiming(1, { duration: motion.state }),
        ),
      );
    }
    onBascule();
  };

  const teinte = suivi ? color.accent : color.textMuted;

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={appuyer}
        // `onPressIn` part des la pression, donc bien avant les 600 ms de
        // l'appui long : le drapeau est toujours leve a temps.
        onPressIn={() => surBouton.set(1)}
        onPressOut={() => surBouton.set(0)}
        disabled={!actif}
        // La zone tactile reelle fait une quarantaine de points de cote alors
        // que le dessin en fait vingt-deux : `hitSlop` deborde sans occuper
        // de place, donc sans toucher a la hauteur du cartel.
        hitSlop={12}
        accessibilityRole="switch"
        accessibilityState={{ checked: suivi }}
        accessibilityLabel={suivi ? `Ne plus suivre ${nom}` : `Suivre ${nom}`}
        style={({ pressed }) => [
          styles.suivre,
          {
            width: taille,
            height: taille,
            borderColor: suivi ? color.accent : 'rgba(255, 255, 255, 0.26)',
            backgroundColor: suivi ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        {suivi ? (
          <IconeCoche couleur={teinte} taille={Math.round(taille * 0.64)} />
        ) : (
          <IconePlus couleur={teinte} taille={Math.round(taille * 0.64)} />
        )}
      </Pressable>
    </Animated.View>
  );
}

export const Passage = memo(PassageImpl);

const styles = StyleSheet.create({
  carte: {
    position: 'absolute',
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: color.bgElevated,
  },
  cartel: { justifyContent: 'center', overflow: 'hidden' },
  cartelVoile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9, 9, 11, 0.87)' },
  texte: { paddingHorizontal: space.lg, gap: space.xs },
  // En mode compact (scenes basses), chaque pixel de marge vole du texte.
  texteCompact: { paddingHorizontal: space.md, gap: space.xs / 2 },
  mention: { marginBottom: space.xs },
  // La taille du titre est posee par le rendu : elle derive du cote reel de
  // la pochette, pas du modele de l'appareil.
  titre: { fontWeight: '700', color: color.text, letterSpacing: -0.5 },
  interpretes: { ...type.body, color: color.textMuted },
  interpretesCompact: { fontSize: 13, lineHeight: 18 },
  // Le nom se tronque, le bouton jamais : c'est `flexShrink` sur le seul
  // texte qui l'obtient. Sans lui, un nom long pousse le bouton hors de la
  // carte au lieu de s'abreger.
  interpretesFlex: { flexShrink: 1 },
  ligneArtiste: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ligneArtisteCompacte: { gap: space.xs },
  suivre: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },

  voeu: { alignItems: 'center', justifyContent: 'center' },
  teinture: { opacity: 0.26 },
  pastille: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(8, 8, 10, 0.78)',
  },
  mot: { ...type.lead, fontWeight: '700' },
});

/**
 * Trois poids, pas trois couleurs decoratives.
 *
 * La decouverte est la seule en capitales espacees : c'est l'evenement, le seul
 * cas ou le moteur prend un risque. « Proche de N artistes » avec N grand est
 * une bonne nouvelle mais attendue — elle garde la couleur d'accent et perd les
 * capitales, qui en faisaient la premiere chose lue de la carte alors que c'est
 * la moins importante. Le reste s'efface, et c'est voulu : si tout ressort,
 * rien ne ressort.
 */
const mentionTon = StyleSheet.create({
  decouverte: {
    ...type.caption,
    fontSize: 12,
    color: color.save,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  fort: { ...type.label, color: color.accent, letterSpacing: 0 },
  discret: { ...type.label, color: color.textFaint, letterSpacing: 0 },
});
