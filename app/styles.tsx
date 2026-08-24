import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import { Etapes } from '../src/components/Etapes';
import { chiffres, color, radius, space, type } from '../src/theme/tokens';
import { vibrer } from '../src/state/vibration';

/**
 * Dans quoi tu creuses ?
 *
 * **L'objet du monde reel, ce sont les intercalaires d'un bac de disquaire** —
 * pas une grille de tuiles de genres. On ne demande pas de decrire son gout
 * dans l'absolu : on presente les rayons dans lesquels *ta propre collection*
 * est deja rangee, et on demande lesquels tu veux qu'on fouille en premier.
 *
 * D'ou la decision qui tient tout l'ecran : **chaque style montre tes artistes
 * qui le portent.** C'est la seule chose qui distingue cette page d'une liste
 * de genres generique, et c'est aussi ce qui la rend honnete — cocher
 * « french hip hop » n'agit pas sur une categorie abstraite du catalogue, ca
 * appuie sur ces artistes-la et sur aucun autre. Le moteur ne connait pas les
 * libelles de Spotify, il ne connait que des ancres.
 *
 * **Ponderer, pas filtrer.** Un style coche fait remonter la facette qui le
 * porte ; il n'en retire aucune autre. Quelqu'un qui ecoute du rap ET de
 * l'ambient doit pouvoir cocher le rap sans perdre l'ambient — c'est ecrit
 * sous le titre, parce que c'est exactement ce que les gens craignent en
 * cochant quelque chose.
 *
 * Deux contextes, un seul ecran :
 *
 * - **au demarrage**, juste apres l'import, avec la liste complete de ce qu'il
 *   a trouve. C'est la troisieme etape — celle du choix des artistes a la
 *   main, que l'import a rendue inutile ;
 * - **depuis les reglages**, ou l'on ne peut que revoir et decocher ce qui est
 *   actif : les propositions viennent de l'import, et l'import n'est pas
 *   rejoue pour ouvrir un ecran de reglage. C'est dit sur place plutot que
 *   laisse deviner.
 */
/** Un style propose, avec **tes** artistes qui le portent.
 *
 * La liste d'artistes n'est pas decorative : c'est elle qui rend le style
 * choisissable. Prisme ne raisonne pas sur des categories de catalogue, il
 * raisonne sur des ancres — cocher « Rap/Hip Hop » revient a appuyer sur ces
 * artistes-la, et sur aucun autre. */
type StyleResolu = { nom: string; artistIds: number[]; artistes: string[] };

type Suggestion = { name: string; artist_ids: number[]; artists: string[] };

