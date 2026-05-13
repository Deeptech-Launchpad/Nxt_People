const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { protect, authorize } = require('../middleware/auth');
router.use(protect, authorize('admin'));

// Generate a fresh API key + its SHA-256 hash + a short prefix shown in the UI.
const generateApiKey = () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 8) };
};

// SELECT clause used everywhere — never exposes the raw api_key.
const SELECT_FIELDS = `
  a.id as "_id", a.name, a.website_url as "websiteUrl", a.description,
  a.api_key_prefix as "apiKeyPrefix",
  a.company, a.is_active as "isActive", a.allowed_data_types as "allowedDataTypes",
  a.last_sync_at as "lastSyncAt", a.created_at as "createdAt"
`;

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ${SELECT_FIELDS},
      json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'email', e.email) as "createdBy"
      FROM api_connections a LEFT JOIN employees e ON a.created_by_id = e.id
      ORDER BY a.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, websiteUrl, description, company, allowedDataTypes } = req.body;
    const { raw, hash, prefix } = generateApiKey();
    const result = await pool.query(`
      INSERT INTO api_connections (name, website_url, description, company, allowed_data_types, api_key_hash, api_key_prefix, created_by_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${SELECT_FIELDS.replace(/a\./g, '')}
    `, [name, websiteUrl, description, company, allowedDataTypes || ['employees'], hash, prefix, req.user._id]);
    // Return the raw key ONCE — the server stores only its hash.
    res.status(201).json({ success: true, data: { ...result.rows[0], apiKey: raw }, message: 'Save this key now — it will not be shown again.' });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, websiteUrl, description, company, allowedDataTypes, isActive } = req.body;
    const result = await pool.query(`
      UPDATE api_connections SET name = COALESCE($1, name), website_url = COALESCE($2, website_url), description = COALESCE($3, description), company = COALESCE($4, company), allowed_data_types = COALESCE($5, allowed_data_types), is_active = COALESCE($6, is_active), updated_at = NOW()
      WHERE id = $7
      RETURNING ${SELECT_FIELDS.replace(/a\./g, '')}
    `, [name, websiteUrl, description, company, allowedDataTypes, isActive, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
    res.json({ success: true, data: result.rows[0] });
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
    const result = await pool.query(
      `UPDATE api_connections SET api_key_hash = $1, api_key_prefix = $2, updated_at = NOW() WHERE id = $3
       RETURNING id as "_id", name, api_key_prefix as "apiKeyPrefix"`,
      [hash, prefix, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
    res.json({ success: true, data: { ...result.rows[0], apiKey: raw }, message: 'API key regenerated. Save it now — it will not be shown again.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
