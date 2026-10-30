/**
 * Adaptateur pour le protocole du quiz de démonstration (`demo-app/`), un projet que nous
 * contrôlons entièrement : contrairement à `kahoot-cometd` (retiré), cette correspondance
 * n'est pas une hypothèse — elle reflète exactement `demo-app/rooms.js`, qui émet ces mêmes
 * champs. Un message = un objet JSON (pas d'enveloppe Bayeux).
 */

const EVENT_BY_TYPE = {
  question_start: 'question_start',
  answer: 'answer_sent', // sortant (joueur → serveur)
  answer_ack: 'answer_ack',
  time_up: 'time_up',
  question_result: 'question_result',
};

export const demoAppAdapter = {
  name: 'demo-app/1',
  verified: true,
  classify(frame) {
    if (frame.kind && frame.kind !== 'ws') return [];
    let msg;
    try { msg = JSON.parse(frame.data); } catch { return []; }
    const event = EVENT_BY_TYPE[msg?.type];
    if (!event) return [];
    const dirOk = event === 'answer_sent' ? frame.dir === 'out' : frame.dir === 'in';
    if (!dirOk || !Number.isInteger(msg.index)) return [];
    return [{ type: event, q: msg.index }];
  },
};
