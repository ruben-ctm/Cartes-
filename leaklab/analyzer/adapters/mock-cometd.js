/**
 * Adaptateur du protocole simulé du banc d'essai (enveloppes de type Bayeux/CometD).
 *
 *   [{ "channel": "/service/player",
 *      "data": { "type": "startQuestion", "content": "{\"questionIndex\":3,…}" } }]
 *
 * Un adaptateur fournit `classify(frame) → [{ type, q }]`. Pour analyser un autre
 * protocole, on écrit un adaptateur équivalent ; le détecteur, lui, n'en dépend pas.
 */

export const EVENTS = {
  startQuestion: { type: 'question_start', dir: 'in' },
  submitAnswer: { type: 'answer_sent', dir: 'out' },
  answerAck: { type: 'answer_ack', dir: 'in' },
  timeUp: { type: 'time_up', dir: 'in' },
  questionResult: { type: 'question_result', dir: 'in' },
};

export const mockCometdAdapter = {
  name: 'mock-cometd/1',
  classify(frame) {
    if (frame.kind && frame.kind !== 'ws') return [];
    let messages;
    try { messages = JSON.parse(frame.data); } catch { return []; }
    const events = [];
    for (const msg of Array.isArray(messages) ? messages : [messages]) {
      const spec = EVENTS[msg?.data?.type];
      if (!spec || spec.dir !== frame.dir) continue;
      let content = msg.data.content;
      if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = null; } }
      if (Number.isInteger(content?.questionIndex)) events.push({ type: spec.type, q: content.questionIndex });
    }
    return events;
  },
};
