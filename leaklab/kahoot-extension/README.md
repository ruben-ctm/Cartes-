# Leaklab Kahoot Capture Analyzer

Extension Chrome MV3 d'audit local de fichiers HAR exportés manuellement depuis Chrome DevTools.

## Fonctionnement

- Charge un fichier HAR depuis la fenêtre de l'extension.
- Repère les requêtes et réponses contenant des événements pertinents.
- Signale la présence de champs de correction sans afficher leurs valeurs.
- Compare les horodatages des soumissions détectées et des champs de correction.
- Masque les identifiants et informations sensibles courants.
- Ne transmet aucune donnée et ne contacte aucun serveur.

## Installation

1. Ouvrir `chrome://extensions`.
2. Activer le mode développeur.
3. Cliquer sur « Charger l’extension non empaquetée ».
4. Sélectionner ce dossier.

## Limites

Cette version ne capture pas les WebSockets en direct. Elle analyse uniquement le contenu effectivement présent dans le HAR fourni. Les exports HAR de Chrome n'incluent pas nécessairement les trames WebSocket ; dans ce cas, l'analyse ne peut pas conclure sur leur ordre ni leur contenu.

Les résultats sont des indices techniques issus du fichier fourni, pas une preuve générale du comportement de Kahoot. Vérifier et anonymiser tout fichier avant de le partager.
