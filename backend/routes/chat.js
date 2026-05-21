/**
 * routes/chat.js — REST endpoints backing the real-time chat.
 *
 * Connection model: requester sends → recipient accepts/declines/blocks.
 * Both directions of an accepted connection can send messages. Threads are
 * stored canonically (user_a < user_b sorted) so lookups are unambiguous.
 *
 * Real-time delivery: after a successful DB write, push the same payload to
 * connected sockets via `chatHub.send(...)`. Recipients without an open
 * tab still see the message when they reconnect because the DB is the
 * source of truth.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const chatHub = require('../ws-chat');

router.use(protect);

// Helper: get-or-create the canonical thread row for a pair of users.
// Returns the thread id. Uses LEAST/GREATEST so insertion order doesn't matter.
async function getOrCreateThread(client, userA, userB) {
  if (userA === userB) throw new Error('Cannot open a chat with yourself');
  // Sort the pair so user_a_id < user_b_id (CHECK constraint).
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  const existing = await client.query(
    `SELECT id FROM chat_dm_threads WHERE user_a_id = $1 AND user_b_id = $2`,
    [a, b]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const created = await client.query(
    `INSERT INTO chat_dm_threads (user_a_id, user_b_id) VALUES ($1, $2) RETURNING id`,
    [a, b]
  );
  return created.rows[0].id;
}

// Helper: does an accepted connection exist between two users? Either
// direction counts.
async function areConnected(client, userA, userB) {
  const r = await client.query(
    `SELECT 1 FROM chat_connections
      WHERE status = 'accepted'
        AND ((requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1))
      LIMIT 1`,
    [userA, userB]
  );
  return r.rows.length > 0;
}

// ── GET /api/chat/contacts ──────────────────────────────────────────────────
// Returns three buckets: accepted contacts (with online flag + unread count
// + last-message preview), incoming pending requests, outgoing pending
// requests. One query per bucket so each can be paginated independently
// later if the user has many connections.
router.get('/contacts', async (req, res) => {
  try {
    const me = req.user._id;
    const acceptedRes = await pool.query(
      `WITH peers AS (
         SELECT CASE WHEN cc.requester_id = $1 THEN cc.recipient_id ELSE cc.requester_id END AS peer_id,
                cc.accepted_at
           FROM chat_connections cc
          WHERE cc.status = 'accepted'
            AND (cc.requester_id = $1 OR cc.recipient_id = $1)
       )
       SELECT e.id, e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_id AS "employeeId", e.email, e.designation, e.department,
              e.photo_url AS "photoUrl",
              p.accepted_at AS "connectedAt",
              (
                SELECT m.content FROM chat_dm_messages m
                  JOIN chat_dm_threads t ON t.id = m.thread_id
                 WHERE (t.user_a_id = LEAST($1::uuid, e.id) AND t.user_b_id = GREATEST($1::uuid, e.id))
              ORDER BY m.created_at DESC LIMIT 1
              ) AS "lastMessage",
              (
                SELECT m.created_at FROM chat_dm_messages m
                  JOIN chat_dm_threads t ON t.id = m.thread_id
                 WHERE (t.user_a_id = LEAST($1::uuid, e.id) AND t.user_b_id = GREATEST($1::uuid, e.id))
              ORDER BY m.created_at DESC LIMIT 1
              ) AS "lastMessageAt",
              (
                SELECT COUNT(*)::int FROM chat_dm_messages m
                  JOIN chat_dm_threads t ON t.id = m.thread_id
                 WHERE (t.user_a_id = LEAST($1::uuid, e.id) AND t.user_b_id = GREATEST($1::uuid, e.id))
                   AND m.sender_id = e.id
                   AND m.read_at IS NULL
              ) AS "unreadCount"
         FROM peers p JOIN employees e ON e.id = p.peer_id
        ORDER BY "lastMessageAt" DESC NULLS LAST, e.first_name ASC`,
      [me]
    );
    // Tag each contact with current online state from the in-memory map.
    const accepted = acceptedRes.rows.map(c => ({
      ...c,
      online: chatHub.isOnline(c.id),
    }));

    const incomingRes = await pool.query(
      `SELECT cc.id AS "requestId", cc.created_at AS "requestedAt",
              e.id, e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_id AS "employeeId", e.designation, e.department,
              e.photo_url AS "photoUrl"
         FROM chat_connections cc JOIN employees e ON e.id = cc.requester_id
        WHERE cc.recipient_id = $1 AND cc.status = 'pending'
        ORDER BY cc.created_at DESC`,
      [me]
    );

    const outgoingRes = await pool.query(
      `SELECT cc.id AS "requestId", cc.created_at AS "requestedAt",
              e.id, e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_id AS "employeeId", e.designation, e.department,
              e.photo_url AS "photoUrl"
         FROM chat_connections cc JOIN employees e ON e.id = cc.recipient_id
        WHERE cc.requester_id = $1 AND cc.status = 'pending'
        ORDER BY cc.created_at DESC`,
      [me]
    );

    res.json({
      success: true,
      data: { accepted, incoming: incomingRes.rows, outgoing: outgoingRes.rows },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/chat/search?q=... ──────────────────────────────────────────────
// Look up colleagues by name / email / employeeId to send a connection
// request to. Excludes the caller and anyone there's already an active
// connection record with (so the UI can show the right button).
router.get('/search', async (req, res) => {
  try {
    const me = req.user._id;
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ success: true, data: [] });
    const r = await pool.query(
      `SELECT e.id, e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_id AS "employeeId", e.email, e.designation, e.department,
              e.photo_url AS "photoUrl",
              (SELECT status FROM chat_connections
                WHERE (requester_id = $1 AND recipient_id = e.id)
                   OR (requester_id = e.id AND recipient_id = $1)
                LIMIT 1) AS "connectionStatus"
         FROM employees e
        WHERE e.status = 'active' AND e.id <> $1
          AND (LOWER(e.first_name) LIKE $2
            OR LOWER(e.last_name)  LIKE $2
            OR LOWER(e.email)      LIKE $2
            OR LOWER(e.employee_id) LIKE $2)
        ORDER BY e.first_name ASC LIMIT 20`,
      [me, `%${q}%`]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/chat/connect/:userId ──────────────────────────────────────────
// Send a connection request. Idempotent: if a row already exists (pending /
// accepted / declined / blocked), return its current state instead of erroring.
router.post('/connect/:userId', async (req, res) => {
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    if (me === peer) return res.status(400).json({ success: false, message: 'Cannot connect to yourself' });

    // Re-use any existing row in either direction so we don't get duplicate
    // pending requests across the two users.
    const existing = await pool.query(
      `SELECT id, status, requester_id FROM chat_connections
        WHERE (requester_id = $1 AND recipient_id = $2)
           OR (requester_id = $2 AND recipient_id = $1)
        LIMIT 1`,
      [me, peer]
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, data: existing.rows[0] });
    }
    const r = await pool.query(
      `INSERT INTO chat_connections (requester_id, recipient_id, status)
       VALUES ($1, $2, 'pending') RETURNING id, status`,
      [me, peer]
    );
    // Push to the recipient if they're online so the badge updates instantly.
    chatHub.send(peer, {
      type: 'connection-request',
      from: { id: me, firstName: req.user.firstName, lastName: req.user.lastName, employeeId: req.user.employeeId },
    });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/chat/connect/:userId/accept ───────────────────────────────────
router.post('/connect/:userId/accept', async (req, res) => {
  const client = await pool.connect();
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    await client.query('BEGIN');
    // Only the *recipient* of a pending request can accept it.
    const r = await client.query(
      `UPDATE chat_connections
          SET status = 'accepted', accepted_at = NOW()
        WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending'
        RETURNING id`,
      [peer, me]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'No pending request from this user' });
    }
    // Pre-create the thread so both sides can start messaging immediately.
    await getOrCreateThread(client, me, peer);
    await client.query('COMMIT');

    chatHub.send(peer, { type: 'connection-accepted', by: { id: me, firstName: req.user.firstName, lastName: req.user.lastName } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/chat/connect/:userId/decline ──────────────────────────────────
router.post('/connect/:userId/decline', async (req, res) => {
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    const r = await pool.query(
      `UPDATE chat_connections
          SET status = 'declined'
        WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending'
        RETURNING id`,
      [peer, me]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'No pending request' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/chat/connect/:userId ────────────────────────────────────────
// Withdraw a pending request you sent. Useful "I clicked the wrong person" UX.
router.delete('/connect/:userId', async (req, res) => {
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    const r = await pool.query(
      `DELETE FROM chat_connections
        WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending'`,
      [me, peer]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, message: 'No pending request to cancel' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/chat/threads/:userId/messages?before=...&limit=50 ──────────────
// Paginated history. `before` is an ISO timestamp; results are returned
// newest-first but should be rendered oldest-first in the UI (it just
// makes the cursor logic simpler — pass the OLDEST returned timestamp
// as `before` on the next page).
router.get('/threads/:userId/messages', async (req, res) => {
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    if (!(await areConnected(pool, me, peer))) {
      return res.status(403).json({ success: false, message: 'Not connected with this user' });
    }
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const before = req.query.before || null;
    const [a, b] = me < peer ? [me, peer] : [peer, me];
    const args = [a, b, limit];
    let cursor = '';
    if (before) { args.push(before); cursor = `AND m.created_at < $${args.length}`; }
    const r = await pool.query(
      `SELECT m.id, m.sender_id AS "senderId", m.content,
              m.created_at AS "createdAt", m.read_at AS "readAt"
         FROM chat_dm_messages m
         JOIN chat_dm_threads t ON t.id = m.thread_id
        WHERE t.user_a_id = $1 AND t.user_b_id = $2
              ${cursor}
        ORDER BY m.created_at DESC LIMIT $3`,
      args
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/chat/threads/:userId/messages ─────────────────────────────────
router.post('/threads/:userId/messages', async (req, res) => {
  const client = await pool.connect();
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ success: false, message: 'Content required' });
    if (content.length > 4000) return res.status(400).json({ success: false, message: 'Message too long (max 4000 chars)' });
    if (!(await areConnected(client, me, peer))) {
      return res.status(403).json({ success: false, message: 'Not connected with this user' });
    }

    await client.query('BEGIN');
    const threadId = await getOrCreateThread(client, me, peer);
    const ins = await client.query(
      `INSERT INTO chat_dm_messages (thread_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING id, created_at AS "createdAt"`,
      [threadId, me, content]
    );
    await client.query(`UPDATE chat_dm_threads SET last_message_at = NOW() WHERE id = $1`, [threadId]);
    await client.query('COMMIT');

    const message = {
      id: ins.rows[0].id,
      senderId: me,
      threadId,
      content,
      createdAt: ins.rows[0].createdAt,
      readAt: null,
    };
    // Push to BOTH parties so a sender's other tabs also reflect the new
    // message instantly (no need to wait for HTTP response to propagate).
    chatHub.send(peer, { type: 'message', message });
    chatHub.send(me,   { type: 'message', message });
    res.json({ success: true, data: message });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/chat/threads/:userId/read ─────────────────────────────────────
// Mark every message from `:userId` in this thread as read. The peer gets a
// 'read' event so their UI can update the read receipts immediately.
router.post('/threads/:userId/read', async (req, res) => {
  try {
    const me = req.user._id;
    const peer = req.params.userId;
    const [a, b] = me < peer ? [me, peer] : [peer, me];
    const r = await pool.query(
      `UPDATE chat_dm_messages
          SET read_at = NOW()
        WHERE thread_id = (SELECT id FROM chat_dm_threads WHERE user_a_id = $1 AND user_b_id = $2)
          AND sender_id = $3
          AND read_at IS NULL`,
      [a, b, peer]
    );
    if (r.rowCount > 0) {
      chatHub.send(peer, { type: 'read', by: me, at: new Date().toISOString() });
    }
    res.json({ success: true, updated: r.rowCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/chat/unread ────────────────────────────────────────────────────
// Total unread count across all threads — for the Topbar badge.
router.get('/unread', async (req, res) => {
  try {
    const me = req.user._id;
    const r = await pool.query(
      `SELECT COUNT(*)::int AS unread
         FROM chat_dm_messages m
         JOIN chat_dm_threads t ON t.id = m.thread_id
        WHERE m.read_at IS NULL
          AND m.sender_id <> $1
          AND (t.user_a_id = $1 OR t.user_b_id = $1)`,
      [me]
    );
    res.json({ success: true, unread: r.rows[0].unread });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
