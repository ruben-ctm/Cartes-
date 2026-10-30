/**
 * Serveur local du banc d'essai : interface + API JSON. Aucun réseau externe.
 *   GET  /api/profiles
 *   GET  /api/run?profile=L1&seed=1&accuracy=0.6   → { profile, capture, result }
 *   POST /api/analyze  (capture JSON)               → { capture, result }
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../analyzer/index.js';
import { simulate } from './simulator.js';
import { PROFILES, profileList } from './profiles.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 5e6) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Corps trop volumineux');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLabServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/profiles') return json(res, 200, profileList());
      if (url.pathname === '/api/run') {
        const profile = url.searchParams.get('profile') ?? 'L0';
        if (!PROFILES[profile]) return json(res, 400, { error: `Profil inconnu : ${profile}` });
        const capture = simulate({
          profile,
          seed: Number(url.searchParams.get('seed') ?? 1) || 1,
          accuracy: Math.min(1, Math.max(0, Number(url.searchParams.get('accuracy') ?? 0.6))),
        });
        return json(res, 200, { profile: profileList().find((p) => p.id === profile), capture, result: analyze(capture) });
      }
      if (url.pathname === '/api/analyze' && req.method === 'POST') {
        const capture = JSON.parse(await readBody(req));
        if (!Array.isArray(capture.frames) || !Array.isArray(capture.groundTruth)) return json(res, 400, { error: 'Capture invalide : frames[] et groundTruth[] requis.' });
        return json(res, 200, { capture, result: analyze(capture) });
      }
      // Fichiers statiques : interface uniquement (ui/), sans sortie du dossier.
      const rel = url.pathname === '/' ? '/ui/index.html' : url.pathname;
      if (!rel.startsWith('/ui/')) return json(res, 404, { error: 'Introuvable' });
      const file = normalize(join(ROOT, rel));
      if (!file.startsWith(join(ROOT, 'ui'))) return json(res, 403, { error: 'Interdit' });
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      json(res, err.code === 'ENOENT' ? 404 : 400, { error: err.code === 'ENOENT' ? 'Introuvable' : String(err.message) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5177);
  createLabServer().listen(port, '127.0.0.1', () => console.log(`Banc d'essai : http://127.0.0.1:${port}/`));
}
