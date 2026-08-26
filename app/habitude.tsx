import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { Etapes } from '../src/components/Etapes';
import { markOnboarded } from '../src/state/session';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * La derniere question : a quel point ecoutes-tu ?
 *
 * Elle a une raison d'etre precise, et ce n'est pas de faire connaissance. Le
 * moteur pilote seul sa part de decouverte pour tenir un taux d'accroche
 * cible, mais il lui faut une trentaine de swipes pour trouver le bon reglage
 * — et pendant ces trente cartes, quelqu'un qui ecoute peu se fait servir des
 * inconnus qu'il refuse, tandis qu'un gros ecouteur s'ennuie dans ce qu'il
 * connait deja. Une question donne le bon point de depart tout de suite.
 *
 * **L'animation n'est pas un ornement.** La bande montre ce que la reponse
 * fait au fil : les deux parts se redistribuent sous les doigts. Une bascule
 * qui ne montre rien demanderait de croire sur parole ; celle-ci se voit. Elle
 * ne joue **qu'au moment du choix** — l'ecran, lui, arrive deja en place,
 * conformement a la regle qui veut qu'un ecran soit pret plutot qu'il se
 * devoile.
 */

/** Ce que le moteur s'autorise. Le vrai plancher et le vrai plafond viennent
 *  de `/prefs` ; ceux-ci ne servent qu'a dessiner avant sa reponse.
 *
 *  **Familier vaut zero.** C'est la promesse du reglage : aucune carte « hors
 *  de tes habitudes » tant qu'il n'est pas change. Le moteur accepte
 *  desormais ce zero (le plancher serveur ne s'applique qu'a son automatique).
 */
const FAMILIER = 0;
const MAX = 0.55;

type Reponse = {
  cle: string;
  mot: string;
  dit: string;
  /** Part de decouverte visee. `null` rend la main au moteur. */
  valeur: number | null;
  /** Ce que la bande montre pour cette reponse. */
  part: number;
};

const REPONSES: Reponse[] = [
  {
    cle: 'peu',
    mot: 'De temps en temps',
    dit: 'Reso reste dans ce que tu connais. Rien d’inconnu.',
    valeur: FAMILIER,
    part: FAMILIER,
  },
  {
    cle: 'souvent',
    mot: 'Souvent',
    dit: 'Reso ajuste tout seul, au fil de tes réactions.',
    valeur: null,
    part: 0.3,
  },
  {
    cle: 'tous-les-jours',
    mot: 'Tous les jours',
    dit: 'Reso pousse plus loin. Tu connais déjà le reste.',
    valeur: MAX,
    part: MAX,
  },
];

/** La reponse par defaut : **Automatique**.
 *
 *  Elle etait sur « De temps en temps », donc sur `FAMILIER` — c'est-a-dire
 *  zero. Or l'ecran s'ouvre deja coche et « Ouvrir le fil » marche sans qu'on
 *  touche a rien : **tout le monde envoyait donc zero sans l'avoir choisi**.
 *  Mesure en base le 2026-08-26 : 81 comptes sur 81 a `discovery = 0`, aucun
 *  en automatique, dont 49 ecrits a la meme microseconde.
 *
 *  Ce zero n'est pas un reglage tiede, c'est un interrupteur : cote moteur il
 *  ecrase le correcteur proportionnel — la piece qui fait vivre la file — et
 *  annule le terme de bruit, soit un dixieme du score, pour tout le monde et
 *  pour toujours. On demandait a quelqu'un qui n'a encore rien ecoute de
 *  choisir « rien d'inconnu », et on l'y laissait par defaut.
 *
 *  Le defaut rend donc la main au moteur. Le filet du nouveau venu existe
 *  deja cote serveur et fait exactement le travail qu'on croyait faire ici :
 *  `Replay.prudent` ne sert aucun inconnu tant que le profil n'a pas prouve
 *  un gout (`Tuning.EvenementsAvantExploration`). Il ne s'applique QUE sans
 *  choix explicite — donc ce zero le desactivait aussi. */
const DEFAUT = REPONSES[1].cle;

