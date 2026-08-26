import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import type { Gen, MixMatch } from '../api/types';
import { chiffres, color, radius, space, type } from '../theme/tokens';
import { vibrer } from '../state/vibration';
import { Visage } from './Visage';

/**
 * L'accord : le seul moment ou deux personnes tombent sur le meme son.
 *
 * ## L'objet : une plaque gravee, pas un ecran de celebration
 *
 * C'est ce choix qui commande tout le reste. Une plaque, ca ne clignote pas :
 * la pochette entiere au centre, les deux noms graves dessous, le rang de
 * l'accord dans la serie. Rien ne gicle.
 *
 * ## Trois choses ont ete retirees, et il faut qu'elles le restent
 *
 * - **Les particules multicolores.** Vingt-deux ronds blancs, violets et
 *   jaunes qui jaillissent du centre : c'est le vocabulaire du jeu mobile, et
 *   c'est ce qui a fait rejeter deux versions de cet ecran (« c'est moche et
 *   pas pro », 2026-08-26). Une seule onde monochrome les remplace — un
 *   mouvement, pas une fete.
 * - **Les trois cercles concentriques empiles**, qui servaient de lueur. Trois
 *   aplats l'un sur l'autre, ce sont **trois bords durs** : sur appareil on
 *   voyait litteralement les anneaux. Une lueur n'a pas de bord — d'ou le
 *   degrade radial SVG, qui est le seul moyen d'en obtenir une vraie ici.
 * - **Le ressort qui rebondit** sur l'arrivee de la pochette. Aucune animation
 *   de cette app ne rebondit ; celle-ci n'avait aucune raison d'etre
 *   l'exception.
 *
 * ## Et une chose a ete ajoutee, qui manquait
 *
 * **Les deux visages.** Un accord est un fait a deux, et l'ecran n'en montrait
 * qu'un — un avatar de vingt-huit pixels a cote d'une phrase. Ils sont
 * maintenant la premiere chose lue sous le titre, cote a cote.
 *
 * ## Une seule fenetre pour toute la file
 *
 * L'appelant tient la file des accords a reveler, mais **cette `Modal` reste
 * montee du premier au dernier** : seul son contenu change. La version d'avant
 * portait une `key` sur l'identite du titre, donc chaque accord demontait la
 * fenetre et en presentait une neuve — on voyait le fil reapparaitre entre les
 * deux, puis une carte revenir une seconde plus tard. Signale tel quel.
 *
 * Deux consequences a ne pas defaire :
 *  - **`animationType="none"`** : la fenetre ne doit pas avoir sa propre
 *    animation de presentation, sinon elle mange celle du contenu ;
 *  - **les valeurs sont remises a zero a chaque accord** (voir l'effet) :
 *    plus rien ne le fait a notre place puisque rien ne se remonte.
 */

type Props = {
  /** Ouvert. La `Modal` reste **montee** tant que la file n'est pas vide —
   *  voir la note « Une seule fenetre » en tete de fichier. */
  visible: boolean;
  /** L'accord affiche. `null` quand la file est vide. */
  match: MixMatch | null;
  partenaire: Gen | null;
  /** Ma photo, pour que les deux visages soient la — voir plus haut. */
  moi?: string | null;
  /** Le rang de cet accord dans la serie du salon. Absent = on ne l'ecrit pas
   *  plutot que d'ecrire « 1er » a tort. */
  rang?: number;
  onFermer: () => void;
};

