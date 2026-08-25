import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import type { GesteHistorique, SwipeAction } from '../src/api/types';
import { EnteteTitre, Feuille, LigneAction } from '../src/components/Feuille';
import { IconeRetour } from '../src/components/Icones';
import { retirerDeLaSeance } from '../src/state/gardesSeance';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * Ce que tu as fait, et de quoi le reprendre.
 *
 * ## Pourquoi cet écran existe
 *
 * Le fil se juge au pouce, en trente secondes, souvent en marchant : on passe
 * un titre qu'on voulait garder, on garde celui d'avant, on aime au lieu de
 * passer. Sans retour en arrière, cette erreur-là est définitive — et pire,
 * elle est **apprise** : le profil est le repli de l'histoire, donc un geste
 * faux pèse aussi longtemps qu'il y reste.
 *
 * ## Ce que corriger veut dire ici
 *
 * Le moteur ne pose pas le bon geste **par-dessus** le mauvais : il remplace.
 * Un faux signal ne se compense pas, il s'efface. L'heure et la durée d'écoute
 * d'origine sont conservées — corriger un mot ne déplace pas le souvenir — et
 * la bibliothèque suit toute seule.
 *
 * ## Ce que l'écran montre, et ce qu'il tait
 *
 * Une ligne par titre, le verbe employé, et **le temps écouté avant de
 * trancher**. Ce dernier n'est pas de la décoration : c'est presque toujours
 * lui qui rappelle pourquoi on a fait ça. « Passé après 2 s » se reconnaît
 * comme un réflexe ; « passé après 24 s », c'était un vrai choix, et on n'y
 * touche pas.
 *
 * Pas de date en toutes lettres, pas d'heure : « hier », « il y a 3 j »
 * suffisent à situer, et un horodatage complet ferait de cette liste un
 * journal d'audit.
 */

/** Ce que chaque verbe dit, à la première personne. */
const VERBES: Record<SwipeAction, string> = {
  save: 'Gardé',
  like: 'Aimé',
  skip: 'Passé',
  block: 'Banni',
};

/** Les corrections proposées, dans l'ordre du geste le plus fort au plus
 *  faible. « Bannir » n'y est pas : c'est une décision d'un autre ordre, elle
 *  se prend dans le fil et se défait dans les réglages. */
const CHOIX: { action: SwipeAction; titre: string; sous: string }[] = [
  { action: 'save', titre: 'Je garde', sous: 'Il entre dans tes gardés.' },
  { action: 'like', titre: 'J’aime', sous: 'Il compte, sans être rangé.' },
  { action: 'skip', titre: 'Je passe', sous: 'Il ne compte plus dans ton goût.' },
];

