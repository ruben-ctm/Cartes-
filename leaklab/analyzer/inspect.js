/**
 * Inspection d'un protocole inconnu : regroupe les trames par (sens, canal, id, type) et
 * liste les clés du contenu, pour calibrer les règles d'un adaptateur sur une capture réelle.
 */

import { normalizeFrames } from './timeline.js';
import { decodeEmbedded } from './payload.js';

const MAX_KEYS = 40;

function contentKeys(value, prefix = '', depth = 0, out = new Set()) {
  if (out.size >= MAX_KEYS || value === null) return out;
  if (typeof value === 'string') {
    const decoded = decodeEmbedded(value);
    if (decoded) contentKeys(decoded.value, prefix, depth, out);
  } else if (Array.isArray(value)) {
    if (value.length && depth < 4) contentKeys(value[0], `${prefix}[]`, depth + 1, out);
  } else if (typeof value === 'object' && depth < 4) {
    for (const [k, v] of Object.entries(value)) {
      out.add(`${prefix}.${k}`.replace(/^\./, ''));
      contentKeys(v, `${prefix}.${k}`, depth + 1, out);
    }
  }
  return out;
}

export function inspectCapture(capture, { adapter } = {}) {
  adapter?.reset?.();
  const frames = normalizeFrames(capture.frames);
  const t0 = frames[0]?.t ?? 0;
  const groups = new Map();
  const add = (key, frame, base) => {
    const g = groups.get(key) ?? groups.set(key, { ...base, count: 0, firstMs: Math.round(frame.t - t0), keys: new Set(), sample: null, events: new Set() }).get(key);
    g.count++;
    return g;
  };

  for (const frame of frames) {
    const events = adapter ? adapter.classify(frame).map((e) => e.type) : [];
    if (frame.kind === 'http') {
      const path = String(frame.url ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\d{4,}/gi, ':id').split('?')[0];
      const g = add(`http|${frame.method ?? 'GET'}|${path}`, frame, { dir: frame.dir, kind: 'http', channel: `${frame.method ?? 'GET'} ${path}`, id: null, type: frame.status ?? null });
      let body = frame.data;
      try { body = JSON.parse(frame.data); } catch { /* texte brut */ }
      contentKeys(body).forEach((k) => g.keys.add(k));
      g.sample ??= String(frame.data).slice(0, 240);
      continue;
    }
    let messages;
    try { messages = JSON.parse(frame.data); } catch { messages = null; }
    for (const msg of Array.isArray(messages) ? messages : [messages]) {
      const id = msg?.data?.id ?? null;
      const type = msg?.data?.type ?? null;
      const g = add(`ws|${frame.dir}|${msg?.channel}|${id}|${type}`, frame, { dir: frame.dir, kind: 'ws', channel: msg?.channel ?? '(non Bayeux)', id, type });
      contentKeys(msg?.data?.content ?? msg).forEach((k) => g.keys.add(k));
      g.sample ??= String(typeof msg?.data?.content === 'string' ? msg.data.content : JSON.stringify(msg)).slice(0, 240);
      events.forEach((e) => g.events.add(e));
    }
  }
  const rows = [...groups.values()].map((g) => ({ ...g, keys: [...g.keys], events: [...g.events] }));
  return { frames: frames.length, rows: rows.sort((a, b) => a.firstMs - b.firstMs) };
}

export function formatInspection(report) {
  const lines = [`${report.frames} trames, ${report.rows.length} types distincts`, ''];
  for (const r of report.rows) {
    lines.push(
      `${String(r.firstMs).padStart(7)} ms  ${r.dir === 'in' ? '⬇' : '⬆'} ${r.kind}  ${r.channel}  id=${r.id ?? '—'} type=${r.type ?? '—'}  ×${r.count}${r.events.length ? `  → ${r.events.join(',')}` : ''}`,
      `           clés : ${r.keys.slice(0, 14).join(', ') || '—'}${r.keys.length > 14 ? ', …' : ''}`,
      `           ex.  : ${r.sample}`,
    );
  }
  return lines.join('\n');
}
