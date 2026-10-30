# Leaklab — détection de fuites d'information avant validation

Projet pédagogique de cybersécurité : un **analyseur** qui, à partir d'une capture de trames,
détermine *si* et *quand* la bonne réponse d'une question de quiz devient lisible côté client,
et trois moyens de le mettre à l'épreuve, du plus abstrait au plus réel :

1. **`analyzer/` + `lab/` + `ui/`** — banc d'essai sur protocole **simulé** (5 profils L0…L4,
   aucun réseau). Sert à valider la méthode de détection elle-même.
2. **`demo-app/`** — une vraie application de quiz (serveur WebSocket **que nous contrôlons**,
   mode hôte + mode joueur), avec les mêmes 5 scénarios de sécurité mais sur de vrais échanges
   réseau localhost.
3. **`demo-extension/`** — une extension Chrome (Manifest V3) qui observe passivement le trafic
   de `demo-app/` dans un vrai Chromium et affiche l'analyse en direct.

**Portée : indépendant de Kahoot et de tout service tiers.** Le serveur de test est le nôtre,
son code source est ici, et nous définissons nous-mêmes les bonnes réponses. L'extension ne
cible que `127.0.0.1` (voir `demo-extension/manifest.json`) et n'affiche jamais de réponse dans
la page observée — seulement dans son propre tableau de bord, à partir d'une clé de réponses que
l'opérateur du test fournit lui-même.

```bash
cd leaklab
npm test                               # 51 tests : hachages, timeline, détecteur, API, demo-app réel
npm run report                         # synthèse des profils simulés L0…L4 (attendu vs obtenu)
npm run lab                            # interface du banc d'essai simulé : http://127.0.0.1:5177/
node lab/cli.js analyze capture.json   # analyser une capture ou une session JSONL
```

Pour l'application de test réelle et l'extension, voir « Application de test (`demo-app/`) »
et « Extension Chrome (`demo-extension/`) » plus bas.

## Arborescence

```
analyzer/                 pur ESM, réutilisable tel quel dans un navigateur
  index.js                API publique : analyze, summarize, PHASES…
  hashers.js              md5 / sha1 / sha256 synchrones (JS pur)
  payload.js              décodage JSON imbriqué et base64
  encoders.js             formes encodées (hash) des choix connus de l'hôte
  predictions.js          « cette valeur désigne-t-elle un choix ? » sans connaître les champs
  stats.js                test binomial contre le hasard
  timeline.js             événements par question, phases
  detector.js             corrélation, mesure des délais, écho, verdict
  report.js               rapport texte
  session.js              sessions JSONL, clé de réponses, redaction d'URL
  inspect.js              calibration d'un adaptateur sur une capture inconnue
  adapters/mock-cometd.js adaptateur du protocole simulé (lab/)
  adapters/demo-app.js    adaptateur du protocole réel de demo-app/ (vérifié, pas une hypothèse)
lab/                      prng, quiz, profiles (L0…L4), simulator, server, cli — protocole SIMULÉ
ui/                       chronologie SVG + tableau des champs + inspecteur — bibliothèque de rendu
demo-app/                 vraie application de quiz (serveur WebSocket + pages hôte/joueur)
demo-extension/           extension Chrome MV3 qui observe demo-app/ et affiche l'analyse en direct
test/                     node:test (dont un test d'intégration sur vrai WebSocket)
```

## Profils

| Profil | Ce que fait le serveur simulé | Verdict attendu | Phase |
|---|---|---|---|
| L0 | Saine : correction seulement à l'événement officiel de résultat | `NO_PREMATURE_DISCLOSURE` | après correction |
| L1 | `choices[].correct` en clair dans la question | `LEAK_BEFORE_ANSWER` | avant réponse |
| L2 | Index base64 + md5 du texte sous des noms opaques | `LEAK_BEFORE_ANSWER` | avant réponse |
| L3 | Définition REST du quiz avec drapeaux, servie au lobby | `LEAK_BEFORE_ANSWER` | avant question |
| L4 | Solution dans l'accusé de réponse | `LEAK_AFTER_ANSWER` | après réponse |

## Méthode du détecteur

1. **Sans nom de champ.** Chaque trame entrante est parcourue récursivement (JSON dans des chaînes,
   base64 décodé). Hypothèses générées : valeur = index (base 0/1), valeur = texte ou index
   haché (md5/sha1/sha256), élément « vrai » unique, ou élément unique différent dans un tableau
   de la taille des choix. Les chemins sont généralisés (`choices[].correct`).
2. **Corrélation.** Par (chemin, hypothèse), comparaison à la clé de l'hôte sur toutes les
   questions : retenu si taux ≥ 90 %, test binomial p < 1e-3 contre 1/k, valeurs non constantes.
3. **Mesure.** Pour chaque question, première trame où la valeur correcte est lisible : durée depuis
   la question (`dtFromQuestionMs`), depuis le rendu DOM, avance sur la réponse du joueur et sur la correction.
