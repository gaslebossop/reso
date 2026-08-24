import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageStyle } from 'expo-image';

import { IconePersonne } from './Icones';
import { color } from '../theme/tokens';

/**
 * Le visage d'un compte — ou ce qui en tient lieu.
 *
 * ## Pourquoi ca vit dans un seul fichier
 *
 * Un avatar est rendu a cinq endroits : la carte de visite, les resultats de
 * recherche, la rangee des abonnements, la liste des abonnes, les
 * notifications, le profil public. Chacun le faisait a sa facon, et **aucun
 * n'avait de repli** sauf les reglages, qui affichaient une initiale. Resultat
 * sur un reseau ou presque personne n'a mis de photo : des trous. Un carre de
 * fond sombre sur un fond sombre, invisible, avec le nom decale a cote de
 * rien.
 *
 * ## Pourquoi une silhouette et pas l'initiale
 *
 * L'initiale renseigne davantage, mais elle ne renseigne sur rien qui ne soit
 * deja ecrit : partout ou ce composant apparait, le nom est a cote ou juste
 * en dessous. La silhouette, elle, dit une chose que le nom ne dit pas —
 * **cette personne n'a pas mis de photo** — et c'est le signe que tout le
 * monde reconnait sans l'avoir appris.
 *
 * ## Le repli sert aussi de fond
 *
 * Le meme aplat est pose sous l'image quand il y en a une : une pochette qui
 * arrive en fondu depuis un trou noir clignote, depuis un aplat elle se
 * substitue.
 */
export function Visage({
  uri,
  taille,
  style,
}: {
  /** L'adresse de la photo. Une chaine vide compte comme absente — c'est ce
   *  que rend le moteur pour un compte sans image. */
  uri?: string | null;
  taille: number;
  /** Marges et decalages seulement : la taille et le rayon viennent de
   *  `taille`. Le type couvre les deux natures parce que le repli est une
   *  `View` et la photo une `Image`, et que leurs `overflow` ne se recouvrent
   *  pas exactement cote types. */
  style?: StyleProp<ViewStyle & ImageStyle>;
}) {
  const rond = { width: taille, height: taille, borderRadius: taille / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.visage, rond, style]}
        contentFit="cover"
        transition={160}
        cachePolicy="memory-disk"
        recyclingKey={uri}
      />
    );
  }

  return (
    <View style={[styles.visage, styles.vide, rond, style]}>
      {/* Pleine taille, sans marge : la silhouette est dessinee pour que le
          rond lui rogne les epaules. Lui laisser de l'air la ferait flotter au
          milieu, ce qui se lit comme une image cassee et non comme un repli. */}
      <IconePersonne couleur={SILHOUETTE} taille={taille} />
    </View>
  );
}

/** Le gris du repli. Plus clair que `bgElevated`, qui se confond avec le fond
 *  de page : un rond qu'on ne distingue pas du noir ne dit pas qu'il y a une
 *  place pour une photo, il dit qu'il manque quelque chose. */
const FOND_VIDE = '#1E1E24';
const SILHOUETTE = '#54545E';

const styles = StyleSheet.create({
  visage: { backgroundColor: color.bgElevated },
  vide: {
    backgroundColor: FOND_VIDE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
