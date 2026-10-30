/**
 * Logique des parties du quiz de démonstration : protocole JSON simple sur WebSocket
 * (propre à ce projet, indépendant de Kahoot et de CometD), un message = un objet JSON.
 *
 * Réutilise lab/quiz.js (génération du quiz) et lab/profiles.js (fonctions `decorate*`,
 * déjà testées dans le laboratoire) pour appliquer les scénarios de sécurité : aucune
 * logique de fuite n'est dupliquée ici, seul le transport réseau est réel.
 *
 * Messages client → serveur : host_create, join, start, answer
 * Messages serveur → client : room_created, lobby_update, question_start, answer_ack,
 *                             time_up, question_result, game_over, error
 * REST : GET /api/quiz/:code/definition (scénario L3 : servi avec ou sans drapeaux)
 */

import { mulberry32 } from '../lab/prng.js';
import { generateQuiz } from '../lab/quiz.js';
import { PROFILES } from '../lab/profiles.js';

export const SCENARIOS = Object.fromEntries(
  Object.entries(PROFILES).map(([id, p]) => [id, { id, title: p.title, description: p.description, expected: p.expected }]),
);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Room {
  /** @param {object} opts { scenario, questionCount, seed, timeAvailable } */
  constructor(opts, hostSocket) {
    const profile = PROFILES[opts.scenario];
    if (!profile) throw new Error(`Scénario inconnu : ${opts.scenario}`);
    this.code = genCode();
    this.scenario = opts.scenario;
    this.profile = profile;
    this.timeAvailable = Math.min(60000, Math.max(150, Number(opts.timeAvailable) || 12000));
    this.revealDelay = Math.min(10000, Math.max(100, Number(opts.revealDelay) || 2500));
    this.hostSocket = hostSocket;
    this.players = new Map(); // ws -> { id, name, answers: Map<q, {choiceIndex, t}> }
    this.state = 'lobby'; // lobby | question | reveal | ended
    this.currentIndex = -1;
    this.timer = null;

    const seed = Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 1e9);
    const rand = mulberry32(seed);
    this.quiz = generateQuiz(rand, Math.min(20, Math.max(3, Number(opts.questionCount) || 8)));
    this.quiz.timeAvailable = this.timeAvailable;
    this.seed = seed;
  }

  groundTruth() {
    return this.quiz.questions.map((q, i) => ({ q: i, correctIndex: q.correctIndex, choices: q.choices }));
  }

  /** Définition REST du quiz (GET /api/quiz/:code/definition) : propre, sauf au scénario L3. */
  restDefinition() {
    const def = {
      uuid: this.quiz.uuid,
      title: this.quiz.title,
      questionCount: this.quiz.questions.length,
      questions: this.quiz.questions.map((q) => ({
        question: q.text,
        type: 'quiz',
        time: this.timeAvailable,
        choices: q.choices.map((text) => ({ answer: text })),
      })),
    };
    this.profile.decorateQuizDefinition?.(def, { quiz: this.quiz }, this.profile.defaultKeys);
    return def;
  }

  lobbySnapshot() {
    return { code: this.code, scenario: this.scenario, state: this.state, questionCount: this.quiz.questions.length, timeAvailable: this.timeAvailable, players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score })) };
  }

  broadcast(msg, { toHost = true, toPlayers = true } = {}) {
    const text = JSON.stringify(msg);
    if (toHost && this.hostSocket?.readyState === 1) this.hostSocket.send(text);
    if (toPlayers) for (const ws of this.players.keys()) if (ws.readyState === 1) ws.send(text);
  }

  addPlayer(ws, name) {
    const id = `p${this.players.size + 1}-${Math.random().toString(36).slice(2, 6)}`;
    this.players.set(ws, { id, name: String(name || 'Joueur').slice(0, 24), score: 0, answers: new Map() });
    this.broadcast({ type: 'lobby_update', room: this.lobbySnapshot() });
    return id;
  }

  removePlayer(ws) {
    this.players.delete(ws);
    this.broadcast({ type: 'lobby_update', room: this.lobbySnapshot() });
  }

  start() {
    if (this.state !== 'lobby' || !this.players.size) return;
    this.nextQuestion();
  }

  nextQuestion() {
    clearTimeout(this.timer);
    this.currentIndex++;
    if (this.currentIndex >= this.quiz.questions.length) return this.end();
    this.state = 'question';
    const q = this.quiz.questions[this.currentIndex];
    const msg = {
      type: 'question_start',
      index: this.currentIndex,
      questionCount: this.quiz.questions.length,
      text: q.text,
      choices: q.choices.map((text) => ({ text })),
      timeAvailable: this.timeAvailable,
      serverTime: Date.now(),
    };
    this.profile.decorateQuestion?.(msg, { question: q, q: this.currentIndex }, this.profile.defaultKeys);
    for (const p of this.players.values()) p.answers.delete(this.currentIndex);
    this.broadcast(msg);
    this.timer = setTimeout(() => this.timeUp(), this.timeAvailable);
  }

  answer(ws, choiceIndex) {
    const player = this.players.get(ws);
    if (!player || this.state !== 'question' || player.answers.has(this.currentIndex)) return;
    const idx = Number(choiceIndex);
    if (!Number.isInteger(idx)) return;
    player.answers.set(this.currentIndex, { choiceIndex: idx, t: Date.now() });
    const ack = { type: 'answer_ack', index: this.currentIndex, accepted: true, choiceIndex: idx };
    const q = this.quiz.questions[this.currentIndex];
    this.profile.decorateAck?.(ack, { question: q, q: this.currentIndex }, this.profile.defaultKeys);
    if (ws.readyState === 1) ws.send(JSON.stringify(ack));
  }

  timeUp() {
    if (this.state !== 'question') return;
    this.broadcast({ type: 'time_up', index: this.currentIndex });
    setTimeout(() => this.reveal(), Math.min(250, this.revealDelay));
  }

  reveal() {
    this.state = 'reveal';
    const q = this.quiz.questions[this.currentIndex];
    const resultBase = { type: 'question_result', index: this.currentIndex, correctChoices: [q.correctIndex], correctIndex: q.correctIndex };
    for (const [ws, player] of this.players) {
      const a = player.answers.get(this.currentIndex);
      const isCorrect = a?.choiceIndex === q.correctIndex;
      if (isCorrect) player.score += 800;
      if (ws.readyState === 1) ws.send(JSON.stringify({ ...resultBase, isCorrect, yourChoice: a?.choiceIndex ?? null, points: isCorrect ? 800 : 0, score: player.score }));
    }
    if (this.hostSocket?.readyState === 1) this.hostSocket.send(JSON.stringify({ ...resultBase, standings: [...this.players.values()].map((p) => ({ name: p.name, score: p.score })) }));
    this.timer = setTimeout(() => this.nextQuestion(), this.revealDelay);
  }

  end() {
    this.state = 'ended';
    this.broadcast({ type: 'game_over', standings: [...this.players.values()].sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score })) });
  }

  destroy() {
    clearTimeout(this.timer);
  }
}

export class RoomRegistry {
  constructor() { this.rooms = new Map(); }
  create(opts, hostSocket) {
    const room = new Room(opts, hostSocket);
    this.rooms.set(room.code, room);
    return room;
  }
  get(code) { return this.rooms.get(String(code || '').toUpperCase()); }
  delete(code) { this.rooms.get(code)?.destroy(); this.rooms.delete(code); }
}
