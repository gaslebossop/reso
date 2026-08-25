#!/usr/bin/env node
/**
 * Construit l'APK ici, sur ce poste, au lieu de le faire construire par EAS.
 *
 * ## Pourquoi
 *
 * Un build EAS coute une quinzaine de minutes dont une bonne moitie passe en
 * file d'attente, avant meme qu'une ligne soit compilee. Or l'immense majorite
 * des changements de ce depot ne touche **aucun code natif** : un badge, un
 * ecran, une couleur. Recompiler tout Android pour ca est un gachis, et
 * surtout un gachis qu'on paie en attente a chaque fois.
 *
 * Ici, un changement JS seul sort un APK en deux a quatre minutes : Gradle ne
 * refait que le bundle et le paquet.
 *
 * ## Les trois choses qui font la vitesse, et qu'il ne faut pas defaire
 *
 * 1. **`android/` n'est JAMAIS regenere de zero.** `expo prebuild` sans
 *    `--clean` met a jour ce qui a change et laisse le reste — donc les
 *    sorties de compilation natives restent valides. Passer `--clean` ramene a
 *    un build a froid, a chaque fois.
 * 2. **Les caches Gradle vivent dans `~/.gradle/gradle.properties`** — cache
 *    de build, cache de configuration, demon. Les ecrire dans le projet serait
 *    sans effet : `android/gradle.properties` est regenere par prebuild.
 * 3. **RNRepo** (`@rnrepo/expo-config-plugin`) substitue aux bibliotheques
 *    React Native des artefacts deja compiles au lieu de les batir depuis les
 *    sources. C'est ce qui coupe le cout du premier build, celui que les deux
 *    caches ci-dessus ne peuvent pas eviter.
 *
 * ## La signature n'est pas un detail
 *
 * Le projet Android genere par Expo signe sa variante `release` avec le
 * **keystore de debogage**. Un APK ainsi signe s'installe, mais Android
 * refusera ensuite toute mise a jour par-dessus un APK signe par EAS avec
 * `credentials/reso.jks` — et inversement. Deux cles differentes, c'est une
 * desinstallation forcee a chaque va-et-vient entre local et EAS.
 *
 * On resigne donc systematiquement avec `reso.jks`, apres coup, plutot que de
 * modifier `app/build.gradle` — que le prochain prebuild reecrirait.
 *
 * Usage : `npm run apk`
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const RACINE = resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';

/** Ce qu'un build Android pose sur le disque, **mesure sur ce poste** le
 *  2026-08-25 et non estime : un premier passage complet a consomme 7,4 Go
 *  (caches Gradle, AAR transformes, dossiers `.cxx`, sorties du NDK).
 *
 *  Les deux chiffres different parce que la depense n'est pas la meme : a
 *  froid tout est a poser, alors qu'un build suivant ne recompile que le
 *  module `app` et ne refait que le bundle. Un seuil unique a 15 Go —
 *  ce qu'il y avait ici d'abord — bloquait donc des builds incrementaux qui
 *  tiennent tres largement dans ce qui reste.
 *
 *  En dessous, le build echoue en pleine compilation avec une erreur qui ne
 *  parle jamais de disque. Refuser tout de suite coute moins cher qu'un
 *  diagnostic. */
const DISQUE_FROID_GO = 12;
const DISQUE_CHAUD_GO = 5;

const etape = (t) => console.log(`\n\x1b[36m> ${t}\x1b[0m`);

function sortir(message) {
  console.error(`\n\x1b[31mX ${message}\x1b[0m\n`);
  process.exit(1);
}

/** Le SDK Android, a son emplacement par defaut selon la plateforme.
 *  `ANDROID_HOME` gagne s'il est pose — mais il ne l'est pas sur ce poste, et
 *  c'est la premiere chose qui fait echouer un build local. */
function sdk() {
  const pose = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (pose && existsSync(pose)) return pose;
  const defauts = WIN
    ? [join(homedir(), 'AppData', 'Local', 'Android', 'Sdk')]
    : [join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk')];
  const trouve = defauts.find((d) => existsSync(d));
  if (!trouve) sortir('SDK Android introuvable. Pose ANDROID_HOME sur son dossier.');
  return trouve;
}

/** Le `apksigner` le plus recent du SDK. Les versions sont comparees
 *  **numeriquement** : un tri de chaines mettrait 9.0.0 apres 36.0.0. */
function apksigner(sdkDir) {
  const dir = join(sdkDir, 'build-tools');
  if (!existsSync(dir)) sortir('Aucun build-tools dans le SDK Android.');
  const versions = readdirSync(dir)
    .filter((v) => /^\d+\./.test(v))
    .sort((a, b) => {
      const na = a.split('.').map(Number);
      const nb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
      }
      return 0;
    });
  if (versions.length === 0) sortir('build-tools vide.');
  const outil = join(dir, versions.at(-1), WIN ? 'apksigner.bat' : 'apksigner');
  if (!existsSync(outil)) sortir(`apksigner absent de build-tools/${versions.at(-1)}.`);
  return outil;
}

