// Rendu de la chronologie : main-server.js fournit { capture, result } à show().

export const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const PHASES = {
  pre_question: ['Avant la question', 'var(--pre-q)'],
  pre_answer: ['Avant la réponse', 'var(--pre-a)'],
  post_answer: ['Après la réponse', 'var(--post-a)'],
  post_correction: ['Après la correction', 'var(--post-c)'],
};
const COLORS = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
const VERDICT_CLASS = { LEAK_BEFORE_ANSWER: 'leak', LEAK_AFTER_ANSWER: 'leak', NO_PREMATURE_DISCLOSURE: 'ok', INCONCLUSIVE_PLAYER_ECHO: 'warn', INSUFFICIENT_DATA: 'warn' };
const X_MIN = -3000;

let state = null; // { capture, result, frames, selectedQ, selectedCand }

const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = (ms) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)} s`;
export const html = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function normalize(frames) {
  return frames
    .map((f, i) => ({ ...f, _i: i }))
    .sort((a, b) => a.t - b.t || a._i - b._i)
    .map((f, seq) => ({ ...f, seq, id: f.id ?? `f${seq}` }));
}

export function showError(message) {
  $('verdict').className = 'verdict warn';
  $('verdict').innerHTML = `<span class="err">${html(message)}</span>`;
}

export function show({ capture, result, profile }) {
  const q0 = result.timeline[0]?.q ?? null;
  state = { capture, result, profile, frames: normalize(capture.frames), selectedQ: q0, selectedCand: null };
  renderVerdict(); renderLegend(); renderTimeline(); renderCandidates(); renderFrames();
}

function renderVerdict() {
  const { result, profile } = state;
  const box = $('verdict');
  box.className = `verdict ${VERDICT_CLASS[result.verdict] ?? ''}`;
  const early = result.candidates.filter((c) => c.worstPhase !== 'post_correction').length;
  box.innerHTML = `<strong>${html(result.verdictLabel)}</strong>
    <span class="meta">${result.questionsAnalyzed} questions · ${result.framesAnalyzed} trames entrantes · ${early} champ(s) précoce(s)
    ${profile ? ` · profil ${profile.id} — ${html(profile.title)}` : ''}</span>
    ${profile ? `<span class="meta">${html(profile.description)}</span>` : ''}
    ${(result.warnings ?? []).map((w) => `<span class="meta err">⚠ ${html(w)}</span>`).join('')}`;
}

function renderLegend() {
  const marks = [['▌', 'début de question', 'var(--info)'], ['●', 'réponse du joueur', 'var(--warn)'], ['◆', 'accusé', 'var(--muted)'], ['■', 'fin du temps', 'var(--c1)'], ['★', 'résultat officiel', 'var(--ok)']];
  $('legend').innerHTML =
    Object.values(PHASES).map(([label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('') +
    marks.map(([sym, label, color]) => `<span><b style="color:${color}">${sym}</b> ${label}</span>`).join('') +
    '<span><b style="color:var(--leak)">◇</b> information correcte lisible</span>';
}

function renderTimeline() {
  const { result, selectedQ, selectedCand } = state;
  const rows = result.timeline;
  if (!rows.length) { $('timeline').innerHTML = '<p class="muted">Aucune question reconnue.</p>'; return; }
  const maxT = Math.max(...rows.map((e) => (e.tResult ?? e.tTimeUp ?? e.tQuestion) - e.tQuestion)) + 800;
  const W = 1100, left = 54, right = 16, top = 24, lane = 26;
  const H = top + rows.length * lane + 22;
  const x = (dt) => left + ((Math.max(dt, X_MIN) - X_MIN) / (maxT - X_MIN)) * (W - left - right);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Chronologie des événements par question' });

  for (let s = Math.ceil(X_MIN / 1000); s * 1000 <= maxT; s += s < 0 ? 1 : 5) {
    const gx = x(s * 1000);
    svg.append(el('line', { x1: gx, x2: gx, y1: top - 4, y2: H - 18, stroke: 'var(--line)', 'stroke-width': s === 0 ? 1.5 : 0.6 }));
    svg.append(el('text', { x: gx, y: H - 4, 'text-anchor': 'middle' }, `${s} s`));
  }
  svg.append(el('text', { x: left, y: 12 }, 'temps relatif à l’apparition de la question — ◀ : lisible bien avant (voir valeur)'));

  const shown = state.result.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.worstPhase !== 'post_correction' || selectedCand === c.id);
  rows.forEach((e, r) => {
    const y = top + r * lane;
    const g = el('g', { class: `lane${e.q === selectedQ ? ' sel' : ''}`, 'data-q': e.q });
    g.append(el('rect', { x: 0, y, width: W, height: lane, fill: 'transparent' }));
    g.append(el('text', { x: 6, y: y + 17, class: 'q' }, `Q${e.q + 1}`));
    const rel = (t) => t - e.tQuestion;
    const answer = e.tAnswer !== undefined ? rel(e.tAnswer) : Infinity;
    const result_ = e.tResult !== undefined ? rel(e.tResult) : Infinity;
    const segs = [['pre_answer', 0, Math.min(answer, result_)], ['post_answer', answer, result_], ['post_correction', result_, maxT]];
    if (X_MIN < 0) segs.unshift(['pre_question', X_MIN, 0]);
    for (const [phase, a, b] of segs) {
      if (!(b > a) || a === Infinity) continue;
      g.append(el('rect', { x: x(a), y: y + 4, width: Math.max(0, x(Math.min(b, maxT)) - x(a)), height: lane - 8, fill: PHASES[phase][1], rx: 2 }));
    }
    g.append(el('rect', { x: x(0) - 1.5, y: y + 2, width: 3, height: lane - 4, fill: 'var(--info)' }));
    const mark = (dt, shape, color) => { if (dt === undefined || dt === Infinity) return; const cx = x(dt), cy = y + lane / 2;
      if (shape === 'dot') g.append(el('circle', { cx, cy, r: 4, fill: color }));
      if (shape === 'diamond') g.append(el('path', { d: `M${cx} ${cy - 4}l4 4l-4 4l-4 -4z`, fill: color }));
      if (shape === 'square') g.append(el('rect', { x: cx - 3.5, y: cy - 3.5, width: 7, height: 7, fill: color }));
      if (shape === 'star') g.append(el('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', style: `fill:${color};font-size:15px` }, '★')); };
    mark(e.tAck !== undefined ? rel(e.tAck) : undefined, 'diamond', 'var(--muted)');
    mark(e.tAnswer !== undefined ? rel(e.tAnswer) : undefined, 'dot', 'var(--warn)');
    mark(e.tTimeUp !== undefined ? rel(e.tTimeUp) : undefined, 'square', 'var(--c1)');
    mark(e.tResult !== undefined ? rel(e.tResult) : undefined, 'star', 'var(--ok)');

    shown.forEach(({ c, i }) => {
      const hit = c.perQuestion.find((h) => h.q === e.q);
      if (!hit) return;
      const dim = selectedCand && selectedCand !== c.id;
      const cx = x(hit.dtFromQuestionMs), cy = y + lane / 2 + (i % 2 ? 5 : -5);
      const d = el('path', { class: `hit${dim ? ' dim' : ''}`, d: `M${cx} ${cy - 6}l6 6l-6 6l-6 -6z`, fill: 'none', stroke: COLORS[i % 5], 'stroke-width': 2.2 });
      d.append(el('title', {}, `${c.template} (${c.variant})\n${fmt(hit.dtFromQuestionMs)} après la question · ${PHASES[hit.phase][0]}`));
      g.append(d);
      if (hit.dtFromQuestionMs < X_MIN) g.append(el('text', { x: left + 12, y: cy + 4, style: `fill:${COLORS[i % 5]}` }, `◀ ${fmt(hit.dtFromQuestionMs)}`));
    });
    g.addEventListener('click', () => { state.selectedQ = e.q; renderTimeline(); renderFrames(); });
    svg.append(g);
  });
  $('timeline').replaceChildren(svg);
  $('axisHint').textContent = `(axe borné à ${X_MIN / 1000} s ; ${rows.length} questions)`;
}

function renderCandidates() {
  const { result, selectedCand } = state;
  if (!result.candidates.length) { $('candidates').innerHTML = '<p class="muted">Aucun champ ne désigne la bonne réponse.</p>'; return; }
  const rows = result.candidates.map((c, i) => `
    <tr class="cand${c.id === selectedCand ? ' sel' : ''}" data-id="${html(c.id)}">
      <td><span class="dot" style="background:${COLORS[i % 5]}"></span><code>${html(c.template)}</code><br><span class="muted">${html(c.variant)}</span>
        ${c.ambiguous ? '<br><span class="err">ambigu : écho possible de la sélection du joueur</span>' : ''}</td>
      <td><span class="badge b-${c.worstPhase}">${PHASES[c.worstPhase][0]}</span></td>
      <td>${c.hits}/${c.n}<br><span class="muted">p = ${c.pValue.toExponential(1)}</span></td>
      <td>${fmt(c.medianDtFromQuestionMs)}<br><span class="muted">min ${fmt(c.minDtFromQuestionMs)}</span></td>
      <td>${c.medianLeadToAnswerMs === null ? '—' : fmt(c.medianLeadToAnswerMs)}</td></tr>`).join('');
  const ignored = (result.ignored ?? []).map((i) => `<li><code>${html(i.id)}</code> — écarté (${html(i.reason)}) : ${html(i.detail)}</li>`).join('');
  $('candidates').innerHTML = `<table><thead><tr><th>Champ (chemin générique)</th><th>Phase</th><th>Réussite</th><th>Lisible (médiane)</th><th>Avance sur la réponse</th></tr></thead><tbody>${rows}</tbody></table>
    ${ignored ? `<p class="muted">Champs écartés :</p><ul class="muted">${ignored}</ul>` : ''}`;
  $('candidates').querySelectorAll('tr.cand').forEach((tr) => tr.addEventListener('click', () => {
    state.selectedCand = state.selectedCand === tr.dataset.id ? null : tr.dataset.id;
    renderTimeline(); renderCandidates(); renderFrames();
  }));
}

function frameLabel(f) {
  if (f.kind === 'http') return `${f.method ?? 'GET'} ${f.url} → ${f.status ?? ''}`;
  try { const m = JSON.parse(f.data)[0]; return `${m.channel} · ${m.data.type}`; } catch { return 'trame'; }
}

function pretty(f) {
  try {
    const v = JSON.parse(f.data);
    const expand = (n) => (typeof n === 'string' && /^[[{]/.test(n.trim()) ? (() => { try { return expand(JSON.parse(n)); } catch { return n; } })()
      : Array.isArray(n) ? n.map(expand) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).map(([k, x]) => [k, expand(x)])) : n);
    return JSON.stringify(expand(v), null, 2);
  } catch { return f.data; }
}

function renderFrames() {
  const { result, frames, selectedQ, selectedCand } = state;
  const e = result.timeline.find((x) => x.q === selectedQ);
  if (!e) { $('frames').innerHTML = '<p class="muted">Aucune question à inspecter.</p>'; $('inspQ').textContent = ''; return; }
  $('inspQ').textContent = `Q${e.q + 1}`;
  const hitsByFrame = new Map();
  result.candidates.forEach((c, i) => c.perQuestion.filter((h) => h.q === e.q).forEach((h) => {
    if (c.worstPhase === 'post_correction' && selectedCand !== c.id) return;
    hitsByFrame.set(h.frameId, [...(hitsByFrame.get(h.frameId) ?? []), { c, i, h }]);
  }));
  const last = e.seqResult ?? e.seqTimeUp ?? e.seqQuestion;
  const list = frames.filter((f) => (f.seq >= e.seqQuestion && f.seq <= last) || hitsByFrame.has(f.id));
  $('frames').innerHTML = list.map((f) => {
    const hits = hitsByFrame.get(f.id) ?? [];
    const rel = f.t - e.tQuestion;
    const badges = hits.map(({ c, i, h }) => `<span class="hitmark" style="color:${COLORS[i % 5]}">◇ ${html(c.variant)} · ${html(h.path)}</span>`).join(' ');
    return `<details${hits.length ? ' open' : ''}><summary><span class="t">${fmt(rel)}</span><span>${f.dir === 'in' ? '⬇ reçu' : '⬆ envoyé'}</span><span>${html(frameLabel(f))}</span>${badges}</summary><pre>${html(pretty(f))}</pre></details>`;
  }).join('');
}
