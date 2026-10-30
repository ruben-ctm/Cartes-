# Leaklab — détection de fuites d'information avant validation

Preuve de concept (lot 1) : un **analyseur** qui, à partir d'une capture de trames, détermine
*si* et *quand* la bonne réponse d'une question devient lisible côté client, et un **banc
d'essai** (serveur simulé, 5 profils) pour le valider. Aucun réseau externe, aucune cible réelle.
L'analyseur est du JS pur (aucune API Node) pour être embarqué ensuite dans l'extension Chrome.

```bash
cd leaklab
npm test            # hachages, timeline, détecteur, API
npm run report      # synthèse des profils L0…L4 (attendu vs obtenu)
npm run lab         # interface : http://127.0.0.1:5177/
node lab/cli.js analyze capture.json   # analyser une capture
```

## Arborescence

```
analyzer/                 pur ESM, réutilisable tel quel dans l'extension
  index.js                API publique : analyze, summarize, PHASES…
  hashers.js              md5 / sha1 / sha256 synchrones (JS pur)
  payload.js              décodage JSON imbriqué et base64
  encoders.js             formes encodées (hash) des choix connus de l'hôte
  predictions.js          « cette valeur désigne-t-elle un choix ? » sans connaître les champs
  stats.js                test binomial contre le hasard
  timeline.js             événements par question, phases
  detector.js             corrélation, mesure des délais, écho, verdict
  report.js               rapport texte
  adapters/mock-cometd.js adaptateur de protocole (à écrire pour un autre protocole)
lab/                      prng, quiz, profiles (L0…L4), simulator, server, cli
ui/                       chronologie SVG + tableau des champs + inspecteur de trames
test/                     node:test
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

## Sessions JSONL

`analyzer/session.js` lit et écrit des sessions JSONL (`meta`, `key`, `frame`, `mark`) ; `node lab/cli.js analyze|inspect <fichier>`
et l'interface (« Charger une capture… ») les acceptent. Cela couvre les captures de **services que vous possédez ou
êtes autorisés à auditer** : il faut alors écrire un adaptateur de protocole (`analyzer/adapters/`) et fournir la clé de réponses.