export default function ChoixStyles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { retour } = useLocalSearchParams<{ retour?: string }>();
  const depuisReglages = retour === 'reglages';

  const [liste, setListe] = useState<StyleResolu[]>([]);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;

    // Les deux sources sont lues **en parallele et independamment** : ce qu'on
    // peut proposer, et ce qui est deja coche. Les deux viennent du moteur —
    // rien de tout ca ne vit sur le telephone, donc un rechargement de l'app
    // ne peut pas vider l'ecran.
    void (async () => {
      const [propose, actif] = await Promise.all([
        prisme.styleSuggestions().catch(() => ({ styles: [] as Suggestion[] })),
        // Un reglage illisible ne doit pas fermer l'ecran : on part de rien.
        prisme.styles().catch(() => ({ styles: [] as { name: string; artist_ids: number[] }[] })),
      ]);
      if (!vivant) return;

      setChoisis(new Set(actif.styles.map((s) => s.name)));
      // A defaut de propositions, on rebatit la liste depuis ce qui est deja
      // actif : on perd les noms d'artistes, jamais le pouvoir de decocher.
      setListe(
        propose.styles.length > 0
          ? propose.styles.map((s) => ({ nom: s.name, artistIds: s.artist_ids, artistes: s.artists }))
          : actif.styles.map((s) => ({ nom: s.name, artistIds: s.artist_ids, artistes: [] })),
      );
      console.log(`[styles] ecran : ${propose.styles.length} proposes, ${actif.styles.length} actifs`);
      setChargement(false);
    })();

    return () => {
      vivant = false;
    };
  }, []);

  const basculer = useCallback((nom: string) => {
    vibrer.choix();
    setChoisis((avant) => {
      const apres = new Set(avant);
      if (apres.has(nom)) apres.delete(nom);
      else apres.add(nom);
      return apres;
    });
  }, []);

  const valider = useCallback(async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      await prisme.setStyles(
        liste
          .filter((s) => choisis.has(s.nom))
          .map((s) => ({ name: s.nom, artist_ids: s.artistIds })),
      );
      if (depuisReglages) router.back();
      else router.push('/habitude');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Le reglage n'a pas ete enregistre.");
    } finally {
      setEnvoi(false);
    }
  }, [choisis, depuisReglages, liste, router]);

  const passer = useCallback(() => {
    if (depuisReglages) router.back();
    else router.push('/habitude');
  }, [depuisReglages, router]);

  const rien = !chargement && liste.length === 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      {depuisReglages ? null : <Etapes courante={3} />}

      <Text style={styles.titre}>Dans quoi tu creuses ?</Text>
      <Text style={styles.sous}>
        {rien
          ? 'Tes artistes ne se rangent pas dans assez de rayons communs pour qu’on te propose un choix.'
          : 'Ces styles viennent de tes artistes. Ce que tu coches remonte dans le fil — rien n’en disparait.'}
      </Text>

      {chargement ? (
        <View style={styles.attente}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : rien ? (
        <View style={styles.attente}>
          <Text style={styles.vide}>
            {depuisReglages
              ? 'Refais un import depuis Spotify pour choisir tes styles.'
              : 'Le fil apprendra tes gouts au fil des cartes, c’est son travail.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.liste}
          contentContainerStyle={styles.listeContenu}
          showsVerticalScrollIndicator={false}
        >
          {liste.map((s, i) => {
            const actif = choisis.has(s.nom);
            return (
              <Pressable
                key={s.nom}
                style={({ pressed }) => [styles.ligne, i > 0 && styles.filet, pressed && styles.presse]}
                onPress={() => basculer(s.nom)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: actif }}
                accessibilityLabel={`${s.nom}, ${s.artistIds.length} artistes`}
              >
                <View style={styles.texte}>
                  <Text style={[styles.nom, actif && styles.nomChoisi]} numberOfLines={1}>
                    {s.nom}
                  </Text>
                  {/* La preuve que l'ecran a lu ta bibliotheque. Elle s'allume
                      quand on coche : on voit litteralement sur qui on appuie. */}
                  <Text style={[styles.artistes, actif && styles.artistesChoisis]} numberOfLines={1}>
                    {s.artistes.length > 0
                      ? s.artistes.slice(0, 3).join(', ') +
                        (s.artistes.length > 3 ? ` +${s.artistes.length - 3}` : '')
                      : `${s.artistIds.length} artistes`}
                  </Text>
                </View>
                <Text style={[styles.compte, actif && styles.compteChoisi]}>{s.artistIds.length}</Text>
                <View style={[styles.coche, actif && styles.cocheChoisie]} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

      <View style={styles.pied}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.presse, envoi && styles.ctaOccupe]}
          onPress={valider}
          disabled={envoi || chargement}
          accessibilityRole="button"
        >
          {envoi ? (
            <ActivityIndicator color={color.bg} />
          ) : (
            <Text style={styles.ctaTexte}>
              {choisis.size === 0 ? 'Continuer sans choisir' : `Affiner (${choisis.size})`}
            </Text>
          )}
        </Pressable>

        {/* La hauteur est reservee meme sans action secondaire : c'est ce qui
            empeche le bouton principal de sauter d'un ecran de demarrage a
            l'autre. */}
        <View style={styles.secondaire}>
          {depuisReglages ? null : (
            <Pressable onPress={passer} disabled={envoi} accessibilityRole="button">
              <Text style={styles.passer}>Plus tard</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  titre: { ...type.display, fontSize: 32, lineHeight: 38, color: color.text },
  sous: { ...type.lead, color: color.textMuted, marginTop: space.sm },

  attente: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.lg },
  vide: { ...type.lead, color: color.textFaint, textAlign: 'center' },

  // Des lignes separees par des filets, comme partout dans le demarrage. Une
  // grille de pastilles colorees donnerait a dix-huit styles le meme poids et
  // ferait de l'ecran une soupe de couleurs — alors que la seule couleur de
  // l'app est censee venir des pochettes.
  liste: { flex: 1, marginTop: space.lg },
  listeContenu: { paddingBottom: space.md },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: 60,
  },
  filet: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  presse: { opacity: 0.55 },

  texte: { flex: 1, gap: 2 },
  nom: { ...type.lead, color: color.textMuted },
  nomChoisi: { color: color.text, fontWeight: '700' },
  artistes: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  artistesChoisis: { color: color.textMuted },

  compte: { ...type.label, ...chiffres, fontSize: 13, lineHeight: 18, color: color.textFaint },
  compteChoisi: { color: color.accent },

  coche: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: color.textFaint,
  },
  cocheChoisie: { borderColor: color.accent, borderWidth: 6 },

  pied: { paddingTop: space.md },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  ctaOccupe: { opacity: 0.7 },
  ctaTexte: { ...type.lead, color: color.bg, fontWeight: '700' },
  secondaire: { height: 44, alignItems: 'center', justifyContent: 'center' },
  passer: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  erreur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.alert, marginTop: space.sm },
});
