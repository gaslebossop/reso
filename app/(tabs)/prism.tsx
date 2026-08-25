import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRequiredError, prisme } from '../../src/api/client';
import type { Artist, Prism, PrismFacet, Stats } from '../../src/api/types';
import { AccountGate } from '../../src/components/AccountGate';
import { IconeChevron, IconeReglages } from '../../src/components/Icones';
import { duree, habitudes } from '../../src/state/portrait';
import { resetSession } from '../../src/state/session';
import { refreshAccount, useAccount } from '../../src/state/useAccount';
import { vibrer } from '../../src/state/vibration';
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
 * Les portraits mènent quelque part : un visage d'artiste qu'on ne peut pas
 * toucher est une impasse, et c'est justement devant sa propre liste qu'on se
 * demande « lui, c'est qui déjà ? ». Un appui ouvre sa fiche — ses titres,
 * écoutables sur place, et qui le suit ici.
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
  const [suivis, setSuivis] = useState<Artist[]>([]);
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
      const [p, s, f] = await Promise.all([
        prisme.prism(),
        // Le portrait est un supplement : un moteur d'une version anterieure
        // n'a pas cette route, et l'ecran doit rester entier sans elle.
        prisme.stats().catch(() => null),
        // Les suivis aussi : meme raison, et la section disparait sans eux
        // plutot que de montrer un trou.
        prisme.artistesSuivis().then((r) => r.artists).catch(() => []),
      ]);
      setPrism(p);
      setStats(s);
      setSuivis(f);
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

      {/* L'ajout a la main, juste sous le but et au-dessus des listes.
          La ou il compte : le but dit ce qu'il manque au Prisme pour passer
          au stade suivant, et c'est exactement la qu'on se demande si l'on
          peut aider. Range dans les reglages, personne ne l'aurait trouve. */}
      <Pressable
        onPress={() => router.push('/ajouter')}
        style={({ pressed }) => [styles.ajouter, pressed && styles.ajouterPresse]}
        accessibilityRole="button"
        accessibilityLabel="Ajouter des artistes ou des titres à ton goût"
      >
        <Text style={styles.ajouterTexte}>Ajouter un artiste ou un titre</Text>
        <IconeChevron couleur={color.textFaint} />
      </Pressable>

      {/* L'historique juste apres l'ajout, et pour la meme raison : les deux
          repondent a « mon Prisme ne me ressemble pas ». L'un ajoute ce qui
          manque, l'autre retire ce qui n'aurait pas du y entrer — un titre
          passe d'un coup de pouce en marchant, un garde a la place d'un
          skip. Ranger ca dans les reglages, c'etait le cacher. */}
      <Pressable
        onPress={() => router.push('/historique')}
        style={({ pressed }) => [styles.ajouter, pressed && styles.ajouterPresse]}
        accessibilityRole="button"
        accessibilityLabel="Ton historique : revenir sur un geste"
      >
        <Text style={styles.ajouterTexte}>Ton historique</Text>
        <IconeChevron couleur={color.textFaint} />
      </Pressable>

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
              <Tuile key={a.id} artiste={a} cote={cote} />
            ))}
          </View>
        </View>
      )}

      {/* Les suivis, apres la liste apprise et pas avant.
          Deux listes d'artistes sur le meme ecran demandent qu'on sache
          laquelle on regarde, et l'ordre le dit : d'abord ce que le Prisme a
          DEDUIT, puis ce qu'on a CHOISI. L'inverse aurait fait passer une
          poignee d'artistes suivis pour le portrait, alors que le portrait est
          precisement ce qui se construit sans qu'on le decide.

          Meme grille, meme tuile, meme portrait : c'est la note qui distingue
          les deux sections, pas une seconde langue visuelle. */}
      {suivis.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Tes suivis</Text>
          <Text style={styles.sectionNote}>
            Ceux que tu as choisis toi-même. Ils reviennent plus souvent dans ton fil.
          </Text>
          <View style={styles.grille}>
            {suivis.map((a) => (
              <Tuile key={a.id} artiste={a} cote={cote} />
            ))}
          </View>
        </View>
      ) : null}

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
 * Un artiste dans la grille : son portrait, son nom, et sa fiche au bout.
 *
 * Le meme composant sert aux deux sections — celle que le Prisme a deduite et
 * celle qu'on a choisie. Elles montrent la meme chose, un artiste, et rien ne
 * justifierait qu'un appui ne fasse pas la meme chose dans l'une et dans
 * l'autre.
 */
function Tuile({
  artiste,
  cote,
}: {
  artiste: { id: number; name: string; picture: string };
  cote: number;
}) {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.colonne, { width: cote }, pressed && styles.tuilePressee]}
      onPress={() => {
        vibrer.choix();
        router.push(`/artiste/${artiste.id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Voir la fiche de ${artiste.name}`}
    >
      <Image
        source={{ uri: artiste.picture }}
        style={[styles.portrait, { width: cote, height: cote }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={160}
        recyclingKey={String(artiste.id)}
      />
      <Text style={styles.portraitNom} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {artiste.name}
      </Text>
    </Pressable>
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

  ajouter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: color.bgElevated,
  },
  ajouterPresse: { opacity: 0.7 },
  ajouterTexte: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text },

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
  tuilePressee: { opacity: 0.55 },
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
