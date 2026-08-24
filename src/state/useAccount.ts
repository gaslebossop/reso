import { useEffect, useMemo, useState } from 'react';

import { getAuthConfig, prisme } from '../api/client';
import type { Me } from '../api/types';
import { GNetworkError, isSignedIn, signIn, signOut } from '../auth/gnetwork';
import { oublierNotifs } from './notifs';

/**
 * L'etat de connexion au reseau G — **un seul, pour toute l'application**.
 *
 * C'etait un `useState` par ecran. Chaque onglet portait donc sa propre idee de
 * qui vous etes, et les onglets ne se demontent pas : se connecter depuis
 * « Gardes » laissait « Prisme » sur l'etat qu'il avait au premier affichage,
 * c'est-a-dire deconnecte, jusqu'a un rechargement complet de l'app.
 *
 * La verite reste cote moteur — un jeton peut avoir ete revoque depuis un
 * autre appareil sans que le telephone en sache rien — mais elle n'est
 * demandee qu'une fois, et tous les ecrans lisent la meme reponse.
 *
 * Le second effet compte autant : les fonctions rendues par `useAccount` sont
 * **stables**, et l'objet ne change d'identite que lorsque l'etat change
 * vraiment. Elles etaient recreees a chaque rendu, ce qui suffisait a relancer
 * les `useCallback` qui en dependent, donc les effets qui en dependent, donc
 * les requetes — en boucle, tant que l'onglet restait monte.
 */
export type AccountState = {
  me: Me | null;
  loading: boolean;
  /** Vrai pendant l'aller-retour vers la page de connexion. */
  busy: boolean;
  error: string | null;
  connected: boolean;
};

let etat: AccountState = {
  me: null,
  loading: true,
  busy: false,
  error: null,
  connected: false,
};

const abonnes = new Set<(e: AccountState) => void>();

/**
 * Publie un nouvel etat.
 *
 * Rien n'est publie si rien n'a bouge : un `/me` qui reconfirme ce qu'on
 * savait deja ne doit reveiller aucun ecran, sans quoi le rafraichissement
 * ramene le probleme qu'il devait resoudre.
 */
function poser(patch: Partial<AccountState>) {
  const suivant = { ...etat, ...patch };
  if (
    suivant.me === etat.me &&
    suivant.loading === etat.loading &&
    suivant.busy === etat.busy &&
    suivant.error === etat.error &&
    suivant.connected === etat.connected
  ) {
    return;
  }
  etat = suivant;
  for (const prevenir of abonnes) prevenir(etat);
}

/**
 * File d'attente des rafraichissements.
 *
 * Serialisee, et non dedoublonnee : une demande emise **apres** une connexion
 * doit voir le nouveau jeton, alors que la partager avec une demande partie
 * avant rendrait l'ancienne reponse — l'app se croirait encore anonyme juste
 * apres s'etre connectee.
 */
let file: Promise<void> = Promise.resolve();

async function interroger(): Promise<void> {
  try {
    const me = await prisme.me();
    poser({ me, connected: me.kind === 'g', loading: false, error: null });
  } catch {
    // Le moteur injoignable n'est pas une deconnexion : on garde ce qu'on
    // sait plutot que d'afficher un ecran de connexion trompeur.
    const local = await isSignedIn();
    poser({ loading: false, connected: etat.connected || local });
  }
}

export function refreshAccount(): Promise<void> {
  file = file.then(interroger, interroger);
  return file;
}

export async function connectAccount(): Promise<void> {
  poser({ busy: true, error: null });
  try {
    const cfg = await getAuthConfig();
    const account = await signIn(cfg);
    // `null` = fenetre fermee. Ce n'est pas un echec, on ne dit rien.
    if (account) await refreshAccount();
    poser({ busy: false });
  } catch (e) {
    poser({
      busy: false,
      error: e instanceof GNetworkError ? e.message : 'La connexion a echoue.',
    });
  }
}

export async function disconnectAccount(): Promise<void> {
  await signOut();
  // Le compte de notifications du precedent n'a rien a faire sur l'onglet du
  // suivant : la pastille survivrait a la deconnexion, puisque les onglets ne
  // se demontent jamais.
  oublierNotifs();
  await refreshAccount();
}

/** Vrai des que quelqu'un a demande au moteur qui nous sommes. */
let amorce = false;

export function useAccount() {
  const [vu, setVu] = useState(etat);

  useEffect(() => {
    abonnes.add(setVu);
    // L'etat a pu changer entre le premier rendu et cet abonnement.
    setVu(etat);
    if (!amorce) {
      amorce = true;
      void refreshAccount();
    }
    return () => {
      abonnes.delete(setVu);
    };
  }, []);

  // `vu` ne change d'identite qu'avec l'etat, et les trois actions sont des
  // fonctions de module : l'objet rendu est donc stable entre deux rendus, et
  // peut servir de dependance sans relancer quoi que ce soit.
  return useMemo(
    () => ({
      ...vu,
      connect: connectAccount,
      disconnect: disconnectAccount,
      refresh: refreshAccount,
    }),
    [vu],
  );
}