export function ExplosionMatch({ visible, match, partenaire, moi, rang, onFermer }: Props) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const lueur = useSharedValue(0);
  const onde = useSharedValue(0);
  const plaque = useSharedValue(0);
  const grave = useSharedValue(0);

  /**
   * La fenetre est reellement a l'ecran.
   *
   * **C'est ce drapeau qui rend l'effet visible.** Le contenu d'une `Modal`
   * est monte AVANT que la fenetre native soit presentee : lancer l'animation
   * au montage la faisait donc jouer pendant que la fenetre montait encore, et
   * elle etait finie au moment ou on la decouvrait. Signale tel quel — « y a
   * plus d'effet ». `onShow` est le seul instant ou l'on sait qu'il y a
   * quelqu'un pour regarder.
   */
  const [presente, setPresente] = useState(false);

  useEffect(() => {
    if (!visible) setPresente(false);
  }, [visible]);

  const idCourant = match?.track.id ?? null;

  useEffect(() => {
    if (!presente || idCourant === null) return;

    // Remettre a zero : la fenetre ne se remonte plus entre deux accords, donc
    // rien ne le fait a notre place. Sans ca, le deuxieme accord d'une file
    // s'afficherait deja anime, c'est-a-dire sans effet du tout.
    lueur.set(0);
    onde.set(0);
    plaque.set(0);
    grave.set(0);

    if (reduced) {
      lueur.set(1);
      plaque.set(1);
      grave.set(1);
      vibrer.match();
      return;
    }
    // Tout en `out`, rien qui rebondit : la plaque se pose, elle ne saute pas.
    lueur.set(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    onde.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    plaque.set(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    grave.set(withDelay(260, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })));
    const t = setTimeout(() => scheduleOnRN(vibrer.match), 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presente, idCourant, reduced]);

  /** La pochette occupe la largeur, bornee : au-dela c'est une affiche. */
  const cote = Math.round(Math.min(width - space.xl * 2, height * 0.32, 300));

  const lueurStyle = useAnimatedStyle(() => ({ opacity: lueur.get() }));
  const ondeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(onde.get(), [0, 0.15, 1], [0, 0.5, 0]),
    transform: [{ scale: interpolate(onde.get(), [0, 1], [0.6, 2.4]) }],
  }));
  const plaqueStyle = useAnimatedStyle(() => ({
    opacity: plaque.get(),
    transform: [{ scale: interpolate(plaque.get(), [0, 1], [0.94, 1]) }],
  }));
  const graveStyle = useAnimatedStyle(() => ({
    opacity: grave.get(),
    transform: [{ translateY: interpolate(grave.get(), [0, 1], [10, 0]) }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      /* `none` et pas `fade` : la fenetre ne doit pas avoir sa propre
         animation de presentation, sinon elle mange celle du contenu — c'est
         la moitie du defaut « y a plus d'effet ». Le fond est opaque des la
         premiere image, et tout le mouvement vient de l'interieur. */
      animationType="none"
      statusBarTranslucent
      onShow={() => setPresente(true)}
      onRequestClose={onFermer}
    >
      <View style={styles.ecran}>
        {/* La lueur : un degrade radial, donc **sans bord**. C'est la seule
            facon d'obtenir de la lumiere plutot que des disques empiles. */}
        <Animated.View style={[StyleSheet.absoluteFill, lueurStyle]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="lueurMix" cx="50%" cy="42%" r="62%">
                <Stop offset="0" stopColor={color.mix} stopOpacity="0.34" />
                <Stop offset="0.45" stopColor={color.mix} stopOpacity="0.12" />
                <Stop offset="1" stopColor={color.mix} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#lueurMix)" />
          </Svg>
        </Animated.View>

        {/* L'onde : un seul anneau qui se dilate et s'efface. Il remplace
            vingt-deux confettis, et il dit la meme chose sans le bruit. */}
        {!reduced ? (
          <View style={styles.ondeCentre} pointerEvents="none">
            <Animated.View style={[styles.onde, { width: cote, height: cote, borderRadius: cote / 2 }, ondeStyle]} />
          </View>
        ) : null}

        <View style={styles.corps}>
          {/* `match` peut etre nul le temps que la fenetre se ferme : elle
              reste montee pendant sa disparition, et lire `track` dedans
              planterait pile a cet instant-la. */}
          <Animated.View style={plaqueStyle}>
            <Image
              source={{ uri: match?.track.cover }}
              style={[styles.pochette, { width: cote, height: cote }]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          </Animated.View>

          <Animated.View style={[styles.grave, graveStyle]}>
            <Text style={styles.titre} numberOfLines={2}>
              {match?.track.title ?? ''}
            </Text>
            <Text style={styles.artiste} numberOfLines={1}>
              {match?.track.artist.name ?? ''}
            </Text>

            {/* Les deux visages : c'est l'information centrale de cet ecran,
                et elle etait absente. Ils se chevauchent — deux ronds cote a
                cote se liraient comme une liste, superposes ils se lisent
                comme une paire. */}
            <View style={styles.accord}>
              <View style={styles.duo}>
                <Visage uri={moi} taille={34} style={styles.duoPremier} />
                <Visage uri={partenaire?.avatar} taille={34} style={styles.duoSecond} />
              </View>
              <Text style={styles.accordTexte} numberOfLines={1}>
                Vous avez matché
              </Text>
            </View>

            {rang && rang > 0 ? (
              <Text style={styles.rang}>
                {rang === 1 ? (
                  'Votre premier accord'
                ) : (
                  <>
                    Votre <Text style={chiffres}>{rang}</Text>
                    <Text style={styles.exposant}>e</Text> accord
                  </>
                )}
              </Text>
            ) : null}
          </Animated.View>
        </View>

        {/* Un vrai bouton, avec une cible tactile. « Touche l'ecran pour
            continuer » est la phrase qu'on ecrit quand il n'y en a pas. */}
        <Animated.View style={[styles.pied, graveStyle]}>
          <Pressable
            style={({ pressed }) => [styles.bouton, pressed && styles.boutonPresse]}
            onPress={onFermer}
            accessibilityRole="button"
            accessibilityLabel="Continuer"
          >
            <Text style={styles.boutonTexte}>Continuer</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /** Opaque : une `Modal` transparente n'a aucun fond a elle, et c'est cette
   *  vue qui doit masquer entierement le salon qui tourne derriere. */
  ecran: { flex: 1, backgroundColor: '#07060C' },

  ondeCentre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  onde: { borderWidth: 1, borderColor: color.mix },

  corps: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.xl },

  /** Pas de bordure violette autour : elle encadrait l'artwork et le faisait
   *  lire comme une vignette. La lueur suffit a le poser. */
  pochette: { borderRadius: radius.lg, backgroundColor: color.bgElevated },

  grave: { alignItems: 'center', gap: space.xs },
  titre: { ...type.title, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  artiste: { ...type.body, color: color.textMuted, textAlign: 'center' },

  accord: { alignItems: 'center', gap: space.sm, marginTop: space.lg },
  duo: { flexDirection: 'row' },
  duoPremier: { borderWidth: 2, borderColor: '#07060C', zIndex: 1 },
  duoSecond: { marginLeft: -12, borderWidth: 2, borderColor: '#07060C' },
  accordTexte: { ...type.lead, color: color.text, textAlign: 'center' },

  rang: { ...type.label, fontSize: 13, lineHeight: 18, color: color.mix, marginTop: space.xs },
  exposant: { fontSize: 9, lineHeight: 18 },

  pied: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  bouton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    borderRadius: radius.full,
    backgroundColor: color.mix,
  },
  boutonPresse: { opacity: 0.85 },
  boutonTexte: { ...type.lead, fontWeight: '700', color: '#0B0714' },
});
