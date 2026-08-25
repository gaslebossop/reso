import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { prisme } from '../../../src/api/client';
import type { ProfilSocial, TrackCommun } from '../../../src/api/types';
import { player } from '../../../src/audio/player';
import { ligneInterpretes, separerTitre } from '../../../src/api/titre';
import { IconeRetour } from '../../../src/components/Icones';
import { chiffres, color, motion, radius, space, type } from '../../../src/theme/tokens';
import { vibrer } from '../../../src/state/vibration';

/**
 * Vos matchs, un par un.
 *
 * ## Pourquoi ce n'est pas une liste
 *
 * « En commun » etait une grille de pochettes posee au milieu d'un profil : on
 * la depassait en defilant, et elle ne disait rien de plus que « il y en a
 * quelques-uns ». Or c'est **la seule chose de l'application qui parle de deux
 * personnes a la fois**, et la raison pour laquelle on ouvre le profil de
 * quelqu'un qui vous a donne son lien.
 *
 * Une chose pareille se regarde une par une, en grand, avec le son. D'ou la
 * forme : plein ecran, un titre par ecran, on avance du pouce ou en tapant sur
 * le bord — la grammaire d'une story, parce que c'est celle que tout le monde
 * connait deja et qu'elle ne demande rien a apprendre.
 *
 * ## Ce que les segments du haut comptent
 *
 * **Une position, jamais un temps.** Ils disent « troisieme sur sept », pas
 * « il reste douze secondes » : rien n'avance tout seul ici, rien ne se ferme
 * dans le dos de qui regarde. Une barre qui se remplit d'elle-meme mettrait
 * une horloge sur un moment qui n'en demande pas — et l'application a deja
 * jete une barre de progression pour cette raison exacte.
 *
 * ## Fermer se fait au pouce
 *
 * On tire vers le bas et l'ecran s'en va — la grammaire des stories, celle que
 * tout le monde a deja dans les doigts. Ce n'etait pas la : il n'y avait que
 * la croix, en haut a droite, c'est-a-dire a l'endroit exact ou le pouce
 * n'arrive pas sur un telephone tenu d'une main.
 *
 * Trois details font que le geste se sent plutot qu'il ne s'apprend :
 * l'ecran **suit le doigt** au lieu de partir au relachement, il **retrecit et
 * s'arrondit** en descendant — ce qui montre qu'il devient un objet qu'on
 * repose, et non une page qui defile —, et **l'axe se verrouille** au premier
 * dixieme de geste : une fois parti vers le bas, un tremblement lateral ne
 * fait plus changer de titre.
 *
 * Tirer vers le **haut** ne fait rien, deliberement. Un ecran qui se ferme
 * dans les deux sens se ferme surtout par accident.
 *
 * ## Ce que chaque titre raconte
 *
 * La mention sous la pochette **n'est pas la meme d'un titre a l'autre** :
 * elle disait « vous l'avez tous les deux » pour tout le monde, alors que
 * garder et aimer ne sont pas le meme geste — l'un range le titre, l'autre le
 * laisse passer. Un ecran qui existe pour raconter une rencontre doit dire
 * laquelle. Voir [[phraseDuMatch]].
 *
 * ## L'extrait
 *
 * Le lecteur est celui du fil, et c'est voulu : deux lecteurs se disputeraient
 * la sortie audio. Le fil a perdu le focus en poussant cet ecran, donc il
 * s'est tu ; en revenant, il redemandera **sa** carte, et `play()` sait
 * reprendre celle qui tourne deja sans la relancer.
 */