export default function Habitude() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [choisi, setChoisi] = useState<string | null>(DEFAUT);
  const [occupe, setOccupe] = useState(false);

  // Une seule valeur animee pour tout l'ecran : la part de decouverte. La
  // bande et le libelle en decoulent, donc rien ne peut se desynchroniser.
  // Elle demarre sur la reponse par defaut — lue dans DEFAUT, jamais fixee a
  // la main : les deux etaient ecrits separement, donc changer le defaut
  // desynchronisait la bande de la case cochee.
  const part = useSharedValue(REPONSES.find((r) => r.cle === DEFAUT)!.part);

  const repondre = useCallback(
    (r: Reponse) => {
      vibrer.choix();
      setChoisi(r.cle);
      // 320 ms, plus qu'un changement d'etat ordinaire : cette bande doit etre
      // *suivie* du regard, pas seulement perçue. `Easing.out`, jamais de
      // ressort — une part de decouverte qui rebondit n'a aucun sens.
      part.set(withTiming(r.part, { duration: 320, easing: Easing.out(Easing.cubic) }));
    },
    [part],
  );

  const ouvrir = useCallback(async () => {
    const r = REPONSES.find((x) => x.cle === choisi);
    setOccupe(true);
    // Le reglage ne doit pas retenir l'entree dans l'app : s'il echoue, le
    // moteur trouvera le bon reglage seul, en une trentaine de cartes.
    if (r) await prisme.setPrefs(r.valeur).catch(() => {});
    await markOnboarded();
    router.replace('/(tabs)');
  }, [choisi, router]);

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
      ]}
    >
      <Etapes courante={4} />

      <Text style={styles.titre}>Tu écoutes beaucoup ?</Text>
      <Text style={styles.sous}>
        Ça décide de ce que Reso ose te proposer dès la première carte.
      </Text>

      <Bande part={part} />

      <View style={styles.liste}>
        {REPONSES.map((r, i) => (
          <Pressable
            key={r.cle}
            style={({ pressed }) => [styles.choix, i > 0 && styles.filet, pressed && styles.presse]}
            onPress={() => repondre(r)}
            accessibilityRole="radio"
            accessibilityState={{ selected: choisi === r.cle }}
          >
            <View style={styles.choixTexte}>
              <Text style={[styles.mot, choisi === r.cle && styles.motChoisi]}>{r.mot}</Text>
              <Text style={styles.dit}>{r.dit}</Text>
            </View>
            <View style={[styles.coche, choisi === r.cle && styles.cocheChoisie]} />
          </Pressable>
        ))}
      </View>

      <View style={styles.pied}>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            !choisi && styles.ctaEteint,
            pressed && styles.ctaPresse,
          ]}
          disabled={!choisi || occupe}
          onPress={ouvrir}
          accessibilityRole="button"
        >
          {occupe ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={[styles.ctaTexte, !choisi && styles.ctaTexteEteint]}>Ouvrir le fil</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * La bande : ce que la reponse fait au fil.
 *
 * Meme objet que le spectre de l'ecran « Ton Prisme » — une lumiere partagee —
 * pour que la promesse faite ici et le portrait rendu la-bas parlent la meme
 * langue. Deux parts seulement, et elles glissent l'une dans l'autre : on voit
 * la decouverte gagner du terrain, on ne lit pas un pourcentage.
 */
function Bande({ part }: { part: SharedValue<number> }) {
  const connu = useAnimatedStyle(() => ({ flexGrow: 1 - part.get() }));
  const neuf = useAnimatedStyle(() => ({ flexGrow: part.get() }));

  return (
    <View style={styles.bandeBloc}>
      <View style={styles.bande}>
        <Animated.View style={[styles.partConnue, connu]} />
        <Animated.View style={[styles.partNeuve, neuf]} />
      </View>
      <View style={styles.legendes}>
        <Text style={styles.legende}>Ce que tu connais</Text>
        <Text style={[styles.legende, styles.legendeAccent]}>Ce que tu ne connais pas</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  titre: { ...type.display, fontSize: 32, lineHeight: 38, color: color.text },
  sous: { ...type.lead, color: color.textMuted, marginTop: space.sm },

  bandeBloc: { marginTop: space.xl },
  bande: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' },
  // Le connu est sourd, le neuf porte l'accent : c'est la seule chose que le
  // reglage augmente, autant que ce soit elle qu'on regarde.
  partConnue: { backgroundColor: color.bgElevated },
  partNeuve: { backgroundColor: color.accent },
  legendes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
  legende: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  legendeAccent: { color: color.accent },

  liste: { marginTop: space.xl },
  choix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: 64,
  },
  filet: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  presse: { opacity: 0.55 },
  choixTexte: { flex: 1, gap: 2 },
  mot: { ...type.lead, color: color.textMuted },
  motChoisi: { color: color.text, fontWeight: '700' },
  dit: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  coche: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: color.textFaint,
  },
  cocheChoisie: { borderColor: color.accent, borderWidth: 6 },

  pied: { flex: 1, justifyContent: 'flex-end' },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaEteint: { backgroundColor: color.bgElevated },
  ctaPresse: { opacity: 0.85 },
  ctaTexte: { ...type.lead, color: color.bg, fontWeight: '700' },
  ctaTexteEteint: { color: color.textFaint },
});
