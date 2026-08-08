const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
router.use(protect);

// GET /api/companies — list all active companies (any authenticated user, for registration form)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT id as "_id", name, code, description, is_active as "isActive" FROM companies WHERE is_active = true ORDER BY name');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/companies — create (admin only)
router.post('/', authorize('admin', 'director', 'hr_admin'), audit('CREATE', 'company'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const result = await pool.query('INSERT INTO companies (name, code, description) VALUES ($1, $2, $3) RETURNING id as "_id", name, code, description, is_active as "isActive"', [name, code, description]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/companies/:id — update (admin only)
router.put('/:id', authorize('admin', 'director', 'hr_admin'), audit('UPDATE', 'company'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const result = await pool.query('UPDATE companies SET name = $1, code = $2, description = $3, updated_at = NOW() WHERE id = $4 RETURNING id as "_id", name, code, description, is_active as "isActive"', [name, code, description, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/companies/:id — soft delete (admin only)
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), audit('DELETE', 'company'), async (req, res) => {
  try {
    const result = await pool.query('UPDATE companies SET is_active = false WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, message: 'Company deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/public', (req, res, next) => next()); 

module.exports = router;
