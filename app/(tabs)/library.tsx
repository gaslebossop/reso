import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountRequiredError, prisme } from '../../src/api/client';
import type { Track } from '../../src/api/types';
import {
  ajouterAuxLikes, etatSpotify, exporterVersPlaylist, SpotifyError,
} from '../../src/auth/spotify';
import { AccountGate } from '../../src/components/AccountGate';
import {
  chargerPlateforme, lienVers, ouSecoute, plateforme, plateformeCourante,
} from '../../src/state/plateforme';
import {
  autoActif, chargerSync, reglerSync, souscrireAuto,
} from '../../src/state/spotifySync';
import { refreshAccount, useAccount } from '../../src/state/useAccount';
import { vibrer } from '../../src/state/vibration';
import { chiffres, color, motion, radius, space, type } from '../../src/theme/tokens';

/**
 * Les titres gardes — **un casier a disques**, pas une liste de liens.
 *
 * L'ecran presentait chaque titre en ligne, dans une carte grise, avec une
 * vignette de 52 px et une fleche typographique en bout de course. Trois
 * defauts a la fois : la pochette y etait un accessoire alors que c'est la
 * seule chose qu'on reconnait d'un titre garde il y a trois semaines ; le
 * conteneur gris repetait le meme rectangle autant de fois qu'il y a de
 * morceaux ; et « ↗ » n'est pas une icone — sa graisse depend de la police du
 * systeme et il ne partage aucune grille avec le reste.
 *
 * Ici la pochette occupe la moitie de la largeur, le texte se range dessous,
 * et il n'y a plus aucun conteneur : sur un fond noir, **une pochette EST une
 * carte**. C'est la seule mise en page coherente avec le parti pris de l'app,
 * qui veut que la pochette soit la seule source de couleur a l'ecran.
 *
 * Reserve aux comptes du reseau G : garder un titre n'a de sens que si on le
 * retrouve, et un identifiant d'appareil disparait avec l'installation.
 */

