/**
 * Pont (monde isolé) : relaie les enregistrements du hook vers le service worker, et détecte
 * dans le DOM l'apparition des boutons de réponse de `player.html` (marque `dom_question_rendered`).
 * Sélecteur propre à cette application de test (`#choices button`), pas une hypothèse générique.
 */
(() => {
  const CHANNEL = '__leaklab__';
  const now = () => performance.timeOrigin + performance.now();
  let buffer = [];
  let timer = null;

  const flush = () => {
    timer = null;
    if (!buffer.length) return;
    const records = buffer;
    buffer = [];
    try {
      const p = chrome.runtime.sendMessage({ kind: 'records', records });
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* extension rechargée : la page continue normalement */ }
  };
  const push = (rec) => { buffer.push(rec); if (!timer) timer = setTimeout(flush, 80); };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data[CHANNEL]) return;
    push(e.data.rec);
  });

  let present = false;
  let scheduled = false;
  const check = () => {
    scheduled = false;
    const visible = Boolean(document.querySelector('#choices button'));
    if (visible && !present) push({ type: 'mark', t: now(), name: 'dom_question_rendered' });
    present = visible;
  };
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(check); } })
    .observe(document, { childList: true, subtree: true });
})();
