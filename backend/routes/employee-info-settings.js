/* Settings -> Employee Information.
 *
 * The rules behind the Operations records: statuses, ID generation, streams,
 * reference material, and who may see which field.
 *
 * Two principles run through the file:
 *
 *   1. An empty configuration table must behave exactly as the system did
 *      before the screen existed. Nothing here seeds a default that changes
 *      behaviour on deploy; absence means "as before", so switching a screen
 *      on cannot silently alter who sees what.
 *   2. Permissions here may only NARROW. Field permissions can hide a field a
 *      role could otherwise see; they cannot reveal one the code protects for
 *      a stronger reason — identity numbers stay behind the audited reveal
 *      whatever this screen says, because an audit trail an administrator can
 *      switch off is not an audit trail.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');

router.use(protect);
const WRITE = ['admin', 'director', 'hr_admin'];

const str = (v, field, { required = false, max = 255 } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (required) throw new Error(`${field} is required`); return null; }
  if (s.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return s;
};
const known = (err) => /is required|characters or fewer|already|cannot|must be|Unknown|at least/i.test(err.message || '');
const fail = (res, err) => (known(err)
  ? res.status(400).json({ success: false, message: err.message })
  : serverError(res, err));

/* ── Basic Details ───────────────────────────────────────────────────────── */

const BASIC_DEFAULTS = { dualReporting: false, streams: false };

async function basicDetails() {
  const r = await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`);
  return { ...BASIC_DEFAULTS, ...(r.rows[0]?.c?.basicDetails || {}) };
}

router.get('/basic-details', async (req, res) => {
  try { res.json({ success: true, data: await basicDetails() }); }
  catch (err) { fail(res, err); }
});

router.patch('/basic-details', authorize(...WRITE), async (req, res) => {
  try {
    const before = await basicDetails();
    const next = {
      dualReporting: req.body.dualReporting === undefined ? before.dualReporting : !!req.body.dualReporting,
      streams: req.body.streams === undefined ? before.streams : !!req.body.streams,
    };
    const cur = (await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    await pool.query(
      `UPDATE settings SET employee_info_config = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify({ ...cur, basicDetails: next })]);

    const fields = Object.keys(next)
      .filter(k => before[k] !== next[k])
      .map(k => ({ field: k, from: before[k], to: next[k] }));
    if (fields.length) {
      await logAudit(req, { action: 'UPDATE', resource: 'Employee Information policy',
        resourceId: 'basic-details', changes: { summary: `${fields.length} setting(s) changed`, fields } });
    }
    res.json({ success: true, data: next });
  } catch (err) { fail(res, err); }
});

/* ── Employee statuses ───────────────────────────────────────────────────── */

router.get('/statuses', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.id AS "_id", s.name, s.type, s.sort_order AS "sortOrder", s.is_system AS "isSystem",
              (SELECT COUNT(*)::int FROM employees e
                WHERE e.deleted_at IS NULL AND LOWER(e.status) = LOWER(s.name)) AS "inUse"
         FROM employee_statuses s ORDER BY s.sort_order, s.name`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/statuses', authorize(...WRITE), async (req, res) => {
  try {
    const name = str(req.body.name, 'Status name', { required: true, max: 60 });
    const type = req.body.type === 'active' ? 'active' : 'inactive';
    const r = await pool.query(
      `INSERT INTO employee_statuses (name, type, sort_order)
       VALUES ($1,$2,COALESCE((SELECT MAX(sort_order)+1 FROM employee_statuses),0)) RETURNING id`,
      [name, type]);
    await logAudit(req, { action: 'CREATE', resource: 'Employee status', resourceId: r.rows[0].id,
      changes: { summary: `${name} (${type})` } });
    res.status(201).json({ success: true, data: { _id: r.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'That status already exists' });
    fail(res, err);
  }
});

router.patch('/statuses/:id', authorize(...WRITE), async (req, res) => {
  try {
    const cur = (await pool.query(`SELECT * FROM employee_statuses WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ success: false, message: 'Status not found' });

    /* The two system statuses are what every other query means by "working"
     * and "not working". Renaming or retyping them would silently change the
     * meaning of the employee list, the headcount and every report. */
    if (cur.is_system && req.body.type && req.body.type !== cur.type) {
      return res.status(400).json({ success: false,
        message: `"${cur.name}" is a built-in status and its type cannot be changed.` });
    }
    const name = req.body.name === undefined ? cur.name : str(req.body.name, 'Status name', { required: true, max: 60 });
    const type = req.body.type === undefined ? cur.type : (req.body.type === 'active' ? 'active' : 'inactive');

    await pool.query(
      `UPDATE employee_statuses SET name=$1, type=$2, updated_at=NOW() WHERE id=$3`,
      [name, type, req.params.id]);

    const fields = [];
    if (name !== cur.name) fields.push({ field: 'name', from: cur.name, to: name });
    if (type !== cur.type) fields.push({ field: 'type', from: cur.type, to: type });
    if (fields.length) {
      await logAudit(req, { action: 'UPDATE', resource: 'Employee status', resourceId: req.params.id,
        changes: { summary: `${cur.name} updated`, fields } });
    }
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'That status already exists' });
    fail(res, err);
  }
});

