/**
 * routes/payroll-templates.js — reusable salary templates (e.g. "L2
 * Engineer"): a named set of components that split an annual CTC into
 * monthly basic/hra/conveyance/other. Mounted at /api/payroll/templates.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { splitCtcFromTemplate } = require('../utils/payroll-calc');

router.use(protect, authorize('admin', 'director', 'hr_admin'));

router.get('/', async (req, res) => {
  try {
    const templates = await pool.query(
      `SELECT id, name, band, created_at AS "createdAt" FROM salary_templates ORDER BY name ASC`
    );
    const components = await pool.query(
      `SELECT id, template_id AS "templateId", name, type, value, seq FROM salary_template_components ORDER BY template_id, seq ASC`
    );
    const byTemplate = {};
    components.rows.forEach(c => { (byTemplate[c.templateId] ||= []).push(c); });
    const data = templates.rows.map(t => ({ ...t, components: byTemplate[t.id] || [] }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/', audit('CREATE', 'salary_template'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, band, components } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Template name is required' });
    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one component is required' });
    }
    for (const c of components) {
      if (!c.name || !['fixed', 'percent_of_ctc'].includes(c.type) || !Number.isFinite(Number(c.value))) {
        return res.status(400).json({ success: false, message: `Invalid component: each needs name, type (fixed|percent_of_ctc), and a numeric value` });
      }
    }

    await client.query('BEGIN');
    const t = await client.query(
      `INSERT INTO salary_templates (name, band, created_by) VALUES ($1,$2,$3) RETURNING id`,
      [name, band || null, req.user._id]
    );
    let seq = 0;
    for (const c of components) {
      await client.query(
        `INSERT INTO salary_template_components (template_id, name, type, value, seq) VALUES ($1,$2,$3,$4,$5)`,
        [t.rows[0].id, String(c.name).trim(), c.type, Number(c.value), seq++]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, id: t.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

router.put('/:id', audit('UPDATE', 'salary_template'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, band, components } = req.body;
    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one component is required' });
    }
    for (const c of components) {
      if (!c.name || !['fixed', 'percent_of_ctc'].includes(c.type) || !Number.isFinite(Number(c.value))) {
        return res.status(400).json({ success: false, message: `Invalid component: each needs name, type (fixed|percent_of_ctc), and a numeric value` });
      }
    }

    await client.query('BEGIN');
    const t = await client.query(
      `UPDATE salary_templates SET name = COALESCE($1, name), band = $2 WHERE id = $3 RETURNING id`,
      [name || null, band || null, req.params.id]
    );
    if (t.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Template not found' }); }
    // Replace all components — this endpoint doesn't diff partial updates.
    await client.query(`DELETE FROM salary_template_components WHERE template_id = $1`, [req.params.id]);
    let seq = 0;
    for (const c of components) {
      await client.query(
        `INSERT INTO salary_template_components (template_id, name, type, value, seq) VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, String(c.name).trim(), c.type, Number(c.value), seq++]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

router.delete('/:id', audit('DELETE', 'salary_template'), async (req, res) => {
  try {
    // salary_structures.template_id is ON DELETE SET NULL — deleting a
    // template never breaks an employee's already-applied structure, it just
    // loses the "which template was this built from" provenance.
    const r = await pool.query(`DELETE FROM salary_templates WHERE id = $1 RETURNING id`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// POST /:id/apply-preview — { ctcAnnual } -> computed monthly split, no write.
router.post('/:id/apply-preview', async (req, res) => {
  try {
    const ctcAnnual = Number(req.body.ctcAnnual);
    if (!Number.isFinite(ctcAnnual) || ctcAnnual <= 0) {
      return res.status(400).json({ success: false, message: 'ctcAnnual must be a positive number' });
    }
    const components = await pool.query(
      `SELECT name, type, value FROM salary_template_components WHERE template_id = $1 ORDER BY seq ASC`,
      [req.params.id]
    );
    if (components.rows.length === 0) return res.status(404).json({ success: false, message: 'Template not found or has no components' });
    const split = splitCtcFromTemplate(ctcAnnual, components.rows);
    res.json({ success: true, data: split });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
