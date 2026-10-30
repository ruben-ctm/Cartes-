import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5, sha1, sha256 } from '../analyzer/hashers.js';

const VECTORS = ['', 'abc', 'Paris', 'Léonard de Vinci', '0', '3', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];

for (const [name, fn] of [['md5', md5], ['sha1', sha1], ['sha256', sha256]]) {
  test(`${name} coïncide avec node:crypto`, () => {
    for (const v of VECTORS) assert.equal(fn(v), createHash(name).update(v).digest('hex'), `${name}(${v.slice(0, 12)}…)`);
  });
}
