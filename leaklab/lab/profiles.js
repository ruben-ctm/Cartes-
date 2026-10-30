/**
 * Profils de serveur simulé. Chaque profil décide quelles données (et quand) sont envoyées
 * au client. Les noms de champs sont paramétrables (`keys`) pour prouver que le détecteur
 * n'en dépend pas.
 *
 *   L0  saine            : la correction n'apparaît qu'à l'événement officiel de résultat
 *   L1  drapeau en clair : `choices[].correct` dans la trame de début de question
 *   L2  obfusquée        : index en base64 + md5 du texte dans la trame de début de question
 *   L3  fuite REST       : définition du quiz (avec drapeaux) servie au lobby, avant toute question
 *   L4  fuite tardive    : l'accusé de réponse contient la solution, avant la fin du temps imparti
 */

import { md5 } from '../analyzer/hashers.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

export const PROFILES = {
  L0: {
    id: 'L0',
    title: 'Serveur sain (témoin négatif)',
    description: "La bonne réponse n'est envoyée qu'avec l'événement officiel de résultat, après la fin du temps imparti.",
    expected: { verdict: 'NO_PREMATURE_DISCLOSURE', worstPhase: 'post_correction' },
    defaultKeys: {},
  },
  L1: {
    id: 'L1',
    title: 'Drapeau en clair dans la question',
    description: 'Chaque choix de la trame de début de question porte un booléen indiquant s’il est correct.',
    expected: { verdict: 'LEAK_BEFORE_ANSWER', worstPhase: 'pre_answer' },
    defaultKeys: { flag: 'correct' },
    decorateQuestion(content, { question }, keys) {
      content.choices = content.choices.map((c, i) => ({ ...c, [keys.flag]: i === question.correctIndex }));
    },
  },
  L2: {
    id: 'L2',
    title: 'Fuite obfusquée (base64 + hachage)',
    description: 'La trame de question embarque l’index en base64 et le md5 du texte correct sous des noms opaques.',
    expected: { verdict: 'LEAK_BEFORE_ANSWER', worstPhase: 'pre_answer' },
    defaultKeys: { container: 'meta', ref: 'ref', sig: 'sig' },
    decorateQuestion(content, { question }, keys) {
      content[keys.container] = {
        [keys.ref]: b64(String(question.correctIndex)),
        [keys.sig]: md5(question.choices[question.correctIndex]),
        build: 'a41f', // leurre
      };
    },
  },
  L3: {
    id: 'L3',
    title: 'Fuite via la définition REST du quiz',
    description: 'Au lobby, le client télécharge la définition complète du quiz avec les drapeaux de correction.',
    expected: { verdict: 'LEAK_BEFORE_ANSWER', worstPhase: 'pre_question' },
    defaultKeys: { flag: 'correct' },
    decorateQuizDefinition(def, { quiz }, keys) {
      def.questions = def.questions.map((q, i) => ({
        ...q,
        choices: q.choices.map((c, j) => ({ ...c, [keys.flag]: j === quiz.questions[i].correctIndex })),
      }));
    },
  },
  L4: {
    id: 'L4',
    title: 'Fuite tardive dans l’accusé de réponse',
    description: 'Dès que le joueur répond, l’accusé renvoie la solution — avant la fin du temps imparti.',
    expected: { verdict: 'LEAK_AFTER_ANSWER', worstPhase: 'post_answer' },
    defaultKeys: { solution: 'solution' },
    decorateAck(content, { question }, keys) {
      content[keys.solution] = question.correctIndex;
    },
  },
};

export const profileList = () => Object.values(PROFILES).map(({ id, title, description, expected }) => ({ id, title, description, expected }));