4. **Phases** (par ordre des trames) : `pre_question` · `pre_answer` · `post_answer` · `post_correction`.
5. **Écho.** Un champ reçu après la réponse qui reproduit la sélection du joueur (trames sortantes)
   est écarté ; si le joueur a toujours répondu juste, écho et fuite sont indiscernables →
   `INCONCLUSIVE_PLAYER_ECHO`.

## Limites connues

- Hachages **salés** ou chiffrés avec une clé serveur : non détectables (aucune corrélation observable).
- Couches d'encodage au-delà de JSON / base64 (compression, protobuf, XOR) : à ajouter dans `payload.js`.
- Les captures réelles exigent un adaptateur de protocole et la clé de réponses de l'hôte
  (parties que vous créez vous-mêmes).
- Résultat statistique : ≥ 6 questions requises ; la précision du joueur influe sur le contrôle d'écho.
- **Échantillon réduit + questions à peu de choix (vrai/faux, k=2) : une vraie fuite peut rester sous
  le seuil statistique strict.** Rencontré en vérifiant `demo-app` : sur 6 questions tirées sans graine
  fixe, un mélange de questions à 2 et 4 choix a fait deviner juste le joueur simulé 6 fois sur 6 *par
  hasard* avec une probabilité (≈ 0,5 %) au-dessus du seuil `alpha = 1e-3` — le détecteur a donc,
  correctement selon sa propre règle, jugé l'échantillon non concluant alors que le champ fautif était
  bien présent. Ce n'est pas un faux négatif du détecteur mais une limite du seuil choisi face à un
  petit échantillon hétérogène : plus de questions, ou des questions à 4 choix, lèvent l'ambiguïté
  (voir la graine utilisée dans `test/chromium-check.mjs`).

## Sessions JSONL

`analyzer/session.js` lit et écrit des sessions JSONL (`meta`, `key`, `frame`, `mark`) ; `node lab/cli.js analyze|inspect <fichier>`
et l'interface du banc d'essai (« Charger une capture… ») les acceptent. Le tableau de bord de
`demo-extension/` les produit aussi, en direct, depuis une vraie capture navigateur.

## Application de test (`demo-app/`)

Un vrai serveur de quiz, HTTP + WebSocket (`ws`), que nous contrôlons entièrement — protocole
JSON propre à ce projet, indépendant de Kahoot et de CometD. Réutilise `lab/quiz.js` (génération
du quiz) et les fonctions `decorate*` de `lab/profiles.js` (déjà testées dans le banc d'essai
simulé) pour appliquer les mêmes 5 scénarios de sécurité L0…L4, mais sur un vrai réseau.

```bash
cd leaklab/demo-app
npm install        # installe `ws` (une seule fois)
npm start          # http://127.0.0.1:5180/host.html (hôte) et /player.html (joueur)
```

