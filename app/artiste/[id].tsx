import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../src/api/client';
import { fansLisibles, ligneInterpretes, separerTitre } from '../../src/api/titre';
import type { FicheArtiste, Track } from '../../src/api/types';
import { player } from '../../src/audio/player';
import { IconeRetour } from '../../src/components/Icones';
import { NomVerifie } from '../../src/components/NomVerifie';
import { vibrer } from '../../src/state/vibration';
import { color, radius, space, type } from '../../src/theme/tokens';

/**
 * La fiche d'un artiste : qui il est, ce qu'il fait, qui le suit **ici**.
 *
 * ## Deux chiffres qui ne disent pas la même chose
 *
 * Les fans Deezer se comptent en millions et disent sa taille dans le monde.
 * Les abonnés Reso se comptent sur les doigts et disent « qui, autour de toi,
 * écoute ça ». C'est le second qui a une valeur ici, donc c'est lui qui est
 * écrit en grand ; l'autre le suit, en petit, parce que le taire donnerait à
 * « 3 abonnés » l'air d'un artiste confidentiel alors qu'il est peut-être
 * numéro un mondial.
 *
 * ## Ses titres s'écoutent sur place
 *
 * Trente secondes, le lecteur du fil — le même, parce que deux lecteurs se
 * disputeraient la sortie audio. C'est tout l'intérêt d'ouvrir la fiche avant
 * de suivre : on n'a pas à croire un nom sur parole.
 *
 * ## Le bouton suivre est optimiste
 *
 * Il bascule tout de suite et appelle ensuite : la route est idempotente côté
 * moteur, et attendre le réseau pour changer un mot donne l'impression d'un
 * bouton mou. En cas d'échec il revient à sa place, ce qui est plus honnête
 * qu'un message.
 */
