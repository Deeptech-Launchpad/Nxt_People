/* Operations -> Employee Information -> Delegation.
 *
 * Reassigns approvals from one person to another for a window. The reference
 * describes it as exactly that: "Delegation lets you reassign approvals from
 * one employee to another for a specific time frame."
 *
 * This file OWNS the records. Whether the approval engine consults them is a
 * separate, deliberate step: silently rerouting live approvals the moment a
 * row is saved would change who can approve leave and pay without anybody
 * asking for that, so `GET /delegations/active-for/:employeeId` exposes the
 * lookup and nothing calls it yet. The screen is honest about that.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');
const { isFullAccess } = require('../utils/roles');

router.use(protect);
const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

const TYPES = new Set(['temporary', 'permanent']);
const NOTIFY = new Set(['both', 'delegatee']);

const SELECT = `
  d.id AS "_id", d.type, d.starts_at AS "startsAt", d.ends_at AS "endsAt",
  d.notify, d.description, d.is_active AS "isActive",
  d.created_at AS "createdAt",
  json_build_object('id', dr.id, 'code', dr.employee_id,
    'firstName', dr.first_name, 'lastName', dr.last_name,
    'photoUrl', dr.photo_url) AS delegator,
  json_build_object('id', de.id, 'code', de.employee_id,
    'firstName', de.first_name, 'lastName', de.last_name,
    'photoUrl', de.photo_url) AS delegatee,
  /* Whether it applies TODAY, computed rather than stored: a stored flag goes
   * stale the moment a window closes and nothing runs to flip it. */
  (d.is_active
    AND (d.starts_at IS NULL OR d.starts_at <= CURRENT_DATE)
    AND (d.ends_at   IS NULL OR d.ends_at   >= CURRENT_DATE)) AS "inEffect"`;

const FROM = `approval_delegations d
  JOIN employees dr ON dr.id = d.delegator_id
  JOIN employees de ON de.id = d.delegatee_id`;

/* GET / — full access sees every delegation; anybody else sees only the ones
 * they are party to. Somebody's approvals being handed elsewhere is their
 * business, but not the whole org's. */
router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (!isFullAccess(req.user.role)) {
      params.push(req.user._id);
      where += ` AND (d.delegator_id = $${params.length} OR d.delegatee_id = $${params.length})`;
    }
    if (req.query.employeeId && isFullAccess(req.user.role)) {
      params.push(req.query.employeeId);
      where += ` AND (d.delegator_id = $${params.length} OR d.delegatee_id = $${params.length})`;
    }
    if (String(req.query.status) === 'active') where += ' AND d.is_active = TRUE';

    const r = await pool.query(
      `SELECT ${SELECT} FROM ${FROM} ${where} ORDER BY d.created_at DESC`, params);
    res.json({ success: true, data: r.rows, total: r.rows.length });
  } catch (err) { serverError(res, err); }
});

/* Who currently holds somebody's approvals. Exposed so the approval engine can
 * be pointed at it deliberately later; nothing calls it today. */
router.get('/active-for/:employeeId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE d.delegator_id = $1 AND d.is_active
          AND (d.starts_at IS NULL OR d.starts_at <= CURRENT_DATE)
          AND (d.ends_at   IS NULL OR d.ends_at   >= CURRENT_DATE)
        ORDER BY d.created_at DESC`, [req.params.employeeId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

const clean = (body) => {
  const delegatorId = String(body?.delegatorId || '').trim();
  const delegateeId = String(body?.delegateeId || '').trim();
  if (!delegatorId) throw new Error('Delegator is required');
  if (!delegateeId) throw new Error('Delegatee is required');
  if (delegatorId === delegateeId) throw new Error('A person cannot delegate to themselves');

  const type = TYPES.has(body?.type) ? body.type : 'temporary';
  const startsAt = body?.startsAt || null;
  const endsAt = body?.endsAt || null;
  /* Temporary means a window, so a temporary delegation without one would run
   * forever while claiming not to — the same trap as an unset expiry. */
  if (type === 'temporary' && (!startsAt || !endsAt)) {
    throw new Error('A temporary delegation needs a start and an end date');
  }
  if (startsAt && endsAt && String(endsAt) < String(startsAt)) {
    throw new Error('The end date cannot be before the start date');
  }
  return {
    delegatorId, delegateeId, type, startsAt, endsAt,
    notify: NOTIFY.has(body?.notify) ? body.notify : 'both',
    description: String(body?.description || '').trim() || null,
  };
};

router.post('/', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const v = clean(req.body);

    /* Two live delegations from the same person would leave it undefined which
     * one holds their approvals, so overlapping windows are refused rather
     * than silently layered. */
    const clash = await pool.query(
      `SELECT 1 FROM approval_delegations
        WHERE delegator_id = $1 AND is_active
          AND COALESCE(starts_at, '-infinity'::date) <= COALESCE($3::date, 'infinity'::date)
          AND COALESCE(ends_at,   'infinity'::date)  >= COALESCE($2::date, '-infinity'::date)
        LIMIT 1`,
      [v.delegatorId, v.startsAt, v.endsAt]);
    if (clash.rows.length) {
      return res.status(400).json({ success: false,
        message: 'That person already has a delegation covering those dates.' });
    }

    const r = await pool.query(
      `INSERT INTO approval_delegations
         (delegator_id, delegatee_id, type, starts_at, ends_at, notify, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [v.delegatorId, v.delegateeId, v.type, v.startsAt, v.endsAt, v.notify, v.description, req.user._id]);

    await logAudit(req, {
      action: 'CREATE', resource: 'Delegation', resourceId: r.rows[0].id,
      changes: { summary: 'Delegation created',
        fields: [{ field: 'window', from: null, to: `${v.startsAt || 'open'} to ${v.endsAt || 'open'}` }] },
    });

    /* The reference notifies the delegator and/or delegatee here. Recorded,
     * not sent — nothing in this module emails anybody automatically. */
    res.status(201).json({
      success: true, data: { _id: r.rows[0].id },
      message: 'Delegation saved. Nobody has been emailed — notifications are not sent automatically.',
    });
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ success: false, message: 'A person cannot delegate to themselves' });
    if (err.code === '23503') return res.status(400).json({ success: false, message: 'One of those employees no longer exists' });
    const known = /required|cannot|needs a start|before the start/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.put('/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const v = clean(req.body);
    const r = await pool.query(
      `UPDATE approval_delegations
          SET delegator_id=$1, delegatee_id=$2, type=$3, starts_at=$4, ends_at=$5,
              notify=$6, description=$7, is_active=$8, updated_at=NOW()
        WHERE id=$9 RETURNING id`,
      [v.delegatorId, v.delegateeId, v.type, v.startsAt, v.endsAt, v.notify, v.description,
       req.body?.isActive !== false, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Delegation not found' });
    await logAudit(req, { action: 'UPDATE', resource: 'Delegation', resourceId: req.params.id,
      changes: { summary: 'Delegation updated' } });
    res.json({ success: true, message: 'Delegation updated' });
  } catch (err) {
    const known = /required|cannot|needs a start|before the start/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.delete('/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM approval_delegations WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Delegation not found' });
    await logAudit(req, { action: 'DELETE', resource: 'Delegation', resourceId: req.params.id,
      changes: { summary: 'Delegation removed' } });
    res.json({ success: true, message: 'Delegation removed' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
