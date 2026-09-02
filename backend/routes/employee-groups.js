/* Operations -> Employee Information -> Groups.
 *
 * A named list of people with an administrator and members, used for
 * announcements and distribution. NOT applicability_groups, which decides
 * which policy applies to whom — folding the two together would mean adding
 * somebody to an HR mailing list silently changing who a leave policy covers.
 *
 * Membership carries a role of exactly 'admin' or 'member', enforced by a
 * CHECK in migrate_employee_information.js rather than trusted from the body.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');

router.use(protect);
const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

const ROLES = new Set(['admin', 'member']);
const cleanRole = (r) => (ROLES.has(String(r)) ? String(r) : 'member');

const name = (v, field, { required = false, max = 255 } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (s.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return s;
};

const GROUP_SELECT = `
  g.id AS "_id", g.name, g.description, g.email,
  g.created_at AS "createdAt", g.updated_at AS "updatedAt",
  (SELECT COUNT(*)::int FROM employee_group_members m
     JOIN employees e ON e.id = m.employee_id
    WHERE m.group_id = g.id AND e.deleted_at IS NULL) AS "memberCount"`;

/* GET / — the list.
 * `scope=my` is the All groups / My groups dropdown: groups the caller belongs
 * to in any role, which is a narrowing of the same list, never a different one. */
router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = 'WHERE g.deleted_at IS NULL';

    if (String(req.query.scope) === 'my') {
      params.push(req.user._id);
      where += ` AND EXISTS (SELECT 1 FROM employee_group_members m
                              WHERE m.group_id = g.id AND m.employee_id = $${params.length})`;
    }
    const q = String(req.query.q || '').trim();
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (g.name ILIKE $${params.length} OR g.email ILIKE $${params.length})`;
    }

    const r = await pool.query(
      `SELECT ${GROUP_SELECT} FROM employee_groups g ${where} ORDER BY g.created_at DESC`, params);
    res.json({ success: true, data: r.rows, total: r.rows.length });
  } catch (err) { serverError(res, err); }
});

/* GET /:id — the detail panel, group plus its members.
 * Deleted employees are excluded rather than rendered as blank rows; the
 * membership row is left in place so restoring a person restores their groups. */
router.get('/:id', async (req, res) => {
  try {
    const g = await pool.query(
      `SELECT ${GROUP_SELECT} FROM employee_groups g WHERE g.id = $1 AND g.deleted_at IS NULL`,
      [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });

    const members = await pool.query(
      `SELECT m.id AS "_id", m.role, m.created_at AS "addedAt",
              e.id AS "employeeId", e.employee_id AS "code",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.photo_url AS "photoUrl", e.designation
         FROM employee_group_members m
         JOIN employees e ON e.id = m.employee_id
        WHERE m.group_id = $1 AND e.deleted_at IS NULL
        ORDER BY (m.role = 'admin') DESC, e.first_name`,
      [req.params.id]);

    res.json({ success: true, data: { ...g.rows[0], members: members.rows } });
  } catch (err) { serverError(res, err); }
});

/* POST / — create, with the administrator and any members in one call.
 * A group with no administrator has nobody who can maintain it, so the
 * administrator is required and is written as a member row with role 'admin'
 * rather than a separate column: one place to ask "who is in this group". */
router.post('/', authorize(...WRITE_ROLES), async (req, res) => {
  const client = await pool.connect();
  try {
    const groupName = name(req.body?.name, 'Group name', { required: true });
    const description = name(req.body?.description, 'Description', { max: 2000 });
    const email = name(req.body?.email, 'Group email address');
    const adminIds = Array.isArray(req.body?.administrators) ? req.body.administrators : [];
    const memberIds = Array.isArray(req.body?.members) ? req.body.members : [];
    if (!adminIds.length) throw new Error('At least one administrator is required');

    await client.query('BEGIN');
    const g = await client.query(
      `INSERT INTO employee_groups (name, description, email, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [groupName, description, email, req.user._id]);
    const groupId = g.rows[0].id;

    // Administrators first: if somebody appears in both lists the admin role
    // must win, and ON CONFLICT DO NOTHING would otherwise keep whichever
    // arrived first.
    for (const id of adminIds) {
      await client.query(
        `INSERT INTO employee_group_members (group_id, employee_id, role, added_by)
         VALUES ($1,$2,'admin',$3) ON CONFLICT (group_id, employee_id)
         DO UPDATE SET role = 'admin'`, [groupId, id, req.user._id]);
    }
    for (const id of memberIds) {
      await client.query(
        `INSERT INTO employee_group_members (group_id, employee_id, role, added_by)
         VALUES ($1,$2,'member',$3) ON CONFLICT (group_id, employee_id) DO NOTHING`,
        [groupId, id, req.user._id]);
    }
    await client.query('COMMIT');

    await logAudit(req, {
      action: 'CREATE', resource: 'EmployeeGroup', resourceId: groupId,
      changes: { summary: `Group "${groupName}" created`,
        fields: [{ field: 'members', from: null, to: adminIds.length + memberIds.length }] },
    });

    /* The reference offers "Notify newly added employees." Deliberately not
     * wired: nothing in this module sends mail without being asked, and a
     * checkbox that quietly emails everyone added is exactly the automatic
     * send that is not allowed here. The flag is recorded, not acted on. */
    res.status(201).json({
      success: true, data: { _id: groupId },
      notifyRequested: !!req.body?.notify,
      message: req.body?.notify
        ? 'Group created. Notifications are not sent automatically — nobody has been emailed.'
        : 'Group created',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') return res.status(400).json({ success: false, message: 'One of those employees no longer exists' });
    const known = /required|characters or fewer/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  } finally { client.release(); }
});

