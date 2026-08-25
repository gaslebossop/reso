import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { prisme } from '../api/client';
import type { Ami, Track } from '../api/types';
import { vibrer } from '../state/vibration';
import { color, space, type } from '../theme/tokens';
import { EnteteTitre, Feuille } from './Feuille';
import { NomVerifie } from './NomVerifie';
import { Visage } from './Visage';

/**
 * Envoyer un son à quelqu'un.
 *
 * ## Un tap envoie
 *
 * Pas de bouton « Envoyer », pas de case à cocher suivie d'une validation :
 * l'envoi **est** le tap. Un bouton de confirmation aurait demandé un second
 * geste pour une action dont le pire dénouement est qu'un ami reçoive un son.
 * On peut en toucher plusieurs — le visage se coche et reste coché.
 *
 * ## Le compteur est visible dès l'ouverture
 *
 * « 2 sons à envoyer aujourd'hui ». Découvrir un plafond en le heurtant est la
 * pire façon de l'apprendre. Il vient du serveur : le calculer ici le ferait
 * diverger dès qu'on envoie depuis un deuxième appareil.
 *
 * Le compte porte sur les **titres**, pas sur les envois — le même son à
 * quatre amis coûte un. C'est pourquoi le compteur ne bouge pas forcément
 * après un tap, et pourquoi on le relit de la réponse plutôt que de le
 * décrémenter soi-même.
 *
 * ## Ce qui est déjà parti est marqué avant le tap
 *
 * L'envoi est idempotent : un son, une personne, une fois. Un ami qui a déjà
 * reçu ce titre arrive donc déjà coché et n'est plus tapable — sans ça on
 * taperait dans le vide, et voir « envoyé » alors que rien ne part est pire
 * que le doublon qu'on vient de fermer.
 *
 * ## Le coche part avant la réponse
 *
 * Optimiste, comme le bouton « suivre » de la carte. Un refus décoche et
 * affiche le message du serveur tel quel — c'est lui qui sait s'il s'agit
 * d'une amitié rompue ou d'une journée épuisée, et sa phrase est écrite pour
 * être lue.
 */
export function FeuilleEnvoi({
  track,
  visible,
  onFermer,
}: {
  track: Track | null;
  visible: boolean;
  onFermer: () => void;
}) {
  const [amis, setAmis] = useState<Ami[] | null>(null);
  const [restants, setRestants] = useState<number | null>(null);
  const [envoyes, setEnvoyes] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  // La liste se relit à chaque ouverture : on a pu se faire un ami depuis la
  // dernière, et le compteur du jour repart tout seul à minuit.
  useEffect(() => {
    if (!visible) return;
    let vivant = true;
    setAmis(null);
    setEnvoyes(new Set());
    setErreur(null);
    prisme
      // Avec le titre : chaque ami dit s'il l'a déjà reçu de moi.
      .amis(track?.id)
      .then((r) => {
        if (!vivant) return;
        setAmis(r.amis);
        setRestants(r.restants);
        setEnvoyes(new Set(r.amis.filter((a) => a.envoye).map((a) => a.user_id)));
      })
      .catch((e) => {
        if (vivant) setErreur(e instanceof Error ? e.message : 'Liste d’amis indisponible');
      });
    return () => {
      vivant = false;
    };
  }, [visible, track?.id]);

  const envoyer = useCallback(
    async (g: Ami) => {
      if (!track || envoyes.has(g.user_id)) return;
      vibrer.action();
      setEnvoyes((s) => new Set(s).add(g.user_id));
      setErreur(null);
      try {
        const r = await prisme.partager(track.id, g.user_id);
        setRestants(r.restants);
      } catch (e) {
        setEnvoyes((s) => {
          const n = new Set(s);
          n.delete(g.user_id);
          return n;
        });
        setErreur(e instanceof Error ? e.message : 'Envoi impossible');
      }
    },
    [track, envoyes],
  );

  return (
    <Feuille visible={visible} onFermer={onFermer}>
      {track ? <EnteteTitre track={track} sous="À qui tu l’envoies ?" /> : null}

      {restants !== null ? (
        <Text style={styles.compteur}>
          {restants > 0
            ? `${restants} son${restants > 1 ? 's' : ''} à envoyer aujourd’hui`
            : 'Tu as envoyé tes sons du jour'}
        </Text>
      ) : null}

      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}

      {amis === null && erreur === null ? (
        <ActivityIndicator color={color.accent} style={styles.attente} />
      ) : amis !== null && amis.length === 0 ? (
        <Text style={styles.vide}>
          Tu n’as pas encore d’ami ici. Il faut se suivre des deux côtés — cherche un @ dans
          l’onglet « Les gens ».
        </Text>
      ) : (
        // Bornée en hauteur : quinze amis ne doivent pas pousser la feuille
        // jusqu'en haut de l'écran.
        <ScrollView style={styles.liste} showsVerticalScrollIndicator={false}>
          {(amis ?? []).map((g) => {
            const parti = envoyes.has(g.user_id);
            return (
              <Pressable
                key={g.user_id}
                style={({ pressed }) => [styles.rang, pressed && styles.pale]}
                onPress={() => void envoyer(g)}
                disabled={parti}
                accessibilityRole="button"
                accessibilityState={{ disabled: parti }}
                accessibilityLabel={parti ? `Envoyé à ${g.nom}` : `Envoyer à ${g.nom}`}
              >
                <Visage uri={g.avatar} taille={40} />
                <NomVerifie
                  nom={g.nom || `@${g.handle}`}
                  verifie={g.verifie}
                  style={[styles.nom, parti && styles.nomParti]}
                  ligne={styles.nomLigne}
                />
                {parti ? <Text style={styles.parti}>envoyé</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Feuille>
  );
}

const styles = StyleSheet.create({
  pale: { opacity: 0.55 },

  compteur: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
  erreur: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    color: color.alert,
    marginTop: space.xs,
  },
  attente: { marginVertical: space.xl },
  vide: {
    ...type.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textMuted,
    paddingVertical: space.lg,
  },

  liste: { maxHeight: 320, marginTop: space.sm },
  // Le filet en haut de chaque ligne, comme `LigneAction` : une carte par ami
  // dans une feuille qui est déjà une carte ferait trois épaisseurs.
  rang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  /** Le `flex` vit sur la rangee et non sur le texte : c'est elle qui doit
   *  pousser « envoyé » au bout de la ligne, et un `flex: 1` sur le nom
   *  aurait au contraire decolle la pastille du nom qu'elle qualifie. */
  nomLigne: { flex: 1 },
  nom: { ...type.lead, fontSize: 15, lineHeight: 20, color: color.text },
  nomParti: { color: color.textFaint },
  parti: { ...type.caption, fontSize: 11, lineHeight: 14, color: color.accent, letterSpacing: 0.8 },
});
