/**
 * routes/shift-groups.js
 * Operations → Shift → Shift Group.
 *
 * A named bucket of people with an effective period. The reference uses it for
 * two things: narrowing the schedule to a group, and assigning a shift to that
 * group in one action. It is not itself a schedule — nothing here writes
 * shift_roster; /roster/assign-range does that, and this only answers "who is
 * in this group, for which dates".
 *
 * Membership carries its own period, so the same person on Night Crew in
 * October and Day Crew in November is two rows, not one row that forgets
 * October.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];
const bad = (res, message) => res.status(400).json({ success: false, message });

/** Groups, each with how many people are in it for the month being looked at. */
router.get('/', async (req, res) => {
  try {
    // `on` narrows the count to a date — the list is the same, the headcount
    // is "as at". Without it the count would be every membership row ever,
    // which for a group reused month after month is a meaningless number.
    const on = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.on || '')) ? req.query.on : null;

    const r = await pool.query(
      `SELECT g.id AS "_id", g.name, g.description, g.is_active AS "isActive",
              COUNT(m.id) FILTER (
                WHERE $1::date IS NULL
                   OR (m.effective_from <= $1::date
                       AND (m.effective_to IS NULL OR m.effective_to >= $1::date))
              )::int AS "memberCount"
         FROM shift_groups g
         LEFT JOIN shift_group_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.name`,
      [on]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

/**
 * Every membership overlapping a month, with the employee on it. This is what
 * the Shift Group tab's grid is drawn from.
 */
router.get('/members', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return bad(res, 'startDate and endDate are required');

    const r = await pool.query(
      `SELECT m.id AS "_id", m.group_id AS "groupId", g.name AS "groupName",
              m.employee_id AS "employeeId",
              m.effective_from::text AS "effectiveFrom", m.effective_to::text AS "effectiveTo",
              e.employee_id AS "employeeCode",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName",
              e.department, e.designation, e.photo_url AS "photoUrl"
         FROM shift_group_members m
         JOIN shift_groups g ON g.id = m.group_id
         JOIN employees e ON e.id = m.employee_id
        WHERE e.deleted_at IS NULL
          AND m.effective_from <= $2::date
          AND (m.effective_to IS NULL OR m.effective_to >= $1::date)
        ORDER BY g.name, e.first_name`,
      [startDate, endDate]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

router.post('/', authorize(...WRITE), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return bad(res, 'A group needs a name');

    const r = await pool.query(
      `INSERT INTO shift_groups (name, description) VALUES ($1, $2)
       RETURNING id AS "_id", name, description`,
      [name, String(req.body.description || '').trim() || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    // The unique constraint is the check — two groups called "Night Crew" is
    // exactly the confusion this screen exists to avoid.
    if (err.code === '23505') return bad(res, `There is already a group called "${req.body.name}"`);
    serverError(res, err);
  }
});

router.delete('/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM shift_groups WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'That group no longer exists' });
    // Members go with it (ON DELETE CASCADE) — nothing in shift_roster is
    // touched, because a group has never been what a rostered day points at.
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

/** Put people into a group for a period. */
router.post('/:id/members', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const { employeeIds, effectiveFrom, effectiveTo } = req.body;
    if (!Array.isArray(employeeIds) || !employeeIds.length) return bad(res, 'Choose at least one employee');
    if (!effectiveFrom) return bad(res, 'An effective period needs a start date');
    if (effectiveTo && String(effectiveTo) < String(effectiveFrom)) {
      return bad(res, 'The end of the period cannot be before its start');
    }

    const group = (await client.query(`SELECT id, name FROM shift_groups WHERE id = $1`, [req.params.id])).rows[0];
    if (!group) return res.status(404).json({ success: false, message: 'That group no longer exists' });

    await client.query('BEGIN');
    /* ON CONFLICT on (group, employee, effective_from): re-submitting the same
     * period moves its end date rather than failing or silently duplicating.
     * A DIFFERENT effective_from is a new row on purpose — that is a second
     * spell in the group, not an edit of the first. */
    const r = await client.query(
      `INSERT INTO shift_group_members (group_id, employee_id, effective_from, effective_to, created_by)
       SELECT $1::uuid, emp.id, $3::date, $4::date, $5::uuid
         FROM unnest($2::uuid[]) AS emp(id)
       ON CONFLICT (group_id, employee_id, effective_from)
         DO UPDATE SET effective_to = EXCLUDED.effective_to`,
      [req.params.id, [...new Set(employeeIds.map(String))], effectiveFrom, effectiveTo || null, req.user._id]
    );
    await client.query('COMMIT');

    res.json({ success: true, added: r.rowCount,
      message: `${r.rowCount} employee(s) mapped to ${group.name}` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally { client.release(); }
});

router.delete('/members/:memberId', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM shift_group_members WHERE id = $1 RETURNING id`, [req.params.memberId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'That mapping no longer exists' });
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
