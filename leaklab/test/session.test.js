import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, getAdapter, toJsonl, parseJsonl, looksLikeJsonl, normalizeAnswerKey,
  redactUrl, captureFromRecords, recordsFromCapture, inspectCapture, formatInspection, buildTimeline, normalizeFrames,
} from '../analyzer/index.js';
import { simulate } from '../lab/simulator.js';

const msg = (dir, id, content, channel = '/service/player') => ({ dir, kind: 'ws', data: JSON.stringify([{ channel, data: { id, type: 'message', content: JSON.stringify(content) } }]) });

test('clé de réponses : liste CSV, nombres, objets, erreurs', () => {
  assert.deepEqual(normalizeAnswerKey('2, 0,1').map((k) => k.correctIndex), [2, 0, 1]);
  assert.equal(normalizeAnswerKey([1, 3])[0].choices.length, 4);
  const k = normalizeAnswerKey([{ q: 5, correctIndex: 1, choiceCount: 2 }]);
  assert.deepEqual([k[0].q, k[0].choices.length], [5, 2]);
  assert.equal(normalizeAnswerKey('[{"correctIndex":0,"choices":["a","b"]}]')[0].choices[1], 'b');
  assert.throws(() => normalizeAnswerKey([7]), /correctIndex invalide/);
  assert.throws(() => normalizeAnswerKey(''), /vide/);
});

test('JSONL : aller-retour, détection de format, ligne invalide signalée', () => {
  const recs = [{ type: 'meta', schema: 1 }, { type: 'frame', t: 1, dir: 'in', data: 'x' }];
  assert.deepEqual(parseJsonl(toJsonl(recs)), recs);
  assert.ok(looksLikeJsonl(toJsonl(recs)));
  assert.ok(!looksLikeJsonl('{"frames":[]}'));
  assert.throws(() => parseJsonl('{"a":1}\n{oups'), /ligne 2/);
});

test('redactUrl masque le jeton de session CometD et les paramètres sensibles', () => {
  assert.equal(redactUrl('wss://lab.test/cometd/123456/abcDEF.secret'), 'wss://lab.test/cometd/123456/<redacted>');
  assert.equal(redactUrl('https://x/y?token=abc&a=1'), 'https://x/y?token=<redacted>&a=1');
  assert.equal(redactUrl('https://lab.test/rest/quizzes/1'), 'https://lab.test/rest/quizzes/1');
});

test('aller-retour JSONL ↔ capture : même verdict que l’analyse directe, pour chaque profil', () => {
  for (const profile of ['L0', 'L1', 'L2', 'L3', 'L4']) {
    const cap = simulate({ profile, seed: 4 });
    const direct = analyze(cap);
    const back = captureFromRecords(parseJsonl(toJsonl(recordsFromCapture(cap, { startedAt: 1.7e12 }))), { adapter: getAdapter('mock-cometd') });
    const viaJsonl = analyze(back, { adapter: getAdapter('mock-cometd') });
    assert.equal(viaJsonl.verdict, direct.verdict, profile);
    assert.deepEqual(viaJsonl.candidates.map((c) => c.id), direct.candidates.map((c) => c.id), profile);
    assert.equal(back.marks.length, 12, 'marques DOM réassociées aux questions');
  }
});

test('clé fournie en option prioritaire sur celle du fichier', () => {
  const cap = simulate({ profile: 'L1' });
  const recs = recordsFromCapture(cap);
  const key = normalizeAnswerKey(cap.groundTruth.map((g) => ({ ...g, correctIndex: (g.correctIndex + 1) % g.choices.length })));
  const wrong = captureFromRecords(recs, { adapter: getAdapter('mock-cometd'), key });
  assert.equal(analyze(wrong, { adapter: getAdapter('mock-cometd') }).candidates.filter((c) => c.worstPhase === 'pre_answer').length, 0);
});

test('inspect : regroupe par (sens, canal, id, type) et liste les clés de contenu', () => {
  const cap = simulate({ profile: 'L1' });
  const rep = inspectCapture(cap, { adapter: getAdapter('mock-cometd') });
  const start = rep.rows.find((r) => r.type === 'startQuestion');
  assert.equal(start.count, 12);
  assert.ok(start.keys.includes('choices[].correct'), start.keys.join());
  assert.deepEqual(start.events, ['question_start']);
  assert.ok(rep.rows.some((r) => r.kind === 'http'));
  assert.match(formatInspection(rep), /startQuestion/);
});
