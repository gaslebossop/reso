import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../src/api/client';
import type { Card, Gen, MixMatch, SwipeAction } from '../../src/api/types';
import { Barre } from '../../src/components/Barre';
import { ExplosionMatch } from '../../src/components/ExplosionMatch';
import { AccountGate } from '../../src/components/AccountGate';
import { IconeRetour } from '../../src/components/Icones';
import { NomVerifie } from '../../src/components/NomVerifie';
import { Passage, type Verdict } from '../../src/components/Passage';
import { Visage } from '../../src/components/Visage';
import { player } from '../../src/audio/player';
import { useAccount } from '../../src/state/useAccount';
import { useMixFeed } from '../../src/state/useMixFeed';
import { vibrer } from '../../src/state/vibration';
import { color, radius, space, type } from '../../src/theme/tokens';

/**
 * Le salon de mix : le fil, mais a deux.
 *
 * ## Ce qui ne bouge pas
 *
 * La carte, les gestes, la barre — c'est `Passage.tsx` sans une ligne
 * touchee. Refaire la forme d'un ecran n'autorise pas a faire reapprendre son
 * usage, et un mix qui swipe autrement que le fil serait exactement cette
 * faute.
 *
 * ## Ce qui distingue le salon
 *
 * Une identite violette (`color.mix`) au lieu du fond dynamique du fil
 * normal — c'est un deuxieme espace, pas une variante du premier — et
 * l'explosion de match, seul moment de toute l'application ou une vraie
 * explosion de particules a sa place : elle est rare par construction (il
 * faut deux personnes ET le meme titre) et paie une attente qui a dure plus
 * longtemps qu'un swipe.
 */

const STACK = 3;

