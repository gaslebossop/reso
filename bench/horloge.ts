/**
 * Horloge virtuelle.
 *
 * Le banc doit etre deterministe et instantane : le lecteur raisonne en
 * dizaines de millisecondes (`SUSTAIN_TICK_MS`, le delai de coupure natif de
 * 100 ms), et une seule seconde de decalage sur un vrai `setInterval` suffit a
 * faire passer un banc rouge au vert par hasard.
 *
 * On remplace donc les minuteries **avant** d'importer `player.ts` — d'ou le
 * `await import()` dans `fil.ts`.
 */

const vraiSetImmediate = globalThis.setImmediate;

type Tache = { id: number; a: number; periode: number | null; fn: () => void };

const taches = new Map<number, Tache>();
let suivant = 1;
let t = 0;

/** Base fixe pour `Date.now()` : les URLs d'extrait portent une peremption. */
export const EPOCH = 1_800_000_000_000;

export const horloge = {
  maintenant: () => t,

  installer() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = (fn: () => void, ms = 0) => {
      const id = suivant++;
      taches.set(id, { id, a: t + ms, periode: null, fn });
      return id;
    };
    g.setInterval = (fn: () => void, ms = 0) => {
      const id = suivant++;
      taches.set(id, { id, a: t + ms, periode: Math.max(1, ms), fn });
      return id;
    };
    g.clearTimeout = (id: number) => void taches.delete(id);
    g.clearInterval = (id: number) => void taches.delete(id);
    Date.now = () => EPOCH + t;
  },

  /** Avance le temps virtuel en executant tout ce qui tombe dans l'intervalle. */
  async avancer(ms: number) {
    const fin = t + ms;
    for (;;) {
      let p: Tache | null = null;
      for (const x of taches.values()) {
        if (x.a > fin) continue;
        if (!p || x.a < p.a || (x.a === p.a && x.id < p.id)) p = x;
      }
      if (!p) break;
      t = p.a;
      if (p.periode !== null) p.a = t + p.periode;
      else taches.delete(p.id);
      p.fn();
      await vider();
    }
    t = fin;
    await vider();
  },
};

/** Laisse filer les promesses en attente (le lecteur en enchaine plusieurs). */
export function vider(): Promise<void> {
  return new Promise((r) => vraiSetImmediate(() => vraiSetImmediate(r)));
}
