const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');

router.use(protect);

// ── GET my conversations ──────────────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id as "_id", c.type, c.name, c.updated_at as "updatedAt",
       (
         SELECT json_build_object(
           'content', m.content, 'createdAt', m.created_at,
           'sender', json_build_object('firstName', s.first_name, 'lastName', s.last_name)
         )
         FROM chat_messages m
         JOIN employees s ON m.sender_id = s.id
         WHERE m.conversation_id = c.id AND m.is_deleted = false
         ORDER BY m.created_at DESC LIMIT 1
       ) as "lastMessage",
       (
         SELECT COUNT(*) FROM chat_messages m
         WHERE m.conversation_id = c.id AND m.is_deleted = false
           AND m.created_at > COALESCE(
             (SELECT last_read_at FROM chat_participants WHERE conversation_id = c.id AND employee_id = $1),
             '1970-01-01'::timestamptz
           )
           AND m.sender_id != $1
       ) as "unreadCount",
       (
         SELECT json_agg(json_build_object(
           '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'photoUrl', e.photo_url, 'department', e.department
         ))
         FROM chat_participants cp2
         JOIN employees e ON cp2.employee_id = e.id
         WHERE cp2.conversation_id = c.id AND cp2.employee_id != $1
       ) as participants
       FROM chat_conversations c
       JOIN chat_participants cp ON c.id = cp.conversation_id
       WHERE cp.employee_id = $1
       ORDER BY c.updated_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST create or open a direct conversation ─────────────────────────────────
router.post('/conversations', async (req, res) => {
  try {
    const { participantId, name, type = 'direct' } = req.body;

    if (type === 'direct' && participantId) {
      // Check if a direct conversation already exists between these two employees
      const existing = await pool.query(
        `SELECT c.id FROM chat_conversations c
         JOIN chat_participants cp1 ON c.id = cp1.conversation_id AND cp1.employee_id = $1
         JOIN chat_participants cp2 ON c.id = cp2.conversation_id AND cp2.employee_id = $2
         WHERE c.type = 'direct' LIMIT 1`,
        [req.user._id, participantId]
      );
      if (existing.rows[0]) {
        return res.json({ success: true, data: { _id: existing.rows[0].id }, existing: true });
      }
    }

    const conv = await pool.query(
      `INSERT INTO chat_conversations (type, name, created_by) VALUES ($1,$2,$3)
       RETURNING id as "_id", type, name, created_at as "createdAt"`,
      [type, name || null, req.user._id]
    );
    const convId = conv.rows[0]._id;

    // Add current user as participant
    await pool.query(
      `INSERT INTO chat_participants (conversation_id, employee_id) VALUES ($1,$2)`,
      [convId, req.user._id]
    );
    // Add the other participant(s)
    if (participantId) {
      await pool.query(
        `INSERT INTO chat_participants (conversation_id, employee_id) VALUES ($1,$2)`,
        [convId, participantId]
      );
    }

    res.status(201).json({ success: true, data: conv.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET messages in a conversation ────────────────────────────────────────────
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;

    // Verify user is a participant
    const access = await pool.query(
      `SELECT 1 FROM chat_participants WHERE conversation_id=$1 AND employee_id=$2`,
      [req.params.id, req.user._id]
    );
    if (!access.rows[0]) return res.status(403).json({ success: false, message: 'Not a participant' });

    let where = 'WHERE m.conversation_id = $1 AND m.is_deleted = false';
    const params = [req.params.id];
    if (before) { where += ` AND m.created_at < $2`; params.push(before); }

    const r = await pool.query(
      `SELECT m.id as "_id", m.content, m.is_deleted as "isDeleted",
       m.created_at as "createdAt",
       json_build_object(
         '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'photoUrl', e.photo_url
       ) as sender
       FROM chat_messages m
       JOIN employees e ON m.sender_id = e.id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, parseInt(limit)]
    );

    // Update last_read_at
    await pool.query(
      `UPDATE chat_participants SET last_read_at = NOW()
       WHERE conversation_id=$1 AND employee_id=$2`,
      [req.params.id, req.user._id]
    );

    res.json({ success: true, data: r.rows.reverse() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST send a message ───────────────────────────────────────────────────────
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message content is required' });

    // Verify participant
    const access = await pool.query(
      `SELECT 1 FROM chat_participants WHERE conversation_id=$1 AND employee_id=$2`,
      [req.params.id, req.user._id]
    );
    if (!access.rows[0]) return res.status(403).json({ success: false, message: 'Not a participant' });

    const msg = await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, content)
       VALUES ($1,$2,$3)
       RETURNING id as "_id", content, created_at as "createdAt"`,
      [req.params.id, req.user._id, content.trim()]
    );

    // Update conversation's updated_at
    await pool.query(
      `UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    res.status(201).json({
      success: true,
      data: {
        ...msg.rows[0],
        sender: {
          _id: req.user._id,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
        },
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── DELETE message (soft delete) ──────────────────────────────────────────────
router.delete('/conversations/:id/messages/:msgId', async (req, res) => {
  try {
    await pool.query(
      `UPDATE chat_messages SET is_deleted = true WHERE id = $1 AND sender_id = $2`,
      [req.params.msgId, req.user._id]
    );
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET audit log (admin only) ────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  // Keep this in messages.js for now or move to a dedicated route
  res.status(404).json({ success: false, message: 'Use /api/audit for audit log' });
});

module.exports = router;