export default function MixScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const compte = useAccount();
  const { roomId: brut } = useLocalSearchParams<{ roomId?: string }>();
  const roomId = typeof brut === 'string' ? Number.parseInt(brut, 10) : NaN;
  const idValide = Number.isFinite(roomId);

  const [partenaire, setPartenaire] = useState<Gen | null>(null);
  const [salonIntrouvable, setSalonIntrouvable] = useState(false);
  const [matches, setMatches] = useState<MixMatch[] | null>(null);
  const [reveler, setReveler] = useState<MixMatch[]>([]);

  /** Un accord est a l'ecran : le fil se tait, c'est cet extrait-la qu'on
   *  ecoute. Voir l'effet juste en dessous. */
  const enReveal = reveler.length > 0;

  const feed = useMixFeed(compte.connected && idValide ? roomId : null, enReveal);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  /**
   * Le son de l'accord revele.
   *
   * **Un seul lecteur pour toute l'app**, donc rien a couper a la main :
   * `play()` met en pause ce qui tournait avant de partir. Le fil, lui, est
   * mis en sourdine par `enReveal` — sans ca, un lot qui arrive pendant la
   * popup ferait repartir la carte du dessous par-dessus l'accord.
   */
  const revealId = reveler[0]?.track.id ?? null;
  useEffect(() => {
    const m = reveler[0];
    if (!m) return;
    void player.play(m.track).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId]);

  useEffect(() => {
    if (!compte.connected || !idValide) return;
    let vivant = true;
    prisme
      .mixRoom(roomId)
      .then((r) => {
        if (vivant) setPartenaire(r.partenaire);
      })
      .catch(() => {
        if (vivant) setSalonIntrouvable(true);
      });
    prisme
      .mixMatches(roomId)
      .then((r) => {
        if (!vivant) return;
        setMatches(r.matches);
        const nouveaux = r.matches.filter((m) => m.nouveau);
        if (nouveaux.length > 0) setReveler(nouveaux);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [compte.connected, idValide, roomId]);

  const fermerReveal = useCallback(() => {
    setReveler((r) => {
      const suite = r.slice(1);
      if (suite.length === 0 && idValide) void prisme.mixMarquerLu(roomId).catch(() => {});
      return suite;
    });
  }, [roomId, idValide]);

  const [aBannir, setABannir] = useState<Card | null>(null);
  const [scene, setScene] = useState({ w: 0, h: 0 });
  const mesurer = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setScene((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  }, []);

  const auFil = useRef(false);
  const hautRef = useRef<Card['track'] | null>(null);
  useEffect(() => {
    hautRef.current = feed.cards[0]?.track ?? null;
  }, [feed.cards]);

  useEffect(() => {
    auFil.current = true;
    return () => {
      auFil.current = false;
      player.pause();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') player.suspend();
      else if (s === 'active' && auFil.current) player.resume();
    });
    return () => sub.remove();
  }, []);

  const payerGeste = useCallback((v: Verdict) => {
    if (v === 'like') vibrer.aime();
    else if (v === 'save') vibrer.garde();
  }, []);

  const onVerdict = useCallback((v: Verdict) => {
    setABannir(null);
    void feedRef.current.decide(v as SwipeAction);
  }, []);

  const onSeuil = useCallback(() => vibrer.seuil(), []);
  const onSurprise = useCallback(() => vibrer.surprise(), []);

  const demanderBannir = useCallback(() => {
    vibrer.grave();
    setABannir(feedRef.current.cards[0] ?? null);
  }, []);

  const bannir = useCallback(() => {
    setABannir(null);
    void feedRef.current.decide('block');
  }, []);

  const [suivisLocaux, setSuivisLocaux] = useState<Record<number, boolean>>({});
  const estSuivi = useCallback(
    (c: Card) => suivisLocaux[c.track.artist.id] ?? !!c.followed,
    [suivisLocaux],
  );
  const suivre = useCallback((artistId: number, on: boolean) => {
    setSuivisLocaux((s) => ({ ...s, [artistId]: on }));
    prisme.suivreArtiste(artistId, on).catch(() => {
      setSuivisLocaux((s) => ({ ...s, [artistId]: !on }));
    });
  }, []);

  const top = feed.cards[0];
  const visible = feed.cards.slice(0, scene.w > 0 ? STACK : 0);

  if (!compte.loading && !compte.connected) {
    return (
      <AccountGate
        titre="Mixer à deux"
        raison="Mélangez vos goûts avec un ami et découvrez ce qui vous rassemble."
        busy={compte.busy}
        error={compte.error}
        onConnect={compte.connect}
      />
    );
  }

  if (!idValide || salonIntrouvable) {
    return (
      <View style={styles.screen}>
        <Entete insets={insets} partenaire={null} matches={null} onRetour={() => router.back()} />
        <View style={styles.vide}>
          <Text style={styles.videTitre}>Salon introuvable</Text>
          <Text style={styles.videTexte}>Ce mix n’existe pas, ou plus.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FondMix />

      <Entete insets={insets} partenaire={partenaire} matches={matches} onRetour={() => router.back()} />

      <View style={styles.scene} onLayout={mesurer}>
        {top ? (
          visible
            .map((card, i) => ({ card, i }))
            .reverse()
            .map(({ card, i }) => (
              <Passage
                key={card.track.id}
                card={card}
                depth={i}
                active={i === 0}
                largeurScene={scene.w}
                hauteurScene={scene.h}
                onVerdict={onVerdict}
                onPaiement={payerGeste}
                onSeuil={onSeuil}
                onSurprise={onSurprise}
                onDemandeBannir={demanderBannir}
                suivi={estSuivi(card)}
                onSuivre={(on) => suivre(card.track.artist.id, on)}
              />
            ))
        ) : (
          <EtatMix feed={feed} partenaire={partenaire} />
        )}
      </View>

      <View style={[styles.pied, { paddingBottom: insets.bottom + space.md }]}>
        {aBannir ? (
          <Bannissement
            artiste={aBannir.track.artist.name}
            onAnnuler={() => setABannir(null)}
            onConfirmer={bannir}
          />
        ) : (
          <Barre onAction={onVerdict} disabled={!top} />
        )}
      </View>

      {/* Rendue en permanence, et **sans `key`** : c'est la fenetre qui doit
          survivre a toute la file. Avec une cle sur le titre, chaque accord
          demontait la Modal et en presentait une neuve — le fil reapparaissait
          entre les deux, puis une carte revenait une seconde plus tard. */}
      <ExplosionMatch
        visible={enReveal}
        match={reveler[0] ?? null}
        partenaire={partenaire}
        moi={compte.me?.picture}
        /* `matches` arrive du plus recent au plus ancien : le rang d'un
           accord est donc sa position **depuis la fin**. Le calculer a
           l'envers ferait dire « premier accord » au dernier arrive. */
        rang={
          matches && reveler[0]
            ? matches.length - matches.findIndex((m) => m.track.id === reveler[0].track.id)
            : undefined
        }
        onFermer={fermerReveal}
      />
    </View>
  );
}

/** L'en-tete : retour, le partenaire, et la trace des matchs. */
function Entete({
  insets,
  partenaire,
  matches,
  onRetour,
}: {
  insets: { top: number };
  partenaire: Gen | null;
  matches: MixMatch[] | null;
  onRetour: () => void;
}) {
  return (
    <View style={[styles.entete, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        style={({ pressed }) => [styles.retour, pressed && styles.pale]}
        onPress={onRetour}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Retour"
      >
        <IconeRetour couleur={color.textMuted} />
      </Pressable>

      <View style={styles.identite}>
        <Visage uri={partenaire?.avatar} taille={30} />
        <NomVerifie
          nom={partenaire?.nom || 'Votre mix'}
          verifie={partenaire?.verifie}
          style={styles.identiteNom}
          taille={13}
          numberOfLines={1}
        />
      </View>

      {matches && matches.length > 0 ? (
        <View style={styles.trace}>
          {matches.slice(0, 3).map((m, k) => (
            <Image
              key={m.track.id}
              source={{ uri: m.track.cover }}
              style={[styles.tracePochette, k > 0 && styles.traceDecale]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ))}
          <Text style={styles.traceNombre}>{matches.length}</Text>
        </View>
      ) : (
        <View style={styles.traceVide} />
      )}
    </View>
  );
}

/** Le fond du salon : calme, et violet — pas la palette dynamique du fil. */
function FondMix() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.fondHalo} />
    </View>
  );
}

function EtatMix({
  feed,
  partenaire,
}: {
  feed: ReturnType<typeof useMixFeed>;
  partenaire: Gen | null;
}) {
  if (feed.loading) {
    return (
      <Cadre titre="Le mix se prépare" detail="Deux goûts à mélanger…">
        <ActivityIndicator color={color.mix} />
      </Cadre>
    );
  }
  if (feed.error) {
    return (
      <Cadre titre="Le mix ne répond pas" detail={feed.error} action="Réessayer" onAction={feed.reload} />
    );
  }
  return (
    <Cadre
      titre="C'est tout pour l'instant"
      detail={`${partenaire?.nom || 'Votre ami'} n’a peut-être pas encore de nouveau titre à vous proposer. Revenez plus tard.`}
      action="Relancer"
      onAction={feed.reload}
    />
  );
}

function Cadre({
  titre,
  detail,
  action,
  onAction,
  children,
}: {
  titre: string;
  detail: string;
  action?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.cadre}>
      {children}
      <Text style={styles.cadreTitre}>{titre}</Text>
      <Text style={styles.cadreDetail}>{detail}</Text>
      {action && onAction ? (
        <Pressable style={styles.bouton} hitSlop={12} onPress={onAction}>
          <Text style={styles.boutonTexte}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Bannissement({
  artiste,
  onAnnuler,
  onConfirmer,
}: {
  artiste: string;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  return (
    <View style={styles.bannissement}>
      <Text style={styles.bannirQuestion} numberOfLines={2}>
        Ne plus jamais proposer {artiste} ?
      </Text>
      <View style={styles.bannirActions}>
        <Pressable style={styles.bannirSecondaire} hitSlop={12} onPress={onAnnuler}>
          <Text style={styles.bannirSecondaireTexte}>Annuler</Text>
        </Pressable>
        <Pressable style={styles.bannirPrincipal} hitSlop={12} onPress={onConfirmer}>
          <Text style={styles.bannirPrincipalTexte}>Bannir</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pale: { opacity: 0.5 },

  fondHalo: {
    position: 'absolute',
    top: -120,
    left: '-20%',
    right: '-20%',
    height: 420,
    borderRadius: 999,
    backgroundColor: color.mix,
    opacity: 0.14,
    transform: [{ scaleX: 1.4 }],
  },

  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  retour: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  identite: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  identiteNom: { color: color.text },

  trace: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tracePochette: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: color.bg,
    backgroundColor: color.bgSunken,
  },
  traceDecale: { marginLeft: -12 },
  traceNombre: { ...type.label, fontSize: 12, color: color.mix, marginLeft: space.xs },
  traceVide: { width: 1 },

  scene: { flex: 1, marginHorizontal: space.md },
  pied: { paddingTop: space.lg, minHeight: 128, justifyContent: 'center' },

  cadre: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.card,
    backgroundColor: color.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  cadreTitre: { ...type.title, color: color.text, textAlign: 'center' },
  cadreDetail: { ...type.body, color: color.textMuted, textAlign: 'center' },
  bouton: {
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
    backgroundColor: color.mixDim,
    borderWidth: 1,
    borderColor: color.mix,
  },
  boutonTexte: { ...type.label, color: color.mix },

  vide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.sm },
  videTitre: { ...type.title, color: color.text },
  videTexte: { ...type.lead, color: color.textMuted, textAlign: 'center' },

  bannissement: { paddingHorizontal: space.lg, gap: space.md },
  bannirQuestion: { ...type.lead, color: color.text, textAlign: 'center' },
  bannirActions: { flexDirection: 'row', justifyContent: 'center', gap: space.md },
  bannirSecondaire: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.full },
  bannirSecondaireTexte: { ...type.label, color: color.textMuted },
  bannirPrincipal: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.alert,
  },
  bannirPrincipalTexte: { ...type.label, color: color.alert },
});
