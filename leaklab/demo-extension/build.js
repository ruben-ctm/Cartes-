#!/usr/bin/env node
/**
 * Copie dans vendor/ les modules partagés dont l'extension a besoin (analyzer/ en entier,
 * et la bibliothèque de rendu de ui/). Une extension empaquetée ne peut pas importer de
 * fichiers hors de son propre dossier : on copie plutôt que d'y faire référence. Relancer
 * ce script après toute modification de leaklab/analyzer/ ou de leaklab/ui/app.js|style.css.
 * `npm test` (test/vendor-sync.test.js) échoue si vendor/ n'est plus à jour.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LEAKLAB = join(ROOT, '..');
const VENDOR = join(ROOT, 'vendor');

rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(join(VENDOR, 'analyzer'), { recursive: true });
mkdirSync(join(VENDOR, 'ui'), { recursive: true });

cpSync(join(LEAKLAB, 'analyzer'), join(VENDOR, 'analyzer'), { recursive: true });
cpSync(join(LEAKLAB, 'ui', 'app.js'), join(VENDOR, 'ui', 'app.js'));
cpSync(join(LEAKLAB, 'ui', 'style.css'), join(VENDOR, 'ui', 'style.css'));

// Horodatage lisible pour vérifier d'un coup d'œil que vendor/ n'est pas périmé.
writeFileSync(join(VENDOR, 'VENDORED_AT.txt'), `Copié depuis leaklab/analyzer et leaklab/ui le ${new Date().toISOString()}\nNe pas éditer à la main : relancer "node build.js".\n`);

console.log(`vendor/ régénéré dans ${VENDOR}`);
