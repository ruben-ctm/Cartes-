/**
 * Service worker : reçoit les enregistrements du pont et les range par session (une session =
 * un chargement de page) dans chrome.storage.local. Aucune analyse ici : le tableau de bord
 * (ui/dashboard.html) appelle l'analyseur vendu dans vendor/analyzer/ (copie de analyzer/,
 * voir build.js) sur les enregistrements bruts, en direct.
 *
 * Stockage : leaklab:index  → [{ id, tabId, startedAt, frames, closed, updatedAt }]
 *            leaklab:s:<id> → enregistrements de la session (meta, frame, event, mark)
 */
const INDEX = 'leaklab:index';
const dataKey = (id) => `leaklab:s:${id}`;

let queue = Promise.resolve(); // sérialise les écritures (le worker peut traiter plusieurs messages en parallèle)

async function ingest(tabId, records) {
  const store = await chrome.storage.local.get(INDEX);
  const index = store[INDEX] ?? [];
  let session = index.filter((s) => s.tabId === tabId && !s.closed).pop();
  let data = session ? ((await chrome.storage.local.get(dataKey(session.id)))[dataKey(session.id)] ?? []) : [];

  for (const rec of records) {
    // Un nouveau `hook_installed` sur un onglet déjà en session = la page a été rechargée.
    const reload = rec.name === 'hook_installed' && session && session.frames > 0;
    if (!session || reload) {
      if (session) { session.closed = true; await chrome.storage.local.set({ [dataKey(session.id)]: data }); }
      session = { id: `${Date.now().toString(36)}-${tabId}`, tabId, startedAt: Date.now(), frames: 0 };
      index.push(session);
      data = [{ type: 'meta', schema: 1, adapter: 'demo-app', source: 'extension-live-capture', startedAt: Date.now(), tabId }];
    }
    data.push(rec);
    if (rec.type === 'frame') session.frames++;
    session.updatedAt = Date.now();
  }
  await chrome.storage.local.set({ [INDEX]: index, [dataKey(session.id)]: data });
  chrome.action.setBadgeText({ tabId, text: String(session.frames) }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.kind !== 'records' || !sender.tab) return;
  queue = queue.then(() => ingest(sender.tab.id, msg.records)).catch((e) => console.warn('leaklab ingest', e));
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('ui/dashboard.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queue = queue.then(async () => {
    const store = await chrome.storage.local.get(INDEX);
    const index = (store[INDEX] ?? []).map((s) => (s.tabId === tabId ? { ...s, closed: true } : s));
    await chrome.storage.local.set({ [INDEX]: index });
  });
});
