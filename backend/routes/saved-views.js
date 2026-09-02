/* Saved views and per-person column visibility for the list tabs.
 *
 * Two different things that look similar and must not share storage:
 *
 *   - A SAVED VIEW is a named column set plus criteria, optionally shared with
 *     other people. It is the Create View builder.
 *   - COLUMN PREFS are which columns you personally have hidden via the small
 *     popover on the header row. Hiding a column for yourself must never edit
 *     a view somebody else can see, so they live in different tables.
 *
 * Visibility is enforced on read as well as write. A view shared "to specific
 * users, departments, roles or locations" is only listed for people who match,
 * and only its owner (or full access) can change or delete it — otherwise a
 * shared view would be editable by everyone it was shared with.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { isFullAccess } = require('../utils/roles');

router.use(protect);
const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

const MODULES = new Set(['employees', 'departments', 'designations']);
const VISIBILITY = new Set(['private', 'everyone', 'shared']);

const asArray = (v) => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined) : []);

const clean = (body) => {
  const module = String(body?.module || '').trim();
  if (!MODULES.has(module)) throw new Error('Unknown module');
  const name = String(body?.name || '').trim();
  if (!name) throw new Error('View name is required');
  if (name.length > 120) throw new Error('View name must be 120 characters or fewer');

  const visibility = VISIBILITY.has(body?.visibility) ? body.visibility : 'private';
  const shareWith = visibility === 'shared'
    ? {
        employees:   asArray(body?.shareWith?.employees),
        departments: asArray(body?.shareWith?.departments),
        roles:       asArray(body?.shareWith?.roles),
        locations:   asArray(body?.shareWith?.locations),
      }
    : {};
  /* "Shared" that names nobody is indistinguishable from private, except that
   * it reads on screen as though colleagues can see it. */
  if (visibility === 'shared' && !Object.values(shareWith).some(a => a.length)) {
    throw new Error('Choose at least one person, department, role or location to share with');
  }

  const columns = asArray(body?.columns).map(String);
  if (!columns.length) throw new Error('Choose at least one column');

  return {
    module, name, visibility, shareWith, columns,
    criteria: asArray(body?.criteria),
    isDefault: !!body?.isDefault,
  };
};

/* Whether a row is visible to this caller, expressed as SQL so the list query
 * does the filtering rather than fetching everything and sieving in JS. */
const visibleClause = (user, startIdx) => ({
  clause: `AND (
      v.visibility = 'everyone'
      OR v.owner_id = $${startIdx}
      OR (v.visibility = 'shared' AND (
            v.share_with -> 'employees'   @> to_jsonb($${startIdx}::text)
         OR v.share_with -> 'roles'       @> to_jsonb($${startIdx + 1}::text)
         OR v.share_with -> 'departments' @> to_jsonb($${startIdx + 2}::text)
         OR v.share_with -> 'locations'   @> to_jsonb($${startIdx + 3}::text)
      ))
    )`,
  params: [user._id, user.role || '', user.department || '', user.work_location || ''],
});

router.get('/', async (req, res) => {
  try {
    const module = String(req.query.module || '').trim();
    if (!MODULES.has(module)) return res.status(400).json({ success: false, message: 'Unknown module' });

    const params = [module];
    let where = 'WHERE v.deleted_at IS NULL AND v.module = $1';
    if (!isFullAccess(req.user.role)) {
      const vis = visibleClause(req.user, params.length + 1);
      where += ' ' + vis.clause;
      params.push(...vis.params);
    }

    const r = await pool.query(
      `SELECT v.id AS "_id", v.name, v.visibility, v.is_default AS "isDefault",
              v.columns, v.criteria, v.owner_id AS "ownerId",
              (v.owner_id = $${params.length + 1}) AS "isMine",
              v.created_at AS "createdAt"
         FROM saved_views v ${where}
        ORDER BY (v.visibility = 'everyone') DESC, v.name`,
      [...params, req.user._id]);

    /* Grouped the way the dropdown renders them: public views above, the
     * caller's own below. */
    res.json({
      success: true,
      data: r.rows,
      publicViews: r.rows.filter(v => v.visibility === 'everyone'),
      myViews: r.rows.filter(v => v.visibility !== 'everyone' && v.isMine),
    });
  } catch (err) { serverError(res, err); }
});

