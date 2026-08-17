/**
 * routes/org-users.js
 * Manage Accounts → Users.
 *
 * Two groups over the same table, separated by whether a login account exists:
 *
 *   Users             is_user = true   — can sign in, subject to login_enabled
 *   Employee Profiles is_user = false  — recorded only, can never sign in
 *
 * In the reference that boundary is a licence. Here it is simply whether an
 * account exists, which is the half that means something without billing.
 *
 * Employment status and account access are deliberately separate columns. They
 * usually agree — an employment change sets access — but they answer different
 * questions, and the whole reason nobody noticed the sign-in gap was that the
 * product only ever had one of them.
 *
 * Employee status stays Active / Inactive rather than the reference's
 * Active / Resigned / Terminated. exit_requests only models resignation, and
 * only 40 of the 87 inactive employees have an exit date, so splitting them
 * would mean inventing a separation type for 47 people.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const ADMIN = ['admin', 'director', 'hr_admin'];

const SELECT = `
  e.id, e.employee_id AS "employeeCode",
  TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
  e.email, e.photo_url AS "photoUrl", e.role,
  e.joining_date AS "joiningDate",
  COALESCE(e.status, 'active') AS "employeeStatus",
  e.is_user AS "isUser", e.login_enabled AS "loginEnabled",
  e.login_disabled_at AS "loginDisabledAt",
  e.designation, e.department,
  l.name AS location, d.name AS department_name, co.name AS company`;

const FROM = `
  employees e
  LEFT JOIN work_locations l ON l.id = e.work_location_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN companies co ON co.id = e.company_id`;

// group: users | profiles      filter: all | enabled | disabled | active | inactive
router.get('/', authorize(...ADMIN), async (req, res) => {
  const group = req.query.group === 'profiles' ? 'profiles' : 'users';
  const filter = String(req.query.filter || 'all');

  const where = ['e.deleted_at IS NULL', group === 'profiles' ? 'e.is_user = FALSE' : 'e.is_user = TRUE'];
  const params = [];

  if (group === 'users') {
    if (filter === 'enabled') where.push('e.login_enabled = TRUE');
    if (filter === 'disabled') where.push('e.login_enabled = FALSE');
    // Invited — an account that exists but has never been taken up. Everyone
    // migrated in had already accepted, so this is empty until someone is added
    // through Add User(s), which is the same as the reference reports.
    if (filter === 'invited') where.push('COALESCE(e.has_accepted, FALSE) = FALSE');
  } else {
    if (filter === 'active') where.push(`COALESCE(e.status, 'active') = 'active'`);
    if (filter === 'inactive') where.push(`COALESCE(e.status, 'active') <> 'active'`);
  }

  // Free-text search across the fields someone would actually type.
  if (req.query.search) {
    params.push(`%${String(req.query.search).trim()}%`);
    where.push(`(e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length}
                 OR e.email ILIKE $${params.length} OR e.employee_id ILIKE $${params.length})`);
  }
  if (req.query.role) { params.push(req.query.role); where.push(`e.role = $${params.length}`); }
  if (req.query.locationId) { params.push(req.query.locationId); where.push(`e.work_location_id = $${params.length}`); }
  if (req.query.employeeStatus) {
    params.push(req.query.employeeStatus);
    where.push(`COALESCE(e.status, 'active') = $${params.length}`);
  }

  try {
    const rows = await pool.query(
      `SELECT ${SELECT} FROM ${FROM} WHERE ${where.join(' AND ')}
        ORDER BY e.employee_id DESC NULLS LAST, e.created_at DESC`,
      params
    );

    // The rail shows a count beside each filter, so they come back together
    // rather than as five more round-trips from the browser.
    const counts = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_user)                             AS "users",
         COUNT(*) FILTER (WHERE is_user AND login_enabled)           AS "enabled",
         COUNT(*) FILTER (WHERE is_user AND NOT login_enabled)       AS "disabled",
         COUNT(*) FILTER (WHERE is_user AND NOT COALESCE(has_accepted, FALSE)) AS "invited",
         COUNT(*) FILTER (WHERE NOT is_user)                         AS "profiles",
         COUNT(*) FILTER (WHERE NOT is_user AND COALESCE(status,'active') = 'active')  AS "profilesActive",
         COUNT(*) FILTER (WHERE NOT is_user AND COALESCE(status,'active') <> 'active') AS "profilesInactive"
       FROM employees WHERE deleted_at IS NULL`
    );

    res.json({ success: true, data: rows.rows, counts: counts.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// Turn sign-in on or off for one person. This is the control the reference puts
// in the Actions column, and the only thing that now decides whether a
// password or Google sign-in is accepted.
router.patch('/:id/login', authorize(...ADMIN), async (req, res) => {
  const enable = req.body?.loginEnabled !== false;
  const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;

  try {
    // Locking yourself out is recoverable only from the database.
    if (String(req.params.id) === String(req.user._id) && !enable) {
      return res.status(400).json({ success: false, message: 'You cannot disable your own sign-in' });
    }

    const target = await pool.query(
      `SELECT is_user AS "isUser", role FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!target.rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (!target.rows[0].isUser) {
      return res.status(400).json({ success: false, message: 'That person has no login account to enable' });
    }

    // Refusing to remove the last way in is worth a query. An org with every
    // admin blocked cannot re-enable anyone through the UI.
    if (!enable && ['admin', 'director'].includes(target.rows[0].role)) {
      const remaining = await pool.query(
        `SELECT COUNT(*)::int AS n FROM employees
          WHERE role IN ('admin','director') AND login_enabled AND is_user
            AND deleted_at IS NULL AND id <> $1`,
        [req.params.id]
      );
      if (remaining.rows[0].n === 0) {
        return res.status(400).json({
          success: false,
          message: 'That is the last administrator who can sign in. Enable another first.',
        });
      }
    }

    const r = await pool.query(
      `UPDATE employees
          SET login_enabled = $1,
              login_disabled_at = CASE WHEN $1 THEN NULL ELSE NOW() END,
              login_disabled_reason = CASE WHEN $1 THEN NULL ELSE $2 END,
              -- Ends any live session at the next refresh, rather than letting
              -- an issued access token run to its own expiry.
              tokens_revoked_at = CASE WHEN $1 THEN tokens_revoked_at ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $3
       RETURNING id, login_enabled AS "loginEnabled"`,
      [enable, reason, req.params.id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// Move someone between the two groups: grant a login account, or take it away
// and leave the person on record.
router.patch('/:id/account', authorize(...ADMIN), async (req, res) => {
  const isUser = req.body?.isUser !== false;
  try {
    if (String(req.params.id) === String(req.user._id) && !isUser) {
      return res.status(400).json({ success: false, message: 'You cannot remove your own account' });
    }
    const r = await pool.query(
      `UPDATE employees
          SET is_user = $1,
              -- Removing the account withdraws access with it; granting one
              -- does not silently re-enable sign-in for someone who was blocked.
              login_enabled = CASE WHEN $1 THEN login_enabled ELSE FALSE END,
              tokens_revoked_at = CASE WHEN $1 THEN tokens_revoked_at ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, is_user AS "isUser", login_enabled AS "loginEnabled"`,
      [isUser, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// The next employee id, following whatever pattern the existing ones use. The
// reference shows the last one beside a Generate button, and so does this: an
// id that jumps for no visible reason is worse than one you can check.
router.get('/next-code', authorize(...ADMIN), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT employee_id FROM employees
        WHERE employee_id ~ '^[A-Za-z]+[0-9]+$'
        ORDER BY REGEXP_REPLACE(employee_id, '[^0-9]', '', 'g')::bigint DESC
        LIMIT 1`
    );
    const last = r.rows[0]?.employee_id || null;
    if (!last) return res.json({ success: true, data: { last: null, next: null } });

    const prefix = last.replace(/[0-9]+$/, '');
    const digits = last.slice(prefix.length);
    const next = prefix + String(Number(digits) + 1).padStart(digits.length, '0');
    res.json({ success: true, data: { last, next } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// Add a user, or an employee profile — the same person record either way, and
// the only difference is whether an account comes with it.
//
// No password is set. A user added here is Invited until they set one through
// the reset-password flow, which is why that filter exists.
router.post('/', authorize(...ADMIN), async (req, res) => {
  const b = req.body || {};
  const isUser = b.isUser !== false;

  const firstName = String(b.firstName || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  if (!firstName) return res.status(400).json({ success: false, message: 'A first name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address' });
  }

  const ROLES = ['admin', 'director', 'hr_admin', 'manager', 'team_incharge', 'team_member'];
  const role = ROLES.includes(b.role) ? b.role : 'team_member';

  try {
    const clash = await pool.query(`SELECT 1 FROM employees WHERE LOWER(email) = $1 AND deleted_at IS NULL`, [email]);
    if (clash.rows.length) {
      return res.status(400).json({ success: false, message: 'Someone already has that email address' });
    }
    const code = String(b.employeeCode || '').trim() || null;
    if (code) {
      const dupe = await pool.query(`SELECT 1 FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code]);
      if (dupe.rows.length) {
        return res.status(400).json({ success: false, message: 'That employee id is already in use' });
      }
    }

    const r = await pool.query(
      `INSERT INTO employees
         (first_name, last_name, email, employee_id, role, joining_date,
          work_location_id, department_id, registration_status, has_accepted,
          is_user, login_enabled, status, shift_id, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',FALSE,$9,$9,'active',
               (SELECT id FROM shifts WHERE is_default = TRUE ORDER BY created_at LIMIT 1),
               (SELECT id FROM companies ORDER BY created_at LIMIT 1))
       RETURNING id, employee_id AS "employeeCode",
                 TRIM(CONCAT(first_name, ' ', last_name)) AS name, email,
                 is_user AS "isUser", login_enabled AS "loginEnabled"`,
      [firstName, String(b.lastName || '').trim() || null, email, code, role,
       b.joiningDate || null, b.locationId || null, b.departmentId || null, isUser]
    );

    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'That email or employee id already exists' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
