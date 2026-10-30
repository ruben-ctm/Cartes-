// Contrôleur du tableau de bord : lit les sessions capturées par l'extension (chrome.storage),
// les analyse en direct avec l'analyseur vendu (vendor/analyzer/, copie de leaklab/analyzer/)
// et les affiche avec la même bibliothèque de rendu que le banc d'essai (vendor/ui/app.js).
import { $, html, show, showError } from '../vendor/ui/app.js';
import { analyze, getAdapter, parseJsonl, toJsonl, captureFromRecords } from '../vendor/analyzer/index.js';

const INDEX = 'leaklab:index';
const dataKey = (id) => `leaklab:s:${id}`;
const keyStoreKey = (id) => `leaklab:key:${id}`;
const adapter = getAdapter('demo-app');

let sessions = [];
let currentId = null;
let pollTimer = null;

async function listSessions() {
  const store = await chrome.storage.local.get(INDEX);
  return (store[INDEX] ?? []).sort((a, b) => b.startedAt - a.startedAt);
}

async function getRecords(id) {
  const store = await chrome.storage.local.get([dataKey(id), keyStoreKey(id)]);
  return { records: store[dataKey(id)] ?? [], rawKey: store[keyStoreKey(id)] ?? null };
}

/** URL http(s) du serveur de l'application de test, déduite d'une trame `ws_open` capturée. */
function httpOriginOf(records) {
  const open = records.find((r) => r.type === 'event' && r.name === 'ws_open');
  if (!open) return null;
  try { const u = new URL(open.url); return `http://${u.host}`; } catch { return null; }
}

function playerIdOf(records) {
  for (const r of records) {
    if (r.type !== 'frame' || r.dir !== 'in') continue;
    try { const msg = JSON.parse(r.data); if (msg?.type === 'joined' && msg.playerId) return msg.playerId; } catch { /* ignorer */ }
  }
  return null;
}

async function render() {
  if (!currentId) { showError('Aucune session capturée pour l’instant. Ouvrez player.html de l’application de test dans un autre onglet.'); return; }
  const { records, rawKey } = await getRecords(currentId);
  if (!records.length) { showError('Session vide.'); return; }
  const capture = captureFromRecords(records, { adapter, key: rawKey ?? [] });
  const result = analyze(capture, { adapter });
  if (!rawKey) {
    $('verdict').className = 'verdict warn';
    $('verdict').innerHTML = `<strong>Clé de réponses manquante</strong><span class="meta">${capture.frames.length} trames capturées ·
      entrez le code de la partie (affiché côté hôte) puis « Récupérer la clé de réponses » pour lancer l’analyse.</span>`;
    $('legend').innerHTML = ''; $('timeline').innerHTML = ''; $('axisHint').textContent = '';
    $('candidates').innerHTML = ''; $('frames').innerHTML = ''; $('inspQ').textContent = '';
    return;
  }
  const session = sessions.find((s) => s.id === currentId);
  show({ capture, result, profile: { id: session?.closed ? 'terminée' : 'en direct', title: `${capture.frames.length} trames`, description: '' } }, { keepSelection: true });
}

async function refreshSessionList({ preserveSelection = true } = {}) {
  sessions = await listSessions();
  const sel = $('session');
  const prev = preserveSelection ? currentId : null;
  sel.innerHTML = sessions.map((s) => `<option value="${s.id}">${new Date(s.startedAt).toLocaleTimeString()} — onglet ${s.tabId} — ${s.frames} trame(s)${s.closed ? ' (fermée)' : ' (active)'}</option>`).join('')
    || '<option value="">(aucune session)</option>';
  currentId = sessions.some((s) => s.id === prev) ? prev : (sessions[0]?.id ?? null);
  sel.value = currentId ?? '';
  const session = sessions.find((s) => s.id === currentId);
  const liveEl = $('liveStatus');
  liveEl.textContent = session ? (session.closed ? '● terminée' : '● en direct') : '○ aucune session';
  liveEl.className = `live${session && !session.closed ? '' : ' idle'}`;
}

async function fetchKey() {
  const msg = $('keyMsg');
  msg.className = 'hint'; msg.textContent = 'Recherche…';
  try {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!code) throw new Error('Entrez le code de la partie (affiché sur la page de l’hôte).');
    const { records } = await getRecords(currentId);
    const origin = httpOriginOf(records);
    const playerId = playerIdOf(records);
    if (!origin || !playerId) throw new Error('Pas encore assez de trames capturées : rejoignez la partie dans l’onglet observé d’abord.');
    const res = await fetch(`${origin}/api/session/${code}/${playerId}.jsonl`);
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Erreur serveur (${res.status})`);
    const keyRecord = parseJsonl(await res.text()).find((r) => r.type === 'key');
    if (!keyRecord) throw new Error('Réponse du serveur sans clé de réponses.');
    await chrome.storage.local.set({ [keyStoreKey(currentId)]: keyRecord.groundTruth });
    msg.textContent = `Clé récupérée (${keyRecord.groundTruth.length} question(s)) — analyse en cours.`;
  } catch (err) {
    msg.className = 'hint err';
    msg.textContent = err.message;
  }
}

async function exportSession() {
  const { records, rawKey } = await getRecords(currentId);
  const out = rawKey ? [records[0], { type: 'key', groundTruth: rawKey }, ...records.slice(1)] : records;
  const blob = new Blob([toJsonl(out)], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leaklab-session-${currentId}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function deleteSession() {
  if (!currentId) return;
  const store = await chrome.storage.local.get(INDEX);
  const index = (store[INDEX] ?? []).filter((s) => s.id !== currentId);
  await chrome.storage.local.remove([dataKey(currentId), keyStoreKey(currentId)]);
  await chrome.storage.local.set({ [INDEX]: index });
  currentId = null;
  await refreshSessionList({ preserveSelection: false });
  await render();
}

$('session').addEventListener('change', async (e) => { currentId = e.target.value || null; await render(); });
$('keyBtn').addEventListener('click', fetchKey);
$('exportBtn').addEventListener('click', exportSession);
$('deleteBtn').addEventListener('click', deleteSession);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (INDEX in changes) refreshSessionList().then(render);
  else if (currentId && (dataKey(currentId) in changes || keyStoreKey(currentId) in changes)) render();
});

await refreshSessionList({ preserveSelection: false });
await render();
// Filet de sécurité : si chrome.storage.onChanged ne se déclenche pas assez vite (le worker
// peut être en sommeil), un rafraîchissement périodique garde le tableau de bord à jour.
pollTimer = setInterval(() => refreshSessionList().then(render), 1500);
