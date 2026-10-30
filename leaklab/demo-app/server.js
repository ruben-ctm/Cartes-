/**
 * Serveur du quiz de démonstration. HTTP (pages statiques + API REST) et WebSocket réels,
 * sur 127.0.0.1 uniquement. Un message WebSocket = un objet JSON (protocole propre à ce
 * projet, indépendant de Kahoot).
 *
 * Chaque connexion WebSocket est aussi journalisée côté serveur, au format de capture du
 * laboratoire (`{t, dir, kind, data}` + `meta`/`groundTruth`), pour permettre une vérification
 * croisée : `GET /api/session/:code/:playerId.jsonl` renvoie cette capture, à comparer à ce
 * que l'extension Chrome a observé depuis le navigateur. Les deux doivent concorder : seule
 * l'extension est la source de vérité pour la démonstration (elle voit ce que voit la page).
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomRegistry, SCENARIOS } from './rooms.js';
import { toJsonl, redactUrl } from '../analyzer/session.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

const registry = new RoomRegistry();
const sessions = new Map(); // `${code}/${playerId}` -> { meta, groundTruth, frames: [] }

function sessionFor(room, playerId, role) {
  const key = `${room.code}/${playerId}`;
  if (!sessions.has(key)) {
    sessions.set(key, {
      meta: { schema: 1, adapter: 'demo-app', source: 'server-side-log', scenario: room.scenario, role, startedAt: Date.now() },
      groundTruth: room.groundTruth(),
      frames: [],
    });
  }
  return sessions.get(key);
}

function logFrame(session, dir, kind, data, extra = {}) {
  session.frames.push({ t: Date.now(), dir, kind, data, ...extra });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/scenarios') return json(res, 200, Object.values(SCENARIOS));

    const defMatch = url.pathname.match(/^\/api\/quiz\/([A-Z0-9]+)\/definition$/i);
    if (defMatch) {
      const room = registry.get(defMatch[1]);
      if (!room) return json(res, 404, { error: 'Partie introuvable' });
      const playerId = url.searchParams.get('playerId');
      const body = JSON.stringify(room.restDefinition());
      if (playerId) logFrame(sessionFor(room, playerId, 'player'), 'in', 'http', body, { method: 'GET', url: redactUrl(req.url), status: 200 });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(body);
    }

    const sessMatch = url.pathname.match(/^\/api\/session\/([A-Z0-9]+)\/([\w-]+)\.jsonl$/i);
    if (sessMatch) {
      const session = sessions.get(`${sessMatch[1].toUpperCase()}/${sessMatch[2]}`);
      if (!session) return json(res, 404, { error: 'Session introuvable' });
      const records = [
        { type: 'meta', ...session.meta },
        { type: 'key', groundTruth: session.groundTruth },
        ...session.frames.map(({ t, dir, kind, data, ...extra }) => ({ type: 'frame', t, dir, kind, data, ...extra })),
      ];
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="${sessMatch[1]}-${sessMatch[2]}.jsonl"` });
      return res.end(toJsonl(records));
    }

    const rel = url.pathname === '/' ? '/host.html' : url.pathname;
    if (rel.includes('..')) return json(res, 403, { error: 'Interdit' });
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Interdit' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    json(res, err.code === 'ENOENT' ? 404 : 400, { error: err.code === 'ENOENT' ? 'Introuvable' : String(err.message) });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let role = null; // 'host' | 'player'
  let room = null;
  let playerId = null;
  let session = null;

  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { return send({ type: 'error', message: 'JSON invalide' }); }

    if (session) logFrame(session, 'out', 'ws', text);

    if (msg.type === 'host_create' && !role) {
      try {
        room = registry.create(msg, ws);
        role = 'host';
        return send({ type: 'room_created', code: room.code, scenario: room.scenario, scenarios: Object.values(SCENARIOS) });
      } catch (err) { return send({ type: 'error', message: String(err.message) }); }
    }

    if (msg.type === 'join' && !role) {
      room = registry.get(msg.code);
      if (!room) return send({ type: 'error', message: `Partie ${msg.code} introuvable` });
      if (room.state !== 'lobby') return send({ type: 'error', message: 'La partie a déjà commencé' });
      role = 'player';
      playerId = room.addPlayer(ws, msg.name);
      session = sessionFor(room, playerId, 'player');
      logFrame(session, 'out', 'ws', text); // la demande de connexion elle-même
      return send({ type: 'joined', playerId, room: room.lobbySnapshot() });
    }

    if (!room) return send({ type: 'error', message: 'Rejoignez ou créez une partie d’abord' });
    if (msg.type === 'start' && role === 'host') return room.start();
    if (msg.type === 'answer' && role === 'player') return room.answer(ws, msg.choiceIndex);
  });

  ws.on('close', () => {
    if (role === 'player' && room) room.removePlayer(ws);
    if (role === 'host' && room) { room.broadcast({ type: 'error', message: 'L’hôte a quitté la partie' }, { toHost: false }); registry.delete(room.code); }
  });

  // Journalise aussi les trames entrantes (serveur → client) telles qu'envoyées à CE socket,
  // en enveloppant `send` : couvre host_create reply, broadcasts et messages ciblés.
  const nativeSend = ws.send.bind(ws);
  ws.send = (data) => { if (session) logFrame(session, 'in', 'ws', typeof data === 'string' ? data : data.toString()); return nativeSend(data); };
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5180);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Quiz de démonstration : http://127.0.0.1:${port}/host.html (hôte) · http://127.0.0.1:${port}/player.html (joueur)`);
  });
}

export { server, registry };