export default function Commun() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height: hauteur } = useWindowDimensions();
  const { id: brut } = useLocalSearchParams<{ id?: string }>();
  const id = typeof brut === 'string' ? decodeURIComponent(brut) : '';

  const [profil, setProfil] = useState<ProfilSocial | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [n, setN] = useState(0);

  /** Le deplacement du doigt. `x` fait defiler les titres, `y` ferme l'ecran.
   *  Les deux vivent ici et non dans la scene : le geste de sortie emporte
   *  **tout** — segments et croix compris —, comme sur une story. */
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  /** L'axe retenu : 0 indecis, 1 horizontal, 2 vertical. Verrouille des le
   *  premier dixieme de geste, sinon un tremblement fait changer de titre au
   *  milieu d'une fermeture. */
  const axe = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      let vivant = true;
      prisme
        .profilPublic(id)
        .then((p) => {
          if (vivant) setProfil(p);
        })
        .catch((e) => {
          if (vivant) setErreur(e instanceof Error ? e.message : 'Indisponible');
        });
      return () => {
        vivant = false;
      };
    }, [id]),
  );

  const titres: TrackCommun[] = profil?.commun ?? [];
  const courant = titres[n];
  const premier = n === 0;
  const dernier = n >= titres.length - 1;

  // L'extrait suit la position, et rien d'autre : changer de titre est le seul
  // evenement qui doit toucher au son.
  useEffect(() => {
    // Un extrait qui refuse de partir n'a pas a remonter en promesse
    // orpheline : l'ecran reste lisible sans le son.
    if (courant) void player.play(courant).catch(() => {});
  }, [courant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quitter l'ecran coupe le son. Le fil le reprendra de lui-meme en
  // retrouvant le focus — sur SA carte, pas sur celle-ci.
  useEffect(() => () => player.pause(), []);

  const aller = useCallback(
    (pas: number) => {
      setN((k) => {
        const suivant = k + pas;
        if (suivant < 0 || suivant >= titres.length) return k;
        vibrer.choix();
        return suivant;
      });
    },
    [titres.length],
  );

  const fermer = useCallback(() => router.back(), [router]);

  /** Combien il faut descendre pour que l'ecran parte. Un cinquieme de la
   *  hauteur : assez pour qu'un frolement ne ferme rien, assez peu pour que le
   *  geste ne demande pas de reprendre son pouce. */
  const sortie = hauteur * 0.2;
  const seuilLateral = width * 0.22;

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (axe.get() === 0) {
        const dx = Math.abs(e.translationX);
        const dy = Math.abs(e.translationY);
        // Rien tant que le geste n'a pas de direction : bouger de trois pixels
        // n'est pas encore une intention.
        if (dx < 10 && dy < 10) return;
        axe.set(dy > dx ? 2 : 1);
      }
      if (axe.get() === 2) {
        // Vers le bas seulement. Un ecran qui se ferme dans les deux sens se
        // ferme surtout par accident.
        y.set(Math.max(0, e.translationY));
        return;
      }
      // On retient le bord : tirer au-dela du premier ou du dernier doit se
      // sentir comme un mur, pas comme un geste ignore.
      const mur = (e.translationX > 0 && premier) || (e.translationX < 0 && dernier);
      x.set(mur ? e.translationX * 0.28 : e.translationX);
    })
    .onEnd((e) => {
      const vertical = axe.get() === 2;
      axe.set(0);

      if (vertical) {
        if (e.translationY > sortie || e.velocityY > 900) {
          // On ne remet rien en place : l'ecran s'en va, et le voir revenir au
          // centre une image avant de disparaitre serait un hoquet.
          scheduleOnRN(fermer);
          return;
        }
        y.set(withSpring(0, motion.settle));
        return;
      }

      const gauche = e.translationX < -seuilLateral || e.velocityX < -700;
      const droite = e.translationX > seuilLateral || e.velocityX > 700;
      if (gauche && !dernier) {
        // Sans ressort : la carte suivante entre par sa propre animation, et
        // deux mouvements a la fois donneraient un flottement.
        x.set(0);
        scheduleOnRN(aller, 1);
      } else if (droite && !premier) {
        x.set(0);
        scheduleOnRN(aller, -1);
      } else {
        x.set(withSpring(0, motion.settle));
      }
    });

  /**
   * L'ecran entier pendant la fermeture.
   *
   * Il retrecit et s'arrondit en descendant : ce qui remplissait l'ecran
   * devient un objet qu'on repose. C'est ce qui distingue « je ferme » de
   * « je fais defiler », sans qu'aucun mot ne l'explique.
   */
  const enveloppe = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [0, hauteur * 0.5], [0, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY: y.get() }, { scale: interpolate(p, [0, 1], [1, 0.82]) }],
      borderRadius: interpolate(p, [0, 0.12], [0, radius.card], Extrapolation.CLAMP),
      opacity: interpolate(p, [0, 0.8, 1], [1, 1, 0.55]),
    };
  });

  if (erreur) {
    return (
      <View style={[styles.ecran, styles.centre]}>
        <Text style={styles.erreur}>{erreur}</Text>
        <Fermer onPress={() => router.back()} haut={insets.top + space.sm} />
      </View>
    );
  }

  if (!profil) {
    return (
      <View style={[styles.ecran, styles.centre]}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  if (titres.length === 0) {
    return (
      <View style={[styles.ecran, styles.centre]}>
        <Text style={styles.vide}>Rien en commun pour l'instant.</Text>
        <Fermer onPress={() => router.back()} haut={insets.top + space.sm} />
      </View>
    );
  }

  return (
    <View style={styles.ecran}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.enveloppe, enveloppe]}>
          <Scene
            key={courant.id}
            track={courant}
            mention={phraseDuMatch(courant, prenomDe(profil))}
            largeur={width}
            x={x}
            onAller={aller}
          />

          {/* Les segments, et sous eux le rappel de qui est en face : ouvert depuis
              un lien recu, on ne sait pas toujours chez qui on vient d'entrer. */}
          <View style={[styles.haut, { paddingTop: insets.top + space.sm }]} pointerEvents="none">
            <View style={styles.segments}>
              {titres.map((t, i) => (
                <View key={t.id} style={[styles.segment, i <= n && styles.segmentPasse]} />
              ))}
            </View>
            <Text style={styles.qui} numberOfLines={1}>
              <Text style={[styles.quiNombre, chiffres]}>{titres.length}</Text>
              {` en commun avec ${profil.nom || `@${profil.handle}`}`}
            </Text>
          </View>

          <Fermer onPress={fermer} haut={insets.top + space.sm} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** La croix de sortie. Toujours au meme endroit, y compris sur les etats
 *  vides : un plein ecran sans porte de sortie visible est une impasse. */
function Fermer({ onPress, haut }: { onPress: () => void; haut: number }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.fermer, { top: haut }, pressed && styles.pale]}
      onPress={onPress}
      hitSlop={14}
      accessibilityRole="button"
      accessibilityLabel="Fermer"
    >
      <IconeRetour couleur={color.text} />
    </Pressable>
  );
}