export default function FicheArtisteEcran() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id: brut } = useLocalSearchParams<{ id?: string }>();
  const id = Number(brut ?? 0);

  const [fiche, setFiche] = useState<FicheArtiste | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [suivi, setSuivi] = useState(false);
  const [joue, setJoue] = useState<number | null>(null);

  useEffect(() => {
    let vivant = true;
    prisme
      .artiste(id)
      .then((f) => {
        if (!vivant) return;
        setFiche(f);
        setSuivi(f.suivi);
      })
      .catch((e) => {
        if (vivant) setErreur(e instanceof Error ? e.message : 'Artiste indisponible');
      });
    return () => {
      vivant = false;
    };
  }, [id]);

  // Quitter la fiche coupe le son. Le fil reprendra le sien en retrouvant le
  // focus — sur SA carte, pas sur un titre écouté ici.
  useEffect(() => () => player.pause(), []);

  const basculerSuivi = useCallback(async () => {
    if (!fiche) return;
    vibrer.action();
    const vise = !suivi;
    setSuivi(vise);
    try {
      await prisme.suivreArtiste(fiche.artist.id, vise);
    } catch {
      // Revenir en arrière plutôt qu'afficher un message : le bouton dit
      // l'état, et un état faux est pire qu'un état qui refuse de changer.
      setSuivi(!vise);
    }
  }, [fiche, suivi]);

  const ecouter = useCallback(
    (t: Track) => {
      vibrer.choix();
      if (joue === t.id) {
        void player.pause();
        setJoue(null);
        return;
      }
      setJoue(t.id);
      void player.play(t).catch(() => setJoue(null));
    },
    [joue],
  );

  if (erreur) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.erreur}>{erreur}</Text>
        <Pressable
          style={({ pressed }) => [styles.retourSeul, pressed && styles.pale]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Text style={styles.retourMot}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  if (!fiche) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  const portrait = Math.min(width - space.lg * 2, 320);

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

        <View style={styles.identite}>
          <Image
            source={{ uri: fiche.artist.picture }}
            style={[styles.portrait, { width: portrait, height: portrait }]}
            contentFit="cover"
            transition={220}
            cachePolicy="memory-disk"
            recyclingKey={String(fiche.artist.id)}
            accessibilityLabel={fiche.artist.name}
          />
          <NomVerifie
            nom={fiche.artist.name}
            verifie={fiche.artist.verifie}
            style={styles.nom}
            ligne={styles.nomLigne}
            taille={22}
            numberOfLines={2}
          />
          <Text style={styles.abonnes}>
            {fiche.abonnes === 0
              ? 'Personne ne le suit encore sur Reso'
              : fiche.abonnes === 1
                ? '1 abonné sur Reso'
                : `${fiche.abonnes} abonnés sur Reso`}
          </Text>
          {(fiche.artist.fans ?? 0) > 0 ? (
            <Text style={styles.fans}>{fansLisibles(fiche.artist.fans ?? 0)} fans sur Deezer</Text>
          ) : null}

          <Pressable
            style={[styles.suivre, suivi && styles.suiviActif]}
            onPress={basculerSuivi}
            accessibilityRole="button"
            accessibilityLabel={suivi ? 'Ne plus suivre' : 'Suivre'}
          >
            <Text style={[styles.suivreTexte, suivi && styles.suivreTexteActif]}>
              {suivi ? 'Suivi' : 'Suivre'}
            </Text>
          </Pressable>
        </View>

        {fiche.tracks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Ses titres</Text>
            <Text style={styles.sectionNote}>Appuie pour écouter trente secondes.</Text>
            <View style={styles.liste}>
              {fiche.tracks.map((t) => {
                const { titre, avec: dansLeTitre } = separerTitre(t.title);
                const avec = t.featuring?.length ? t.featuring : dansLeTitre;
                return (
                  <Pressable
                    key={t.id}
                    style={({ pressed }) => [styles.ligne, pressed && styles.pale]}
                    onPress={() => ecouter(t)}
                    accessibilityRole="button"
                    accessibilityLabel={`Écouter ${titre}`}
                  >
                    <Image
                      source={{ uri: t.cover }}
                      style={styles.cover}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={String(t.id)}
                    />
                    <View style={styles.ligneTexte}>
                      <Text
                        style={[styles.ligneTitre, joue === t.id && styles.enEcoute]}
                        numberOfLines={1}
                      >
                        {titre}
                      </Text>
                      <Text style={styles.ligneSous} numberOfLines={1}>
                        {avec.length > 0 ? ligneInterpretes(t.artist.name, avec) : t.album}
                      </Text>
                    </View>
                    {joue === t.id ? <Text style={styles.onde}>▮▮</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={styles.vide}>Deezer ne connaît aucun titre de cet artiste.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space.md },
  pale: { opacity: 0.5 },

  retour: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: space.lg - space.md,
  },
  retourSeul: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
  retourMot: { ...type.lead, color: color.accent },

  identite: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.lg },
  portrait: { borderRadius: radius.card, backgroundColor: color.bgElevated },
  nom: {
    ...type.display,
    fontSize: 28,
    lineHeight: 34,
    color: color.text,
    textAlign: 'center',
  },
  /** La marge vit sur la rangee et non sur le texte : posee sur le `Text`,
   *  elle aurait pousse le nom sans pousser la pastille, qui se serait
   *  retrouvee accrochee au portrait. */
  nomLigne: { justifyContent: 'center', maxWidth: '100%', marginTop: space.md },
  // Le chiffre qui compte ici est celui de Reso : il dit qui, autour de toi,
  // écoute ça. Les fans Deezer disent une autre chose, et en plus petit.
  abonnes: { ...type.body, color: color.textMuted, textAlign: 'center' },
  fans: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  suivre: {
    marginTop: space.lg,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  suiviActif: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.textFaint },
  suivreTexte: { ...type.lead, fontWeight: '700', color: color.bg },
  suivreTexteActif: { color: color.textMuted },

  section: { marginTop: space.xl, paddingHorizontal: space.lg },
  sectionTitre: { ...type.title, fontSize: 20, lineHeight: 26, color: color.text },
  sectionNote: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, marginTop: space.xs },

  liste: { marginTop: space.md },
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
  enEcoute: { color: color.accent },
  ligneSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  onde: { ...type.caption, fontSize: 12, lineHeight: 16, color: color.accent },

  erreur: { ...type.body, color: color.alert, textAlign: 'center', paddingHorizontal: space.xl },
  vide: {
    ...type.body,
    color: color.textMuted,
    paddingHorizontal: space.lg,
    marginTop: space.xl,
  },
});
