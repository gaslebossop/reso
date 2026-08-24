import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../../src/api/client';
import type { Gen } from '../../../src/api/types';
import { IconeChevron, IconeRetour } from '../../../src/components/Icones';
import { Visage } from '../../../src/components/Visage';
import { vibrer } from '../../../src/state/vibration';
import { color, radius, space, type } from '../../../src/theme/tokens';

/**
 * La liste derriere un compteur : les abonnes, ou les abonnements.
 *
 * Une regle vient du moteur et tient tout l'ecran : les profils caches
 * n'y figurent pas. Suivre quelqu'un — ou etre suivi — ne donne aucun
 * droit sur les gens qui ont choisi de disparaitre.
 */
export default function GensDeProfil() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: brut, type } = useLocalSearchParams<{ id?: string; type?: string }>();
  const id = typeof brut === 'string' ? decodeURIComponent(brut) : '';
  const enAbonnes = type !== 'abonnements';

  const [gens, setGens] = useState<Gen[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivant = true;
      setErreur(null);
      prisme
        .gensDuProfil(id, enAbonnes ? 'abonnes' : 'abonnements')
        .then((r) => {
          if (vivant) setGens(r.gens);
        })
        .catch((e) => {
          if (vivant) setErreur(e instanceof Error ? e.message : 'Liste indisponible');
        });
      return () => {
        vivant = false;
      };
    }, [id, enAbonnes]),
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xl }}
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
          <Text style={styles.titre}>{enAbonnes ? 'Abonnés' : 'Abonnements'}</Text>
          <View style={styles.retour} />
        </View>

        {gens === null && erreur === null ? (
          <ActivityIndicator color={color.accent} style={styles.attente} />
        ) : erreur !== null ? (
          <Text style={styles.erreur}>{erreur}</Text>
        ) : (gens?.length ?? 0) === 0 ? (
          <Text style={styles.vide}>
            {enAbonnes ? 'Personne ne suit ce profil encore.' : 'Ce profil ne suit personne encore.'}
          </Text>
        ) : (
          <View style={styles.liste}>
            {gens!.map((g) => (
              <Pressable
                key={g.user_id}
                style={({ pressed }) => [styles.rang, pressed && styles.rangPresse]}
                onPress={() => {
                  vibrer.choix();
                  router.push(`/gens/${encodeURIComponent(g.user_id)}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Voir le profil de ${g.nom}`}
              >
                <Visage uri={g.avatar} taille={48} />
                <View style={styles.rangTexte}>
                  <Text style={styles.nom} numberOfLines={1}>
                    {g.nom || 'Sans nom'}
                  </Text>
                  <Text style={styles.sous} numberOfLines={1}>
                    {[g.handle ? `@${g.handle}` : null, `${g.gardes} gardé${g.gardes > 1 ? 's' : ''}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <IconeChevron couleur={color.textFaint} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
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
  rangTexte: { flex: 1, gap: 2 },
  nom: { ...type.lead, color: color.text },
  sous: { ...type.label, fontSize: 13, lineHeight: 18, color: color.textFaint },
});
