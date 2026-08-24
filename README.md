# Reso

Une app de swipe pour découvrir de la musique. Tu écoutes un extrait, tu
glisses. Le moteur [Prisme](../prisme) apprend à chaque geste.

## Démarrer

Le moteur doit tourner d'abord.

```bash
# 1. dans ../prisme
sbt run

# 2. ici
npx expo start
```

Sur un **appareil physique**, `localhost` désigne le téléphone lui-même. Il
faut pointer vers l'IP de ton poste :

```bash
# .env
EXPO_PUBLIC_PRISME_URL=http://192.168.1.42:4400
```

(`ipconfig` pour trouver l'adresse.)

## Les gestes

| Geste | Effet |
|---|---|
| glisser à droite | j'aime |
| glisser à gauche | je passe |
| glisser vers le haut | je garde |
| bouton ⊘ | ne plus jamais proposer cet artiste |

Les boutons du bas font la même chose que les gestes. Ils ne sont pas
redondants : ils servent quand on tient le téléphone d'une main, et ils
enseignent les gestes à qui ne les connaît pas.

## Les écrans

- **Onboarding** — choisir au moins 3 artistes. L'ordre compte : le premier
  choisi pèse davantage.
- **Fil** — la pile de cartes, l'extrait démarre tout seul.
- **Gardes** — les titres sauvegardés, ouvrables dans Deezer.
- **Ton Prisme** — tes facettes de goût, telles que le moteur les a comprises.

## Deux règles qui tiennent l'expérience

**Jamais de file vide.** `useFeed` recharge dès qu'il reste quatre cartes, en
tâche de fond. L'utilisateur ne voit aucun écran d'attente.

**Jamais de silence.** Les trois extraits suivants sont préparés avant
d'arriver à l'écran (`src/audio/player.ts`). Une seconde de chargement entre
deux cartes suffit à casser la boucle de swipe.

## Structure

```
app/                 routes (expo-router)
  onboarding.tsx     choix des artistes de départ
  (tabs)/index.tsx   le fil de swipe
  (tabs)/library.tsx les titres gardés
  (tabs)/prism.tsx   les facettes de goût
src/
  api/               client HTTP de Prisme
  audio/player.ts    lecture + préchargement des extraits
  components/        SwipeCard, ActionBar, ProgressRing
  state/             identité locale, hook du fil
  theme/tokens.ts    couleurs, espacements, courbes
```

## Notes de conception

**Pas de comptes.** Un identifiant aléatoire généré au premier lancement suffit
à porter un profil de goût. Pas d'email, pas de mot de passe, rien à fuiter. Le
prix : un profil ne suit pas d'un appareil à l'autre. Un compte pourra être
ajouté plus tard en rattachant cet identifiant.

**L'écran est noir et la pochette est la seule couleur.** Une app d'écoute doit
disparaître derrière la musique ; tout chrome coloré entre en concurrence avec
l'artwork, qui est justement ce qu'on demande de juger.

**Le son se coupe en arrière-plan.** Une app musicale qui continue à jouer
seule dans une poche est désinstallée le jour même.

## Sur appareil, à vérifier

Ces choses ne se jugent pas depuis le code :

- lancer une carte d'un geste bref — le seuil de vitesse doit suffire, sans
  avoir à traverser tout l'écran ;
- interrompre une carte en plein vol et la ramener ;
- l'haptique doit tomber sur la **même image** que la validation visuelle ;
- l'enchaînement de deux cartes doit être sans blanc sonore ;
- tout cela sur le téléphone Android le plus lent disponible, en build
  release — Expo Go masque exactement les problèmes qu'on cherche.

## Pile

Expo SDK 57 · React Native 0.86 (nouvelle architecture) · expo-router ·
Reanimated 4 · Gesture Handler · expo-audio · expo-image.
