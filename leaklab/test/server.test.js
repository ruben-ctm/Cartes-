import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabServer } from '../lab/server.js';

const server = createLabServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('API : /api/run renvoie capture + résultat', async () => {
  const body = await (await fetch(`${base}/api/run?profile=L3&seed=2`)).json();
  assert.equal(body.result.verdict, 'LEAK_BEFORE_ANSWER');
  assert.equal(body.capture.meta.profile, 'L3');
});

test('API : /api/analyze accepte une capture et rejette un corps invalide', async () => {
  const capture = (await (await fetch(`${base}/api/run?profile=L4`)).json()).capture;
  const ok = await (await fetch(`${base}/api/analyze`, { method: 'POST', body: JSON.stringify(capture) })).json();
  assert.equal(ok.result.verdict, 'LEAK_AFTER_ANSWER');
  const bad = await fetch(`${base}/api/analyze`, { method: 'POST', body: '{"x":1}' });
  assert.equal(bad.status, 400);
});

test('serveur : profil inconnu → 400, sortie du dossier ui/ → refusée', async () => {
  assert.equal((await fetch(`${base}/api/run?profile=ZZ`)).status, 400);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.notEqual((await fetch(`${base}/ui/..%2fpackage.json`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
});
