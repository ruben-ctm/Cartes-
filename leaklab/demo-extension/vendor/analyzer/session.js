/**
 * Sessions enregistrées : format JSONL, clé de réponses et conversion vers le format de
 * capture de l'analyseur. Partagé par le CLI, le serveur du banc d'essai et les tests.
 *
 * JSONL (une ligne JSON par enregistrement, `t` = ms epoch absolu) :
 *   {"type":"meta","schema":1,"adapter":"mock-cometd","startedAt":…,…}
 *   {"type":"key","groundTruth":[{"q":0,"correctIndex":2,"choices":[…]}]}     (optionnel)
 *   {"type":"frame","t":…,"dir":"in"|"out","kind":"ws"|"http","data":"…","url"?,"channel"?}
 *   {"type":"mark","t":…,"name":"dom_question_rendered"}
 */

import { normalizeFrames } from './timeline.js';

export const SCHEMA = 1;

export const toJsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

export function parseJsonl(text) {
  const records = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { records.push(JSON.parse(line)); } catch { throw new Error(`JSONL invalide à la ligne ${i + 1}`); }
  });
  return records;
}

/** Vrai si le texte ressemble à un JSONL de session (et non à une capture JSON unique). */
export const looksLikeJsonl = (text) => /^\s*\{"type":"(meta|frame|key|mark)"/.test(text);

/**
 * Clé de réponses de l'hôte. Formes acceptées :
 *   - tableau d'objets { q?, correctIndex, choices?: string[], choiceCount?: number }
 *   - tableau de nombres, ou chaîne "2,0,1,3" : un index correct par question
 * Sans `choices`, des libellés génériques sont créés (`choiceCount` = 4 par défaut).
 */
export function normalizeAnswerKey(input, { defaultChoiceCount = 4 } = {}) {
  let items = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    items = trimmed.startsWith('[') || trimmed.startsWith('{') ? JSON.parse(trimmed) : trimmed.split(/[\s,;]+/).filter(Boolean).map(Number);
  }
  if (items && !Array.isArray(items) && Array.isArray(items.groundTruth)) items = items.groundTruth;
  if (!Array.isArray(items) || !items.length) throw new Error('Clé de réponses vide ou invalide');
  return items.map((item, i) => {
    const entry = typeof item === 'number' ? { correctIndex: item } : item;
    const q = Number.isInteger(entry.q) ? entry.q : i;
    const k = entry.choices?.length ?? entry.choiceCount ?? defaultChoiceCount;
    const choices = entry.choices ?? Array.from({ length: k }, (_, j) => `#${j}`);
    if (!Number.isInteger(entry.correctIndex) || entry.correctIndex < 0 || entry.correctIndex >= choices.length) {
      throw new Error(`Question ${q + 1} : correctIndex invalide (0 à ${choices.length - 1} attendu)`);
    }
    return { q, correctIndex: entry.correctIndex, choices };
  });
}

/** Retire les secrets de session d'une URL avant stockage ou export. */
export function redactUrl(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(/(\/cometd\/\d+\/)[^/?#]+/, '$1<redacted>')
    .replace(/([?&](?:token|session|sessionToken|access_token|authorization)=)[^&#]*/gi, '$1<redacted>');
}

/** Associe chaque marque DOM à la dernière question démarrée avant elle. */
export function assignMarkQuestions(frames, marks, adapter) {
  adapter.reset?.();
  const starts = [];
  for (const f of frames) for (const ev of adapter.classify(f)) if (ev.type === 'question_start') starts.push({ t: f.t, q: ev.q });
  return marks
    .map((m) => {
      const prior = starts.filter((s) => s.t <= m.t).pop();
      return prior ? { t: m.t, type: m.name ?? m.type, q: prior.q } : null;
    })
    .filter(Boolean);
}

/** Enregistrements JSONL → capture au format de l'analyseur. */
export function captureFromRecords(records, { adapter, key } = {}) {
  const meta = records.find((r) => r.type === 'meta') ?? {};
  const keyRecord = [...records].reverse().find((r) => r.type === 'key');
  const rawFrames = records.filter((r) => r.type === 'frame');
  const rawMarks = records.filter((r) => r.type === 'mark');
  const origin = Math.min(...[...rawFrames, ...rawMarks].map((r) => r.t));
  const base = Number.isFinite(origin) ? origin : 0;
  const frames = normalizeFrames(rawFrames.map(({ type, t, ...rest }) => ({ t: Math.round((t - base) * 10) / 10, ...rest })));
  const marks = rawMarks.map(({ t, name, type }) => ({ t: Math.round((t - base) * 10) / 10, name: name ?? type }));
  const groundTruth = key ?? keyRecord?.groundTruth ?? [];
  return {
    meta: { ...meta, origin: base },
    groundTruth: groundTruth.length ? normalizeAnswerKey(groundTruth) : [],
    frames,
    marks: adapter ? assignMarkQuestions(frames, marks, adapter) : [],
  };
}

/** Capture → enregistrements JSONL (t décalé à `startedAt`) : sert aux fixtures et aux tests aller-retour. */
export function recordsFromCapture(capture, { startedAt = 1.7e12, adapter = 'mock-cometd', withKey = true } = {}) {
  return [
    { type: 'meta', schema: SCHEMA, adapter, startedAt, source: capture.meta?.source ?? 'capture' },
    ...(withKey ? [{ type: 'key', groundTruth: capture.groundTruth }] : []),
    ...capture.frames.map(({ id, seq, ...f }) => ({ type: 'frame', ...f, t: startedAt + f.t })),
    ...(capture.marks ?? []).map((m) => ({ type: 'mark', t: startedAt + m.t, name: m.type })),
  ];
}
