import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRequiredError, prisme } from '../../src/api/client';
import type { Prism, PrismFacet, Stats } from '../../src/api/types';
import { AccountGate } from '../../src/components/AccountGate';
import { IconeReglages } from '../../src/components/Icones';
import { duree, habitudes } from '../../src/state/portrait';
import { resetSession } from '../../src/state/session';
import { refreshAccount, useAccount } from '../../src/state/useAccount';
import { chiffres, color, radius, space, type } from '../../src/theme/tokens';

/**
 * « Ton Prisme » : un **portrait en train de se faire**, avec un but.
 *
 * L'ecran montrait des grandeurs internes au moteur — masses, taux d'accroche,
 * « 34 % retenus » par facette — et une liste d'avatars. Deux reproches, tous
 * deux justes : un pourcentage ne veut rien dire pour qui ne connait pas le
 * denominateur, et une file de visages sans phrase n'apprend rien sur
 * soi. Ce n'etait pas un portrait, c'etait l'interface d'admin du moteur.
 *
 * Ce qui le remplace, et pourquoi :
 *
 *  1. **Un but, en mots.** La premiere chose lue dit OU en est le Prisme —
 *     esquisse, contours, portrait, miroir — et ce qu'il faut pour passer au
 *     stade suivant. Un palier, pas une jauge : il n'y a rien a perdre, rien
 *     qui expire, rien a defendre.
 *  2. **Une seule liste d'artistes.** Les facettes sont de la plomberie
 *     interne — le moteur s'en sert pour ne pas moyenner des gouts
 *     disjoints — pas une facon de decouper la musique de quelqu'un. La
 *     personne veut SA liste, entiere, du plus lourd au plus leger. On la
 *     lui donne sans cloisons, sans verdicts, sans pourcentages.
 *  3. **Le detail, en bas, pour qui veut** : les habitudes d'ecoute. 
 *     Consultable, pas impose.
 *
 * Aucun pourcentage, aucun libelle de groupe ne survit sur cet ecran. Ce
 * n'est pas de la deco en moins : un chiffre ou une separation qu'on ne peut
 * pas agir dessus est du bruit, et le but d'un portrait est de dire quelque
 * chose de vrai, pas de precis.
 *
 * L'ecran fonctionne sans `/stats` : un moteur qui ne connait pas encore la
 * route rend le but et la liste seuls, sans erreur ni trou.
 */

