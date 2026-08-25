import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../src/api/client';
import { EnteteTitre, Feuille, LigneAction } from '../../src/components/Feuille';
import type { ProfilSocial, Track } from '../../src/api/types';
import { IconeChevron, IconeRetour } from '../../src/components/Icones';
import { Visage } from '../../src/components/Visage';
import { chargerPlateforme, lienVers } from '../../src/state/plateforme';
import { useAccount } from '../../src/state/useAccount';
import { vibrer } from '../../src/state/vibration';
import { chiffres, color, radius, space, type } from '../../src/theme/tokens';

/**
 * Le profil public : ce que cette personne garde, ce qu'elle aime, qui la
 * suit — et ce que VOUS partagez.
 *
 * L'ordre des sections est un ordre d'envie :
 *
 *  1. **En commun** — les titres que vous avez gardes tous les deux. C'est la
 *     seule section qui parle des deux a la fois, et la raison pour laquelle
 *     on ouvre un profil : « on a les memes gouts » se prouve, il ne se
 *     declare pas. Absente sur son propre profil, absente quand elle est vide.
 *  2. **Suivre** — un bouton, deux etats. Le retrait ne demande pas de
 *     confirmation : ne plus suivre n'efface rien chez l'autre, c'est un
 *     geste sans consequence qui merite un geste sans ceremonie.
 *  3. **Aime**, en pastilles ; **Gardes**, en casier.
 *
 * Un profil cache repond 404 cote moteur ; l'ecran le dit « introuvable »,
 * sans distinguer inexistant de cache — la distinction elle-meme serait une
 * fuite.
 */

/** L'espace entre les deux colonnes du casier. */
const GOUTTIERE = space.md;

/** Le visage du profil. Passe en constante et non en feuille de styles :
 *  `Visage` en a besoin pour arrondir son repli au bon rayon. */
const AVATAR = 88;

/** Ma bibliotheque, une fois par session : chaque profil ouvert en aurait
 *  besoin pour calculer l'affinite, et le casier ne change pas sous les
 *  doigts assez vite pour justifier un aller-retour par visite. */
let maBiblioSession: Track[] | null = null;