router.post('/', authorize(...WRITE_ROLES), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = clean(req.body);
    await client.query('BEGIN');
    /* Only one default per module per person, or the dropdown has no defined
     * starting point. */
    if (v.isDefault) {
      await client.query(
        `UPDATE saved_views SET is_default = FALSE WHERE module=$1 AND owner_id=$2`,
        [v.module, req.user._id]);
    }
    const r = await client.query(
      `INSERT INTO saved_views (module, name, owner_id, visibility, is_public, is_default, share_with, columns, criteria)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING id`,
      [v.module, v.name, req.user._id, v.visibility, v.visibility === 'everyone', v.isDefault,
       JSON.stringify(v.shareWith), JSON.stringify(v.columns), JSON.stringify(v.criteria)]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { _id: r.rows[0].id }, message: 'View created' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const known = /required|Unknown module|at least one|characters or fewer/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  } finally { client.release(); }
});

/* Editing and deleting are the owner's, or full access's. A view shared WITH
 * you is not a view you own — without this, sharing a view would hand every
 * recipient the ability to rewrite it for everybody else. */
const ownedOr403 = async (req, res) => {
  const r = await pool.query(
    `SELECT owner_id, name FROM saved_views WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
  if (!r.rows.length) { res.status(404).json({ success: false, message: 'View not found' }); return null; }
  const own = String(r.rows[0].owner_id) === String(req.user._id);
  if (!own && !isFullAccess(req.user.role)) {
    res.status(403).json({ success: false, message: 'Only the person who created this view can change it' });
    return null;
  }
  return r.rows[0];
};

router.put('/:id', async (req, res) => {
  try {
    if (!(await ownedOr403(req, res))) return;
    const v = clean(req.body);
    await pool.query(
      `UPDATE saved_views
          SET name=$1, visibility=$2, is_public=$3, share_with=$4::jsonb,
              columns=$5::jsonb, criteria=$6::jsonb, is_default=$7, updated_at=NOW()
        WHERE id=$8`,
      [v.name, v.visibility, v.visibility === 'everyone', JSON.stringify(v.shareWith),
       JSON.stringify(v.columns), JSON.stringify(v.criteria), v.isDefault, req.params.id]);
    res.json({ success: true, message: 'View updated' });
  } catch (err) {
    const known = /required|Unknown module|at least one|characters or fewer/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!(await ownedOr403(req, res))) return;
    await pool.query(`UPDATE saved_views SET deleted_at = NOW() WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'View deleted' });
  } catch (err) { serverError(res, err); }
});

/* Column visibility — per person, per module. Always the caller's own row:
 * there is no reason for one person to change another's hidden columns, so the
 * employee id is never taken from the request. */
router.get('/column-prefs/:module', async (req, res) => {
  try {
    if (!MODULES.has(req.params.module)) return res.status(400).json({ success: false, message: 'Unknown module' });
    const r = await pool.query(
      `SELECT hidden FROM list_column_prefs WHERE employee_id=$1 AND module=$2`,
      [req.user._id, req.params.module]);
    res.json({ success: true, data: { hidden: r.rows[0]?.hidden || [] } });
  } catch (err) { serverError(res, err); }
});

router.put('/column-prefs/:module', async (req, res) => {
  try {
    if (!MODULES.has(req.params.module)) return res.status(400).json({ success: false, message: 'Unknown module' });
    const hidden = asArray(req.body?.hidden).map(String);
    await pool.query(
      `INSERT INTO list_column_prefs (employee_id, module, hidden, updated_at)
       VALUES ($1,$2,$3::jsonb,NOW())
       ON CONFLICT (employee_id, module)
       DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = NOW()`,
      [req.user._id, req.params.module, JSON.stringify(hidden)]);
    res.json({ success: true, message: 'Columns saved' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
