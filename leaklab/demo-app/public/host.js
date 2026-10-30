// Page hôte : crée la partie, affiche le code et les joueurs, démarre et suit la progression.
const $ = (id) => document.getElementById(id);
const html = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let ws;
let scenarios = [];

async function loadScenarios() {
  scenarios = await (await fetch('/api/scenarios')).json();
  $('scenario').innerHTML = scenarios.map((s) => `<option value="${s.id}">${s.id} — ${html(s.title)}</option>`).join('');
  updateDesc();
}
function updateDesc() {
  const s = scenarios.find((s) => s.id === $('scenario').value);
  $('scenarioDesc').textContent = s ? s.description : '';
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => { $('setupErr').textContent = 'Connexion perdue.'; });
  return new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
}

function onMessage(msg) {
  if (msg.type === 'error') { $('setupErr').textContent = msg.message; return; }
  if (msg.type === 'room_created') return showLobby(msg);
  if (msg.type === 'lobby_update') return renderPlayers(msg.room);
  if (msg.type === 'question_result') return renderStandings(msg);
  if (msg.type === 'game_over') return showOver(msg);
  if (msg.type === 'question_start') { $('qIndex').textContent = msg.index + 1; $('qTotal').textContent = msg.questionCount; $('qState').textContent = `Question affichée chez les joueurs : « ${msg.text} »`; }
  if (msg.type === 'time_up') $('qState').textContent = 'Temps écoulé — révélation en cours…';
}

function showLobby(msg) {
  $('setup').hidden = true; $('lobby').hidden = false;
  $('roomCode').textContent = msg.code;
  $('roomScenario').textContent = msg.scenario;
  $('playerUrl').textContent = `${location.origin}/player.html`;
}

function renderPlayers(room) {
  $('players').innerHTML = room.players.length ? room.players.map((p) => `<li>${html(p.name)}</li>`).join('') : '<li class="muted">En attente…</li>';
  $('startBtn').disabled = room.players.length === 0 || room.state !== 'lobby';
}

function renderStandings(msg) {
  $('game').hidden = false; $('lobby').hidden = true;
  $('qState').textContent = `Résultat de la question ${msg.index + 1} envoyé aux joueurs.`;
  $('standings').innerHTML = `<tr><th>Joueur</th><th>Score</th></tr>` + (msg.standings ?? []).map((p) => `<tr><td>${html(p.name)}</td><td>${p.score}</td></tr>`).join('');
}

function showOver(msg) {
  $('game').hidden = true; $('over').hidden = false;
  $('finalStandings').innerHTML = `<tr><th>Rang</th><th>Joueur</th><th>Score</th></tr>` + msg.standings.map((p, i) => `<tr><td>${i + 1}</td><td>${html(p.name)}</td><td>${p.score}</td></tr>`).join('');
}

$('scenario').addEventListener('change', updateDesc);
$('createBtn').addEventListener('click', async () => {
  $('setupErr').textContent = '';
  $('createBtn').disabled = true;
  await connect();
  ws.send(JSON.stringify({
    type: 'host_create',
    scenario: $('scenario').value,
    questionCount: Number($('count').value),
    timeAvailable: Number($('time').value) * 1000,
    seed: $('seed').value ? Number($('seed').value) : undefined,
  }));
});
$('startBtn').addEventListener('click', () => ws.send(JSON.stringify({ type: 'start' })));

loadScenarios();