export default function ProfilPublic() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id: brut } = useLocalSearchParams<{ id?: string }>();
  const id = typeof brut === 'string' ? decodeURIComponent(brut) : '';

  const [profil, setProfil] = useState<ProfilSocial | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [monId, setMonId] = useState<string | null>(null);

  useEffect(() => {
    void chargerPlateforme();
  }, []);

  /**
   * Qui je suis. Demande **une fois**, au montage.
   *
   * Ca ne change pas pendant la vie de l'ecran, et le remettre dans l'effet de
   * focus ajoutait un aller-retour a chaque retour d'une sous-page pour une
   * reponse toujours identique.
   */
  useEffect(() => {
    let vivant = true;
    prisme
      .me()
      .then((m) => {
        if (vivant) setMonId(m.user_id);
      })
      .catch(() => {
        if (vivant) setMonId(null);
      });
    return () => {
      vivant = false;
    };
  }, []);

  /** Vrai des qu'un profil a ete affiche au moins une fois. Une reference et
   *  non un etat : `load` ne doit dependre que de `id`, sinon l'effet de focus
   *  se rejoue a chaque changement de profil. */
  const dejaVu = useRef(false);
  useEffect(() => {
    dejaVu.current = false;
  }, [id]);

  /**
   * Le profil, recharge a chaque retour sur l'ecran — **sans le vider**.
   *
   * Il se remplacait par une roue a chaque fois qu'on revenait de la liste des
   * abonnes ou des titres en commun : `setLoading(true)` etait inconditionnel,
   * donc revenir en arriere donnait exactement l'impression d'ouvrir la page
   * pour la premiere fois. La donnee est pourtant encore la ; elle est juste
   * peut-etre un peu vieille, ce qui se corrige en silence.
   *
   * Meme raison pour l'erreur : un rafraichissement qui echoue ne doit pas
   * effacer ce qui est deja lisible a l'ecran. On ne remplace par un message
   * que s'il n'y a rien dessous.
   */
  const load = useCallback(async () => {
    if (!id) return;
    if (!dejaVu.current) {
      setLoading(true);
      setErreur(null);
    }
    try {
      const p = await prisme.profilPublic(id);
      setProfil(p);
      setErreur(null);
      dejaVu.current = true;
    } catch (e) {
      if (!dejaVu.current) setErreur(e instanceof Error ? e.message : 'Profil indisponible');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Suivre / ne plus suivre, en optimiste : le bouton repond au doigt, la
   *  reponse serveur fait foi au retour et annule si elle contredit. */
  const basculerSuivi = useCallback(async () => {
    if (!profil || (monId && profil.id === monId)) return;
    const suivant = !profil.suivi;
    vibrer.choix();
    setProfil({ ...profil, suivi: suivant, abonnes: profil.abonnes + (suivant ? 1 : -1) });
    const r = await prisme.suivre(profil.handle || profil.id, suivant).catch(() => null);
    if (r) setProfil((p) => (p ? { ...p, suivi: r.suivi, abonnes: r.abonnes } : p));
  }, [profil, monId]);

  const cote = Math.floor((width - space.lg * 2 - GOUTTIERE) / 2);

  const ouvrir = useCallback((t: Track) => {
    vibrer.action();
    void Linking.openURL(lienVers(t));
  }, []);

  /**
   * L'appui long sur un titre garde par quelqu'un d'autre.
   *
   * **Le casier de quelqu'un est une recommandation.** C'est meme la seule
   * qui ne vienne pas du moteur : on ouvre un profil parce qu'on veut savoir
   * ce que cette personne ecoute, et jusqu'ici la seule chose qu'on pouvait
   * en faire etait de partir vers Spotify. Le titre repartait donc chez le
   * concurrent, et le gout n'apprenait rien.
   *
   * L'appui simple garde ce role — ouvrir la ou l'on ecoute — et l'appui long
   * ouvre ce qu'on peut en faire ICI. Deux gestes, deux mondes, et le premier
   * ne bouge pas : personne n'a a reapprendre ce qu'il connait.
   *
   * **Seulement chez les autres.** Sur son propre casier, « je garde » n'a
   * aucun sens (c'est deja fait) et « suivre l'artiste » y aurait sa place —
   * mais une feuille a une seule ligne utile n'est pas une feuille, c'est un
   * bouton perdu. La bibliotheque a deja sa fiche pour ca.
   */
  const [feuille, setFeuille] = useState<Track | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [dit, setDit] = useState<string | null>(null);
  const [suivis, setSuivis] = useState<Set<number>>(new Set());

  // Qui je suis deja : sans ca, la feuille proposerait de suivre un artiste
  // que je suis depuis six mois. Sans garde de connexion : cet ecran ne
  // s'ouvre que sur un profil, qui exige deja un compte, et un echec laisse
  // simplement la feuille proposer « Suivre ».
  useEffect(() => {
    prisme
      .artistesSuivis()
      .then((r) => setSuivis(new Set(r.artists.map((a) => a.id))))
      .catch(() => {});
  }, []);

  const tenir = useCallback((t: Track) => {
    vibrer.grave();
    setDit(null);
    setFeuille(t);
  }, []);

  const garder = useCallback(async (t: Track) => {
    setEnCours('save');
    setDit(null);
    try {
      await prisme.ajouterAuGout({ trackIds: [t.id] });
      setDit('Gardé. Il est dans ta bibliothèque.');
    } catch (e) {
      setDit(e instanceof Error ? e.message : 'Impossible pour l’instant.');
    } finally {
      setEnCours(null);
    }
  }, []);

  const aimer = useCallback(async (t: Track) => {
    setEnCours('like');
    setDit(null);
    try {
      // Le meme signal qu'un « j'aime » du fil, sans duree d'ecoute : on n'a
      // rien ecoute ici, et inventer des secondes gonflerait la recompense.
      await prisme.event({ track: t, action: 'like', msPlayed: 0, previewMs: 30000 });
      setDit('Aimé. Ton Prisme en tient compte.');
    } catch (e) {
      setDit(e instanceof Error ? e.message : 'Impossible pour l’instant.');
    } finally {
      setEnCours(null);
    }
  }, []);

  const suivreArtiste = useCallback(
    async (t: Track) => {
      const deja = suivis.has(t.artist.id);
      setEnCours('suivre');
      setDit(null);
      // Optimiste : la route est idempotente cote moteur.
      setSuivis((s) => {
        const n = new Set(s);
        if (deja) n.delete(t.artist.id);
        else n.add(t.artist.id);
        return n;
      });
      try {
        await prisme.suivreArtiste(t.artist.id, !deja);
        setDit(deja ? `Tu ne suis plus ${t.artist.name}.` : `Tu suis ${t.artist.name}.`);
      } catch {
        setSuivis((s) => {
          const n = new Set(s);
          if (deja) n.add(t.artist.id);
          else n.delete(t.artist.id);
          return n;
        });
        setDit('Impossible pour l’instant.');
      } finally {
        setEnCours(null);
      }
    },
    [suivis],
  );

  const estMoi = monId !== null && profil !== null && profil.id === monId;

  // --- Affinite -------------------------------------------------------------
  const compte = useAccount();
  const [maBiblio, setMaBiblio] = useState<Track[] | null>(maBiblioSession);

  useEffect(() => {
    if (!compte.connected || estMoi) {
      setMaBiblio(null);
      return;
    }
    if (maBiblioSession) {
      setMaBiblio(maBiblioSession);
      return;
    }
    let vivant = true;
    prisme
      .library()
      .then((r) => {
        maBiblioSession = r.tracks;
        if (vivant) setMaBiblio(r.tracks);
      })
      .catch(() => {
        // Bibliotheque indisponible : pas de carte d'affinite, silencieusement.
        if (vivant) setMaBiblio([]);
      });
    return () => {
      vivant = false;
    };
  }, [compte.connected, estMoi, profil?.id]);

  /**
   * L'affinite, et pourquoi cette formule.
   *
   * **Recouvrement du plus petit casier** : parmi les titres que chacun de
   * nous a gardes en moins grand nombre, combien se retrouvent des deux cotes.
   * Un Jaccard brut ecraserait les petits profils (deux gardes en commun sur
   * deux cents font 2 %, pour un gout identique) ; la part du plus petit dit
   * « quand on choisit peu, on choisit pareil ».
   *
   * Les artistes partages se comptent par nom contre MA bibliotheque ; le
   * monde commun se lit dans vos gardes mutuels — c'est l'artiste qui fait
   * que ce profil vous parle.
   */
  const affinite = useMemo(() => {
    if (!profil || estMoi || !maBiblio || !compte.connected) return null;
    const mes = maBiblio.length;
    const ses = profil.total;
    if (mes === 0 || ses === 0) return null;
    const inter = Math.max(0, profil.commun_total || profil.commun.length);
    const pct = Math.min(100, Math.round((100 * inter) / Math.min(mes, ses)));
    if (inter === 0 && profil.artistes.length === 0) return null;

    const nomsMien = new Set(maBiblio.map((t) => t.artist.name.trim().toLowerCase()));
    const partages = profil.artistes.filter((a) => nomsMien.has(a.name.trim().toLowerCase())).length;

    const freq = new Map<string, number>();
    for (const t of profil.commun) {
      const k = t.artist.name;
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    let monde: string | null = null;
    let meilleur = 0;
    for (const [nom, n] of freq) {
      if (n > meilleur) {
        meilleur = n;
        monde = nom;
      }
    }

    const mot =
      pct >= 60 ? 'En résonance' : pct >= 35 ? 'Très proches' : pct >= 15 ? 'Des échos' : 'Deux mondes';

    return { pct, mot, inter, partages, monde };
  }, [profil, maBiblio, estMoi, compte.connected]);

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
          <IconeRetour couleur={color.textMuted} />
        </Pressable>

        {loading ? (
          <ActivityIndicator color={color.accent} style={styles.attente} />
        ) : erreur !== null || !profil ? (
          <View style={styles.vide}>
            <Text style={styles.videTitre}>Introuvable</Text>
            <Text style={styles.videTexte}>
              Ce profil n'existe pas, ou son propriétaire a choisi de ne pas apparaître.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.identite}>
              <Visage uri={profil.avatar} taille={AVATAR} style={styles.avatarMarge} />
              <Text style={styles.nom} numberOfLines={2}>
                {profil.nom || 'Sans nom'}
              </Text>
              {profil.handle ? (
                <Text style={styles.at} numberOfLines={1}>
                  @{profil.handle}
                </Text>
              ) : null}
            </View>

            {/* Les compteurs. Abonnes et abonnements menent a leur liste ;
                les gardes menent a la section du dessous, deja sous les yeux. */}
            <View style={styles.comptes}>
              <Pressable
                style={styles.compte}
                onPress={() => {
                  vibrer.choix();
                  router.push(`/gens/${encodeURIComponent(profil.id)}/gens?type=abonnes`);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.compteNombre}>{profil.abonnes}</Text>
                <Text style={styles.compteMot}>abonnés</Text>
              </Pressable>
              <Pressable
                style={styles.compte}
                onPress={() => {
                  vibrer.choix();
                  router.push(`/gens/${encodeURIComponent(profil.id)}/gens?type=abonnements`);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.compteNombre}>{profil.abonnements}</Text>
                <Text style={styles.compteMot}>abonnements</Text>
              </Pressable>
              <View style={styles.compte}>
                <Text style={styles.compteNombre}>{profil.total}</Text>
                <Text style={styles.compteMot}>gardés</Text>
              </View>
            </View>

            {!estMoi ? (
              <Pressable
                style={[styles.suivre, profil.suivi ? styles.suiviActif : null]}
                onPress={basculerSuivi}
                accessibilityRole="button"
                accessibilityLabel={profil.suivi ? 'Ne plus suivre' : 'Suivre'}
              >
                <Text style={[styles.suivreTexte, profil.suivi && styles.suivreTexteActif]}>
                  {profil.suivi ? 'Suivi' : 'Suivre'}
                </Text>
              </Pressable>
            ) : null}

            {/* Le match ne se depasse plus en defilant.
                C'etait une grille de pochettes au milieu du profil, qu'on
                franchissait sans s'arreter. Or c'est la seule chose de
                l'application qui parle de deux personnes a la fois, et la
                raison pour laquelle on ouvre le profil de quelqu'un qui vous a
                donne son lien. Elle devient une porte : un bandeau, les
                premieres pochettes empilees, et derriere, les titres un par un
                en grand, avec le son. */}
            {affinite ? (
              <View style={styles.affinite}>
                <View style={styles.affiniteHaut}>
                  <View style={styles.affiniteDuo}>
                    <Visage uri={compte.me?.picture ?? null} taille={38} style={styles.affiniteVisagePremier} />
                    <Visage uri={profil.avatar} taille={38} style={styles.affiniteVisageSecond} />
                  </View>
                  <Text style={[styles.affinitePct, chiffres]}>{affinite.pct} %</Text>
                  <Text style={[styles.affiniteMot, affinite.pct >= 35 && styles.affiniteMotVivant]}>
                    {affinite.mot}
                  </Text>
                </View>

                <View style={styles.affiniteLignes}>
                  <View style={styles.affiniteLigne}>
                    <Text style={styles.affiniteCle}>Titres gardés en commun</Text>
                    <Text style={[styles.affiniteValeur, chiffres]}>{affinite.inter}</Text>
                  </View>
                  {affinite.partages > 0 ? (
                    <View style={styles.affiniteLigne}>
                      <Text style={styles.affiniteCle}>Artistes partagés</Text>
                      <Text style={[styles.affiniteValeur, chiffres]}>{affinite.partages}</Text>
                    </View>
                  ) : null}
                  {affinite.monde ? (
                    <View style={styles.affiniteLigne}>
                      <Text style={styles.affiniteCle}>Votre artiste en commun</Text>
                      <Text style={styles.affiniteValeur} numberOfLines={1}>
                        {affinite.monde}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {profil.commun.length > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.match, pressed && styles.pale]}
                onPress={() => {
                  vibrer.choix();
                  router.push(`/gens/${encodeURIComponent(profil.id)}/commun`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Voir vos ${profil.commun_total || profil.commun.length} titres en commun`}
              >
                <View style={styles.matchPile}>
                  {profil.commun.slice(0, 3).map((t, k) => (
                    <Image
                      key={t.id}
                      source={{ uri: t.cover }}
                      style={[styles.matchPochette, k > 0 && styles.matchDecale]}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={`m-${t.id}`}
                    />
                  ))}
                </View>
                <View style={styles.matchTexte}>
                  <Text style={styles.matchTitre}>
                    <Text style={[styles.matchNombre, chiffres]}>
                      {profil.commun_total || profil.commun.length}
                    </Text>
                    {` en commun`}
                  </Text>
                  <Text style={styles.matchSous} numberOfLines={2}>
                    Gardés ou aimés par vous deux
                  </Text>
                </View>
                <IconeChevron couleur={color.textFaint} />
              </Pressable>
            ) : null}

            {profil.artistes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitre}>Aime</Text>
                <View style={styles.pastilles}>
                  {profil.artistes.map((a) => (
                    <View key={a.name} style={styles.pastille}>
                      <Text style={styles.pastilleNom} numberOfLines={1}>
                        {a.name}
                      </Text>
                      <Text style={styles.pastilleCompte} numberOfLines={1}>
                        {a.count}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Suit — apres « Aime » et pas avant.
                « Aime » est deduit des swipes, « Suit » est choisi a la main.
                Meme ordre que sur Ton Prisme : d'abord ce que le moteur a
                observe, ensuite ce que la personne a decide. L'inverse ferait
                passer une poignee de suivis pour son portrait.

                Des portraits en file horizontale, ni pastilles ni casier :
                les deux sections voisines occupent deja ces deux formes, et
                trois listes de la meme forme ne se distingueraient plus. */}
            {profil.suivis && profil.suivis.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitre}>Suit</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // La file deborde de la section : le contenu reprend la
                  // marge a l'interieur pour que le premier portrait s'aligne
                  // sur le titre tout en laissant les suivants filer au bord.
                  style={styles.fileSuivis}
                  contentContainerStyle={styles.fileSuivisContenu}
                >
                  {profil.suivis.map((a) => (
                    <View key={a.id} style={styles.suiviArtiste}>
                      <Image
                        source={{ uri: a.picture }}
                        style={styles.suiviPortrait}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={160}
                        recyclingKey={String(a.id)}
                        accessibilityLabel={a.name}
                      />
                      <Text style={styles.suiviNom} numberOfLines={1}>
                        {a.name}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {profil.gardes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitre}>Gardés</Text>
                <View style={styles.grille}>
                  {profil.gardes.map((t) => (
                    <Pressable
                      key={t.id}
                      style={({ pressed }) => [styles.carte, { width: cote }, pressed && styles.pale]}
                      onPress={() => ouvrir(t)}
                      onLongPress={estMoi ? undefined : () => tenir(t)}
                      delayLongPress={280}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.title} par ${t.artist.name}`}
                      accessibilityHint={
                        estMoi ? undefined : 'Appui long pour le garder, l’aimer ou voir l’artiste'
                      }
                    >
                      <Image
                        source={{ uri: t.cover }}
                        style={[styles.pochette, { width: cote, height: cote }]}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={String(t.id)}
                      />
                      <Text style={styles.titreTitre} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <Text style={styles.titreArtiste} numberOfLines={1}>
                        {t.artist.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={[styles.videTexte, { paddingHorizontal: space.lg }]}>
                Rien gardé pour l'instant.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* L'ordre est celui de l'envie : d'abord ce qu'on fait du TITRE — le
          garder, l'aimer —, ensuite ce qu'on fait de l'ARTISTE. Et « voir
          l'artiste » en dernier parce que c'est le seul qui quitte l'ecran :
          une ligne qui emmene ailleurs, posee au milieu, fait rater les trois
          autres. */}
      <Feuille visible={feuille !== null} onFermer={() => setFeuille(null)}>
        {feuille ? (
          <>
            <EnteteTitre track={feuille} sous={dit ?? `Gardé par ${profil?.nom || 'cette personne'}`} />
            <LigneAction
              titre="Je garde"
              sous="Il entre dans ta bibliothèque."
              accent
              occupe={enCours === 'save'}
              onPress={() => garder(feuille)}
            />
            <LigneAction
              titre="J’aime"
              sous="Il compte dans ton goût, sans être rangé."
              occupe={enCours === 'like'}
              onPress={() => aimer(feuille)}
            />
            <LigneAction
              titre={suivis.has(feuille.artist.id) ? `Ne plus suivre ${feuille.artist.name}` : `Suivre ${feuille.artist.name}`}
              sous={
                suivis.has(feuille.artist.id)
                  ? 'Tu le suis déjà.'
                  : 'Ses sorties comptent pour ton Prisme.'
              }
              occupe={enCours === 'suivre'}
              onPress={() => suivreArtiste(feuille)}
            />
            <LigneAction
              titre="Voir l’artiste"
              sous="Ses titres, et qui le suit sur Reso."
              onPress={() => {
                const artiste = feuille.artist.id;
                setFeuille(null);
                router.push(`/artiste/${artiste}`);
              }}
            />
          </>
        ) : null}
      </Feuille>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarMarge: { marginBottom: space.xs },

  // --- Banniere affinite ----------------------------------------------------
  // Une carte calme : vos deux visages, le pourcentage, et ce qui l'explique
  // en lignes sous filets. Pas de jauge, pas de couleur criee — la pochette
  // du bandeau d'en dessous porte deja la couleur.
  affinite: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.bgElevated,
    gap: space.sm,
  },
  affiniteHaut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  affiniteDuo: { flexDirection: 'row', marginRight: space.xs },
  affiniteVisagePremier: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    zIndex: 1,
  },
  affiniteVisageSecond: {
    marginLeft: -12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  affinitePct: { ...type.display, fontSize: 24, lineHeight: 28, color: color.text },
  affiniteMot: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  affiniteMotVivant: { color: color.accent },
  affiniteLignes: {},
  affiniteLigne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.sm,
  },
  affiniteCle: { ...type.body, fontSize: 15, lineHeight: 20, color: color.textMuted, flexShrink: 1 },
  affiniteValeur: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text },

  // Aligne sur la carte d'affinite juste au-dessus, et sur les sections en
  // dessous : elle etait la seule chose de l'ecran collee aux deux bords, donc
  // la seule a ne pas commencer sur la meme verticale que le reste. Meme
  // marge exterieure (`space.lg`) ET meme retrait interieur, sinon le texte
  // des deux cartes empilees ne demarre pas au meme endroit.
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xl,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.bgElevated,
  },
  // Les pochettes se recouvrent : une pile de disques, pas une frise. Le
  // recouvrement dit « il y en a d'autres derriere » sans l'ecrire.
  matchPile: { flexDirection: 'row' },
  matchPochette: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: color.bgSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  matchDecale: { marginLeft: -16 },
  matchTexte: { flex: 1, gap: 2 },
  matchTitre: { ...type.lead, color: color.text },
  matchNombre: { color: color.accent, fontWeight: '700' },
  matchSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  screen: { flex: 1, backgroundColor: color.bg },
  pale: { opacity: 0.5 },

  retour: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: space.lg - space.md,
  },

  attente: { marginTop: space.xxl },

  identite: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.lg, marginTop: space.sm },
  nom: { ...type.display, fontSize: 26, lineHeight: 32, color: color.text, textAlign: 'center' },
  at: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  comptes: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xl,
    marginTop: space.lg,
  },
  compte: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  compteNombre: { ...type.title, ...chiffres, fontSize: 18, lineHeight: 24, color: color.text },
  compteMot: { ...type.caption, fontSize: 13, lineHeight: 18, color: color.textFaint },

  suivre: {
    alignSelf: 'center',
    marginTop: space.lg,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  suiviActif: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: color.textFaint,
  },
  suivreTexte: { ...type.lead, fontWeight: '700', color: color.bg },
  suivreTexteActif: { color: color.textMuted, fontWeight: '500' },

  section: { marginTop: space.xl, paddingHorizontal: space.lg },
  sectionTitre: { ...type.title, fontSize: 20, lineHeight: 26, color: color.text },
  sectionNote: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, marginTop: space.xs },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  pastille: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRadius: radius.full,
    backgroundColor: color.bgElevated,
    maxWidth: 220,
  },
  pastilleNom: { ...type.body, fontSize: 15, lineHeight: 20, color: color.text, flexShrink: 1 },
  pastilleCompte: { ...type.label, ...chiffres, fontSize: 13, lineHeight: 18, color: color.textFaint },

  // La file deborde la marge de la section pour filer jusqu'au bord de
  // l'ecran — un rail qu'on peut pousser se voit mieux qu'une rangee qui
  // s'arrete net dans la marge.
  fileSuivis: { marginTop: space.md, marginHorizontal: -space.lg },
  fileSuivisContenu: { paddingHorizontal: space.lg, gap: space.md },
  suiviArtiste: { width: 76, gap: space.xs },
  suiviPortrait: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    backgroundColor: color.bgElevated,
  },
  suiviNom: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },

  grille: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GOUTTIERE,
    marginTop: space.md,
  },
  carte: { gap: space.xs },
  pochette: { borderRadius: radius.md, backgroundColor: color.bgElevated },
  titreTitre: { ...type.label, fontSize: 13, lineHeight: 18, color: color.text, marginTop: space.xs },
  titreArtiste: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  vide: { paddingHorizontal: space.lg, paddingTop: space.xxl, gap: space.sm },
  videTitre: { ...type.title, color: color.text },
  videTexte: { ...type.lead, color: color.textMuted },
});
