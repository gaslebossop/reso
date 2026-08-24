import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../src/api/client';
import type { Notif } from '../src/api/types';
import { IconeCoeur, IconeGens, IconeRetour } from '../src/components/Icones';
import { Visage } from '../src/components/Visage';
import { poser, toutLu } from '../src/state/notifs';
import { vibrer } from '../src/state/vibration';
import { color, radius, space, type } from '../src/theme/tokens';

/**
 * Ce qui s'est passe pendant que tu n'etais pas la.
 *
 * ## Deux genres, et pas un de plus
 *
 * Un **nouvel abonne**, et un **titre qu'on t'a repris**. Ce sont les deux
 * seuls faits que la base porte deja avec une date ; tout le reste — « untel a
 * ecoute », « ton profil a ete vu N fois » — serait une notification fabriquee
 * pour donner l'impression qu'il se passe quelque chose. Une liste courte et
 * vraie vaut mieux qu'une liste longue et decorative : c'est la difference
 * entre une page qu'on ouvre et une page qu'on apprend a ignorer.
 *
 * ## Le titre repris est la vraie nouvelle
 *
 * « Quelqu'un a garde un titre que tu gardes » est le seul evenement de cette
 * app qui dise quelque chose sur le gout plutot que sur le compteur. Il porte
 * donc sa pochette, en grand par rapport au reste de la ligne — on reconnait
 * un disque avant de lire un nom.
 *
 * Le moteur ne remonte que les reprises **posterieures** a la tienne. Sans
 * cette regle, tous ceux qui gardaient deja un titre populaire avant toi
 * apparaitraient le jour de l'inscription, et la page serait pleine sans rien
 * annoncer.
 *
 * ## Lu des l'ouverture
 *
 * Pas de bouton « tout marquer comme lu ». Ouvrir la page **est** l'acte de
 * lecture ; demander un geste de plus pour eteindre une pastille qu'on n'a pas
 * demandee serait une corvee inventee. Le compteur tombe a zero tout de suite,
 * sans attendre la reponse du serveur — la pastille doit disparaitre au moment
 * ou l'ecran s'ouvre.
 */

