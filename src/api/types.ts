export type Artist = {
  id: number;
  name: string;
  picture: string;
  /**
   * Nombre d'abonnes Deezer. Ecarte les coquilles vides du catalogue —
   * doublons de distributeurs et fiches homonymes sans rien dedans, qui en
   * ont une poignee la ou le vrai artiste en a des milliers.
   *
   * Absent des artistes qui ne viennent pas d'une recherche.
   */
  fans?: number;
  /**
   * Deux titres phares, pour reconnaitre l'artiste.
   *
   * Le nombre de fans ne suffit pas a trancher entre deux artistes tres
   * connus qui se disputent la meme requete — « PNL » remonte Pink Floyd, et
   * les deux ont des millions d'abonnes. On reconnait un artiste a ce qu'il a
   * fait, pas a sa notoriete.
   *
   * Rendu par `/search/artists` seulement, et vide quand Deezer ne connait
   * aucun titre — ce qui est justement le signe d'une fiche creuse.
   */
  titres?: string[];
  /**
   * C'est la fiche principale pour ce nom.
   *
   * **Plus dessine nulle part — `verifie` a pris sa place.** Le drapeau
   * n'etait calculable que dans une recherche : il fallait le mot tape et le
   * groupe d'homonymes. Sur la fiche d'un artiste, ouverte depuis une carte
   * du fil, il n'y a ni l'un ni l'autre — le meme artiste portait donc la
   * pastille dans la liste de resultats et la perdait une fois sa fiche
   * ouverte. Un badge qui clignote d'un ecran a l'autre ne se lit plus comme
   * un fait.
   *
   * Le moteur continue de l'envoyer pour les APK deja installes, qui le
   * lisent encore.
   *
   * **Deezer n'expose aucune certification** : ce drapeau ne dit pas « compte
   * verifie », il dit « parmi les fiches qui portent ce nom, c'est celle-la
   * la vraie ». Le moteur ne le leve que sans ambiguite — la fiche doit
   * ecraser ses homonymes d'un facteur dix en abonnes ET avoir des titres.
   *
   * Aucune fiche ne le porte quand le doute subsiste : un badge qui se trompe
   * est pire que pas de badge, puisqu'on cesse alors de lire les titres.
   */
  principal?: boolean;

  /**
   * Le badge verifie.
   *
   * Dit « c'est bien lui », et rien d'autre — ni « il est bon », ni « il est
   * connu ». Le moteur le decide seul (`Verifies.scala`) a partir de deux
   * choses : une liste curee a la main, et un seuil d'abonnes Deezer
   * au-dessus duquel une fiche ne peut plus etre confondue avec un doublon de
   * distributeur.
   *
   * Facultatif : un moteur d'une version anterieure ne le rend pas, et
   * l'absence vaut « non verifie » — l'app n'affiche alors aucune pastille,
   * ce qui est exactement ce qu'elle faisait avant.
   */
  verifie?: boolean;
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
  /**
   * L'artiste principal est deja suivi.
   *
   * Porte par la carte et non recupere a part : le bouton doit etre dans le
   * bon etat des la premiere image. Une liste chargee de son cote le ferait
   * basculer sous les yeux une fraction de seconde apres, et un bouton qui
   * change tout seul se lit comme un appui qu'on n'a pas fait.
   *
   * Optionnel : un moteur anterieur au suivi ne l'envoie pas, et l'absence
   * doit valoir « pas suivi » plutot que casser la carte.
   */
  followed?: boolean;
  /**
   * Qui t'envoie ce titre, si c'est un ami qui te l'a partagé.
   *
   * Porté par la carte et non récupéré à part : la signature doit être dans
   * le bon état dès la première image, comme `followed` juste au-dessus.
   *
   * Sa présence change trois choses, et c'est tout : la ligne de mention
   * devient la signature, un « passer » n'est plus compté dans le goût, et
   * l'icône d'envoi disparaît — on ne renvoie pas un son qu'on vient de
   * recevoir sans l'avoir jugé.
   *
   * Optionnel : un moteur antérieur au partage ne l'envoie pas.
   */
  envoye_par?: Gen;
};

export type SwipeAction = 'like' | 'skip' | 'save' | 'block';

/**
 * Un ami, dans la feuille d'envoi.
 *
 * C'est un [[Gen]] plus une marque : `envoye` dit qu'il a **déjà reçu ce
 * titre-là de moi**. L'envoi est idempotent — un son, une personne, une fois —
 * donc la feuille doit le montrer avant le tap. Taper dans le vide et voir
 * « envoyé » alors que rien n'est parti serait pire que le doublon qu'on a
 * fermé.
 *
 * Faux partout quand la feuille est ouverte sans titre.
 */
export type Ami = Gen & { envoye?: boolean };

/**
 * Un geste passe, tel que l'historique le rend.
 *
 * `ms_played` est ce qui a ete reellement ecoute avant de trancher. Il est la
 * pour une raison precise : c'est souvent lui qui rappelle POURQUOI on a fait
 * ca — deux secondes, c'etait un reflexe ; vingt-cinq, c'etait un choix.
 */
export type GesteHistorique = {
  track: Track;
  action: SwipeAction;
  /** Millisecondes depuis l'epoque, cote serveur. */
  at: number;
  ms_played: number;
};

/**
 * La fiche d'un artiste.
 *
 * `abonnes` compte ceux qui le suivent **sur Reso**, et c'est un chiffre
 * different de `artist.fans`, qui vient de Deezer et se compte en millions.
 * Le premier dit « qui, autour de toi, ecoute ca » ; le second dit sa taille
 * dans le monde. Les deux sont vrais, ils ne repondent pas a la meme question.
 */
