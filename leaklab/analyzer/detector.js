/**
 * Détecteur de fuite de la bonne réponse, indépendant du nom des champs.
 *
 * Principe : pour chaque trame entrante, on extrait toutes les hypothèses « cette valeur
 * désigne un choix » (predictions.js). On regroupe par (chemin générique, hypothèse) et on
 * compare, question par question, le choix désigné à la clé de réponses de l'hôte
 * (`capture.groundTruth`). Un champ est retenu s'il prédit la bonne réponse bien mieux que
 * le hasard (taux de réussite ET test binomial). On mesure ensuite, pour chaque question,
 * la première trame où la valeur correcte est lisible, et sa phase (timeline.js).
 *
 * Format de capture :
 *   { meta, groundTruth: [{ q, correctIndex, choices: [texte…] }],
 *     frames: [{ t, dir: 'in'|'out', kind?: 'ws'|'http', data }], marks?: [{ t, type, q }] }
 */

import { defaultHashers } from './hashers.js';
import { createEncoder } from './encoders.js';
import { extractPredictions } from './predictions.js';
import { parseRoot } from './payload.js';
import { binomialTail } from './stats.js';
import { mockCometdAdapter } from './adapters/mock-cometd.js';
import { PHASES, buildTimeline, normalizeFrames } from './timeline.js';

export const DEFAULTS = {
  minQuestions: 6, // nombre minimal de questions observées pour conclure
  minHitRate: 0.9, // part des questions où le champ désigne la bonne réponse
  alpha: 1e-3, // seuil du test binomial (contre le hasard 1/k)
  minDistinct: 2, // un champ constant n'est pas informatif
};

const round = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function makeTruth(groundTruth) {
  const byQ = new Map(groundTruth.map((g) => [g.q, g]));
  return { byQ, count: byQ.size };
}

/**
 * Un champ entrant qui reproduit exactement la sélection du joueur (trames sortantes) sur
 * toutes les questions communes, alors qu'il ne donne pas toujours la bonne réponse, est un
 * écho de l'entrée du joueur et non une fuite. Si le joueur a toujours répondu juste, écho
 * et fuite sont indiscernables : on conserve le champ en le signalant.
 */
function echoOf(entry, outFields, opts) {
  for (const out of outFields.values()) {
    const common = [...entry.perQ.keys()].filter((q) => out.perQ.has(q));
    if (common.length < opts.minQuestions) continue;
    if (common.every((q) => entry.perQ.get(q)[0].predicted === out.perQ.get(q)[0].predicted)) return out;
  }
  return null;
}

function evaluate(entry, truth, timeline, outFields, opts) {
  const perQ = [];
  let hits = 0;
  let expected = 0;
  const predictedValues = new Set();

  for (const [q, preds] of entry.perQ) {
    const first = preds[0];
    const t = truth.byQ.get(q);
    predictedValues.add(first.predicted);
    expected += 1 / t.choices.length;
    if (first.predicted !== t.correctIndex) continue;
    hits++;
    const e = timeline.get(q);
    perQ.push({
      q,
      frameId: first.frameId,
      seq: first.seq,
      t: round(first.t),
      path: first.path,
      phase: timeline.phaseOf(q, first.seq),
      dtFromQuestionMs: round(first.t - e.tQuestion),
      dtFromRenderMs: round(e.tRender === undefined ? null : first.t - e.tRender),
      leadToAnswerMs: round(e.tAnswer === undefined ? null : e.tAnswer - first.t),
      leadToResultMs: round(e.tResult === undefined ? null : e.tResult - first.t),
    });
  }

  const n = entry.perQ.size;
  const rate = n ? hits / n : 0;
  const pValue = n ? binomialTail(n, hits, expected / n) : 1;
  const isLeak = n >= opts.minQuestions && rate >= opts.minHitRate && pValue < opts.alpha && predictedValues.size >= opts.minDistinct;
  if (!isLeak) return null;

  const phases = Object.fromEntries(PHASES.map((p) => [p, perQ.filter((h) => h.phase === p).length]));
  const worstPhase = PHASES.find((p) => phases[p] > 0);

  // Un écho n'est possible que pour une valeur lue après la réponse du joueur.
  const echo = worstPhase === 'post_answer' ? echoOf(entry, outFields, opts) : null;
  if (echo && hits < n) return { ignored: { id: `${entry.template}|${entry.variant}`, reason: 'echo', detail: `reproduit la sélection du joueur (${echo.template})` } };
  const dts = perQ.map((h) => h.dtFromQuestionMs);
  const notes = [];
  if (echo) notes.push('Indiscernable de l’écho de la sélection du joueur (il a toujours répondu juste) : refaire la mesure avec des réponses fausses.');
  if (worstPhase === 'post_correction') notes.push('Divulgation attendue : la correction officielle est envoyée à ce moment.');

  return { candidate: {
    id: `${entry.template}|${entry.variant}`,
    template: entry.template,
    variant: entry.variant,
    n,
    hits,
    rate: round(rate * 1000) / 1000,
    pValue,
    phases,
    worstPhase,
    medianDtFromQuestionMs: round(median(dts)),
    minDtFromQuestionMs: round(Math.min(...dts)),
    medianLeadToAnswerMs: round(median(perQ.map((h) => h.leadToAnswerMs).filter((x) => x !== null))),
    ambiguous: Boolean(echo),
    perQuestion: perQ.sort((a, b) => a.q - b.q),
    notes,
  } };
}

