import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import type { Track } from '../api/types';
import { color } from '../theme/tokens';

/**
 * Le mur des deux écrans d'ouverture : **la cale de disques**.
 *
 * Des dizaines de pochettes posées bord à bord, sans jointure, du bord gauche
 * au bord droit — la matière même de l'application, celle que la personne
 * jugera carte par carte dix secondes plus tard. Le composant ne sait faire
 * qu'une chose, et ne dit rien : pas de texte, pas de dégradé. Ce qui se pose
 * sur le mur appartient à l'écran — la phrase posée dans une assise sombre
 * côté accueil, la porte pleine côté réseau G.
 *
 * ## Ce qui rend un mur supportable alors qu'il avait déjà été rejeté
 *
 * Le mur de portraits rejeté au tout début coûtait une soixantaine d'images
 * plein format et **ne s'affichait qu'une fois la grille entière arrivée** —
 * noir, puis remplissage tuile par tuile. C'est cette attente-là qui était
 * intolérable, pas l'idée du mur. Trois règles l'évitent ici :
 *
 * 1. **Rien n'attend rien.** Les cellules sont posées dès le premier rendu,
 *    en teinte d'élévation ; chaque pochette fond au fil de son arrivée. Sur
 *    un réseau mort, le mur reste une grille calme — l'écran est complet,
 *    il lui manque des photos.
 * 2. **Le poids est coupé par quatre à la source.** Deezer sert ses
 *    pochettes en tailles fixes codées dans l'URL ; une cellule n'a jamais
 *    besoin du `500x500` que porte `Track.cover`, le `250x250` suffit et
 *    `pochetteLegere` le demande.
 * 3. **Priorité basse.** Le texte et les boutons se rendent avant les images ;
 *    un mur ne doit jamais voler la première seconde à la phrase qu'on lit.
 */

/** Taille CDN demandée pour une cellule de mur. */
const TAILLE_CELLULE = 250;

/**
 * Demande la version légère d'une pochette Deezer.
 *
 * Les URL portent la taille dans leur chemin (`…/500x500-000000-80-0-0.jpg`)
 * et le CDN sert tous les formats standards à la même adresse. Une URL qui ne
 * suit pas ce motif est rendue telle quelle : mieux vaut une image lourde
 * qu'une image absente.
 */
export function pochetteLegere(url: string): string {
  return url.replace(/\/\d+x\d+-/, `/${TAILLE_CELLULE}x${TAILLE_CELLULE}-`);
}

export function MurAccueil({ tracks }: { /** Les pochettes du mur, en vrac — le moteur les a déjà mélangées. */ tracks: Track[] }) {
  const { width, height } = useWindowDimensions();
  // Densité constante d'un appareil à l'autre : une cellule fait ~108 pt,
  // donc 4 colonnes sur un téléphone, davantage sur tablette.
  const colonnes = Math.max(4, Math.round(width / 108));
  const cote = width / colonnes;
  const rangees = Math.ceil(height / cote) + 1;
  const manquantes = colonnes * rangees;

  return (
    <View style={styles.mur} pointerEvents="none">
      {/* Les cellules vides d'abord : elles dessinent le mur avant ses
          photos, et restent visibles partout où une pochette n'est jamais
          arrivée. */}
      <View style={styles.mur}>
        {Array.from({ length: manquantes }, (_, i) => (
          <View key={i} style={[styles.celluleFantome, { width: cote, height: cote }]} />
        ))}
      </View>

      <View style={styles.mur}>
        {tracks.map((t) => (
          <Image
            key={t.id}
            source={{ uri: pochetteLegere(t.cover) }}
            style={{ width: cote, height: cote }}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="low"
            transition={260}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mur: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    overflow: 'hidden',
    backgroundColor: color.bg,
  },
  celluleFantome: { backgroundColor: color.bgElevated },
});
