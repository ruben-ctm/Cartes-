import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, normalizeFrames } from '../analyzer/timeline.js';
import { mockCometdAdapter } from '../analyzer/adapters/mock-cometd.js';

const frame = (t, dir, type, q) => ({ t, dir, kind: 'ws', data: JSON.stringify([{ data: { type, content: JSON.stringify({ questionIndex: q }) } }]) });

const frames = normalizeFrames([
  { t: 10, dir: 'in', kind: 'http', data: '{}' },
  frame(100, 'in', 'startQuestion', 0),
  frame(5000, 'out', 'submitAnswer', 0),
  frame(5050, 'in', 'answerAck', 0),
  frame(20000, 'in', 'timeUp', 0),
  frame(20200, 'in', 'questionResult', 0),
  frame(23000, 'in', 'startQuestion', 1),
  frame(24000, 'in', 'timeUp', 1), // question 1 : le joueur n'a jamais répondu
]);
const marks = [{ t: 120, type: 'dom_question_rendered', q: 0 }];
const tl = buildTimeline(frames, marks, mockCometdAdapter);
const seqAt = (t, dir) => frames.find((f) => f.t === t && (!dir || f.dir === dir)).seq;

test('les événements sont reconnus avec leurs temps', () => {
  const e = tl.get(0);
  assert.equal(e.tQuestion, 100);
  assert.equal(e.tRender, 120);
  assert.equal(e.tAnswer, 5000);
  assert.equal(e.tAck, 5050);
  assert.equal(e.tTimeUp, 20000);
  assert.equal(e.tResult, 20200);
});

test('phases : avant question / avant réponse / après réponse / après correction', () => {
  assert.equal(tl.phaseOf(0, seqAt(10)), 'pre_question');
  assert.equal(tl.phaseOf(0, seqAt(100)), 'pre_answer'); // la trame de question elle-même
  assert.equal(tl.phaseOf(0, seqAt(5000)), 'post_answer');
  assert.equal(tl.phaseOf(0, seqAt(5050)), 'post_answer');
  assert.equal(tl.phaseOf(0, seqAt(20000)), 'post_answer');
  assert.equal(tl.phaseOf(0, seqAt(20200)), 'post_correction');
});

test('sans réponse du joueur, la phase pre_answer court jusqu’à la correction', () => {
  assert.equal(tl.phaseOf(1, seqAt(24000)), 'pre_answer');
});

test('contextQ : question en cours', () => {
  assert.equal(tl.contextQ(seqAt(10)), null);
  assert.equal(tl.contextQ(seqAt(20200)), 0);
  assert.equal(tl.contextQ(seqAt(23000)), 1);
});

test('normalizeFrames : tri stable par temps, seq contigus', () => {
  const out = normalizeFrames([{ t: 5, data: 'b' }, { t: 1, data: 'a' }, { t: 5, data: 'c' }]);
  assert.deepEqual(out.map((f) => f.data), ['a', 'b', 'c']);
  assert.deepEqual(out.map((f) => f.seq), [0, 1, 2]);
});
