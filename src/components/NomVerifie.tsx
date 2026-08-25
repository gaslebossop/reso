import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { IconePastilleVerifiee } from './Icones';

/**
 * Un nom, et la pastille verifiee quand elle est due.
 *
 * ## Pourquoi un composant et pas trois lignes recopiees
 *
 * Le nom d'un compte ou d'un artiste est affiche a **huit** endroits — la
 * carte de visite, la recherche, le profil public, les abonnes, les
 * abonnements, la fiche artiste, l'ajout a la main, l'onboarding. Le badge
 * recopie a la main aurait manque a l'un d'eux, et le premier symptome aurait
 * ete un artiste marque dans la recherche et nu sur sa propre fiche — ce qui
 * ne se lit pas comme un oubli mais comme une erreur de l'app.
 *
 * ## Pourquoi une rangee et pas un `<Text>` imbrique
 *
 * La pastille est un SVG, et React Native n'accepte pas de SVG dans un `Text`.
 * D'ou la rangee, avec `flexShrink` sur le texte : c'est le nom qui se tronque
 * quand la place manque, jamais la pastille — un badge a moitie sorti de
 * l'ecran ne dit plus rien, alors qu'un nom coupe reste lisible.
 *
 * `alignItems: 'center'` : sur un nom qui tient sur deux lignes, la pastille
 * se pose a mi-hauteur du bloc plutot qu'a la fin du dernier mot. C'est le
 * seul placement stable quand on ne sait pas d'avance combien de lignes le
 * nom prendra.
 */
export function NomVerifie({
  nom,
  verifie,
  style,
  ligne,
  taille = 14,
  numberOfLines = 1,
}: {
  nom: string;
  /** Facultatif : un moteur d'une version anterieure ne rend pas le drapeau,
   *  et l'absence vaut « non verifie » — donc aucune pastille, exactement ce
   *  que l'ecran faisait avant. */
  verifie?: boolean;
  /** Le style du texte. La troncature vient d'ici, pas de l'appelant. */
  style?: StyleProp<TextStyle>;
  /** Le style de la rangee : c'est la qu'on centre, qu'on aligne a gauche ou
   *  qu'on pose une marge. */
  ligne?: StyleProp<ViewStyle>;
  taille?: number;
  numberOfLines?: number;
}) {
  return (
    <View style={[styles.ligne, ligne]}>
      <Text style={[styles.nom, style]} numberOfLines={numberOfLines}>
        {nom}
      </Text>
      {verifie ? (
        // « Vérifié » et non « compte vérifié » : la meme pastille sert aux
        // profils et aux artistes, et le lecteur d'ecran vient de dire lequel
        // des deux en lisant le nom juste avant.
        <View accessible accessibilityLabel="Vérifié">
          <IconePastilleVerifiee taille={taille} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  /** `flexShrink` et non `flex: 1` : un nom court ne doit pas pousser la
   *  pastille au bout de la rangee, il doit la garder collee a lui. */
  nom: { flexShrink: 1 },
});