/**
 * Ce que vous avez fait de ce titre, tous les deux.
 *
 * Trois phrases, parce qu'il y a trois rencontres possibles et qu'elles ne se
 * valent pas : deux gardes est le match fort — le titre est range des deux
 * cotes —, deux « j'aime » est le croisement le plus courant, et le cas mixte
 * est le plus interessant a lire parce qu'il dit **qui** a fait quoi.
 *
 * Le prenom plutot que le nom entier : la mention est en capitales sous une
 * pochette, et « Jean-Baptiste De La Tour Fontaine l'a aime » y tiendrait sur
 * trois lignes.
 *
 * Sans les deux gestes — un moteur d'une version anterieure —, on retombe sur
 * la phrase d'avant, qui reste vraie : elle ne dit simplement pas laquelle.
 */
export function phraseDuMatch(t: TrackCommun, prenom: string): string {
  const { moi, autre } = t;
  if (!moi || !autre) return 'Vous l’avez tous les deux';
  if (moi === autre) {
    return moi === 'garde' ? 'Vous l’avez tous les deux gardé' : 'Vous l’avez tous les deux aimé';
  }
  return moi === 'garde'
    ? `Tu l’as gardé, ${prenom} l’a aimé`
    : `Tu l’as aimé, ${prenom} l’a gardé`;
}

/** Le prenom, ou le @handle a defaut. Ce qui tient dans une phrase courte. */
function prenomDe(profil: ProfilSocial): string {
  const nom = (profil.nom ?? '').trim();
  if (nom) return nom.split(/\s+/)[0];
  return profil.handle ? `@${profil.handle}` : 'l’autre';
}

/**
 * Un titre, plein ecran.
 *
 * Elle ne tient aucun geste : le doigt est ecoute une fois pour tout l'ecran,
 * plus haut. Elle ne fait que **suivre** `x` — sinon la fermeture vers le bas
 * emporterait le fond et laisserait la pochette immobile au milieu.
 *
 * Les zones de tap restent, en plus du glissement : on ne tient pas son
 * telephone de la meme facon assis et en marche, et une story qui n'obeit
 * qu'au tap se traverse au marteau.
 */