export default function Historique() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [gestes, setGestes] = useState<GesteHistorique[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<GesteHistorique | null>(null);
  const [occupe, setOccupe] = useState<SwipeAction | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await prisme.historique();
      setGestes(r.gestes);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Historique indisponible');
      setGestes([]);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const corriger = useCallback(
    async (action: SwipeAction) => {
      const g = ouvert;
      if (!g || g.action === action) return;
      vibrer.action();
      setOccupe(action);
      try {
        await prisme.corrigerGeste(g.track.id, action);
        // La liste se met à jour sur place : recharger ferait clignoter tout
        // l'écran pour un mot qui change sur une ligne.
        setGestes((xs) =>
          (xs ?? []).map((x) => (x.track.id === g.track.id ? { ...x, action } : x)),
        );
        // La trace du fil montre les pochettes gardées pendant la séance : un
        // titre qui n'est plus gardé n'a plus rien à y faire.
        if (action !== 'save') retirerDeLaSeance(g.track.id);
        setOuvert(null);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : 'Correction impossible');
      } finally {
        setOccupe(null);
      }
    },
    [ouvert],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={({ pressed }) => [styles.retour, pressed && styles.pale]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <IconeRetour couleur={color.text} />
        </Pressable>

        <View style={styles.entete}>
          <Text style={styles.titre}>Ton historique</Text>
          <Text style={styles.sous}>
            Appuie sur un titre pour changer ton geste. Le moteur remplace l’ancien au lieu de
            l’empiler : ton goût oublie l’erreur.
          </Text>
        </View>

        {gestes === null ? (
          <ActivityIndicator color={color.accent} style={styles.attente} />
        ) : gestes.length === 0 ? (
          <View style={styles.vide}>
            <Text style={styles.videTitre}>Rien encore.</Text>
            <Text style={styles.videTexte}>
              Les titres que tu juges dans le fil s’inscrivent ici, et tu peux revenir sur chacun.
            </Text>
          </View>
        ) : (
          <View style={styles.liste}>
            {gestes.map((g) => (
              <Pressable
                key={g.track.id}
                style={({ pressed }) => [styles.ligne, pressed && styles.pale]}
                onPress={() => {
                  vibrer.choix();
                  setOuvert(g);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${VERBES[g.action]} — ${g.track.title} par ${g.track.artist.name}`}
              >
                <Image
                  source={{ uri: g.track.cover }}
                  style={styles.cover}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={String(g.track.id)}
                />
                <View style={styles.ligneTexte}>
                  <Text style={styles.ligneTitre} numberOfLines={1}>
                    {g.track.title}
                  </Text>
                  <Text style={styles.ligneArtiste} numberOfLines={1}>
                    {g.track.artist.name}
                  </Text>
                </View>
                <View style={styles.ligneDroite}>
                  <Text style={[styles.verbe, styles[g.action]]}>{VERBES[g.action]}</Text>
                  <Text style={styles.quand}>{depuis(g.at, g.ms_played)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}
      </ScrollView>

      <Feuille visible={ouvert !== null} onFermer={() => setOuvert(null)}>
        {ouvert ? (
          <>
            <EnteteTitre
              track={ouvert.track}
              sous={`${VERBES[ouvert.action]} · ${ecoute(ouvert.ms_played)}`}
            />
            {CHOIX.map((c) => (
              <LigneAction
                key={c.action}
                titre={c.titre}
                sous={c.sous}
                accent={c.action === 'save'}
                courante={c.action === ouvert.action}
                occupe={occupe === c.action}
                onPress={() => corriger(c.action)}
              />
            ))}
          </>
        ) : null}
      </Feuille>
    </View>
  );
}

/** « il y a 3 j », et l'écoute quand elle dit quelque chose.
 *
 * Deux informations sur une ligne parce qu'elles se lisent ensemble : un geste
 * d'il y a un mois posé après deux secondes ne se défend pas de la même façon
 * qu'un geste d'hier posé après vingt-cinq. */
function depuis(at: number, msPlayed: number): string {
  const j = Math.floor((Date.now() - at) / 86_400_000);
  const quand = j <= 0 ? "aujourd’hui" : j === 1 ? 'hier' : `il y a ${j} j`;
  return `${quand} · ${ecoute(msPlayed)}`;
}

/** Le temps écouté, arrondi à la seconde. Zéro se dit « sans écouter » : c'est
 *  le cas d'un ajout à la main, et « 0 s » se lirait comme une panne. */
function ecoute(ms: number): string {
  if (ms <= 0) return 'sans écouter';
  return `${Math.round(ms / 1000)} s`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pale: { opacity: 0.5 },
  retour: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: space.lg - space.md,
  },

  entete: { paddingHorizontal: space.lg, gap: space.sm },
  titre: { ...type.display, fontSize: 28, lineHeight: 34, color: color.text },
  sous: { ...type.body, color: color.textMuted },

  attente: { marginTop: space.xxl },

  // Des lignes séparées par des filets, pas des cartes : vingt cartes grises
  // identiques ne hiérarchisent rien, et ici c'est le verbe à droite qui doit
  // sauter aux yeux.
  liste: { marginTop: space.xl, paddingHorizontal: space.lg },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  cover: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.bgElevated },
  ligneTexte: { flex: 1, gap: 2 },
  ligneTitre: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text },
  ligneArtiste: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  ligneDroite: { alignItems: 'flex-end', gap: 2 },
  verbe: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  // Chaque verbe porte la couleur de son geste dans le fil : le doré de « je
  // garde », le vert du « j'aime », le gris sourd du rejet.
  save: { color: color.save },
  like: { color: color.accent },
  skip: { color: color.reject },
  block: { color: color.alert },
  quand: { ...type.caption, fontSize: 12, lineHeight: 16, color: color.textFaint },

  vide: { paddingHorizontal: space.lg, paddingTop: space.xxl, gap: space.sm },
  videTitre: { ...type.title, color: color.text },
  videTexte: { ...type.body, color: color.textMuted },

  erreur: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.alert,
    paddingHorizontal: space.lg,
    marginTop: space.md,
  },
});