/** Espace entre les deux colonnes du casier. */
const GOUTTIERE = space.md;

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compte = useAccount();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Le titre dont la fiche est ouverte. */
  const [fiche, setFiche] = useState<Track | null>(null);

  /** Ce que Spotify autorise ici. `null` tant qu'on ne l'a pas demande. */
  const [spot, setSpot] = useState<{ relie: boolean; peutPlaylist: boolean } | null>(null);
  const [auto, setAuto] = useState(autoActif());
  /** L'avancement de l'export, ou `null` s'il n'y en a pas. */
  const [avance, setAvance] = useState<{ fait: number; total: number } | null>(null);
  /** Le compte rendu du dernier export. */
  const [ditSpot, setDitSpot] = useState<string | null>(null);

  useEffect(() => souscrireAuto(() => setAuto(autoActif())), []);

  useFocusEffect(
    useCallback(() => {
      let vivant = true;
      void chargerSync().then(() => {
        if (vivant) setAuto(autoActif());
      });
      etatSpotify()
        .then((e) => {
          if (vivant) setSpot({ relie: e.relie, peutPlaylist: e.peutPlaylist });
        })
        .catch(() => {
          if (vivant) setSpot({ relie: false, peutPlaylist: false });
        });
      return () => {
        vivant = false;
      };
    }, []),
  );

  /**
   * Verse toute la bibliotheque dans la playlist.
   *
   * L'avancement n'est pose qu'un tour sur quatre : chaque pose redessine
   * l'ecran entier, casier compris, et quatre-vingts redessins pour une ligne
   * de texte font sauter le defilement pendant tout l'export.
   */
  const exporter = useCallback(async () => {
    if (avance) return;
    vibrer.action();
    setDitSpot(null);
    setAvance({ fait: 0, total: tracks.length });
    try {
      const r = await exporterVersPlaylist(tracks, (fait, total) => {
        if (fait % 4 === 0 || fait === total) setAvance({ fait, total });
      });
      const bouts: string[] = [];
      if (r.ajoutes) bouts.push(`${r.ajoutes} ajouté${r.ajoutes > 1 ? 's' : ''}`);
      if (r.deja) bouts.push(`${r.deja} déjà là`);
      if (r.introuvables.length) {
        bouts.push(
          `${r.introuvables.length} introuvable${r.introuvables.length > 1 ? 's' : ''} chez Spotify`,
        );
      }
      setDitSpot(bouts.length > 0 ? bouts.join(' · ') : 'Tout y était déjà.');
    } catch (e) {
      setDitSpot(e instanceof SpotifyError ? e.message : 'Spotify n’a pas répondu.');
    } finally {
      setAvance(null);
    }
  }, [tracks, avance]);

  const basculerAuto = useCallback(async (v: boolean) => {
    vibrer.choix();
    setAuto(v);
    await reglerSync(v);
  }, []);

  // La plateforme decide des mots ecrits sur les boutons de la fiche : elle
  // doit etre lue avant qu'on en ouvre une.
  useEffect(() => {
    void chargerPlateforme();
  }, []);

  const retirer = useCallback(async (t: Track) => {
    setFiche(null);
    // Optimiste : la pochette part tout de suite. Un retrait qui echoue
    // reapparait au prochain rafraichissement, ce qui est le bon compromis
    // devant une grille ou l'absence se voit immediatement.
    setTracks((xs) => xs.filter((x) => x.id !== t.id));
    await prisme.removeFromLibrary(t.id).catch(() => {});
  }, []);

  const cote = Math.floor((width - space.lg * 2 - GOUTTIERE) / 2);

  // Ne dependre que de `connected`, jamais de l'objet `compte`.
  //
  // C'etait `[compte]`, un objet reconstruit a chaque rendu : `load` changeait
  // donc d'identite a chaque rendu, l'effet qui en depend repartait, la reponse
  // posait un nouveau tableau dans l'etat, ce qui provoquait un rendu — et
  // ainsi de suite. La bibliotheque etait redemandee en boucle tant que
  // l'onglet restait monte, ce qui est le cas de tous les onglets.
  const load = useCallback(async () => {
    try {
      const res = await prisme.library();
      setTracks(res.tracks);
    } catch (e) {
      // Le moteur reste seul juge : un jeton perime se voit ici, pas avant.
      if (e instanceof AccountRequiredError) await refreshAccount();
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * On charge a l'arrivee sur l'onglet, pas au montage.
   *
   * Les onglets restent montes : charger au montage voulait dire ne jamais
   * recharger, et un titre garde dans le fil n'apparaissait ici qu'au
   * redemarrage de l'app.
   *
   * Le retour anticipe quand le compte n'est pas encore etabli est l'autre
   * moitie du correctif : l'ecran concluait « rien de garde » avant meme de
   * savoir a qui il parlait, puis se remplissait une fois la reponse arrivee.
   * C'est ce qui donnait un casier vide pendant quelques secondes.
   */
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

  // Le geste de tirer doit montrer qu'il a ete compris. `refreshing` etait
  // fige a faux : l'indicateur ne s'ouvrait jamais, et rien ne disait que la
  // liste avait ete redemandee.
  const rafraichir = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!compte.loading && !compte.connected) {
    return (
      <AccountGate
        titre="Gardés"
        raison="Les titres que tu mets de côté t'attendent ici, et te suivent d'un téléphone à l'autre."
        busy={compte.busy}
        error={compte.error}
        onConnect={compte.connect}
      />
    );
  }

  const patiente = loading || compte.loading;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.titre}>Gardés</Text>
      {/* La ligne existe meme vide : sinon le titre descend a l'arrivee des
          donnees, et l'ecran a l'air de se reconstruire. */}
      <Text style={styles.compte}>
        {patiente ? ' ' : `${tracks.length} titre${tracks.length > 1 ? 's' : ''}`}
      </Text>

      {patiente ? (
        // Squelette a la forme exacte du casier : l'arrivee des pochettes ne
        // deplace rien. Un rond de chargement au centre de l'ecran, lui,
        // remplacait la page par une autre, puis la remplacait encore.
        <View style={styles.squelette}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[styles.fantome, { width: cote, height: cote }]} />
          ))}
        </View>
      ) : tracks.length === 0 ? (
        <Vide />
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          numColumns={2}
          columnWrapperStyle={styles.colonnes}
          contentContainerStyle={styles.casier}
          onRefresh={rafraichir}
          refreshing={refreshing}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            spot?.relie ? (
              <Playlist
                peut={spot.peutPlaylist}
                total={tracks.length}
                avance={avance}
                dit={ditSpot}
                auto={auto}
                onExporter={exporter}
                onAuto={basculerAuto}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Pochette track={item} cote={cote} onPress={() => setFiche(item)} />
          )}
        />
      )}

      <Fiche track={fiche} onFermer={() => setFiche(null)} onRetirer={retirer} />
    </View>
  );
}

