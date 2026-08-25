import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prisme } from '../../../src/api/client';
import { fansLisibles } from '../../../src/api/titre';
import type { Artist, Gen } from '../../../src/api/types';
import { IconeChevron, IconeRetour } from '../../../src/components/Icones';
import { NomVerifie } from '../../../src/components/NomVerifie';
import { Visage } from '../../../src/components/Visage';
import { vibrer } from '../../../src/state/vibration';
import { color, radius, space, type } from '../../../src/theme/tokens';

/**
 * La liste derriere un compteur : les abonnes, ou les abonnements.
 *
 * Une regle vient du moteur et tient tout l'ecran : les profils caches
 * n'y figurent pas. Suivre quelqu'un — ou etre suivi — ne donne aucun
 * droit sur les gens qui ont choisi de disparaitre.
 *
 * ## Un abonnement n'est pas forcement quelqu'un
 *
 * On suit des gens et on suit des artistes, du meme geste et depuis le meme
 * bouton. La liste ne montrait pourtant que les gens : un artiste suivi
 * n'apparaissait nulle part sous « abonnements », et le compteur ne le
 * comptait pas non plus — suivre un artiste ne laissait donc aucune trace
 * dans l'endroit meme ou l'on va chercher ce qu'on suit.
 *
 * Les deux natures se suivent maintenant dans la meme liste, dans cet ordre :
 * les profils, puis les artistes. Meme ordre que la recherche de l'onglet
 * « Les gens », et pour la meme raison — c'est un ecran de gens, et quelqu'un
 * qui cherche un @ ne doit pas defiler sous une discographie.
 *
 * **Les titres de section n'apparaissent que quand il y a bien deux natures a
 * distinguer.** Une seule liste n'a pas besoin qu'on la nomme, et un titre
 * « Profils » au-dessus des seuls profils est du bruit.
 *
 * La forme dit deja laquelle on regarde avant que le titre soit lu : visage
 * rond pour un profil, portrait carre a coins arrondis pour un artiste. C'est
 * ce qui permet aux deux listes de se suivre sans se confondre.
 *
 * Cote abonnes, rien ne change : un artiste n'est pas un compte, il ne suit
 * personne, et le moteur rend toujours une liste d'artistes vide.
 */
export default function GensDeProfil() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: brut, type: quoi } = useLocalSearchParams<{ id?: string; type?: string }>();
  const id = typeof brut === 'string' ? decodeURIComponent(brut) : '';
  const enAbonnes = quoi !== 'abonnements';

  const [gens, setGens] = useState<Gen[] | null>(null);
  /** Les artistes suivis. Vide cote abonnes, et vide aussi si le moteur est
   *  d'une version anterieure — dans les deux cas l'ecran retombe sur la
   *  liste de gens seule, sans rien casser. */
  const [artistes, setArtistes] = useState<Artist[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivant = true;
      setErreur(null);
      prisme
        .gensDuProfil(id, enAbonnes ? 'abonnes' : 'abonnements')
        .then((r) => {
          if (!vivant) return;
          setGens(r.gens);
          setArtistes(r.artistes ?? []);
        })
        .catch((e) => {
          if (vivant) setErreur(e instanceof Error ? e.message : 'Liste indisponible');
        });
      return () => {
        vivant = false;
      };
    }, [id, enAbonnes]),
  );

  const charge = gens === null || artistes === null;
  const combienGens = gens?.length ?? 0;
  const combienArtistes = artistes?.length ?? 0;
  /** Deux natures a l'ecran : c'est la seule situation ou les titres de
   *  section apprennent quelque chose. */
  const melange = combienGens > 0 && combienArtistes > 0;

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

        {charge && erreur === null ? (
          <ActivityIndicator color={color.accent} style={styles.attente} />
        ) : erreur !== null ? (
          <Text style={styles.erreur}>{erreur}</Text>
        ) : combienGens === 0 && combienArtistes === 0 ? (
          <Text style={styles.vide}>
            {enAbonnes
              ? 'Personne ne suit ce profil encore.'
              : 'Ce profil ne suit encore personne, ni aucun artiste.'}
          </Text>
        ) : (
          <>
            {combienGens > 0 ? (
              <View style={styles.bloc}>
                {melange ? <Text style={styles.sectionTitre}>Profils</Text> : null}
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
                        <NomVerifie
                          nom={g.nom || 'Sans nom'}
                          verifie={g.verifie}
                          style={styles.nom}
                        />
                        <Text style={styles.sous} numberOfLines={1}>
                          {[
                            g.handle ? `@${g.handle}` : null,
                            `${g.gardes} gardé${g.gardes > 1 ? 's' : ''}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <IconeChevron couleur={color.textFaint} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {combienArtistes > 0 ? (
              <View style={styles.bloc}>
                {melange ? <Text style={styles.sectionTitre}>Artistes</Text> : null}
                <View style={styles.liste}>
                  {artistes!.map((a) => {
                    const fans = fansLisibles(a.fans);
                    return (
                      <Pressable
                        key={a.id}
                        style={({ pressed }) => [styles.rang, pressed && styles.rangPresse]}
                        onPress={() => {
                          vibrer.choix();
                          router.push(`/artiste/${a.id}`);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Voir la fiche de ${a.name}`}
                      >
                        <Image
                          source={{ uri: a.picture }}
                          style={styles.portrait}
                          contentFit="cover"
                          transition={160}
                          cachePolicy="memory-disk"
                          recyclingKey={String(a.id)}
                        />
                        <View style={styles.rangTexte}>
                          <NomVerifie nom={a.name} verifie={a.verifie} style={styles.nom} />
                          {fans ? (
                            <Text style={styles.sous} numberOfLines={1}>
                              {fans} sur Deezer
                            </Text>
                          ) : null}
                        </View>
                        <IconeChevron couleur={color.textFaint} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </>
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

  bloc: { marginTop: space.lg },
  sectionTitre: { ...type.label, color: color.textMuted, letterSpacing: 0.4 },
  liste: { marginTop: space.xs },
  portrait: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.bgElevated },
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