export type FicheArtiste = {
  artist: Artist;
  tracks: Track[];
  abonnes: number;
  suivi: boolean;
};

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

  /**
   * Le badge verifie.
   *
   * Dit « c'est bien lui », et rien d'autre — ni « il est bon », ni « il est
   * connu ». Le moteur le decide seul (`Verifies.scala`) a partir de deux
   * choses : une liste curee a la main, et un seuil d'abonnes Deezer
   * au-dessus duquel une fiche ne peut plus etre confondue avec un doublon de
   * distributeur.
   *
   * Facultatif : un moteur d'une version anterieure ne le rend pas, et
   * l'absence vaut « non verifie » — l'app n'affiche alors aucune pastille,
   * ce qui est exactement ce qu'elle faisait avant.
   */
  verifie?: boolean;
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

/**
 * Ce qu'une personne a fait d'un titre : elle l'a **garde** (il est entre en
 * bibliotheque, c'est le geste fort) ou elle l'a **aime** (un swipe a droite,
 * qui ne range rien).
 */
export type Geste = 'garde' | 'aime';

/**
 * Un titre en commun, et ce que chacun en a fait.
 *
 * Les deux gestes manquaient, et l'ecran qui montre ces titres un par un
 * ecrivait donc la meme phrase pour tout le monde. `moi` et `autre` sont
 * facultatifs : un moteur d'une version anterieure ne les rend pas, et
 * l'ecran retombe alors sur sa phrase d'avant.
 */
export type TrackCommun = Track & { moi?: Geste; autre?: Geste };
export type ProfilSocial = {
  id: string;
  handle: string;
  nom: string;
  avatar: string;

  /**
   * Le badge verifie.
   *
   * Dit « c'est bien lui », et rien d'autre — ni « il est bon », ni « il est
   * connu ». Le moteur le decide seul (`Verifies.scala`) a partir de deux
   * choses : une liste curee a la main, et un seuil d'abonnes Deezer
   * au-dessus duquel une fiche ne peut plus etre confondue avec un doublon de
   * distributeur.
   *
   * Facultatif : un moteur d'une version anterieure ne le rend pas, et
   * l'absence vaut « non verifie » — l'app n'affiche alors aucune pastille,
   * ce qui est exactement ce qu'elle faisait avant.
   */
  verifie?: boolean;
  visible: boolean;
  total: number;
  abonnes: number;
  abonnements: number;
  /** Est-ce que MOI suis ce profil ? Toujours faux sur le sien. */
  suivi: boolean;
  gardes: Track[];
  commun: TrackCommun[];
  commun_total: number;
  /** Les artistes les plus aimes, du plus consensuel au plus personnel. */
  artistes: { name: string; count: number }[];
  /**
   * Les artistes que ce compte a choisi de suivre, du plus recent au plus
   * ancien, plafonnes a douze cote moteur.
   *
   * Fiches completes, contrairement a `artistes` qui n'a que des noms : cette
   * section-la porte des portraits.
   *
   * Optionnel : un moteur anterieur au suivi ne l'envoie pas, et l'absence
   * doit valoir « rien a montrer » plutot que casser l'ecran.
   */
  suivis?: Artist[];
};

/**
 * Ce qui s'est passé pendant qu'on n'était pas là.
 *
 * Quatre genres, et le moteur n'en invente pas d'autres : ce sont les seuls
 * faits que la base porte déjà avec une date. Ils sont **dérivés**, jamais
 * écrits — d'où le fait qu'aucun ne puisse mentir.
 *
 * `partage_aime` et `partage_garde` disent ce qu'un ami a fait du son qu'on lui
 * a envoyé. **Les deux, et pas seulement le second** : un « j'aime » ne range
 * rien en bibliothèque, et s'en tenir au gardé rendait invisible le geste le
 * plus fréquent des deux. Ils restent distincts parce que garder et aimer ne
 * racontent pas la même rencontre — c'est déjà la règle de l'écran des titres
 * en commun. Un envoi ne produit qu'une notification, celle du geste le plus
 * fort.
 *
 * Il n'y a pas de pendant négatif, et c'est délibéré : dire à quelqu'un qu'on
 * a zappé son morceau est une petite cruauté gratuite.
 *
 * Un genre inconnu doit être **ignoré**, pas affiché : un moteur plus récent
 * que l'app en enverrait un que celle-ci ne sait pas écrire.
 */
export type Notif = {
  genre: 'abonne' | 'match' | 'partage_recu' | 'partage_aime' | 'partage_garde';
  /** Millisecondes epoch. */
  at: number;
  gen: Gen;
  /** Le titre repris, reçu ou gardé. Nul sur un abonnement. */
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

/**
 * Une invitation a mixer les gouts, en attente.
 *
 * `gen` porte celui qui a envoye si c'est une invitation recue, celui qui la
 * recevra si c'est une envoyee — le moteur ne rend jamais les deux cotes,
 * l'ecran sait deja lequel il affiche.
 */
export type MixInvite = {
  id: number;
  gen: Gen;
  /** Millisecondes epoch. */
  at: number;
};

/**
 * Un salon de mix, tel qu'il apparait dans la liste.
 *
 * `partenaire` peut etre nul si ce compte a disparu depuis — un salon reste
 * ouvert, il ne se ferme jamais tout seul.
 */
export type MixRoomResume = {
  room_id: number;
  partenaire: Gen | null;
  matches: number;
  matches_nouveaux: number;
};

/**
 * Un titre sur lequel vous avez tous les deux un verdict positif.
 *
 * `nouveau` dit si ce match est arrive apres la derniere fois que le salon a
 * ete ouvert — c'est lui qui pilote l'effet a l'ouverture.
 */
export type MixMatch = {
  track: Track;
  at: number;
  nouveau: boolean;
};
