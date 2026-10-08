# Tableclub

Une table de cartes multijoueur libre, sobre et adaptée au mobile. **Aucun tour, aucune règle, aucune victoire ou pénalité automatique.** Les joueurs choisissent leurs propres règles de Président, 99, palmier, Uno ou d'un autre jeu.

## Ce que l'on peut faire

- Créer une table ou la rejoindre par code / lien, sans compte.
- Choisir 52 cartes classiques ou 108 cartes de type Uno, avec 1 à 4 paquets.
- Piocher librement, distribuer à chacun, poser face visible ou face cachée.
- Glisser les cartes sur la table, les retourner, les récupérer ou les défausser.
- Donner une carte à un autre joueur, remettre une carte sur la pioche.
- Mélanger la pioche, recycler la défausse, disposer jusqu'à 52 cartes en cercle.
- Utiliser un compteur libre, quitter, reprendre le salon ou remettre la table à zéro (hôte).
- Accueillir jusqu'à 100 participants dans une table. Prévoir assez de paquets selon le jeu.

Les mains ne sont visibles que par leur propriétaire. Une carte face cachée sur la table est cachée à tout le monde ; n'importe quel participant peut la retourner ou la prendre, comme autour d'une vraie table. L'interface rend automatiquement visible une carte posée normalement et propose aussi « Poser face cachée ».

## Démarrage local

Node.js 24 recommandé.

```sh
npm ci
npm run dev
```

Ouvrir http://localhost:3000 dans plusieurs navigateurs ou profils privés. Les onglets d'un même profil partagent l'identité de joueur. Sans configuration, le stockage local est en mémoire et disparaît au redémarrage.

```sh
npm test
npm run check
# Dans un second terminal, avec npm run dev en cours :
npm run test:browser
node test/load.mjs
```

Les tests navigateur utilisent Chromium fourni par @sparticuz/chromium sur Linux. Les captures et le rapport de charge sont placés dans artifacts/ (ignoré par Git).

## Déploiement Vercel

- Projet final : `cartes` (`prj_G87N4VVphKV82ZrZ4urMQ3MhkRuM`).
- Région des fonctions et du stockage : Paris (`cdg1`).
- Sortie statique : `public/` ; API Node : `api/rooms.js`.
- Connecter un **store Vercel Blob privé** au projet pour l'environnement ciblé. `BLOB_STORE_ID` permet l'authentification OIDC ; `BLOB_READ_WRITE_TOKEN` est également supporté.
- Pour utiliser Redis à la place de Blob, connecter une ressource Upstash via Vercel Marketplace et configurer `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`. Redis prend automatiquement la priorité.
- Ne jamais mettre les secrets dans Git. Copier `.env.example` vers `.env.local` pour documenter les clés ; le serveur de développement n'en charge pas automatiquement les valeurs. Utiliser `node --env-file=.env.local dev.js` ou `vercel env run -- npm run dev` si nécessaire.
- Les salons expirent après 6 heures. Redis les supprime automatiquement via TTL. Sur Blob, l'expiration interdit la lecture mais les objets doivent être nettoyés séparément pour la rétention et les coûts.
- Accès public : https://cartes-nu.vercel.app. La protection SSO a été désactivée avec l’accord de l’utilisateur. Dépôt GitHub : https://github.com/ruben-ctm/Cartes-.

## Architecture et limites connues

Le frontend est en HTML/CSS/JavaScript natif, sans dépendance cliente, image lourde ou police externe. Les déplacements sont affichés localement immédiatement et envoyés lors du relâchement, plutôt que chaque pixel. Synchronisation des autres joueurs par lecture toutes les 1,6 à 1,95 secondes ; lectures suspendues lorsque l'onglet est masqué. Il ne s'agit pas d'un transport WebSocket.

L'état est partagé entre fonctions Vercel dans le stockage privé. Les writes Blob utilisent ETag / `ifMatch` et les writes Redis un compare-and-swap Lua. Les actions sont regroupées par salon dans chaque instance, puis validées côté serveur avec les droits d'accès aux mains. Les collisions entre instances sont réessayées jusqu'à 5 fois avec un court délai. Les identifiants de requête évitent de réexécuter une action répétée parmi les 64 dernières actions. Les mutations sur des cartes différentes peuvent se réappliquer au dernier état du salon.

Une micro-cache serveur de 350 ms regroupe les lectures d'un même salon et est invalidée après mutation. Chaque réponse ne contient que la main du demandeur, les cartes publiques et le nombre de cartes des autres. Les cookies d'identité sont HttpOnly / SameSite et Secure sur Vercel. Le filtrage des requêtes par IP et identité est local à l'instance ; ce n'est pas une limitation globale distribuée contre les abus.

**Mesures de charge :** 100 clients simulés, 500 lectures et 100 pioches en parallèle validés localement en mémoire, sans perte ni duplication. Les chiffres locaux ne garantissent pas la latence, le coût ou la capacité sur Vercel/Blob. Il reste à effectuer le test de charge sur le déploiement après résolution de l'accès protégé. Pour des tables très actives avec 100 personnes, préférer Redis et mesurer les collisions, la latence et les coûts réels.

## Structure

- `public/` : interface et ressources statiques.
- `lib/engine.js` : opérations de table libre et masquage des cartes.
- `lib/storage.js` : Blob / Redis / mémoire de développement.
- `api/rooms.js` : validation HTTP, identité, actions et lecture des salons.
- `test/engine.test.js` : règles d'accès, conservation et concurrence.
- `test/browser.mjs` : parcours multijoueur, drag and drop et mobile.
- `test/load.mjs` : simulation de 100 clients HTTP.

Le jeu de cartes Uno est dessiné en CSS et cette application n'est pas un produit officiel Mattel.