/** `statfs` plutot qu'un appel a `df` ou a PowerShell : meme code sur les deux
 *  plateformes, et aucune sortie a analyser. */
function disqueLibreGo() {
  try {
    const s = statfsSync(RACINE);
    return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
  } catch {
    return Infinity; // On ne bloque pas sur une mesure ratee.
  }
}

const lancer = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: RACINE, shell: WIN, ...options });

// ---------------------------------------------------------------------------

const froid = !existsSync(join(RACINE, 'android'));
const libre = disqueLibreGo();
const requis = froid ? DISQUE_FROID_GO : DISQUE_CHAUD_GO;
if (libre < requis) {
  sortir(
    `${libre.toFixed(1)} Go libres, il en faut au moins ${requis} ` +
      `(build ${froid ? 'a froid' : 'incremental'}).\n` +
      `  Un build Android echouerait en cours de compilation, avec une erreur\n` +
      `  qui ne mentionnerait pas le disque. Libere de la place et relance.`
  );
}

const SDK = sdk();
process.env.ANDROID_HOME = SDK;
process.env.ANDROID_SDK_ROOT = SDK;
console.log(`SDK Android  : ${SDK}`);
console.log(`Disque libre : ${libre === Infinity ? 'non mesure' : `${libre.toFixed(1)} Go`}`);

etape(froid ? 'Generation du projet Android (premier passage, long)' : 'Mise a jour du projet Android');
// **Sans `--clean`.** C'est toute la difference entre deux minutes et quinze.
lancer('npx', ['expo', 'prebuild', '--platform', 'android']);

etape('Compilation');
// Le lanceur est donne par son **chemin absolu**. Sous Windows, `execFileSync`
// avec `shell: true` fait resoudre le nom par cmd, qui ne cherche pas dans le
// `cwd` qu'on lui a pose : un simple « gradlew.bat » echoue en
// « n'est pas reconnu en tant que commande interne ».
const ANDROID = join(RACINE, 'android');
// **`:app:assembleRelease`, jamais `assembleRelease` tout court.** Sans le
// prefixe de module, Gradle declenche la tache de chaque sous-projet
// independamment au lieu de passer par le graphe de dependances de l'app.
// Symptome mesure : `:react-native-reanimated:buildCMakeRelWithDebInfo`
// echoue en cherchant `libworklets.so` dans un dossier de variante que
// personne ne lui a demande de produire — dix-huit minutes pour rien.
lancer(join(ANDROID, WIN ? 'gradlew.bat' : 'gradlew'), [':app:assembleRelease', '--build-cache'], {
  cwd: ANDROID,
});

const brut = join(RACINE, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(brut)) sortir(`APK introuvable a ${brut}`);

etape('Signature avec credentials/reso.jks');
const cred = JSON.parse(readFileSync(join(RACINE, 'credentials.json'), 'utf8')).android.keystore;
const jks = join(RACINE, cred.keystorePath);
if (!existsSync(jks)) {
  sortir(
    `Keystore absent : ${jks}\n` +
      `  Sans lui l'APK resterait signe avec la cle de debogage, et Android\n` +
      `  refuserait de l'installer par-dessus une version venue d'EAS.`
  );
}

mkdirSync(join(RACINE, 'build'), { recursive: true });
const sortie = join(RACINE, 'build', 'reso.apk');
copyFileSync(brut, sortie);
lancer(apksigner(SDK), [
  'sign',
  '--ks',
  jks,
  '--ks-pass',
  `pass:${cred.keystorePassword}`,
  '--ks-key-alias',
  cred.keyAlias,
  '--key-pass',
  `pass:${cred.keyPassword}`,
  sortie,
]);

const mo = (statSync(sortie).size / 1024 ** 2).toFixed(1);
console.log(`\n\x1b[32mOK ${sortie}  (${mo} Mo)\x1b[0m`);
console.log(`   adb install -r "${sortie}"\n`);
