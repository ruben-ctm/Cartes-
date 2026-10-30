/**
 * Simule une session complète (lobby → N questions → fin) et produit une capture au
 * format attendu par l'analyseur. Aucun réseau : tout est déterministe d'après `seed`.
 */

import { mulberry32 } from './prng.js';
import { generateQuiz, groundTruthOf } from './quiz.js';
import { PROFILES } from './profiles.js';

const envelope = (channel, type, content, id) =>
  JSON.stringify([{ channel, id: String(id), data: { type, content: JSON.stringify(content) } }]);

/**
 * @param {object} options
 * @param {string} options.profile  L0…L4
 * @param {number} [options.seed=1]
 * @param {number} [options.questions=12]
 * @param {number} [options.accuracy=0.6]  probabilité que le joueur simulé réponde juste
 * @param {object} [options.keys]   noms de champs à substituer aux noms par défaut du profil
 */
export function simulate({ profile, seed = 1, questions = 12, accuracy = 0.6, keys = {} }) {
  const prof = PROFILES[profile];
  if (!prof) throw new Error(`Profil inconnu : ${profile}`);
  const rand = mulberry32(seed);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const k = { ...prof.defaultKeys, ...keys };
  const quiz = generateQuiz(rand, questions);

  const frames = [];
  const marks = [];
  let msgId = 0;
  let t = 0;
  const push = (dir, data, extra = {}) => frames.push({ t: Math.round(t * 10) / 10, dir, kind: 'ws', data, ...extra });

  // Lobby
  t += 120; push('out', envelope('/service/controller', 'join', { name: 'testeur' }, ++msgId));
  t += between(60, 110); push('in', envelope('/service/player', 'joined', { playerId: 'p1', lobby: true }, ++msgId));

  // Définition du quiz servie par REST (propre, sauf profil L3)
  t += between(40, 90);
  const definition = {
    uuid: quiz.uuid,
    title: quiz.title,
    questions: quiz.questions.map((q) => ({ question: q.text, type: 'quiz', time: quiz.timeAvailable, choices: q.choices.map((c) => ({ answer: c })) })),
  };
  prof.decorateQuizDefinition?.(definition, { quiz }, k);
  frames.push({ t: Math.round(t * 10) / 10, dir: 'in', kind: 'http', method: 'GET', url: `/rest/quizzes/${quiz.uuid}`, status: 200, data: JSON.stringify(definition) });

  t += between(1800, 2600);

  quiz.questions.forEach((question, q) => {
    // Début de question
    const content = {
      questionIndex: q,
      gameBlockType: 'quiz',
      timeAvailable: quiz.timeAvailable,
      quizQuestionAnswers: question.choices.length,
      question: question.text,
      choices: question.choices.map((text, i) => ({ text, shape: ['triangle', 'diamond', 'circle', 'square'][i] })),
      answerCounts: question.choices.map(() => 0), // leurre : tableau de la taille des choix
      serverTime: Math.round(1.7e12 + t),
      shuffleSeed: Math.floor(rand() * 1e6), // leurre : entier variable
    };
    prof.decorateQuestion?.(content, { question, q }, k);
    t += between(30, 80);
    const tQuestion = t;
    push('in', envelope('/service/player', 'startQuestion', content, ++msgId));
    marks.push({ t: Math.round((tQuestion + between(8, 35)) * 10) / 10, type: 'dom_question_rendered', q });

    // Réponse du joueur simulé
    const choice = rand() < accuracy ? question.correctIndex : (question.correctIndex + 1 + Math.floor(rand() * (question.choices.length - 1))) % question.choices.length;
    t = tQuestion + between(2500, 9000);
    push('out', envelope('/service/controller', 'submitAnswer', { questionIndex: q, choice, reactionMs: Math.round(t - tQuestion) }, ++msgId));
    t += between(35, 90);
    const ack = { questionIndex: q, accepted: true, choice };
    prof.decorateAck?.(ack, { question, q }, k);
    push('in', envelope('/service/player', 'answerAck', ack, ++msgId));

    // Fin du temps imparti, puis résultat officiel
    t = tQuestion + quiz.timeAvailable + between(10, 40);
    push('in', envelope('/service/player', 'timeUp', { questionIndex: q }, ++msgId));
    t += between(120, 260);
    push('in', envelope('/service/player', 'questionResult', {
      questionIndex: q,
      correctChoices: [question.correctIndex],
      isCorrect: choice === question.correctIndex,
      points: choice === question.correctIndex ? 800 + Math.floor(rand() * 200) : 0,
      rank: 1 + Math.floor(rand() * 5),
    }, ++msgId));
    t += between(2200, 3400);
  });

  push('in', envelope('/service/player', 'gameOver', { finalRank: 1 }, ++msgId));

  return {
    meta: { profile, seed, protocol: 'mock-cometd/1', accuracy, questions, quizUuid: quiz.uuid },
    groundTruth: groundTruthOf(quiz),
    frames,
    marks,
  };
}
