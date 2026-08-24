export type Artist = {
  id: number;
  name: string;
  picture: string;
};

export type Track = {
  id: number;
  isrc: string | null;
  title: string;
  artist: Artist;
  album: string;
  cover: string;
  /** URL MP3 30 s, SIGNEE ET EXPIRANTE — ne jamais persister telle quelle. */
  preview: string;
  /**
   * Les artistes invites, sans l'interprete principal.
   *
   * Deezer ne les met **pas** dans le titre : `/artist/top` rend « Rich Baby
   * Daddy », jamais « Rich Baby Daddy (feat. Sexyy Red & SZA) ». Le moteur les
   * lit dans `contributors` et les joint ici.
   *
   * Facultatif : un moteur anterieur au 2026-08-23 ne l'envoie pas, et une
   * carte tiree d'un cache plus ancien non plus. Dans ce cas l'app retombe sur
   * ce que le titre porte (`separerTitre`).
   */
  featuring?: string[];
  /**
   * La couleur dominante de la pochette, en `#rrggbb`.
   *
   * Calculee par le moteur et mise en cache : le fil s'en sert pour peindre
   * son fond, et pour choisir la couleur de son texte selon le contraste.
   * Absente quand la pochette n'a pas pu etre lue — l'ecran retombe alors sur
   * son noir.
   */
  couleur?: string | null;
  /**
   * Les deux extremites du degrade de fond, en `#rrggbb`.
   *
   * Une couleur seule ne fait pas un degrade : l'eclaircir puis l'assombrir ne
   * deplace que la clarte, et l'ecran se lit comme un aplat. Ces deux tons
   * viennent de la pochette et bougent en teinte. Absents d'un moteur plus
   * ancien : le fil sait alors les reconstituer, en moins bien.
   */
  couleur_haut?: string | null;
  couleur_bas?: string | null;
  duration_sec: number;
  rank: number;
  genre_id: number | null;
};

export type Card = {
  track: Track;
  score: number;
  facet_id: number;
  breakdown: {
    collaborative: number;
    facet_fit: number;
    discovery: number;
    exploration: number;
  };
  /** Phrase courte affichee sur la carte : pourquoi ce titre arrive. */
  reason: string;
};

export type SwipeAction = 'like' | 'skip' | 'save' | 'block';

/**
 * Ce que le moteur repond a un swipe.
 *
 * Volontairement maigre. Il rendait aussi le taux d'accroche, la part
 * d'exploration et les facettes — ce qui l'obligeait a rejouer le profil
 * entier a chaque carte, soit 840 ms par swipe sur une histoire de 65, mises
 * en file quand on swipe vite. Rien de tout cela n'etait affiche.
 */
export type EventResult = {
  /** Ce que le geste a valu au modele. Utile a tracer, a rien d'autre. */
  reward: number;
};

/** Qui le moteur croit que je suis.
 *
 *  `kind` vaut `anon` tant qu'aucun compte du reseau G n'est associe. C'est
 *  la seule facon fiable de le savoir : l'app peut porter un jeton perime
 *  sans s'en apercevoir. */
export type Me = {
  user_id: string;
  kind: 'anon' | 'g';
  name: string | null;
  email: string | null;
  picture: string | null;
};

export type PrismFacet = {
  id: number;
  mass: number;
  rate: number;
  artists: Artist[];
};

export type Prism = {
  user_id: string;
  name: string | null;
  events: number;
  hit_rate: number;
  exploration: number;
  facets: PrismFacet[];
};

/** Un artiste, avec le nombre de fois qu'il a suscite la meme decision. */
export type ArtistCount = {
  artist: Artist;
  count: number;
};

/**
 * Le portrait : ce que l'histoire dit de toi, pas ce que le moteur en pense.
 *
 * Volontairement disjoint de `Prism`. Celui-la porte l'etat du moteur — masses
 * et facettes — et sert a expliquer une recommandation ; celui-ci porte du
 * comportement, et aucun chiffre n'apparait dans les deux.
 */
export type Stats = {
  judged: number;
  saved: number;
  liked: number;
  skipped: number;
  blocked: number;
  /** Taille de la bibliotheque. Peut differer de `saved` : un titre garde
   *  deux fois ne compte qu'une, et la bibliotheque survit a un deblocage. */
  library: number;
  listened_ms: number;
  /** Mediane du temps mis a passer un titre. */
  verdict_ms: number;
  played_whole: number;
  first_at: number;
  last_at: number;
  active_days: number;
  /** 24 entiers, indexes par heure **UTC** — le serveur ignore ton fuseau.
   *  Voir `heuresLocales` dans `src/state/portrait.ts`. */
  hours_utc: number[];
  kept_artists: ArtistCount[];
  passed_artists: ArtistCount[];
};

/** Les reglages qui vivent sur le serveur (les autres sont locaux). */
export type Prefs = {
  /** Ce qui a ete demande a la main. `null` = le moteur decide. */
  discovery: number | null;
  /** Ce qui s'applique vraiment en ce moment. */
  discovery_now: number;
  discovery_min: number;
  discovery_max: number;
};

/**
 * Un profil rendu par la recherche sociale.
 *
 * Volontairement maigre — nom, @handle, avatar, nombre de gardes. Le moteur ne
 * rend ni email, ni historique, ni quoi que ce soit que le swipe a appris.
 */
export type Gen = {
  user_id: string;
  handle: string;
  nom: string;
  avatar: string;
  gardes: number;
};

/**
 * Le profil public d'un compte : ce qu'il garde, ce qu'il aime, qui le suit.
 *
 * `visible` n'est rendu que sur son propre profil — c'est l'etat de la
 * bascule. Sur celui des autres, il vaut vrai par construction : un profil
 * cache repond 404, pas « visible: false ».
 *
 * `commun` n'est rendu que sur le profil des autres : ce sont les titres que
 * les deux comptes ont gardes — la seule section qui parle des deux.
 */
export type ProfilSocial = {
  id: string;
  handle: string;
  nom: string;
  avatar: string;
  visible: boolean;
  total: number;
  abonnes: number;
  abonnements: number;
  /** Est-ce que MOI suis ce profil ? Toujours faux sur le sien. */
  suivi: boolean;
  gardes: Track[];
  commun: Track[];
  commun_total: number;
  /** Les artistes les plus aimes, du plus consensuel au plus personnel. */
  artistes: { name: string; count: number }[];
};

/** Un nouvel abonne, ou un titre qu'on t'a repris. Le moteur n'en invente pas
 *  d'autres : ce sont les deux seuls faits que la base porte avec une date. */
export type Notif = {
  genre: 'abonne' | 'match';
  /** Millisecondes epoch. */
  at: number;
  gen: Gen;
  /** Le titre repris. Nul sur un abonnement. */
  track: Track | null;
};

/**
 * Ce que rend `/social/notifs`.
 *
 * `nouvelles` est **calcule par le moteur**, pas par l'app : c'est lui qui
 * sait quand la liste a ete lue pour la derniere fois, et decider cote
 * telephone donnerait un compteur different d'un appareil a l'autre.
 */
export type Notifs = {
  notifs: Notif[];
  nouvelles: number;
  vues_at: number | null;
};
