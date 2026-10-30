import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEmbedded, parseRoot } from '../analyzer/payload.js';
import { binomialTail } from '../analyzer/stats.js';

test('decodeEmbedded : JSON imbriqué, base64 d’un entier, base64 de JSON', () => {
  assert.deepEqual(decodeEmbedded('{"a":1}'), { tag: 'json', value: { a: 1 } });
  assert.deepEqual(decodeEmbedded(Buffer.from('2').toString('base64')), { tag: 'b64', value: 2 });
  assert.deepEqual(decodeEmbedded(Buffer.from('{"c":3}').toString('base64')), { tag: 'b64json', value: { c: 3 } });
});

test('decodeEmbedded : les textes ordinaires et les hachages ne sont pas décodés', () => {
  for (const s of ['Paris', 'Rome', 'Vrai', 'Léonard de Vinci', 'Port 443', 'd41d8cd98f00b204e9800998ecf8427e']) {
    assert.equal(decodeEmbedded(s), null, s);
  }
});

test('parseRoot : JSON brut → objet, texte brut → inchangé', () => {
  assert.deepEqual(parseRoot('[1,2]'), [1, 2]);
  assert.equal(parseRoot('bonjour'), 'bonjour');
  assert.deepEqual(parseRoot({ x: 1 }), { x: 1 });
});

test('binomialTail : valeurs de référence', () => {
  assert.ok(Math.abs(binomialTail(10, 5, 0.5) - 0.623046875) < 1e-9);
  assert.equal(binomialTail(10, 0, 0.3), 1);
  assert.equal(binomialTail(10, 11, 0.3), 0);
  assert.ok(binomialTail(12, 12, 0.25) < 1e-6);
  assert.ok(binomialTail(12, 4, 0.25) > 0.3);
});