/** Combien de temps s'est ecoule, en une poignee de mots. */
function ilYA(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 90) return "a l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j < 7) return `il y a ${j} j`;
  const sem = Math.round(j / 7);
  if (sem < 5) return `il y a ${sem} sem`;
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [notifs, setNotifs] = useState<Notif[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  /**
   * Le seuil de lecture, fige a l'arrivee.
   *
   * Il vient du serveur **avant** qu'on marque la page comme lue, et il ne
   * bouge plus ensuite : sans cela, les lignes cesseraient d'etre signalees
   * comme nouvelles sous les yeux de qui est en train de les lire.
   */
  const [seuil, setSeuil] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivant = true;
      setErreur(null);
      prisme
        .notifs()
        .then((r) => {
          if (!vivant) return;
          setNotifs(r.notifs);
          setSeuil(r.vues_at ?? 0);
          // Le compte local est connu sans aller-retour : la reponse le porte.
          poser(r.nouvelles);
          if (r.nouvelles > 0) void toutLu();
        })
        .catch((e) => {
          if (vivant) setErreur(e instanceof Error ? e.message : 'Notifications indisponibles');
        });
      return () => {
        vivant = false;
      };
    }, []),
  );

  const ouvrir = useCallback(
    (id: string) => {
      vibrer.choix();
      router.push(`/gens/${encodeURIComponent(id)}`);
    },
    [router],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.entete}>
          <Pressable
            style={({ pressed }) => [styles.retour, pressed && styles.pale]}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            hitSlop={12}
          >
            <IconeRetour couleur={color.textMuted} />
          </Pressable>
          <Text style={styles.titre}>Notifications</Text>
          <View style={styles.retour} />
        </View>

        {notifs === null && erreur === null ? (
          <ActivityIndicator color={color.accent} style={styles.attente} />
        ) : erreur !== null ? (
          <Text style={styles.erreur}>{erreur}</Text>
        ) : notifs!.length === 0 ? (
          <Text style={styles.vide}>
            Rien pour l'instant. Ça se remplira quand quelqu'un te suivra, ou gardera un titre que
            tu gardes déjà.
          </Text>
        ) : (
          <View style={styles.liste}>
            {notifs!.map((n, i) => (
              <Ligne
                key={`${n.genre}-${n.gen.user_id}-${n.at}-${i}`}
                notif={n}
                neuve={seuil !== null && n.at > seuil}
                onPress={() => ouvrir(n.gen.user_id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Une ligne.
 *
 * Le visage a gauche parce que toutes les notifications parlent de quelqu'un ;
 * la pochette a droite parce qu'une seule des deux en a une, et qu'une colonne
 * qui n'existe qu'une fois sur deux se lit mieux au bord qu'au milieu.
 *
 * Ce qui est nouveau porte **un point, pas un fond colore**. Un aplat sur la
 * moitie des lignes fait une page a deux couleurs ou l'oeil ne sait plus quoi
 * chercher ; un point de quatre pixels se voit tout autant et laisse la liste
 * tranquille.
 */
function Ligne({
  notif,
  neuve,
  onPress,
}: {
  notif: Notif;
  neuve: boolean;
  onPress: () => void;
}) {
  const nom = notif.gen.nom || `@${notif.gen.handle}` || 'Quelqu’un';
  const estMatch = notif.genre === 'match';

  return (
    <Pressable
      style={({ pressed }) => [styles.rang, pressed && styles.rangPresse]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        estMatch ? `${nom} garde aussi ${notif.track?.title ?? 'un titre'}` : `${nom} te suit`
      }
    >
      <View>
        <Visage uri={notif.gen.avatar} taille={48} />
        {/* Le pictogramme du genre, pose sur le bord du visage : il dit de quoi
            il s'agit avant qu'on lise la phrase. */}
        <View style={[styles.sceau, estMatch ? styles.sceauMatch : styles.sceauAbonne]}>
          {estMatch ? (
            <IconeCoeur actif couleur={color.accent} taille={12} />
          ) : (
            <IconeGens actif couleur={color.save} taille={12} />
          )}
        </View>
      </View>

      <View style={styles.rangTexte}>
        <Text style={styles.phrase} numberOfLines={2}>
          <Text style={styles.nom}>{nom}</Text>
          {estMatch ? ' garde aussi ' : ' te suit'}
          {estMatch && notif.track ? (
            <Text style={styles.oeuvre}>{notif.track.title}</Text>
          ) : null}
        </Text>
        <Text style={styles.quand}>{ilYA(notif.at)}</Text>
      </View>

      {estMatch && notif.track ? (
        <Image
          source={{ uri: notif.track.cover }}
          style={styles.pochette}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={String(notif.track.id)}
        />
      ) : null}

      {neuve ? <View style={styles.point} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.lg },
  pale: { opacity: 0.5 },

  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  retour: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -space.md,
  },
  titre: { ...type.title, fontSize: 20, lineHeight: 26, color: color.text },

  attente: { marginTop: space.xxl },
  erreur: { ...type.body, fontSize: 15, lineHeight: 20, color: color.alert, marginTop: space.xl },
  vide: { ...type.body, fontSize: 15, lineHeight: 22, color: color.textMuted, marginTop: space.xl },

  liste: { marginTop: space.md },
  rang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  rangPresse: { opacity: 0.55 },
  sceau: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    // Un liseré de la couleur du fond : le sceau se détache du visage sans
    // qu'on ait à lui dessiner une ombre, qui ne se verrait pas sur du noir.
    borderWidth: 2,
    borderColor: color.bg,
  },
  sceauMatch: { backgroundColor: color.accentDim },
  sceauAbonne: { backgroundColor: color.saveDim },

  rangTexte: { flex: 1, gap: 2 },
  phrase: { ...type.body, fontSize: 15, lineHeight: 21, color: color.textMuted },
  nom: { color: color.text, fontWeight: '700' },
  oeuvre: { color: color.text },
  quand: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },

  pochette: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: color.bgElevated,
  },
  point: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
});
