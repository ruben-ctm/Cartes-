/** Rapport texte lisible d'un résultat d'analyse (CLI, journaux, popup de l'extension). */

const PHASE_LABELS = {
  pre_question: 'avant la question',
  pre_answer: 'avant la réponse',
  post_answer: 'après la réponse',
  post_correction: 'après la correction',
};

const fmtMs = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${(x / 1000).toFixed(2)} s`);

export function summarize(result) {
  const lines = [`Verdict : ${result.verdictLabel} [${result.verdict}]`, `Questions : ${result.questionsAnalyzed} · trames entrantes : ${result.framesAnalyzed}`];
  if (!result.candidates.length) lines.push('Aucun champ ne désigne la bonne réponse.');
  for (const c of result.candidates) {
    lines.push(
      '',
      `• ${c.template}  (${c.variant})`,
      `  phase : ${PHASE_LABELS[c.worstPhase]} · réussite ${c.hits}/${c.n} · p=${c.pValue.toExponential(1)}`,
      `  lisible ${fmtMs(c.medianDtFromQuestionMs)} après l'apparition de la question (min ${fmtMs(c.minDtFromQuestionMs)})`,
      `  avance sur la réponse du joueur (médiane) : ${fmtMs(c.medianLeadToAnswerMs)}`,
      ...c.notes.map((n) => `  note : ${n}`),
    );
  }
  return lines.join('\n');
}