function Scene({
  track,
  mention,
  largeur,
  x,
  onAller,
}: {
  track: TrackCommun;
  mention: string;
  largeur: number;
  x: SharedValue<number>;
  onAller: (pas: number) => void;
}) {
  const reduced = useReducedMotion();
  const entree = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    entree.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [entree, reduced]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { scale: interpolate(entree.get(), [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
    opacity: entree.get(),
  }));

  const { titre, avec: dansLeTitre } = separerTitre(track.title);
  const avec = track.featuring?.length ? track.featuring : dansLeTitre;
  const cote = Math.min(largeur - space.xl * 2, 340);

  return (
    <View style={StyleSheet.absoluteFill}>
        {/* La lumiere : la pochette elle-meme, floutee. Le fond prend la
            couleur du titre qu'on partage. */}
        <Image
          source={{ uri: track.cover }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={72}
          transition={320}
          cachePolicy="memory-disk"
          recyclingKey={`f-${track.id}`}
        />
        <View style={styles.voile} />

        <Animated.View style={[styles.centre, style]}>
          <Image
            source={{ uri: track.cover }}
            style={[styles.pochette, { width: cote, height: cote }]}
            contentFit="cover"
            transition={220}
            cachePolicy="memory-disk"
            recyclingKey={String(track.id)}
          />
          <Text style={styles.mention} numberOfLines={2}>
            {mention}
          </Text>
          <Text style={styles.titre} numberOfLines={2}>
            {titre}
          </Text>
          <Text style={styles.interpretes} numberOfLines={1}>
            {ligneInterpretes(track.artist.name, avec)}
          </Text>
        </Animated.View>

        {/* Les deux zones de tap, invisibles et sans retour visuel : une story
            ne clignote pas quand on la traverse. */}
        <Pressable
          style={[styles.zone, styles.zoneGauche]}
          onPress={() => onAller(-1)}
          accessibilityRole="button"
          accessibilityLabel="Titre précédent"
        />
        <Pressable
          style={[styles.zone, styles.zoneDroite]}
          onPress={() => onAller(1)}
          accessibilityRole="button"
        accessibilityLabel="Titre suivant"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: color.bg },
  // `overflow: hidden` pour que le rayon qui apparait pendant la fermeture
  // rogne reellement la pochette floutee, et pas seulement le cadre.
  enveloppe: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', backgroundColor: color.bg },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  pale: { opacity: 0.5 },
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 8, 10, 0.62)' },

  pochette: { borderRadius: radius.lg, backgroundColor: color.bgElevated, marginBottom: space.lg },
  // En capitales par le style et non dans le texte : la phrase porte un
  // prenom, et l'ecrire deja crie interdirait de le rendre autrement un jour.
  // `lineHeight` explicite parce qu'elle peut passer sur deux lignes.
  mention: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: color.accent,
    textAlign: 'center',
    paddingHorizontal: space.xl,
  },
  titre: {
    ...type.display,
    color: color.text,
    textAlign: 'center',
    paddingHorizontal: space.xl,
  },
  interpretes: { ...type.body, color: color.textMuted, textAlign: 'center' },

  haut: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, gap: space.sm },
  segments: { flexDirection: 'row', gap: 3 },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  segmentPasse: { backgroundColor: color.text },
  qui: { ...type.label, fontSize: 13, color: color.textMuted, textAlign: 'center' },
  quiNombre: { color: color.text, fontWeight: '700' },

  fermer: { position: 'absolute', right: space.md, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // Les zones s'arretent avant le bas : la pochette et le titre restent
  // touchables pour qui voudra les ouvrir un jour, et le pouce au repos en bas
  // d'ecran ne fait pas defiler la story par accident.
  zone: { position: 'absolute', top: 0, bottom: 120, width: '32%' },
  zoneGauche: { left: 0 },
  zoneDroite: { right: 0 },

  erreur: { ...type.body, color: color.alert, textAlign: 'center', paddingHorizontal: space.xl },
  vide: { ...type.body, color: color.textMuted, textAlign: 'center', paddingHorizontal: space.xl },
});