/**
 * La playlist Spotify, en une bande.
 *
 * ## Pourquoi une bande et pas deux lignes de reglages
 *
 * Il y a deux choses a offrir — verser ce qui est deja la, et verser ce qui
 * viendra — et ce sont deux faces du meme geste. Deux lignes a chevron les
 * auraient separees en deux reglages sans rapport, dans un ecran qui n'est pas
 * un ecran de reglages. Une bande, une action a gauche, un interrupteur a
 * droite : on lit « exporte, et continue » d'un seul coup d'oeil.
 *
 * Elle est en tete du casier et non au-dessus de lui : elle defile avec les
 * pochettes. Un bandeau fixe aurait pris une hauteur permanente pour une
 * action qu'on fait une fois.
 *
 * ## Le troisieme etat
 *
 * Relie **sans** la permission playlist n'est pas un cas rare mais le cas
 * normal de quiconque a connecte Spotify avant que cette fonctionnalite
 * existe : une portee ne s'elargit jamais toute seule. La bande le dit et
 * renvoie aux reglages, au lieu de proposer un bouton qui echouerait en 403.
 */
function Playlist({
  peut,
  total,
  avance,
  dit,
  auto,
  onExporter,
  onAuto,
}: {
  peut: boolean;
  total: number;
  avance: { fait: number; total: number } | null;
  dit: string | null;
  auto: boolean;
  onExporter: () => void;
  onAuto: (v: boolean) => void;
}) {
  if (!peut) {
    return (
      <View style={styles.playlist}>
        <Text style={styles.playlistSous}>
          Pour verser tes gardés dans une playlist Spotify, reconnecte Spotify depuis les
          réglages — cette permission a été ajoutée après ta connexion.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.playlist}>
      <Pressable
        style={({ pressed }) => [styles.playlistGauche, pressed && styles.pale]}
        onPress={onExporter}
        disabled={avance !== null || total === 0}
        accessibilityRole="button"
        accessibilityLabel="Tout exporter vers la playlist Spotify Reso"
      >
        <Text style={styles.playlistAction}>
          {avance ? (
            <Text style={chiffres}>{`${avance.fait} / ${avance.total}`}</Text>
          ) : (
            'Tout exporter'
          )}
        </Text>
        <Text style={styles.playlistSous} numberOfLines={2}>
          {dit ?? 'Vers ta playlist Spotify « Reso »'}
        </Text>
      </Pressable>

      <View style={styles.playlistAuto}>
        <Text style={styles.playlistMot}>auto</Text>
        <Switch
          value={auto}
          onValueChange={onAuto}
          trackColor={{ false: '#26262B', true: color.accentDim }}
          thumbColor={auto ? color.accent : color.textMuted}
          ios_backgroundColor="#26262B"
          accessibilityLabel="Ajouter automatiquement les nouveaux gardés"
        />
      </View>
    </View>
  );
}

/**
 * Un titre garde.
 *
 * Le tap ouvrait Deezer directement. Il ouvre maintenant une fiche : il y a
 * trois gestes utiles sur un titre garde — l'ecouter en entier, l'ajouter aux
 * favoris de sa plateforme, le ranger — et une grille n'a nulle part ou les
 * loger. La pression enfonce la pochette, sans quoi rien ne dit que le tap a
 * ete pris.
 */