function verdictFor(candidates, questionsObserved, opts) {
  if (questionsObserved < opts.minQuestions) return 'INSUFFICIENT_DATA';
  const rank = (list) => Math.min(...list.map((c) => PHASES.indexOf(c.worstPhase)), Infinity);
  const firm = rank(candidates.filter((c) => !c.ambiguous));
  if (firm <= PHASES.indexOf('pre_answer')) return 'LEAK_BEFORE_ANSWER';
  if (firm === PHASES.indexOf('post_answer')) return 'LEAK_AFTER_ANSWER';
  if (candidates.some((c) => c.ambiguous && c.worstPhase === 'post_answer')) return 'INCONCLUSIVE_PLAYER_ECHO';
  return 'NO_PREMATURE_DISCLOSURE';
}

export const VERDICT_LABELS = {
  LEAK_BEFORE_ANSWER: 'Fuite avant la réponse du joueur',
  LEAK_AFTER_ANSWER: 'Fuite après la réponse, avant la correction officielle',
  NO_PREMATURE_DISCLOSURE: 'Aucune divulgation avant la correction officielle',
  INCONCLUSIVE_PLAYER_ECHO: 'Indéterminé : un champ après réponse peut être l’écho de la sélection du joueur',
  INSUFFICIENT_DATA: 'Données insuffisantes pour conclure',
};

/**
 * @param {object} capture
 * @param {object} [options] surcharge de DEFAULTS + { adapter, hashers }
 */
export function analyze(capture, options = {}) {
  const opts = { ...DEFAULTS, adapter: mockCometdAdapter, hashers: defaultHashers, ...options };
  const frames = normalizeFrames(capture.frames);
  const timeline = buildTimeline(frames, capture.marks, opts.adapter);
  const truth = makeTruth(capture.groundTruth);
  const encoder = createEncoder(opts.hashers, truth);

  // Les trames sortantes contiennent les choix du joueur : jamais des fuites, mais elles
  // servent à écarter les champs entrants qui ne font que les répéter (écho).
  const collect = (dir) => {
    const fields = new Map(); // `${template}|${variant}` → { template, variant, perQ: Map<q, prédictions[]> }
    for (const frame of frames) {
      if (frame.dir !== dir) continue;
      const root = parseRoot(frame.data);
      const preds = extractPredictions({ root, contextQ: timeline.contextQ(frame.seq), truth, encoder });
      for (const p of preds) {
        const key = `${p.template}|${p.variant}`;
        const entry = fields.get(key) ?? fields.set(key, { template: p.template, variant: p.variant, perQ: new Map() }).get(key);
        const list = entry.perQ.get(p.q) ?? entry.perQ.set(p.q, []).get(p.q);
        list.push({ seq: frame.seq, t: frame.t, frameId: frame.id, predicted: p.predicted, path: p.path });
      }
    }
    return fields;
  };
  const fields = collect('in');
  const outFields = collect('out');

  const evaluated = [...fields.values()].map((entry) => evaluate(entry, truth, timeline, outFields, opts));
  const ignored = evaluated.filter((e) => e?.ignored).map((e) => e.ignored);
  const candidates = evaluated
    .filter((e) => e?.candidate)
    .map((e) => e.candidate)
    .sort((a, b) => PHASES.indexOf(a.worstPhase) - PHASES.indexOf(b.worstPhase) || a.medianDtFromQuestionMs - b.medianDtFromQuestionMs);

  const questionsObserved = timeline.questions.filter((e) => truth.byQ.has(e.q)).length;
  const verdict = verdictFor(candidates, questionsObserved, opts);

  return {
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    worstPhase: candidates.find((c) => !c.ambiguous)?.worstPhase ?? candidates[0]?.worstPhase ?? null,
    questionsAnalyzed: questionsObserved,
    framesAnalyzed: frames.filter((f) => f.dir === 'in').length,
    params: { minQuestions: opts.minQuestions, minHitRate: opts.minHitRate, alpha: opts.alpha, minDistinct: opts.minDistinct },
    timeline: timeline.questions.map(({ q, ...rest }) => ({ q, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k.startsWith('t') ? round(v) : v])) })),
    candidates,
    ignored,
  };
}
