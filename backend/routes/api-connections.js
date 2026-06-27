const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { protect, authorize } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto-vault');
router.use(protect, authorize('admin', 'director'));

// Generate a fresh API key + its SHA-256 hash + a short prefix shown in the UI.
const generateApiKey = () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 8) };
};

// SELECT clause used everywhere. api_key_encrypted is decrypted in JS
// before being returned to the admin client — never sent over the wire
// in encrypted form.
const SELECT_FIELDS = `
  a.id as "_id", a.name, a.website_url as "websiteUrl", a.description,
  a.api_key_prefix as "apiKeyPrefix", a.api_key_encrypted as "apiKeyEncrypted",
  a.company, a.is_active as "isActive", a.allowed_data_types as "allowedDataTypes",
  a.is_user_app as "isUserApp", a.app_icon as "appIcon", a.app_color as "appColor",
  a.last_sync_at as "lastSyncAt", a.created_at as "createdAt"
`;

/** Strip api_key_encrypted from a row and replace it with the decrypted
 *  raw key (or null if this connection predates encryption). The frontend
 *  only ever sees the plaintext via this helper. */
function withDecryptedKey(row) {
  if (!row) return row;
  const { apiKeyEncrypted, ...rest } = row;
  return { ...rest, apiKey: decrypt(apiKeyEncrypted) };
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ${SELECT_FIELDS},
      json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'email', e.email) as "createdBy"
      FROM api_connections a LEFT JOIN employees e ON a.created_by_id = e.id
      ORDER BY a.created_at DESC
    `);
    // Decrypt api_key_encrypted into apiKey before returning to the client.
    res.json({ success: true, data: result.rows.map(withDecryptedKey) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, websiteUrl, description, company, allowedDataTypes, isUserApp, appIcon, appColor } = req.body;
    const { raw, hash, prefix } = generateApiKey();
    const encryptedKey = encrypt(raw);
    // allowed_data_types is JSONB — must be JSON-stringified before passing.
    // pg-node would otherwise serialize a JS array as a Postgres ARRAY literal
    // (`{employees}`), which JSONB rejects with "invalid input syntax for type json".
    const allowedTypesJson = JSON.stringify(allowedDataTypes || ['employees']);
    const result = await pool.query(`
      INSERT INTO api_connections (name, website_url, description, company, allowed_data_types, api_key_hash, api_key_prefix, api_key_encrypted, created_by_id, is_user_app, app_icon, app_color)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${SELECT_FIELDS.replace(/a\./g, '')}
    `, [name, websiteUrl, description, company, allowedTypesJson, hash, prefix, encryptedKey, req.user._id,
        !!isUserApp, appIcon || 'Layers', appColor || 'from-blue-500 to-indigo-600']);
    // Raw key is also surfaced explicitly so the create-time reveal modal
    // still works even if the client doesn't read it via decrypt-on-list.
    res.status(201).json({ success: true, data: { ...withDecryptedKey(result.rows[0]), apiKey: raw }, message: 'Connection created. Key is now revealable on the card.' });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, websiteUrl, description, company, allowedDataTypes, isActive, isUserApp, appIcon, appColor } = req.body;
    // See note in POST — JSONB needs JSON.stringify, not a raw JS array.
    const allowedTypesJson = allowedDataTypes ? JSON.stringify(allowedDataTypes) : null;
    const result = await pool.query(`
      UPDATE api_connections SET
        name = COALESCE($1, name),
        website_url = COALESCE($2, website_url),
        description = COALESCE($3, description),
        company = COALESCE($4, company),
        allowed_data_types = COALESCE($5::jsonb, allowed_data_types),
        is_active = COALESCE($6, is_active),
        is_user_app = COALESCE($7, is_user_app),
        app_icon    = COALESCE($8, app_icon),
        app_color   = COALESCE($9, app_color),
        updated_at = NOW()
      WHERE id = $10
      RETURNING ${SELECT_FIELDS.replace(/a\./g, '')}
    `, [name, websiteUrl, description, company, allowedTypesJson, isActive,
        isUserApp === undefined ? null : !!isUserApp, appIcon, appColor, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
    res.json({ success: true, data: withDecryptedKey(result.rows[0]) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM api_connections WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
    res.json({ success: true, message: 'Connection deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/:id/regenerate-key', async (req, res) => {
  try {
    const { raw, hash, prefix } = generateApiKey();
    const encryptedKey = encrypt(raw);
    const result = await pool.query(
      `UPDATE api_connections
          SET api_key_hash = $1, api_key_prefix = $2, api_key_encrypted = $3, updated_at = NOW()
        WHERE id = $4
       RETURNING id as "_id", name, api_key_prefix as "apiKeyPrefix"`,
      [hash, prefix, encryptedKey, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
    res.json({ success: true, data: { ...result.rows[0], apiKey: raw }, message: 'API key regenerated.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════════════════════════════════
 *  Per-connection access grants — used by the "Access" tab on each
 *  user-facing app. External apps verify these grants via
 *  POST /api/external/access/check (routes/external-access.js).
 * ══════════════════════════════════════════════════════════════════════ */

// GET /api/api-connections/:id/access — list every active employee with
// their grant status for this connection. Single query so the modal can
// render a complete toggle list without N+1.
router.get('/:id/access', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT e.id AS "_id", e.employee_id AS "employeeId",
             e.first_name AS "firstName", e.last_name AS "lastName",
             e.email, e.department, e.designation, e.photo_url AS "photoUrl",
             (ac.id IS NOT NULL AND ac.revoked_at IS NULL) AS "hasAccess",
             ac.granted_at AS "grantedAt"
        FROM employees e
        LEFT JOIN application_access ac
          ON ac.employee_id = e.id AND ac.api_connection_id = $1
       WHERE e.status = 'active'
       ORDER BY e.first_name ASC, e.last_name ASC
    `, [req.params.id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/api-connections/:id/access — bulk grant. Body: { employeeIds }.
// Upsert pattern: if a revoked row exists, un-revoke it (history preserved).
router.post('/:id/access', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'employeeIds[] required' });

    const conn = await pool.query(`SELECT id, name FROM api_connections WHERE id = $1`, [req.params.id]);
    if (conn.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });

    await pool.query(`
      INSERT INTO application_access (api_connection_id, employee_id, granted_by)
      SELECT $1, unnest($2::uuid[]), $3
        ON CONFLICT (api_connection_id, employee_id) DO UPDATE
          SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
              granted_at = NOW(), granted_by = EXCLUDED.granted_by
    `, [req.params.id, ids, req.user._id]);

    res.json({ success: true, granted: ids.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/api-connections/:id/access/:employeeId — soft-revoke
router.delete('/:id/access/:employeeId', async (req, res) => {
  try {
    const reason = req.body?.reason || null;
    const r = await pool.query(`
      UPDATE application_access
         SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
       WHERE api_connection_id = $3 AND employee_id = $4 AND revoked_at IS NULL
       RETURNING id
    `, [req.user._id, reason, req.params.id, req.params.employeeId]);
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'No active grant to revoke' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/api-connections/:id/access/revoke — bulk soft-revoke.
// Body: { employeeIds: [...], reason? }
router.post('/:id/access/revoke', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'employeeIds[] required' });
    const reason = req.body?.reason || null;
    const r = await pool.query(`
      UPDATE application_access
         SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
       WHERE api_connection_id = $3
         AND employee_id = ANY($4::uuid[])
         AND revoked_at IS NULL
       RETURNING id
    `, [req.user._id, reason, req.params.id, ids]);
    res.json({ success: true, revoked: r.rowCount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