function Pochette({
  track,
  cote,
  onPress,
}: {
  track: Track;
  cote: number;
  onPress: () => void;
}) {
  const echelle = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: echelle.get() }] }));

  return (
    <Pressable
      style={{ width: cote }}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${track.artist.name}`}
      accessibilityHint="Ouvre les actions de ce titre"
      onPressIn={() => echelle.set(withTiming(0.96, { duration: motion.press }))}
      onPressOut={() => echelle.set(withTiming(1, { duration: motion.press }))}
      onPress={() => {
        vibrer.action();
        onPress();
      }}
    >
      <Animated.View style={style}>
        <Image
          source={{ uri: track.cover }}
          style={[styles.cover, { width: cote, height: cote }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={160}
          recyclingKey={String(track.id)}
        />
      </Animated.View>
      <Text style={styles.titreMorceau} numberOfLines={1}>
        {track.title}
      </Text>
      <Text style={styles.artiste} numberOfLines={1}>
        {track.artist.name}
      </Text>
    </Pressable>
  );
}

/**
 * La fiche d'un titre garde.
 *
 * Trois gestes, dans l'ordre ou on les fait : ecouter, garder ailleurs, ranger.
 *
 * **Ce que « ajouter aux titres likes » fait depend de la plateforme, et la
 * fiche le dit avant qu'on appuie.** Spotify est le seul a exposer une API
 * d'ecriture (`PUT /me/tracks`) ; le pont entre les deux catalogues est
 * l'ISRC, le seul identifiant qu'un enregistrement porte chez tout le monde.
 * Apple Music demande MusicKit et une cle de developpeur signee, Deezer un
 * secret cote serveur, YouTube Music n'a pas d'API de bibliotheque : pour ces
 * trois-la, le bouton ouvre le titre chez eux — un geste de moins que d'aller
 * le chercher a la main, et rien de plus n'est promis.
 */
function Fiche({
  track,
  onFermer,
  onRetirer,
}: {
  track: Track | null;
  onFermer: () => void;
  onRetirer: (t: Track) => void;
}) {
  const [occupe, setOccupe] = useState(false);
  const [dit, setDit] = useState<string | null>(null);

  const id = plateformeCourante();
  const p = plateforme(id);

  // Remis a zero a chaque ouverture : un message d'erreur laisse d'un titre
  // sur le suivant accuserait le mauvais morceau.
  useEffect(() => {
    setDit(null);
    setOccupe(false);
  }, [track?.id]);

  if (!track) return null;

  const ouvrir = () => {
    vibrer.action();
    void Linking.openURL(lienVers(track, id));
  };

  const aimer = async () => {
    vibrer.action();
    if (!p.ecrit) {
      // Rien a promettre : on emmene la personne la ou le geste est possible.
      void Linking.openURL(lienVers(track, id));
      return;
    }
    setOccupe(true);
    setDit(null);
    try {
      const ok = await ajouterAuxLikes(track);
      setDit(
        ok
          ? `Ajouté à tes titres likés ${p.nom}.`
          : `Ta liaison ${p.nom} a expiré. Reconnecte-toi depuis les réglages.`,
      );
    } catch (e) {
      setDit(e instanceof SpotifyError ? e.message : `${p.nom} n’a pas répondu.`);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFermer}>
      {/* Le voile ferme la fiche : c'est le geste qu'on tente en premier, et
          ne rien faire donne l'impression que l'app s'est bloquee. */}
      <Pressable style={styles.voile} onPress={onFermer} accessibilityLabel="Fermer" />
      <View style={styles.fiche}>
        <View style={styles.ficheEntete}>
          <Image
            source={{ uri: track.cover }}
            style={styles.ficheCover}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <View style={styles.ficheTexte}>
            <Text style={styles.ficheTitre} numberOfLines={2}>
              {track.title}
            </Text>
            <Text style={styles.ficheArtiste} numberOfLines={1}>
              {track.artist.name}
            </Text>
            <Text style={styles.ficheAlbum} numberOfLines={1}>
              {track.album}
            </Text>
          </View>
        </View>

        <Action titre={`Écouter sur ${ouSecoute(id)}`} onPress={ouvrir} />
        <Action
          titre={p.ecrit ? `Ajouter à mes titres likés ${p.nom}` : `Ajouter dans ${ouSecoute(id)}`}
          sous={p.ecrit ? undefined : `${p.nom} ne permet pas à Reso de l’ajouter pour toi.`}
          occupe={occupe}
          onPress={aimer}
        />
        <Action titre="Retirer de mes gardés" danger onPress={() => onRetirer(track)} />

        {dit ? <Text style={styles.dit}>{dit}</Text> : null}
      </View>
    </Modal>
  );
}

function Action({
  titre,
  sous,
  danger,
  occupe,
  onPress,
}: {
  titre: string;
  sous?: string;
  danger?: boolean;
  occupe?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && styles.actionPressee]}
      disabled={occupe}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.actionTexte}>
        <Text style={[styles.actionTitre, danger && styles.actionDanger]}>{titre}</Text>
        {sous ? <Text style={styles.actionSous}>{sous}</Text> : null}
      </View>
      {occupe ? <ActivityIndicator color={color.accent} /> : null}
    </Pressable>
  );
}

/** Le casier vide, dans le meme cadre que le casier plein : le titre ne bouge
 *  pas, seul son contenu change. Et il dit le geste — un ecran vide qui ne dit
 *  pas comment le remplir se contente de constater. */
function Vide() {
  return (
    <View style={styles.vide}>
      <Text style={styles.videTitre}>Rien de gardé pour l'instant.</Text>
      <Text style={styles.videTexte}>
        Dans le fil, fais glisser une carte vers le haut : le titre atterrit ici, et il y reste même
        si tu changes de téléphone.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  playlist: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginBottom: space.md,
    borderRadius: radius.md,
    backgroundColor: color.bgElevated,
  },
  playlistGauche: { flex: 1, gap: 2 },
  playlistAction: { ...type.lead, color: color.accent },
  playlistSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint, flex: 1 },
  playlistAuto: { alignItems: 'center', gap: space.xs },
  playlistMot: { ...type.caption, fontSize: 12, color: color.textFaint },
  pale: { opacity: 0.55 },

  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  titre: { ...type.display, color: color.text },
  compte: { ...type.body, ...chiffres, color: color.textMuted, marginTop: space.xs },

  casier: { paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  colonnes: { gap: GOUTTIERE },
  cover: { borderRadius: radius.md, backgroundColor: color.bgElevated },
  titreMorceau: {
    ...type.body,
    fontSize: 15,
    lineHeight: 20,
    color: color.text,
    marginTop: space.sm,
  },
  artiste: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted, marginTop: 1 },

  squelette: { flexDirection: 'row', flexWrap: 'wrap', gap: GOUTTIERE, paddingTop: space.lg },
  fantome: { borderRadius: radius.md, backgroundColor: color.bgElevated },

  // La fiche est une feuille posee en bas : c'est la ou tombe le pouce, et
  // c'est la convention native pour un menu d'actions.
  voile: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
  fiche: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bgElevated,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  ficheEntete: { flexDirection: 'row', gap: space.md, paddingBottom: space.lg },
  ficheCover: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: color.bgSunken },
  ficheTexte: { flex: 1, gap: 2 },
  ficheTitre: { ...type.lead, color: color.text },
  ficheArtiste: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted },
  ficheAlbum: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  actionPressee: { opacity: 0.55 },
  actionTexte: { flex: 1, gap: 2 },
  actionTitre: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.text },
  actionDanger: { color: color.alert },
  actionSous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  dit: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textMuted, marginTop: space.md },

  vide: { flex: 1, justifyContent: 'center', paddingBottom: space.xxl, gap: space.sm },
  videTitre: { ...type.title, color: color.text },
  videTexte: { ...type.lead, color: color.textMuted },
});
