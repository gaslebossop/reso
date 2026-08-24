import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { Etapes } from '../src/components/Etapes';
import type { IdPlateforme } from '../src/state/plateforme';
import { plateforme } from '../src/state/plateforme';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * « Colle ton lien. »
 *
 * Cet ecran existe parce que l'import ne peut plus passer par une
 * autorisation. Spotify mis a part, l'OAuth est ferme partout : Deezer a
 * suspendu la creation de nouvelles applications apres des abus de ses
 * conditions, YouTube n'expose aucune bibliotheque, Apple veut un compte
 * developpeur payant.
 *
 * Ce qui reste ouvert, ce sont les routes **par identifiant** — le profil
 * public d'un compte Deezer, une playlist publique, et depuis fevrier 2026 la
 * page embed d'une playlist Spotify, que le moteur lit sans jeton. On ne
 * demande donc plus « autorise Reso a lire ton compte » mais une adresse.
 *
 * **Le vrai point de friction n'est pas technique, il est ici** : personne ne
 * sait spontanement ou trouver le lien de son profil Deezer. C'est pourquoi
 * l'ecran l'explique en toutes lettres au lieu de se contenter d'un champ
 * vide, et c'est la partie qui merite le plus d'attention si l'import est peu
 * utilise.
 */
export default function ImportParLien() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { p } = useLocalSearchParams<{ p?: string }>();
  const cible = plateforme((p ?? 'deezer') as IdPlateforme);

  const [url, setUrl] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const aide = useMemo(() => AIDES[cible.id] ?? AIDES.deezer, [cible.id]);

  const importer = useCallback(async () => {
    const lien = url.trim();
    if (!lien || occupe) return;
    vibrer.choix();
    setErreur(null);
    setOccupe(true);
    try {
      const lu = await prisme.importLien(lien);
      // Deezer rend des identifiants natifs, YouTube des noms : les deux
      // partent tels quels, `seed` sait recevoir l'un ou l'autre. Resoudre les
      // identifiants Deezer en noms ici ne ferait que rouvrir le probleme des
      // homonymes que le moteur vient d'eviter.
      if (lu.artist_ids.length === 0 && lu.artists.length === 0) {
        // Le moteur renvoie normalement une erreur nommee dans ce cas ; si
        // jamais il rend une reponse vide, on ne saute surtout pas l'ecran des
        // artistes — le profil partirait vide.
        router.replace('/onboarding');
        return;
      }
      await prisme.seed({ artistIds: lu.artist_ids, artists: lu.artists });
      router.replace('/habitude');
    } catch (e) {
      // Le message vient du moteur et dit quoi faire (« ce profil est prive,
      // colle plutot une playlist »). On le relaie tel quel plutot que de le
      // remplacer par une phrase generique.
      setErreur(e instanceof Error ? e.message : 'Import impossible');
    } finally {
      setOccupe(false);
    }
  }, [url, occupe, router]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
        ]}
      >
        <Etapes courante={2} />

        <Text style={styles.titre}>{aide.titre}</Text>
        <Text style={styles.sous}>{aide.sous}</Text>

        <TextInput
          style={styles.champ}
          placeholder={aide.exemple}
          placeholderTextColor={color.textFaint}
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            if (erreur) setErreur(null);
          }}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="url"
          returnKeyType="go"
          editable={!occupe}
          onSubmitEditing={importer}
          accessibilityLabel="Lien à importer"
        />

        {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

        {/* Ou trouver le lien. C'est le contenu utile de l'ecran : sans lui,
            le champ vide ne dit rien a personne. */}
        <View style={styles.encart}>
          <Text style={styles.encartTitre}>Où le trouver</Text>
          {aide.etapes.map((e, i) => (
            <Text key={i} style={styles.encartLigne}>
              {i + 1}. {e}
            </Text>
          ))}
        </View>

        <View style={styles.pied}>
          <Pressable
            style={[styles.cta, (!url.trim() || occupe) && styles.ctaOff]}
            disabled={!url.trim() || occupe}
            onPress={importer}
            accessibilityRole="button"
          >
            {occupe ? (
              <ActivityIndicator color={color.bg} />
            ) : (
              <Text style={styles.ctaText}>Importer</Text>
            )}
          </Pressable>

          {/* Toujours atteignable. Un profil prive, une playlist vide ou
              simplement l'envie de ne pas coller d'adresse ne doivent jamais
              laisser quelqu'un coince sur cet ecran. */}
          <Pressable
            style={styles.secondaire}
            disabled={occupe}
            onPress={() => router.replace('/onboarding')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaireTexte}>Choisir mes artistes à la main</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Le mode d'emploi, par plateforme.
 *
 * Ecrit a la main plutot que genere : le chemin exact dans l'application de
 * Deezer n'a rien de deductible, et une formule approximative couterait plus
 * qu'elle ne rapporte.
 */
const AIDES: Record<string, { titre: string; sous: string; exemple: string; etapes: string[] }> = {
  deezer: {
    titre: 'Colle ton lien Deezer',
    sous: "Reso lit tes titres likés et en tire tes artistes. Rien n'est écrit chez Deezer.",
    exemple: 'https://www.deezer.com/profile/…',
    etapes: [
      'Ouvre Deezer, va sur ton profil.',
      'Touche les trois points, puis « Partager mon profil ».',
      'Colle le lien ici. Une playlist marche aussi.',
    ],
  },
  ytmusic: {
    titre: 'Colle une playlist YouTube Music',
    sous: 'Reso en tire les artistes. La playlist doit être publique ou non répertoriée.',
    exemple: 'https://music.youtube.com/playlist?list=…',
    etapes: [
      'Ouvre la playlist dans YouTube Music.',
      'Touche « Partager », puis « Copier le lien ».',
      'Colle le lien ici.',
    ],
  },
  spotify: {
    titre: 'Colle une playlist Spotify',
    sous: "Reso en tire tes artistes. La playlist doit être publique. Rien n'est écrit chez Spotify.",
    exemple: 'https://open.spotify.com/playlist/…',
    etapes: [
      'Ouvre la playlist dans Spotify.',
      'Touche « … », puis « Partager » et « Copier le lien ».',
      'Colle le lien ici.',
    ],
  },
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: color.bg },
  screen: { flex: 1, paddingHorizontal: space.lg },
  titre: { ...type.display, fontSize: 32, lineHeight: 38, color: color.text },
  sous: { ...type.lead, color: color.textMuted, marginTop: space.sm },

  champ: {
    ...type.body,
    color: color.text,
    backgroundColor: color.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.xl,
  },

  erreur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.alert, marginTop: space.md },

  // Un encart sourd, pas une carte : l'information est utile mais secondaire,
  // et lui donner du contraste la mettrait au-dessus du champ qu'elle sert.
  encart: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    gap: space.xs,
  },
  encartTitre: { ...type.caption, color: color.textFaint, marginBottom: space.xs },
  encartLigne: { ...type.label, fontSize: 13, lineHeight: 20, color: color.textMuted },

  pied: { marginTop: 'auto', gap: space.sm },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md + 2,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaOff: { backgroundColor: color.bgElevated },
  ctaText: { ...type.lead, color: color.bg, fontWeight: '700' },
  secondaire: { alignItems: 'center', paddingVertical: space.md },
  secondaireTexte: { ...type.label, color: color.textMuted },
});