- **Mode hôte** (`host.html`) : choisit un scénario, un nombre de questions et un temps par
  question ; crée la partie (un code à 5 caractères s'affiche) ; démarre quand les joueurs sont là ;
  suit la progression et le classement.
- **Mode joueur** (`player.html`) : rejoint avec le code, répond dans le temps imparti. **La page
  n'affiche jamais la bonne réponse avant l'événement officiel de résultat**, même dans les
  scénarios vulnérables où elle est présente dans les données reçues — la page se comporte comme
  une application normale ; seule une observation du trafic (l'extension) peut révéler la fuite.
- **`node host-bot.js --scenario L1 [--count 8] [--time 15] [--seed 42]`** : un hôte en ligne de
  commande, pour rejouer un scénario de façon reproductible pendant qu'un vrai navigateur tient le
  rôle du joueur (c'est ce que fait `test/chromium-check.mjs`).
- **`GET /api/quiz/:code/definition`** : définition REST du quiz, propre sauf au scénario L3.
- **`GET /api/session/:code/:playerId.jsonl`** : journal **côté serveur** de ce que ce joueur a
  reçu/envoyé, au format JSONL du laboratoire, avec la clé de réponses. Sert de référence pour
  comparer à ce que l'extension a capturé depuis le navigateur, et c'est la source que le tableau
  de bord de l'extension interroge pour obtenir la clé de réponses (jamais les trames : celles-ci
  viennent uniquement de la capture réelle du navigateur).

`npm test` (à la racine de `leaklab/`) inclut `test/demo-app.test.js` : un test d'intégration qui
démarre ce vrai serveur, y connecte de vrais clients WebSocket (hôte + joueur, vrai TCP localhost)
pour les 5 scénarios, et vérifie le verdict de l'analyseur sur la session journalisée côté serveur.

## Extension Chrome (`demo-extension/`)

Une extension Manifest V3 qui observe passivement le trafic de `demo-app/` et affiche l'analyse
en direct. **Limitée à `http://127.0.0.1/*`** (voir `manifest.json`) : elle ne s'active sur aucun
autre site, et n'affiche de résultat que dans son propre tableau de bord — jamais dans la page
observée.

- `src/hook.js` (monde `MAIN`, `document_start`) : enveloppe `WebSocket`/`fetch`/`XHR` pour copier
  chaque trame vers `bridge.js`, sans jamais modifier, retarder ou bloquer quoi que ce soit.
- `src/bridge.js` (monde isolé) : relaie ces copies au service worker, et marque dans le DOM
  l'apparition des boutons de réponse (`#choices button` de `player.html`).
- `src/background.js` : range les trames par session (une session = un chargement de page) dans
  `chrome.storage.local`.
- `ui/dashboard.html` : tableau de bord (clic sur l'icône de l'extension), même rendu que le banc
  d'essai (chronologie, champs corrélés, inspecteur de trames), mis à jour en direct à chaque
  nouvelle trame. Vous y entrez le **code de la partie** (affiché côté hôte) et cliquez
  « Récupérer la clé de réponses » : le tableau de bord retrouve votre `playerId` dans ses propres
  trames capturées et va chercher la clé sur `GET /api/session/...` — jamais les trames, qui
  viennent uniquement de ce que le navigateur a réellement reçu.
- « Exporter en JSONL » télécharge la session capturée, au même format que le reste du projet.

### Installer l'extension manuellement

1. `cd leaklab/demo-extension && node build.js` (copie `analyzer/` et `ui/app.js`+`style.css`
   dans `vendor/` — une extension ne peut pas importer de fichiers hors de son propre dossier ;
   déjà fait dans ce dépôt, à relancer seulement après une modification de `analyzer/` ou `ui/`).
2. Dans Chrome : `chrome://extensions` → activer le mode développeur → **Charger l'extension non
   empaquetée** → sélectionner le dossier `leaklab/demo-extension`.
3. Démarrer `demo-app` (`npm start` dans `leaklab/demo-app`), ouvrir `host.html` dans un onglet et
   `player.html` dans un autre (l'extension s'active automatiquement sur ces deux pages, et sur
   elles seules).
4. Jouer une partie, puis cliquer l'icône de l'extension pour ouvrir le tableau de bord.

### Reproduire la démonstration vulnérable vs sécurisée

```bash
# terminal 1
cd leaklab/demo-app && npm start
# terminal 2 : un hôte automatique, scénario vulnérable
cd leaklab/demo-app && node host-bot.js --scenario L1 --count 8
```
Ouvrez `http://127.0.0.1:5180/player.html`, rejoignez avec le code affiché par `host-bot.js`,
répondez aux questions, puis ouvrez le tableau de bord de l'extension : le champ
`choices[].correct` apparaît, lisible dès l'apparition de la question, bien avant la réponse.
Recommencez avec `--scenario L0` : le tableau de bord ne trouve plus aucun champ précoce — seule
la divulgation officielle, après coup, apparaît.

### Vérifier soi-même (ce que nous avons fait, et comment le refaire)

`test/chromium-check.mjs` automatise exactement ce scénario dans un **vrai Chromium**, extension
chargée normalement (`--load-extension`, sans API de test ni raccourci) : démarre le serveur,
lance `host-bot.js`, ouvre un vrai onglet joueur qui répond aux questions, ouvre le tableau de
bord de l'extension, y entre le code et récupère la clé, puis lit le verdict affiché — et échoue
si ce verdict ne correspond pas au scénario. Il n'est pas inclus dans `npm test` (il a besoin d'un
Chromium pilotable et, dans un conteneur sans affichage, d'un serveur X virtuel) :

```bash
cd leaklab
npm install                                  # installe playwright (une fois)
xvfb-run -a node test/chromium-check.mjs L0 L1 L2 L3 L4   # avec affichage : sans xvfb-run
```

Capture d'écran du tableau de bord après chaque scénario dans `test/chromium-check-<L*>.png`.
Résultat obtenu lors de la rédaction de ce README (voir ce fichier pour le détail scénario par
scénario) : L0 → *Aucune divulgation avant la correction officielle* ; L1, L2, L3 → *Fuite avant
la réponse du joueur* ; L4 → *Fuite après la réponse, avant la correction officielle* — les cinq
conformes à ce que `demo-app/rooms.js` est censé faire.

**Ce que cette vérification prouve, et ce qu'elle ne prouve pas.** Elle prouve que l'extension,
dans un vrai navigateur, sur un vrai trafic réseau, détecte correctement les fuites que *nous*
avons délibérément construites dans notre propre serveur de test — et qu'elle ne signale rien sur
le scénario sain. Elle ne dit rien sur un autre service : pour l'appliquer ailleurs, il faut un
nouvel adaptateur de protocole (`analyzer/adapters/`) calibré sur une capture de ce service, et
l'autorisation d'y mener ce test.
