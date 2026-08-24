import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { isSpotifyConfigured, importTaste } from '../src/auth/spotify';
import { Etapes } from '../src/components/Etapes';
import type { IdPlateforme, Plateforme } from '../src/state/plateforme';
import { PLATEFORMES, reglerPlateforme } from '../src/state/plateforme';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * Ou ecoutes-tu, d'habitude ?
 *
 * L'ecran repond a deux besoins qui n'en font qu'un. Reso ne fait entendre que
 * trente secondes : le titre entier se joue ailleurs, et savoir ou evite que
 * chaque lien tombe sur Deezer parce que c'est de la que vient le catalogue.
 * Et quand la plateforme sait rendre un gout deja constitue — **aujourd'hui,
 * Spotify seul** — la question des artistes ne se pose plus : on la saute.
 *
 * Le bouton Spotify vivait au milieu de l'ecran des artistes, sous un
 * separateur « OU CHOISIS A LA MAIN ». C'etait la mauvaise place : il proposait
 * de rendre inutile l'ecran sur lequel il etait pose, apres qu'on avait
 * commence a le remplir. La question vient donc avant.
 *
 * **Ce que chaque plateforme permet est ecrit sous son nom**, sans arrondi.
 * Le dire ici vaut mieux que de le laisser decouvrir apres un tap.
 *
 * Deux mecaniques d'import coexistent, et elles ne demandent pas le meme
 * geste :
 *
 * - **par compte** (Spotify) : une autorisation OAuth, et l'import se fait
 *   sur place, sans quitter cet ecran.
 * - **par lien** (Deezer, YouTube Music) : on part vers `/import-lien`, ou
 *   l'on colle l'adresse d'un profil ou d'une playlist publique. C'est le seul
 *   chemin qui reste : Deezer a suspendu la creation d'applications, donc son
 *   OAuth est ferme pour de bon, et YouTube n'expose aucune bibliotheque.
 *
 * Apple Music n'a ni l'un ni l'autre — sa bibliotheque exige un compte
 * developpeur payant — et recoit donc des liens, pas un import.
 */
/** Le nom que le moteur donne a chaque source d'import par lien. */
const SOURCE: Partial<Record<IdPlateforme, string>> = {
  deezer: 'deezer',
  ytmusic: 'ytmusic',
  // Spotify importe par compte quand l'app a son identifiant OAuth, et par
  // lien de playlist publique sinon — le moteur lit la page embed sans jeton.
  spotify: 'spotify',
};

export default function ChoixPlateforme() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [occupe, setOccupe] = useState<IdPlateforme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  /**
   * Ce que le moteur sait importer, tel qu'il l'annonce.
   *
   * Deezer ne demande aucune cle et repond toujours present ; YouTube Music
   * n'est la que si la cle d'API Google est posee sur le serveur. On le
   * demande avant d'afficher la marque « Import » : promettre un import qui
   * echouera **apres** qu'on a colle son lien serait pire que de ne rien
   * promettre. Si l'appel echoue, on retombe sur Deezer seul — c'est toujours
   * vrai.
   */
  const [sources, setSources] = useState<string[]>(['deezer']);

  useEffect(() => {
    let vivant = true;
    prisme
      .importSources()
      .then((r) => {
        if (vivant && r.sources.length > 0) setSources(r.sources);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  /** Vrai si cette plateforme sait vraiment importer, ici et maintenant.
   *
   * Spotify a deux chemins, et il en faut au moins un : l'OAuth si l'app
   * porte son identifiant client, sinon le lien d'une playlist publique —
   * que le serveur sait lire sans jeton depuis qu'il a ouvert la page embed.
   */
  const peutImporter = useCallback(
    (p: Plateforme) => {
      if (p.id === 'spotify') return isSpotifyConfigured() || sources.includes('spotify');
      if (p.importe === 'compte') return isSpotifyConfigured();
      if (p.importe === 'lien') return sources.includes(SOURCE[p.id] ?? '');
      return false;
    },
    [sources],
  );

  const choisir = useCallback(
    async (p: Plateforme) => {
      vibrer.choix();
      setErreur(null);
      await reglerPlateforme(p.id);

      // Sans import possible, la plateforme n'est qu'une destination de lien :
      // on enchaine sur le choix des artistes, qui reste le seul moyen de
      // savoir ce que cette personne ecoute.
      if (!peutImporter(p)) {
        router.push('/onboarding');
        return;
      }

      // L'import par lien a son propre ecran : il demande une adresse, donc du
      // texte a taper ou coller, ce qu'une ligne de liste ne peut pas offrir.
      // Spotify y tombe aussi quand l'OAuth n'est pas configure : mieux vaut
      // coller une playlist que proposer un compte qui ne peut pas marcher.
      if (p.importe === 'lien' || (p.id === 'spotify' && !isSpotifyConfigured())) {
        router.push({ pathname: '/import-lien', params: { p: p.id } });
        return;
      }

      setOccupe(p.id);
      try {
        const gout = await importTaste();
        // Fenetre fermee : on ne dit rien, on laisse le choix ouvert.
        if (!gout) return;
        if (gout.artists.length === 0) {
          setErreur("Spotify n'a renvoyé aucun artiste écouté. Choisis-les à la main.");
          router.push('/onboarding');
          return;
        }
        await prisme.seed({ artists: gout.artists });
        // Le gout est amorce : l'ecran des artistes n'a plus rien a demander.
        // A sa place, on demande dans quels styles creuser en premier — la
        // seule question que l'import laisse ouverte.
        router.push('/styles');
      } catch (e) {
        setErreur(e instanceof Error ? e.message : 'Connexion impossible');
      } finally {
        setOccupe(null);
      }
    },
    [router, peutImporter],
  );

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
      ]}
    >
      <Etapes courante={2} />

      <Text style={styles.titre}>Où écoutes-tu ?</Text>
      <Text style={styles.sous}>
        Reso ne fait entendre que trente secondes. Le reste se joue chez toi.
      </Text>

      <View style={styles.liste}>
        {PLATEFORMES.map((p, i) => (
          <Pressable
            key={p.id}
            style={({ pressed }) => [styles.choix, i > 0 && styles.filet, pressed && styles.presse]}
            disabled={occupe !== null}
            onPress={() => choisir(p)}
            accessibilityRole="button"
            accessibilityLabel={p.nom}
          >
            <View style={styles.choixTexte}>
              <Text style={styles.nom}>{p.nom}</Text>
              <Text style={styles.dit}>{p.dit}</Text>
            </View>
            {occupe === p.id ? (
              <ActivityIndicator color={color.accent} />
            ) : peutImporter(p) ? (
              <View style={styles.marque}>
                <Text style={styles.marqueTexte}>Import</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>

      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  titre: { ...type.display, fontSize: 32, lineHeight: 38, color: color.text },
  sous: { ...type.lead, color: color.textMuted, marginTop: space.sm },

  // Des lignes separees par des filets, pas cinq cartes : cinq rectangles gris
  // identiques ne hierarchisent rien et donnent a « Aucune » le meme poids
  // visuel qu'a un import complet.
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
  nom: { ...type.lead, color: color.text },
  dit: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  // La seule marque de l'ecran, et elle porte une information : cette
  // plateforme-la evite de tout retaper.
  marque: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: color.accentDim,
  },
  marqueTexte: { ...type.caption, fontSize: 11, lineHeight: 14, color: color.accent, letterSpacing: 0.8 },

  erreur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.alert, marginTop: space.md },
});
