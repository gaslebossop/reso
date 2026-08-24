import { prisme } from '../api/client';
import type { Track } from '../api/types';

/**
 * La pochette des deux écrans d'ouverture, demandée une seule fois.
 *
 * Même rôle que `catalogue.ts`, pour une matière bien plus légère : **trois**
 * pochettes au lieu de trente-six portraits. L'accueil les demande, la porte du
 * réseau G les retrouve déjà là — c'est ce qui fait que les deux écrans
 * montrent la même pile et se lisent comme un seul.
 *
 * Le cache vit le temps de l'application. Le moteur tire un genre au sort à
 * chaque appel : le figer ici serait dommage, le refaire à chaque montage
 * changerait la pochette en pleine transition entre les deux écrans.
 */
let enCours: Promise<Track[]> | null = null;

export function pochettesAccueil(): Promise<Track[]> {
  if (enCours) return enCours;
  enCours = prisme
    .accueil()
    .then((r) => r.tracks)
    .catch(() => {
      // Des pochettes absentes ne sont pas une panne : la pile garde sa forme
      // et son texte. On remet à zéro pour qu'un simple retour en arrière
      // puisse les retenter, sans jamais rien dire à l'écran.
      enCours = null;
      return [];
    });
  return enCours;
}
