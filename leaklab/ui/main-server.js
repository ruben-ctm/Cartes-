// Contrôleur du banc d'essai : simule un profil côté serveur local et affiche l'analyse.
import { $, html, show, showError } from '/ui/app.js';

async function load(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function run() {
  $('verdict').textContent = 'Simulation et analyse…';
  const q = new URLSearchParams({ profile: $('profile').value, seed: $('seed').value, accuracy: $('accuracy').value });
  try { show(await load(`/api/run?${q}`)); } catch (err) { showError(err.message); }
}

async function init() {
  const profiles = await load('/api/profiles');
  $('profile').innerHTML = profiles.map((p) => `<option value="${p.id}">${p.id} — ${html(p.title)}</option>`).join('');
  $('controls').addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
  $('profile').addEventListener('change', run);
  $('accuracy').addEventListener('input', () => { $('accuracyOut').textContent = `${Math.round($('accuracy').value * 100)} %`; });
  $('accuracy').addEventListener('change', run);
  // Capture JSON ou session JSONL du laboratoire (clé de réponses incluse).
  $('file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try { show(await load('/api/analyze', { method: 'POST', body: await file.text() })); } catch (err) { showError(err.message); }
  });
  const initial = new URLSearchParams(location.search).get('profile');
  if (initial) $('profile').value = initial;
  run();
}
init();
