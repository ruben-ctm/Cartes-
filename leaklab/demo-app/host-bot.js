#!/usr/bin/env node
/**
 * Hôte automatisé en ligne de commande : crée une partie, attend un joueur, démarre, et
 * avance les questions au rythme normal (délais réels, pas accélérés). Utile pour rejouer un
 * scénario de façon reproductible pendant qu'un vrai navigateur (avec l'extension) joue le
 * rôle du joueur — c'est ce que fait `test/chromium-check.mjs`.
 *
 * Usage : node demo-app/host-bot.js --scenario L1 [--count 8] [--time 15] [--seed 42] [--port 5180]
 */
import WebSocket from 'ws';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const port = Number(args.port ?? process.env.PORT ?? 5180);
const scenario = args.scenario ?? 'L0';
const questionCount = Number(args.count ?? 8);
const timeAvailable = Number(args.time ?? 15) * 1000;
const revealDelay = args.revealDelay !== undefined ? Number(args.revealDelay) : undefined;
const seed = args.seed !== undefined ? Number(args.seed) : undefined;

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const log = (...a) => console.log(`[host-bot]`, ...a);

ws.on('open', () => {
  log(`création : scénario=${scenario} questions=${questionCount} temps=${timeAvailable}ms`);
  ws.send(JSON.stringify({ type: 'host_create', scenario, questionCount, timeAvailable, revealDelay, seed }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'error') { log('erreur :', msg.message); return; }
  if (msg.type === 'room_created') { log(`partie créée — code : ${msg.code} — ouvrez http://127.0.0.1:${port}/player.html et entrez ce code`); }
  if (msg.type === 'lobby_update') {
    log(`${msg.room.players.length} joueur(s) connecté(s)`);
    if (msg.room.players.length > 0 && msg.room.state === 'lobby') { log('démarrage…'); ws.send(JSON.stringify({ type: 'start' })); }
  }
  if (msg.type === 'question_result') log(`question ${msg.index + 1} — classement : ${msg.standings.map((p) => `${p.name}=${p.score}`).join(', ')}`);
  if (msg.type === 'game_over') { log('partie terminée :', msg.standings); ws.close(); process.exit(0); }
});

ws.on('error', (err) => { console.error('[host-bot] connexion impossible :', err.message); process.exit(1); });
