/**
 * Test d'intégration RÉEL (pas de synthèse) : démarre le vrai serveur HTTP/WebSocket du
 * quiz de démonstration, y connecte un vrai client `ws` hôte et un vrai client `ws` joueur
 * (TCP localhost), joue une partie complète pour chaque scénario, récupère la session
 * journalisée côté serveur via l'API HTTP, et vérifie que l'analyseur rend le verdict attendu.
 *
 * Ce test ne remplace pas la vérification dans Chromium (l'extension capture depuis le
 * navigateur, pas depuis le serveur) : il prouve que le serveur et le protocole se comportent
 * comme annoncé, et sert de référence à laquelle comparer la capture de l'extension.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { server } from '../demo-app/server.js';
import { analyze, parseJsonl, captureFromRecords, getAdapter } from '../analyzer/index.js';

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
test.after(() => server.close());

// Chaque message reçu est capturé dès l'ouverture de la connexion (pas seulement quand un
// test l'attend) pour éliminer toute condition de course entre `send()` et l'attache d'un
// écouteur `message` : un message émis par le serveur avant que le test ne le réclame ne doit
// jamais être perdu.
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const backlog = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => !w.predicate || w.predicate(msg));
      if (i >= 0) { const [w] = waiters.splice(i, 1); w.resolve(msg); } else backlog.push(msg);
    });
    ws.next = (predicate) => new Promise((resolve) => {
      const i = backlog.findIndex((m) => !predicate || predicate(m));
      if (i >= 0) return resolve(backlog.splice(i, 1)[0]);
      waiters.push({ predicate, resolve });
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const nextMessage = (ws, predicate) => ws.next(predicate);

async function playScenario(scenario, { questionCount = 6, timeAvailable = 150, revealDelay = 80, seed = 42 } = {}) {
  const host = await connect();
  const player = await connect();

  host.send(JSON.stringify({ type: 'host_create', scenario, questionCount, seed, timeAvailable, revealDelay }));
  const created = await nextMessage(host, (m) => m.type === 'room_created');
  assert.equal(created.scenario, scenario);

  player.send(JSON.stringify({ type: 'join', code: created.code, name: 'Testeur' }));
  const joined = await nextMessage(player, (m) => m.type === 'joined');
  await nextMessage(host, (m) => m.type === 'lobby_update' && m.room.players.length === 1);

  // Le joueur précharge la définition REST du quiz (comportement réaliste de lobby), comme
  // le ferait une page qui récupère le modèle de données avant d'afficher la première question.
  const defRes = await fetch(`http://127.0.0.1:${port}/api/quiz/${created.code}/definition?playerId=${joined.playerId}`);
  assert.equal(defRes.status, 200);
  await defRes.text();

  host.send(JSON.stringify({ type: 'start' }));

  for (let i = 0; i < questionCount; i++) {
    const q = await nextMessage(player, (m) => m.type === 'question_start' && m.index === i);
    // Répond au hasard un peu avant la fin du temps imparti : le détecteur ne doit dépendre
    // ni de la justesse systématique du joueur, ni de sa vitesse.
    await new Promise((r) => setTimeout(r, Math.min(timeAvailable * 0.5, 60)));
    player.send(JSON.stringify({ type: 'answer', index: i, choiceIndex: (q.index + i) % q.choices.length }));
    await nextMessage(player, (m) => m.type === 'answer_ack' && m.index === i);
    await nextMessage(player, (m) => m.type === 'question_result' && m.index === i);
  }
  await nextMessage(player, (m) => m.type === 'game_over');

  const jsonl = await (await fetch(`http://127.0.0.1:${port}/api/session/${created.code}/${joined.playerId}.jsonl`)).text();
  host.close(); player.close();
  return { code: created.code, playerId: joined.playerId, jsonl };
}

const EXPECTED = {
  L0: 'NO_PREMATURE_DISCLOSURE',
  L1: 'LEAK_BEFORE_ANSWER',
  L2: 'LEAK_BEFORE_ANSWER',
  L3: 'LEAK_BEFORE_ANSWER',
  L4: 'LEAK_AFTER_ANSWER',
};

for (const [scenario, expectedVerdict] of Object.entries(EXPECTED)) {
  test(`demo-app ${scenario} sur vrai WebSocket : verdict ${expectedVerdict}`, async () => {
    const { jsonl } = await playScenario(scenario);
    const capture = captureFromRecords(parseJsonl(jsonl), { adapter: getAdapter('demo-app') });
    const result = analyze(capture, { adapter: getAdapter('demo-app') });
    assert.equal(result.verdict, expectedVerdict, JSON.stringify(result.candidates.map((c) => [c.template, c.worstPhase])));
    assert.equal(result.questionsAnalyzed, 6);
  });
}

test('scénario sain (L0) : le serveur ne journalise jamais correctIndex avant question_result', async () => {
  const { jsonl } = await playScenario('L0');
  const records = parseJsonl(jsonl);
  for (const rec of records.filter((r) => r.type === 'frame' && r.dir === 'in')) {
    const msg = JSON.parse(rec.data);
    if (msg.type !== 'question_result') assert.ok(!('correctIndex' in msg) && !('correctChoices' in msg), JSON.stringify(msg));
  }
});

test('REST /api/quiz/:code/definition est propre sauf au scénario L3', async () => {
  const clean = await playScenario('L0');
  const leaky = await playScenario('L3');
  const bodyOf = (jsonl) => JSON.parse(parseJsonl(jsonl).find((r) => r.type === 'frame' && r.kind === 'http')?.data ?? '{}');
  assert.ok(!JSON.stringify(bodyOf(clean.jsonl)).includes('"correct"'));
  assert.ok(JSON.stringify(bodyOf(leaky.jsonl)).includes('"correct":true'));
});