router.put('/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const groupName = name(req.body?.name, 'Group name', { required: true });
    const description = name(req.body?.description, 'Description', { max: 2000 });
    const email = name(req.body?.email, 'Group email address');
    const r = await pool.query(
      `UPDATE employee_groups SET name=$1, description=$2, email=$3, updated_at=NOW()
        WHERE id=$4 AND deleted_at IS NULL RETURNING id`,
      [groupName, description, email, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    await logAudit(req, { action: 'UPDATE', resource: 'EmployeeGroup', resourceId: req.params.id,
      changes: { summary: `Group renamed to "${groupName}"` } });
    res.json({ success: true, message: 'Group updated' });
  } catch (err) {
    const known = /required|characters or fewer/i.test(err.message || '');
    if (known) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

/* Soft delete, matching how employees are removed here: a hard delete would
 * cascade the membership rows away and there would be no record the group had
 * ever existed. */
router.delete('/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE employee_groups SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING name`,
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    await logAudit(req, { action: 'DELETE', resource: 'EmployeeGroup', resourceId: req.params.id,
      changes: { summary: `Group "${r.rows[0].name}" deleted` } });
    res.json({ success: true, message: 'Group deleted' });
  } catch (err) { serverError(res, err); }
});

/* Members. Add is idempotent so the type-ahead cannot create a duplicate by
 * double-click; the unique index would refuse it anyway, but a 400 for
 * "already in this group" is not an error worth showing. */
router.post('/:id/members', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds
      : (req.body?.employeeId ? [req.body.employeeId] : []);
    if (!ids.length) return res.status(400).json({ success: false, message: 'Select at least one employee' });
    const role = cleanRole(req.body?.role);

    const exists = await pool.query(
      `SELECT 1 FROM employee_groups WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
    if (!exists.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });

    let added = 0;
    for (const id of ids) {
      const r = await pool.query(
        `INSERT INTO employee_group_members (group_id, employee_id, role, added_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT (group_id, employee_id) DO NOTHING RETURNING id`,
        [req.params.id, id, role, req.user._id]);
      if (r.rows.length) added++;
    }
    res.json({ success: true, added, message: `${added} added` });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ success: false, message: 'That employee no longer exists' });
    serverError(res, err);
  }
});

router.put('/:id/members/:employeeId', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const role = cleanRole(req.body?.role);
    /* A group whose last administrator is demoted has nobody who can manage
     * it, and nothing in the UI would say so — the row would just change and
     * the group would quietly become unmaintainable. */
    if (role === 'member') {
      const admins = await pool.query(
        `SELECT COUNT(*)::int n FROM employee_group_members
          WHERE group_id=$1 AND role='admin' AND employee_id <> $2`,
        [req.params.id, req.params.employeeId]);
      if (admins.rows[0].n === 0) {
        return res.status(400).json({ success: false,
          message: 'This is the only administrator. Make somebody else an administrator first.' });
      }
    }
    const r = await pool.query(
      `UPDATE employee_group_members SET role=$1 WHERE group_id=$2 AND employee_id=$3 RETURNING id`,
      [role, req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'That person is not in this group' });
    res.json({ success: true, message: 'Role updated' });
  } catch (err) { serverError(res, err); }
});

router.delete('/:id/members/:employeeId', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    // Same reasoning as the demotion guard above.
    const admins = await pool.query(
      `SELECT COUNT(*)::int n FROM employee_group_members
        WHERE group_id=$1 AND role='admin' AND employee_id <> $2`,
      [req.params.id, req.params.employeeId]);
    const isAdmin = await pool.query(
      `SELECT 1 FROM employee_group_members WHERE group_id=$1 AND employee_id=$2 AND role='admin'`,
      [req.params.id, req.params.employeeId]);
    if (isAdmin.rows.length && admins.rows[0].n === 0) {
      return res.status(400).json({ success: false,
        message: 'This is the only administrator. Make somebody else an administrator first.' });
    }
    const r = await pool.query(
      `DELETE FROM employee_group_members WHERE group_id=$1 AND employee_id=$2 RETURNING id`,
      [req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'That person is not in this group' });
    res.json({ success: true, message: 'Removed from group' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