export default function PrismScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();
  const { width: ecran } = useWindowDimensions();
  const [prism, setPrism] = useState<Prism | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * La grille se calcule depuis l'ecran, elle ne le subit pas.
   *
   * Trois colonnes fixes de 76 px laissaient mourir un tiers de la largeur sur
   * un grand telephone, et les deux tiers sur une tablette. Ici : une tuile
   * vise ~92 px (assez pour un visage, assez pour un nom), le nombre de
   * colonnes s'en deduit, et la tuile absorbe **tout** le reste — la grille
 * finit exactement au bord droit, sur n'importe quel appareil. Plafond de
 * six colonnes : au-dela, les visages deviennent des timbres.
   */
  const usable = ecran - space.lg * 2;
  const colonnes = Math.max(3, Math.min(6, Math.floor((usable + space.md) / (92 + space.md))));
  const cote = Math.floor((usable - (colonnes - 1) * space.md) / colonnes);

  const load = useCallback(async () => {
    try {
      // De front : ce sont deux lectures independantes, et les enchainer
      // doublerait l'attente devant un ecran vide.
      const [p, s] = await Promise.all([
        prisme.prism(),
        // Le portrait est un supplement : un moteur d'une version anterieure
        // n'a pas cette route, et l'ecran doit rester entier sans elle.
        prisme.stats().catch(() => null),
      ]);
      setPrism(p);
      setStats(s);
    } catch (e) {
      if (e instanceof AccountRequiredError) await refreshAccount();
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (compte.loading) return;
      if (!compte.connected) {
        setLoading(false);
        return;
      }
      void load();
    }, [compte.loading, compte.connected, load]),
  );

  const repartir = useCallback(async () => {
    await resetSession();
    await refreshAccount();
    setPrism(null);
    setStats(null);
    router.replace('/bienvenue');
  }, [router]);

  // Triees par masse : l'ordre des artistes doit etre stable d'une visite a
  // l'autre, sinon la liste semble se reorganiser sans raison.
  const facets = useMemo(
    () => [...(prism?.facets ?? [])].sort((a, b) => b.mass - a.mass),
    [prism],
  );
  /**
   * La liste, toute la liste, rien que la liste.
   *
   * Les facettes sont une structure **interne** au moteur — elles lui servent
   * a ne pas moyenner des gouts disjoints. Les montrer a la personne, c'etait
   * lui exposer notre plomberie et la faire passer pour une separation de ses
   * gouts. Ici : un seul flux, dedoublonne, dans l'ordre du poids — du plus
   * lourd au plus leger. C'est sa musique, pas notre modele.
   */
  const artistes = useMemo(() => {
    const vus = new Set<number>();
    const out: { id: number; name: string; picture: string }[] = [];
    for (const f of facets)
      for (const a of f.artists) {
        if (vus.has(a.id)) continue;
        vus.add(a.id);
        out.push({ id: a.id, name: a.name, picture: a.picture });
      }
    return out;
  }, [facets]);

  if (!compte.loading && !compte.connected) {
    return (
      <AccountGate
        titre="Ton Prisme"
        raison="Ce que Reso a compris de ton goût, écrit noir sur blanc — et emportable ailleurs."
        busy={compte.busy}
        error={compte.error}
        onConnect={compte.connect}
        onReset={repartir}
      />
    );
  }

  if (loading || compte.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  const lignes = stats ? habitudes(stats) : [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: space.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.entete}>
        <Text style={styles.titre}>Ton Prisme</Text>
        <Pressable
          style={({ pressed }) => [styles.rouage, pressed && styles.rouagePresse]}
          onPress={() => router.push('/reglages')}
          accessibilityRole="button"
          accessibilityLabel="Réglages"
          hitSlop={8}
        >
          <IconeReglages couleur={color.textMuted} />
        </Pressable>
      </View>

      <But prism={prism} stats={stats} />

      {artistes.length === 0 ? (
        <Vide />
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Tes artistes</Text>
          <Text style={styles.sectionNote}>
            Ce sur quoi ton Prisme s’est construit, du plus lourd au plus léger.
          </Text>
          <View style={styles.grille}>
            {artistes.map((a) => (
              <View key={a.id} style={[styles.colonne, { width: cote }]}>
                <Image
                  source={{ uri: a.picture }}
                  style={[styles.portrait, { width: cote, height: cote }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={160}
                  recyclingKey={String(a.id)}
                  accessibilityLabel={a.name}
                />
                <Text
                  style={styles.portraitNom}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {a.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {lignes.length > 0 ? (
        <View style={styles.habitudes}>
          {lignes.map((l, i) => (
            <View key={l.label} style={[styles.ligne, i === 0 && styles.lignePremiere]}>
              <Text style={styles.ligneLabel}>{l.label}</Text>
              <Text style={styles.ligneValeur}>{l.valeur}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Les stades du portrait, et leur but.
 *
 * Quatre seuils, fixes, en mots — jamais en pourcentage, parce qu'un
 * pourcentage sans denominateur connu ne dit rien. Chaque stade porte sa
 * propre phrase d'effort : ce qu'il reste a faire est dit en cartes, l'unite
 * que tout le monde a deja en main. Le dernier stade n'annonce aucune fin :
 * le Prisme ne se « termine » pas, il s'aiguise.
 */
type Stade = { seuil: number; mot: string; suite: string };

const STADES: Stade[] = [
  { seuil: 0, mot: 'une esquisse', suite: 'Juge une quinzaine d’extraits : ses contours apparaissent.' },
  { seuil: 15, mot: 'des contours', suite: 'Encore une vingtaine de gestes et il devient un portrait.' },
  { seuil: 40, mot: 'un portrait', suite: 'Une soixantaine de gestes, et il te renvoie un miroir.' },
  { seuil: 100, mot: 'un miroir', suite: 'Il te connaît. Chaque nouvelle carte l’aiguise encore.' },
];

function stade(juges: number): Stade {
  let courant = STADES[0];
  for (const s of STADES) if (juges >= s.seuil) courant = s;
  return courant;
}

/**
 * Le but, et d'ou l'on vient.
 *
 * La phrase principale dit le stade. La ligne du dessous ancre le stade dans
 * ce qui a vraiment ete fait — juges, ecoute — puis dit l'effort restant.
 * Les gardes ferment le paragraphe : c'est la preuve que le portrait sert a
 * quelque chose, pas un compteur de plus.
 */
function But({ prism, stats }: { prism: Prism | null; stats: Stats | null }) {
  const juges = stats?.judged ?? prism?.events ?? 0;
  const s = stade(juges);

  return (
    <View style={styles.but}>
      <Text style={styles.phrase}>
        Ton Prisme, c’est encore <Text style={styles.phraseFort}>{s.mot}</Text>.
      </Text>
      <Text style={styles.phraseSuite}>
        {juges > 0 && stats
          ? `${juges} titres jugés en ${duree(stats.listened_ms)} d’écoute. ${s.suite}`
          : s.suite}
      </Text>
      {stats && stats.library > 0 ? (
        <Text style={styles.phraseSuite}>
          {stats.library} {stats.library > 1 ? 'titres t’attendent' : 'titre t’attend'} dans tes
          gardés.
        </Text>
      ) : null}
    </View>
  );
}

function Vide() {
  return (
    <View style={styles.vide}>
      <Text style={styles.videTitre}>La lumière n’est pas encore passée.</Text>
      <Text style={styles.videTexte}>
        Une dizaine d’extraits dans le fil, et le premier monde apparaît. Prisme a besoin de tes
        refus autant que de tes oui.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  center: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },

  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titre: { ...type.display, color: color.text },
  rouage: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  rouagePresse: { opacity: 0.5 },

  // Le but : pose sur le fond, sans conteneur — un grand chiffre dans une
  // carte grise est le motif le plus reconnaissable d'un tableau de bord
  // genere, et il n'ajoute rien a la lecture.
  but: { marginTop: space.lg, gap: space.sm },
  phrase: { ...type.display, fontSize: 26, lineHeight: 34, color: color.textMuted },
  phraseFort: { color: color.text },
  phraseSuite: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textFaint },

  // Les mondes : separes par des filets, comme les mentions d'une pochette.
  section: { marginTop: space.xl },
  sectionTitre: { ...type.title, fontSize: 20, lineHeight: 26, color: color.text },
  sectionNote: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, marginTop: space.xs },
  // Une grille qui coule et remplit les lignes : la liste est une, elle n'a
  // pas a imiter des rangees separees. La largeur des tuiles est posee par
  // le rendu — elle derive de la largeur reelle de l'ecran.
  grille: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.md,
  },
  colonne: { gap: space.xs },
  portrait: { borderRadius: radius.md, backgroundColor: color.bgElevated },
  portraitNom: { ...type.label, fontSize: 13, lineHeight: 18, color: color.text },

  habitudes: { marginTop: space.xl },
  ligne: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  lignePremiere: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  ligneLabel: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.textMuted },
  ligneValeur: { ...type.lead, ...chiffres, fontSize: 15, lineHeight: 20, color: color.text },

  vide: { paddingTop: space.xxl, gap: space.sm },
  videTitre: { ...type.title, color: color.text },
  videTexte: { ...type.lead, color: color.textMuted },
});
