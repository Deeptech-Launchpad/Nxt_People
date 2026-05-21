/**
 * ws-chat.js — Real-time chat WebSocket server.
 *
 * - Authenticates the upgrade request via JWT (Authorization Bearer or
 *   ?token=... query param so the browser WebSocket constructor can
 *   pass it — the browser API doesn't support custom headers).
 * - Maintains an in-memory Map<userId, Set<WebSocket>> so messages /
 *   typing / presence events can be fanned out to every device a user
 *   has open. Single-process design — fine for a typical SMB instance.
 *   If you ever horizontally scale the backend, swap this for a Redis
 *   pub/sub channel (the wire protocol below stays the same).
 * - Exposes `chatHub.send(userId, event)` and `chatHub.broadcastPresence(...)`
 *   so the REST routes can push events after a DB write.
 */
const { WebSocketServer } = require('ws');
const jwt   = require('jsonwebtoken');
const url   = require('url');
const pool  = require('./db');
const logger = require('./logger');

// userId → Set<WebSocket>. A user with two tabs open has two sockets here.
const sockets = new Map();

function add(userId, ws) {
  let set = sockets.get(userId);
  if (!set) { set = new Set(); sockets.set(userId, set); }
  set.add(ws);
}
function remove(userId, ws) {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sockets.delete(userId);
}
function isOnline(userId) {
  const set = sockets.get(userId);
  return !!(set && set.size > 0);
}
function send(userId, payload) {
  const set = sockets.get(userId);
  if (!set) return 0;
  const data = JSON.stringify(payload);
  let delivered = 0;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); delivered++; } catch (_) { /* drop */ }
    }
  }
  return delivered;
}

// Broadcast that `userId` came online or went offline to every user they
// are connected to (accepted chat_connections in either direction).
async function broadcastPresence(userId, status) {
  try {
    const r = await pool.query(
      `SELECT CASE WHEN requester_id = $1 THEN recipient_id ELSE requester_id END AS peer_id
         FROM chat_connections
        WHERE status = 'accepted'
          AND (requester_id = $1 OR recipient_id = $1)`,
      [userId]
    );
    for (const row of r.rows) {
      send(row.peer_id, { type: 'presence', userId, status });
    }
  } catch (err) {
    logger.warn({ err: err.message, userId }, 'broadcastPresence failed');
  }
}

function authenticate(req) {
  // Token comes from ?token=... (browser WS can't set headers) or from
  // an explicit Sec-WebSocket-Protocol subprotocol in dev clients.
  const { query } = url.parse(req.url, true);
  const token = query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id || null;
  } catch {
    return null;
  }
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Only handle /ws/chat — leave anything else alone (other libraries
    // may attach their own WS servers on different paths later).
    const pathname = url.parse(req.url).pathname;
    if (pathname !== '/ws/chat') {
      // Important: only destroy if NO other listener is going to handle it.
      // Express/HTTP server won't, so it's safe here. Don't call socket.destroy()
      // here if you ever add another WS endpoint — wrap in a path check.
      return;
    }

    const userId = authenticate(req);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = userId;
      ws.isAlive = true;
      add(userId, ws);

      // Notify peers that this user just came online (if they weren't
      // already on another tab).
      if (sockets.get(userId)?.size === 1) {
        broadcastPresence(userId, 'online');
      }

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        // Lightweight client → server events: typing indicator + ping.
        // Anything else (actual messages, read receipts) goes through the
        // REST endpoints, so the DB is always the source of truth.
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'typing' && msg.to) {
          send(msg.to, { type: 'typing', userId, isTyping: !!msg.isTyping });
        }
        // Future: other transient signals.
      });

      ws.on('close', () => {
        remove(userId, ws);
        // If this was the last socket for this user, mark them offline.
        if (!sockets.get(userId)) {
          broadcastPresence(userId, 'offline');
        }
      });
    });
  });

  // Keepalive: drop sockets that don't respond to ping within ~60 s. Without
  // this, half-open connections (laptop slept, network hop dies) pile up.
  const interval = setInterval(() => {
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch (_) {}
      }
    }
  }, 30_000);
  server.on('close', () => clearInterval(interval));
}

module.exports = { attach, send, isOnline, broadcastPresence };
