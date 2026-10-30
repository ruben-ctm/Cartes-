/**
 * Chronologie par question et classification de phase.
 *
 * Événements fournis par l'adaptateur de protocole (voir adapters/) :
 *   question_start · answer_sent (sortant) · answer_ack · time_up · question_result
 * Marques optionnelles (capturées dans le DOM) : dom_question_rendered.
 *
 * Phases d'une information disponible dans une trame de numéro `seq` :
 *   pre_question    : avant même l'apparition de la question ;
 *   pre_answer      : question affichée, le joueur n'a pas encore répondu ;
 *   post_answer     : le joueur a répondu, la correction officielle n'est pas arrivée ;
 *   post_correction : à partir de l'événement officiel de résultat (divulgation légitime).
 * La phase est calculée sur l'ordre des trames (`seq`), robuste aux horodatages égaux ;
 * les mesures de durée utilisent `t` (ms).
 */

export const PHASES = ['pre_question', 'pre_answer', 'post_answer', 'post_correction'];

const SLOTS = {
  question_start: ['seqQuestion', 'tQuestion'],
  answer_sent: ['seqAnswer', 'tAnswer'],
  answer_ack: ['seqAck', 'tAck'],
  time_up: ['seqTimeUp', 'tTimeUp'],
  question_result: ['seqResult', 'tResult'],
};

/** Trie par temps (stable), numérote `seq` et attribue un `id`. */
export function normalizeFrames(frames) {
  return frames
    .map((f, i) => ({ ...f, _i: i }))
    .sort((a, b) => a.t - b.t || a._i - b._i)
    .map((f, seq) => {
      const { _i, ...rest } = f;
      return { ...rest, seq, id: rest.id ?? `f${seq}` };
    });
}

export function buildTimeline(frames, marks, adapter) {
  const byQ = new Map();
  const entry = (q) => byQ.get(q) ?? byQ.set(q, { q }).get(q);

  for (const frame of frames) {
    for (const ev of adapter.classify(frame)) {
      const slot = SLOTS[ev.type];
      if (!slot) continue;
      const e = entry(ev.q);
      if (e[slot[0]] === undefined) { e[slot[0]] = frame.seq; e[slot[1]] = frame.t; }
    }
  }
  for (const m of marks ?? []) {
    if (m.type !== 'dom_question_rendered') continue;
    const e = entry(m.q);
    if (e.tRender === undefined) e.tRender = m.t;
  }

  const questions = [...byQ.values()].filter((e) => e.seqQuestion !== undefined).sort((a, b) => a.seqQuestion - b.seqQuestion);

  return {
    questions,
    get: (q) => byQ.get(q),
    /** Question en cours à la trame `seq` (la dernière démarrée), ou null. */
    contextQ(seq) {
      let current = null;
      for (const e of questions) { if (e.seqQuestion <= seq) current = e.q; else break; }
      return current;
    },
    /** Phase d'une information disponible à la trame `seq` pour la question `q`. */
    phaseOf(q, seq) {
      const e = byQ.get(q);
      if (!e || e.seqQuestion === undefined) return null;
      if (seq < e.seqQuestion) return 'pre_question';
      const end = e.seqResult ?? Infinity;
      const answered = e.seqAnswer ?? Infinity;
      if (seq < Math.min(answered, end)) return 'pre_answer';
      if (seq < end) return 'post_answer';
      return 'post_correction';
    },
  };
}
