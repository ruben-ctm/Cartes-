/**
 * `demo-extension/vendor/` est une copie de `analyzer/` et de `ui/{app.js,style.css}` (une
 * extension empaquetée ne peut pas importer de fichiers hors de son propre dossier). Ce test
 * échoue si quelqu'un modifie l'analyseur ou la bibliothèque de rendu sans relancer
 * `node demo-extension/build.js` : il compare le contenu actuel, pas une capture figée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDOR = join(ROOT, 'demo-extension', 'vendor');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('demo-extension/vendor/analyzer est identique à leaklab/analyzer', () => {
  if (!existsSync(VENDOR)) assert.fail('vendor/ absent : lancer `cd demo-extension && node build.js`');
  const srcFiles = walk(join(ROOT, 'analyzer'));
  for (const src of srcFiles) {
    const rel = relative(join(ROOT, 'analyzer'), src);
    const vendored = join(VENDOR, 'analyzer', rel);
    assert.ok(existsSync(vendored), `manquant dans vendor/ : ${rel}`);
    assert.equal(readFileSync(vendored, 'utf8'), readFileSync(src, 'utf8'), `désynchronisé : ${rel} — relancer node build.js`);
  }
  const vendoredFiles = walk(join(VENDOR, 'analyzer'));
  assert.equal(vendoredFiles.length, srcFiles.length, 'vendor/analyzer contient des fichiers en trop ou manquants');
});

test('demo-extension/vendor/ui est identique à leaklab/ui/{app.js,style.css}', () => {
  for (const name of ['app.js', 'style.css']) {
    assert.equal(readFileSync(join(VENDOR, 'ui', name), 'utf8'), readFileSync(join(ROOT, 'ui', name), 'utf8'), `désynchronisé : ui/${name} — relancer node build.js`);
  }
});
