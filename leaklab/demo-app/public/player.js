// Page joueur. Ne lit et n'affiche QUE ce qu'un joueur verrait normalement : texte de la
// question, choix, décompte, puis le résultat officiel. Une trame contenant la bonne réponse
// en avance (scénarios vulnérables) n'est jamais exploitée ici — c'est le rôle de l'extension
// d'observation, séparée de cette page, de le révéler.
const $ = (id) => document.getElementById(id);
const html = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let ws, playerId, answered = false, barTimer;

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => { $('qStatus').textContent = 'Connexion perdue.'; });
  return new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
}

function onMessage(msg) {
  if (msg.type === 'error') { $('joinErr').textContent = msg.message; return; }
  if (msg.type === 'joined') return showLobby(msg);
  if (msg.type === 'lobby_update') { $('waitMsg').textContent = `${msg.room.players.length} joueur(s) dans la partie.`; return; }
  if (msg.type === 'question_start') return showQuestion(msg);
  if (msg.type === 'time_up') { $('qStatus').textContent = 'Temps écoulé — correction en cours…'; disableChoices(); }
  if (msg.type === 'question_result') return showResult(msg);
  if (msg.type === 'game_over') return showOver(msg);
}

function showLobby(msg) {
  $('join').hidden = true; $('lobby').hidden = false;
  playerId = msg.playerId;
  $('roomCode').textContent = msg.room.code;
  // Préchargement réaliste de la définition du quiz au lobby (comme un client qui construit
  // son modèle de données à l'avance) ; l'extension observe cette requête comme les autres.
  fetch(`/api/quiz/${msg.room.code}/definition?playerId=${playerId}`).catch(() => {});
}

function disableChoices() { document.querySelectorAll('#choices button').forEach((b) => (b.disabled = true)); }

function showQuestion(msg) {
  $('lobby').hidden = true; $('question').hidden = false; $('over').hidden = true;
  answered = false;
  $('qIndex').textContent = msg.index + 1; $('qTotal').textContent = msg.questionCount;
  $('qText').textContent = msg.text;
  $('qStatus').textContent = '';
  $('choices').innerHTML = msg.choices.map((c, i) => `<button data-i="${i}">${html(c.text)}</button>`).join('');
  document.querySelectorAll('#choices button').forEach((b) => b.addEventListener('click', () => submit(msg.index, Number(b.dataset.i))));

  clearInterval(barTimer);
  const end = (msg.serverTime ?? Date.now()) + msg.timeAvailable;
  const tick = () => { $('qBar').style.width = `${Math.max(0, (end - Date.now()) / msg.timeAvailable * 100)}%`; };
  tick(); barTimer = setInterval(tick, 100);
}

function submit(index, choiceIndex) {
  if (answered) return;
  answered = true;
  document.querySelectorAll('#choices button').forEach((b) => { b.disabled = true; if (Number(b.dataset.i) === choiceIndex) b.classList.add('picked'); });
  $('qStatus').textContent = 'Réponse envoyée — en attente des autres joueurs…';
  ws.send(JSON.stringify({ type: 'answer', index, choiceIndex }));
}

function showResult(msg) {
  clearInterval(barTimer);
  disableChoices();
  document.querySelectorAll('#choices button').forEach((b) => {
    const i = Number(b.dataset.i);
    if (i === msg.correctIndex) b.classList.add('correct');
    else if (i === msg.yourChoice) b.classList.add('wrong');
  });
  $('qStatus').textContent = msg.isCorrect ? `Bonne réponse ! +${msg.points} points (score : ${msg.score})` : `Mauvaise réponse. Score : ${msg.score}`;
}

function showOver(msg) {
  $('question').hidden = true; $('over').hidden = false;
  $('finalScore').textContent = 'voir le classement ci-dessous';
  $('finalStandings').innerHTML = `<tr><th>Rang</th><th>Joueur</th><th>Score</th></tr>` + msg.standings.map((p, i) => `<tr><td>${i + 1}</td><td>${html(p.name)}</td><td>${p.score}</td></tr>`).join('');
}

$('joinBtn').addEventListener('click', async () => {
  $('joinErr').textContent = '';
  const code = $('code').value.trim().toUpperCase();
  const name = $('name').value.trim() || 'Joueur';
  if (!code) { $('joinErr').textContent = 'Entrez un code de partie.'; return; }
  await connect();
  ws.send(JSON.stringify({ type: 'join', code, name }));
});