router.delete('/statuses/:id', authorize(...WRITE), async (req, res) => {
  try {
    const cur = (await pool.query(`SELECT * FROM employee_statuses WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ success: false, message: 'Status not found' });
    if (cur.is_system) {
      return res.status(400).json({ success: false, message: `"${cur.name}" is built in and cannot be removed.` });
    }
    // Deleting a status somebody is on would leave those rows pointing at
    // nothing, and no screen would say which people were affected.
    const used = (await pool.query(
      `SELECT COUNT(*)::int n FROM employees WHERE deleted_at IS NULL AND LOWER(status)=LOWER($1)`,
      [cur.name])).rows[0].n;
    if (used > 0) {
      return res.status(400).json({ success: false,
        message: `${used} employee(s) are on "${cur.name}". Move them to another status first.` });
    }
    await pool.query(`DELETE FROM employee_statuses WHERE id=$1`, [req.params.id]);
    await logAudit(req, { action: 'DELETE', resource: 'Employee status', resourceId: req.params.id,
      changes: { summary: `${cur.name} removed` } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

router.put('/statuses/reorder', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(`UPDATE employee_statuses SET sort_order=$1 WHERE id=$2`, [i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

/* ── Employee ID rules ───────────────────────────────────────────────────── */

/* A segment is { type: 'custom' | 'field', value }. Field segments resolve
 * against the employee being created; anything unresolvable contributes
 * nothing rather than the string "undefined". */
const SEGMENT_FIELDS = {
  joining_year: 'Joining year (YY)', joining_year_full: 'Joining year (YYYY)',
  department_code: 'Department code', designation_code: 'Designation code',
  location_code: 'Location code',
};

function resolveSegment(seg, ctx = {}) {
  if (!seg || typeof seg !== 'object') return '';
  if (seg.type === 'custom') return String(seg.value ?? '');
  const d = ctx.joiningDate ? new Date(ctx.joiningDate) : new Date();
  switch (seg.value) {
    case 'joining_year':      return String(d.getFullYear()).slice(2);
    case 'joining_year_full': return String(d.getFullYear());
    case 'department_code':   return String(ctx.department || '').slice(0, 3).toUpperCase();
    case 'designation_code':  return String(ctx.designation || '').slice(0, 3).toUpperCase();
    case 'location_code':     return String(ctx.location || '').slice(0, 3).toUpperCase();
    default:                  return '';
  }
}

const asSegments = (v) => (Array.isArray(v) ? v : []).map(s => ({
  type: s?.type === 'field' ? 'field' : 'custom',
  value: String(s?.value ?? '').slice(0, 40),
})).filter(s => s.value);

/** Render a rule to an example, which is what the Preview panel shows. */
function renderRule(rule, number, ctx = {}) {
  const pre = asSegments(rule.prefix).map(s => resolveSegment(s, ctx)).join('');
  const suf = asSegments(rule.suffix).map(s => resolveSegment(s, ctx)).join('');
  const digits = Math.max(1, Math.min(10, parseInt(rule.placeholder_digits ?? rule.placeholderDigits, 10) || 1));
  return `${pre}${String(number).padStart(digits, '0')}${suf}`;
}

router.get('/id-rules', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id AS "_id", name, code, color, starting_number AS "startingNumber",
              placeholder_digits AS "placeholderDigits", prefix, suffix,
              reuse_per_combination AS "reusePerCombination",
              is_default AS "isDefault", is_active AS "isActive",
              last_generated_id AS "lastGeneratedId"
         FROM employee_id_rules ORDER BY is_default DESC, name`);
    const cfg = await basicDetails();
    res.json({
      success: true,
      data: r.rows,
      enabled: !!(await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`))
        .rows[0]?.c?.idGeneration?.enabled,
      fields: Object.entries(SEGMENT_FIELDS).map(([value, label]) => ({ value, label })),
      basicDetails: cfg,
    });
  } catch (err) { fail(res, err); }
});

router.patch('/id-rules/enabled', authorize(...WRITE), async (req, res) => {
  try {
    const cur = (await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    const enabled = !!req.body.enabled;
    await pool.query(
      `UPDATE settings SET employee_info_config = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify({ ...cur, idGeneration: { ...(cur.idGeneration || {}), enabled } })]);
    await logAudit(req, { action: 'UPDATE', resource: 'Employee ID generation', resourceId: 'enabled',
      changes: { summary: enabled ? 'switched on' : 'switched off' } });
    res.json({ success: true, enabled });
  } catch (err) { fail(res, err); }
});

const cleanRule = (b) => ({
  name: str(b.name, 'Rule name', { required: true, max: 80 }),
  code: str(b.code, 'Rule code', { max: 20 }),
  color: str(b.color, 'Colour', { max: 20 }) || '#38bdf8',
  starting_number: Math.max(0, parseInt(b.startingNumber, 10) || 1),
  placeholder_digits: Math.max(1, Math.min(10, parseInt(b.placeholderDigits, 10) || 1)),
  prefix: asSegments(b.prefix),
  suffix: asSegments(b.suffix),
  reuse_per_combination: !!b.reusePerCombination,
  is_default: !!b.isDefault,
  is_active: b.isActive !== false,
});

router.post('/id-rules', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = cleanRule(req.body);
    await client.query('BEGIN');
    // One default, or generation has no defined starting point.
    if (v.is_default) await client.query(`UPDATE employee_id_rules SET is_default = FALSE`);
    const r = await client.query(
      `INSERT INTO employee_id_rules
        (name, code, color, starting_number, placeholder_digits, prefix, suffix,
         reuse_per_combination, is_default, is_active)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING id`,
      [v.name, v.code, v.color, v.starting_number, v.placeholder_digits,
       JSON.stringify(v.prefix), JSON.stringify(v.suffix),
       v.reuse_per_combination, v.is_default, v.is_active]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { _id: r.rows[0].id } });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

router.put('/id-rules/:id', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = cleanRule(req.body);
    await client.query('BEGIN');
    if (v.is_default) await client.query(`UPDATE employee_id_rules SET is_default = FALSE WHERE id <> $1`, [req.params.id]);
    const r = await client.query(
      `UPDATE employee_id_rules SET name=$1, code=$2, color=$3, starting_number=$4,
              placeholder_digits=$5, prefix=$6::jsonb, suffix=$7::jsonb,
              reuse_per_combination=$8, is_default=$9, is_active=$10, updated_at=NOW()
        WHERE id=$11 RETURNING id`,
      [v.name, v.code, v.color, v.starting_number, v.placeholder_digits,
       JSON.stringify(v.prefix), JSON.stringify(v.suffix),
       v.reuse_per_combination, v.is_default, v.is_active, req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Rule not found' }); }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

router.delete('/id-rules/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM employee_id_rules WHERE id=$1 RETURNING name`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* Preview without saving, so the panel can show what a rule produces while it
 * is still being edited. Never touches a counter. */
router.post('/id-rules/preview', authorize(...WRITE), (req, res) => {
  try {
    const v = cleanRule({ ...req.body, name: req.body.name || 'preview' });
    const number = Math.max(0, parseInt(req.body.startingNumber, 10) || 1);
    res.json({
      success: true,
      data: {
        example: renderRule(v, number, req.body.sample || {}),
        parts: [
          ...v.prefix.map(s => ({ label: resolveSegment(s, req.body.sample || {}),
            kind: s.type === 'custom' ? 'Custom' : (SEGMENT_FIELDS[s.value] || s.value) })),
          { label: String(number).padStart(v.placeholder_digits, '0'), kind: 'Id' },
          ...v.suffix.map(s => ({ label: resolveSegment(s, req.body.sample || {}),
            kind: s.type === 'custom' ? 'Custom' : (SEGMENT_FIELDS[s.value] || s.value) })),
        ].filter(p => p.label !== ''),
      },
    });
  } catch (err) { fail(res, err); }
});

/* ── Streams ─────────────────────────────────────────────────────────────── */

router.get('/streams', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.id AS "_id", s.name, s.description, s.is_active AS "isActive",
              (SELECT COUNT(*)::int FROM employee_stream_members m
                WHERE m.stream_id = s.id AND m.employee_id IS NOT NULL) AS "employeeCount",
              (SELECT COUNT(*)::int FROM employee_stream_members m
                WHERE m.stream_id = s.id AND m.designation_id IS NOT NULL) AS "designationCount"
         FROM employee_streams s WHERE s.deleted_at IS NULL ORDER BY s.name`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.get('/streams/:id', async (req, res) => {
  try {
    const s = await pool.query(
      `SELECT id AS "_id", name, description, is_active AS "isActive"
         FROM employee_streams WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ success: false, message: 'Stream not found' });
    const members = await pool.query(
      `SELECT m.id AS "_id",
              e.id AS "employeeId", e.employee_id AS "code",
              TRIM(CONCAT(e.first_name,' ',e.last_name)) AS "employeeName",
              d.id AS "designationId", d.name AS "designationName"
         FROM employee_stream_members m
         LEFT JOIN employees e ON e.id = m.employee_id AND e.deleted_at IS NULL
         LEFT JOIN designations d ON d.id = m.designation_id
        WHERE m.stream_id = $1
        ORDER BY d.name NULLS LAST, e.first_name`, [req.params.id]);
    res.json({ success: true, data: { ...s.rows[0], members: members.rows } });
  } catch (err) { fail(res, err); }
});

router.post('/streams', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const name = str(req.body.name, 'Stream name', { required: true, max: 120 });
    const description = str(req.body.description, 'Description', { max: 1000 });
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO employee_streams (name, description, created_by) VALUES ($1,$2,$3) RETURNING id`,
      [name, description, req.user._id]);
    const id = r.rows[0].id;
    for (const e of (req.body.employees || [])) {
      await client.query(
        `INSERT INTO employee_stream_members (stream_id, employee_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, e]);
    }
    for (const d of (req.body.designations || [])) {
      await client.query(
        `INSERT INTO employee_stream_members (stream_id, designation_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, d]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { _id: id } });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

router.put('/streams/:id', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const name = str(req.body.name, 'Stream name', { required: true, max: 120 });
    const description = str(req.body.description, 'Description', { max: 1000 });
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE employee_streams SET name=$1, description=$2, is_active=$3, updated_at=NOW()
        WHERE id=$4 AND deleted_at IS NULL RETURNING id`,
      [name, description, req.body.isActive !== false, req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Stream not found' }); }
    // Membership is replaced wholesale — the editor sends the full set, so a
    // diff here would only be a second chance to get it wrong.
    if (req.body.employees || req.body.designations) {
      await client.query(`DELETE FROM employee_stream_members WHERE stream_id=$1`, [req.params.id]);
      for (const e of (req.body.employees || [])) {
        await client.query(`INSERT INTO employee_stream_members (stream_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, e]);
      }
      for (const d of (req.body.designations || [])) {
        await client.query(`INSERT INTO employee_stream_members (stream_id, designation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, d]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

router.delete('/streams/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE employee_streams SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING name`,
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Stream not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ── Resources: Knowledge Base ───────────────────────────────────────────── */

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const ALLOWED = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.txt', '.csv'];
const kbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `kb-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.includes(path.extname(file.originalname).toLowerCase())),
});
const kbAttach = (req, res, next) => kbUpload.single('file')(req, res, err => {
  if (!err) return next();
  res.status(400).json({ success: false,
    message: err.code === 'LIMIT_FILE_SIZE' ? 'That file is over 10 MB.' : 'That file type is not accepted.' });
});

router.get('/kb', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT k.id AS "_id", k.title, k.kind, k.url, k.file_path AS "filePath", k.file_name AS "fileName",
              k.created_at AS "createdAt",
              TRIM(CONCAT(e.first_name,' ',e.last_name)) AS "createdBy"
         FROM kb_references k LEFT JOIN employees e ON e.id = k.created_by
        WHERE k.deleted_at IS NULL ORDER BY k.created_at DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/kb', authorize(...WRITE), kbAttach, async (req, res) => {
  try {
    const kind = req.file ? 'file' : 'url';
    const title = str(req.body.title, 'Title', { required: !req.file, max: 200 })
      || (req.file ? req.file.originalname : null);
    const url = kind === 'url' ? str(req.body.url, 'URL', { required: true, max: 1000 }) : null;
    if (kind === 'url' && !/^https?:\/\//i.test(url)) {
      // A reference nobody can open is not a reference.
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Enter a full URL beginning http:// or https://' });
    }
    const r = await pool.query(
      `INSERT INTO kb_references (title, kind, url, file_path, file_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title, kind, url, req.file ? `/uploads/${req.file.filename}` : null,
       req.file ? req.file.originalname.slice(0, 255) : null, req.user._id]);
    res.status(201).json({ success: true, data: { _id: r.rows[0].id } });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    fail(res, err);
  }
});

router.delete('/kb/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE kb_references SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING file_path`,
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Reference not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ── Resources: FAQ ──────────────────────────────────────────────────────── */

router.get('/faqs', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id AS "_id", question, answer, tags, sort_order AS "sortOrder", created_at AS "createdAt"
         FROM faqs WHERE deleted_at IS NULL ORDER BY sort_order, created_at`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/faqs', authorize(...WRITE), async (req, res) => {
  try {
    const question = str(req.body.question, 'Question', { required: true, max: 500 });
    const r = await pool.query(
      `INSERT INTO faqs (question, answer, tags, sort_order, created_by)
       VALUES ($1,$2,$3,COALESCE((SELECT MAX(sort_order)+1 FROM faqs),0),$4) RETURNING id`,
      [question, String(req.body.answer || '').slice(0, 20000),
       str(req.body.tags, 'Tags', { max: 300 }), req.user._id]);
    res.status(201).json({ success: true, data: { _id: r.rows[0].id } });
  } catch (err) { fail(res, err); }
});

router.put('/faqs/:id', authorize(...WRITE), async (req, res) => {
  try {
    const question = str(req.body.question, 'Question', { required: true, max: 500 });
    const r = await pool.query(
      `UPDATE faqs SET question=$1, answer=$2, tags=$3, updated_at=NOW()
        WHERE id=$4 AND deleted_at IS NULL RETURNING id`,
      [question, String(req.body.answer || '').slice(0, 20000),
       str(req.body.tags, 'Tags', { max: 300 }), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'FAQ not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

router.delete('/faqs/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE faqs SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'FAQ not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ── Extend Service: forms ───────────────────────────────────────────────── */

router.get('/forms', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT form_key AS "key", label, is_core AS "isCore", is_enabled AS "isEnabled"
         FROM extend_service_forms ORDER BY is_core DESC, label`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.patch('/forms/:key', authorize(...WRITE), async (req, res) => {
  try {
    const cur = (await pool.query(`SELECT * FROM extend_service_forms WHERE form_key=$1`, [req.params.key])).rows[0];
    if (!cur) return res.status(404).json({ success: false, message: 'Unknown form' });
    // Employee, Department and Designation are what this module is; the
    // reference gives them no toggle either.
    if (cur.is_core) return res.status(400).json({ success: false, message: `${cur.label} cannot be switched off.` });
    await pool.query(`UPDATE extend_service_forms SET is_enabled=$1, updated_at=NOW() WHERE form_key=$2`,
      [!!req.body.isEnabled, req.params.key]);
    await logAudit(req, { action: 'UPDATE', resource: 'Extend Service form', resourceId: req.params.key,
      changes: { summary: `${cur.label} ${req.body.isEnabled ? 'enabled' : 'disabled'}` } });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

module.exports = router;
module.exports.renderRule = renderRule;
module.exports.SEGMENT_FIELDS = SEGMENT_FIELDS;
