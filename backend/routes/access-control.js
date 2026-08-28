/**
 * routes/access-control.js
 * Manage Accounts → User Access Control.
 *
 *   General Role              roles, their members, and who may be assigned
 *   Specific Role             scoped roles, assigned separately
 *   Specific Role Assignment  an employee, a specific role, and where it applies
 *   Function Based Permissions the sixteen switches, per role
 *   Administrator             per user, per service, a level for Settings and Data
 *   Applicability groups      named employees, or criteria that decide membership
 *
 * Every write that touches a role or its permissions reloads the in-memory
 * permission map before answering. Without that, granting a permission would
 * appear to work and change nothing until the next restart — the same failure
 * the attendance config cache had, which was indistinguishable from the
 * setting not working.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const permissions = require('../utils/permissions');
const logger = require('../logger');
const {
  FUNCTIONS, FUNCTION_KEYS, SERVICES, SERVICE_KEYS, ACCESS_LEVELS,
  PERMISSIONS, PERMISSION_KEYS, APPLICABILITY_FIELDS, CRITERIA_FIELDS,
} = require('../utils/accessCatalog');
const { forRole, invalidate } = require('../utils/functionAccess');

router.use(protect);

// Reading the access model is what the whole application needs to know what to
// show; changing it is full-access only.
const WRITE = ['admin', 'director', 'hr_admin'];

const str = (v, label, max) => {
  const s = String(v ?? '').trim();
  if (!s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer`);
  return s;
};

const uuidOrNull = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw bad(`${label} is not valid`);
  }
  return s;
};

// Whether a message is safe to show is a property of the error, not something
// to infer from its wording. Matching on phrasing turned seven real validation
// failures into opaque 500s the first time this ran, because their wording
// happened not to contain any of the words the pattern looked for.
class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = message => new Invalid(message);

const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  // An unexpected error is the one worth keeping. Returning the generic
  // message without logging leaves "An internal server error occurred" on
  // screen and nothing anywhere to say what it was.
  logger.error({ err: err.message, code: err.code, stack: err.stack }, 'Access control request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

// employees has carried a photo under more than one column name over this
// project's life, and not every database has both. Asking the catalogue once
// beats a query that works on one database and 500s on another. The name can
// only be one of the two the IN clause allows, so it is safe to inline.
let PHOTO_EXPR = null;
async function photoExpr() {
  if (PHOTO_EXPR) return PHOTO_EXPR;
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name IN ('photo_url', 'avatar')`
  );
  const have = r.rows.map(x => x.column_name);
  PHOTO_EXPR = have.length === 2 ? 'COALESCE(e.photo_url, e.avatar)'
    : have.length === 1 ? `e.${have[0]}`
    : 'NULL::text';
  if (have.length < 2) {
    logger.warn({ have }, 'employees has no photo_url/avatar pair; avatars fall back to initials');
  }
  return PHOTO_EXPR;
}

// A role's key is what employees.role stores. Renaming a role must never
// change it, or every employee holding it is orphaned in one statement.
const keyFrom = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

// ── The catalogue the screens are drawn from ───────────────────────────────
router.get('/catalog', (req, res) => {
  res.json({
    success: true,
    data: { functions: FUNCTIONS, services: SERVICES, accessLevels: ACCESS_LEVELS,
            permissions: PERMISSIONS, applicabilityFields: APPLICABILITY_FIELDS,
            criteriaFields: CRITERIA_FIELDS },
  });
});

// ── Roles ──────────────────────────────────────────────────────────────────
const MEMBER_LIMIT = 10;   // what a card shows before the "+N" chip

const rolesWithMembers = async kind => {
  const roles = await pool.query(
    `SELECT r.id, r.key, r.name, r.kind, r.is_system AS "isSystem",
            r.description, r.cloned_from AS "clonedFrom", r.rank,
            COALESCE(ARRAY(SELECT p.permission FROM role_permissions p WHERE p.role_id = r.id ORDER BY p.permission), '{}') AS permissions
       FROM roles r WHERE r.kind = $1 ORDER BY r.rank, r.name`,
    [kind]
  );
  if (kind !== 'general') {
    // A specific role is not carried on employees.role; it is granted through
    // an assignment, so its members come from there.
    const counts = await pool.query(
      `SELECT a.role_id AS "roleId", COUNT(*)::int AS n
         FROM specific_role_assignments a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL AND e.status = 'active'
        GROUP BY a.role_id`
    );
    const byRole = new Map(counts.rows.map(c => [c.roleId, c.n]));
    return roles.rows.map(r => ({ ...r, memberCount: byRole.get(r.id) || 0, members: [] }));
  }

  // Current staff only, the way every other count in Manage Accounts reads.
  const photo = await photoExpr();
  const members = await pool.query(
    `SELECT e.id, e.role AS "roleKey", e.employee_id AS "employeeId",
            TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
            e.email, ${photo} AS photo
       FROM employees e
      WHERE e.deleted_at IS NULL AND e.status = 'active'
      ORDER BY e.first_name, e.last_name`
  );
  return roles.rows.map(r => {
    const mine = members.rows.filter(m => m.roleKey === r.key);
    return { ...r, memberCount: mine.length, members: mine.slice(0, MEMBER_LIMIT) };
  });
};

router.get('/roles', async (req, res) => {
  try {
    const kind = req.query.kind === 'specific' ? 'specific' : 'general';
    res.json({ success: true, data: await rolesWithMembers(kind) });
  } catch (err) { fail(res, err); }
});

// Everyone on a role — what the "+31" chip opens.
router.get('/roles/:id/members', async (req, res) => {
  try {
    const role = await pool.query(`SELECT key, kind FROM roles WHERE id = $1`, [req.params.id]);
    if (!role.rows.length) return res.status(404).json({ success: false, message: 'Role not found' });
    const photo = await photoExpr();

    const r = role.rows[0].kind === 'general'
      ? await pool.query(
          `SELECT e.id, e.employee_id AS "employeeId",
                  TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.email,
                  ${photo} AS photo, e.designation, e.department
             FROM employees e
            WHERE e.role = $1 AND e.deleted_at IS NULL AND e.status = 'active'
            ORDER BY e.first_name, e.last_name`, [role.rows[0].key])
      : await pool.query(
          `SELECT e.id, e.employee_id AS "employeeId",
                  TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.email,
                  ${photo} AS photo, e.designation, e.department
             FROM specific_role_assignments a
             JOIN employees e ON e.id = a.employee_id
            WHERE a.role_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'
            ORDER BY e.first_name, e.last_name`, [req.params.id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/roles', authorize(...WRITE), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    const name = str(b.name, 'Role name', 100);
    const kind = b.kind === 'specific' ? 'specific' : 'general';
    const cloneId = uuidOrNull(b.cloneFromId, 'Clone role');

    let key = keyFrom(name);
    if (!key) throw bad('Role name must contain a letter or a number');

    await client.query('BEGIN');

    // Two roles named differently can still reduce to the same key, and the
    // key is what employees carry — so it is made unique rather than rejected.
    const taken = await client.query(`SELECT key FROM roles WHERE key LIKE $1`, [`${key}%`]);
    if (taken.rows.some(r => r.key === key)) {
      let n = 2;
      while (taken.rows.some(r => r.key === `${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }

    const created = await client.query(
      `INSERT INTO roles (key, name, kind, description, cloned_from, is_system, rank)
       VALUES ($1, $2, $3, $4, $5, FALSE, 100) RETURNING id`,
      [key, name, kind, b.description ? String(b.description).slice(0, 255) : null, cloneId]
    );
    const id = created.rows[0].id;

    if (cloneId) {
      // Clone means the permissions and the sixteen switches, not just a name.
      // Copying the name alone is what makes a cloned role grant nothing.
      await client.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT $1, permission FROM role_permissions WHERE role_id = $2
         ON CONFLICT DO NOTHING`, [id, cloneId]);
      await client.query(
        `INSERT INTO role_functions (role_id, function_key, allowed, options)
         SELECT $1, function_key, allowed, options FROM role_functions WHERE role_id = $2
         ON CONFLICT DO NOTHING`, [id, cloneId]);
    }

    if (kind === 'general') {
      // A general role always has all sixteen rows, cloned or not, so the
      // screen never has to guess what a missing row means.
      for (const f of FUNCTIONS) {
        await client.query(
          `INSERT INTO role_functions (role_id, function_key, allowed, options)
           VALUES ($1, $2, FALSE, '{}'::jsonb) ON CONFLICT DO NOTHING`, [id, f.key]);
      }
    }

    await client.query('COMMIT');
    await permissions.reload();
    const list = await rolesWithMembers(kind);
    res.status(201).json({ success: true, data: list.find(r => r.id === id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'That role already exists' });
    fail(res, err);
  } finally { client.release(); }
});

router.patch('/roles/:id', authorize(...WRITE), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT id, kind, is_system FROM roles WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Role not found' });

    await client.query('BEGIN');

    if (b.name !== undefined) {
      // The name changes; the key never does. Employees carry the key.
      await client.query(
        `UPDATE roles SET name = $1, updated_at = NOW() WHERE id = $2`,
        [str(b.name, 'Role name', 100), req.params.id]
      );
    }

    if (Array.isArray(b.permissions)) {
      for (const p of b.permissions) {
        if (!PERMISSION_KEYS.has(p)) throw bad(`'${p}' is not a permission`);
      }
      // You cannot take org.manage off your own role. The organization-wide
      // guard below is not enough on its own: another role having it is no
      // help if you are the one who has to reach this screen to fix it, and
      // this is exactly how the first run of the test locked itself out.
      // The Users screen already refuses self-demotion for the same reason.
      const mine = await client.query(`SELECT key FROM roles WHERE id = $1`, [req.params.id]);
      if (mine.rows[0]?.key === req.user.role && !b.permissions.includes('org.manage')
          && permissions.roleCan(req.user.role, 'org.manage')) {
        throw bad('This is your own role. Removing that permission would lock you out of this screen.');
      }

      // A system role's permissions are what the route guards were built from.
      // Editing them is allowed — that is the point of a permission layer —
      // but removing org.manage from the last role that has it would leave
      // nobody able to put it back.
      if (existing.rows[0].is_system) {
        const others = await client.query(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions p
             JOIN roles r ON r.id = p.role_id
             JOIN employees e ON e.role = r.key AND e.deleted_at IS NULL AND e.status = 'active'
            WHERE p.permission = 'org.manage' AND p.role_id <> $1`,
          [req.params.id]
        );
        if (!b.permissions.includes('org.manage') && others.rows[0].n === 0) {
          throw bad('This is the only role that can manage the organization. Give another role that permission first.');
        }
      }
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [req.params.id]);
      for (const p of b.permissions) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.params.id, p]
        );
      }
    }

    await client.query('COMMIT');
    await permissions.reload();
    const list = await rolesWithMembers(existing.rows[0].kind);
    res.json({ success: true, data: list.find(r => r.id === req.params.id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/roles/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, name, kind, is_system FROM roles WHERE id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Role not found' });
    const role = r.rows[0];

    // The six the application was built on. Every route guard was derived from
    // them and every employee carries one of their keys.
    if (role.is_system) {
      return res.status(400).json({ success: false, message: `${role.name} is a built-in role and cannot be deleted` });
    }

    const held = role.kind === 'general'
      ? await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE role = $1 AND deleted_at IS NULL`, [role.key])
      : await pool.query(`SELECT COUNT(*)::int AS n FROM specific_role_assignments WHERE role_id = $1`, [req.params.id]);
    if (held.rows[0].n > 0) {
      return res.status(400).json({
        success: false,
        message: `${held.rows[0].n} user(s) still have this role. Move them to another role first.`,
      });
    }

    await pool.query(`DELETE FROM roles WHERE id = $1`, [req.params.id]);
    await permissions.reload();
    res.json({ success: true, message: 'Role deleted' });
  } catch (err) { fail(res, err); }
});

// Assign a user to a general role. One general role per employee, so this
// moves them rather than adding.
router.post('/roles/:id/members', authorize(...WRITE), async (req, res) => {
  try {
    const employeeId = uuidOrNull(req.body?.employeeId, 'User');
    if (!employeeId) throw bad('User is required');

    const role = await pool.query(`SELECT key, name, kind FROM roles WHERE id = $1`, [req.params.id]);
    if (!role.rows.length) return res.status(404).json({ success: false, message: 'Role not found' });
    if (role.rows[0].kind !== 'general') {
      throw bad('A specific role is granted under Specific Role Assignment');
    }

    const emp = await pool.query(
      `SELECT id, role, TRIM(CONCAT(first_name, ' ', last_name)) AS name
         FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
    if (!emp.rows.length) return res.status(404).json({ success: false, message: 'User not found' });

    // Moving the last org.manage holder out would lock the organization out of
    // its own settings. The same guard the Users screen already applies.
    if (permissions.roleCan(emp.rows[0].role, 'org.manage') && !permissions.roleCan(role.rows[0].key, 'org.manage')) {
      const remaining = await pool.query(
        `SELECT COUNT(*)::int AS n FROM employees e
           JOIN roles r ON r.key = e.role
           JOIN role_permissions p ON p.role_id = r.id AND p.permission = 'org.manage'
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.id <> $1`,
        [employeeId]
      );
      if (remaining.rows[0].n === 0) {
        throw bad('This is the last user who can manage the organization. Give someone else that access first.');
      }
    }

    await pool.query(`UPDATE employees SET role = $1, updated_at = NOW() WHERE id = $2`, [role.rows[0].key, employeeId]);
    res.json({ success: true, message: `${emp.rows[0].name} assigned to ${role.rows[0].name}` });
  } catch (err) { fail(res, err); }
});

// ── Function Based Permissions ─────────────────────────────────────────────

/* What the signed-in user's own role allows. Every screen needs this to decide
 * what to render, so it is deliberately not behind WRITE — a team member has
 * to be able to ask what they are allowed to see. It answers for the caller's
 * role only and takes no parameters, so it cannot be used to enumerate what
 * other roles can do. */
router.get('/my-functions', async (req, res) => {
  try {
    const map = await forRole(req.user?.role);
    const out = {};
    for (const f of FUNCTIONS) {
      const row = map.get(f.key);
      out[f.key] = { allowed: !!row?.allowed, options: row?.options || {} };
    }
    res.json({ success: true, data: { role: req.user?.role || null, functions: out } });
  } catch (err) { fail(res, err); }
});

router.get('/functions', async (req, res) => {
  try {
    const roleId = uuidOrNull(req.query.roleId, 'Role');
    const role = roleId
      ? await pool.query(`SELECT id, name FROM roles WHERE id = $1 AND kind = 'general'`, [roleId])
      : await pool.query(`SELECT id, name FROM roles WHERE kind = 'general' ORDER BY rank LIMIT 1`);
    if (!role.rows.length) return res.status(404).json({ success: false, message: 'Role not found' });

    const rows = await pool.query(
      `SELECT function_key AS "functionKey", allowed, options FROM role_functions WHERE role_id = $1`,
      [role.rows[0].id]
    );
    const byKey = new Map(rows.rows.map(r => [r.functionKey, r]));

    res.json({
      success: true,
      data: {
        role: role.rows[0],
        // Driven by the catalogue, not by what happens to be in the table, so
        // a function added later appears on every role instead of only on the
        // ones a migration remembered.
        functions: FUNCTIONS.map(f => ({
          ...f,
          // Falls back to the catalogue default, not to false — the same
          // fallback utils/functionAccess.js applies when it enforces these.
          // Showing "off" for a row that behaves as "on" is the one way this
          // screen can lie now that something reads it.
          allowed: byKey.get(f.key)?.allowed ?? f.default,
          options: byKey.get(f.key)?.options ?? f.defaultOptions ?? {},
        })),
      },
    });
  } catch (err) { fail(res, err); }
});

router.patch('/functions/:roleId', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const changes = Array.isArray(req.body?.functions) ? req.body.functions : [];
    await client.query('BEGIN');
    for (const c of changes) {
      if (!FUNCTION_KEYS.has(c.functionKey)) throw bad(`'${c.functionKey}' is not a function`);
      await client.query(
        `INSERT INTO role_functions (role_id, function_key, allowed, options)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (role_id, function_key)
         DO UPDATE SET allowed = EXCLUDED.allowed, options = EXCLUDED.options`,
        [req.params.roleId, c.functionKey, !!c.allowed, JSON.stringify(c.options || {})]
      );
    }
    await client.query('COMMIT');
    // Something reads these now, so a save has to take effect immediately
    // rather than when the cache happens to expire.
    invalidate();
    const rows = await pool.query(
      `SELECT function_key AS "functionKey", allowed, options FROM role_functions WHERE role_id = $1`,
      [req.params.roleId]
    );
    const byKey = new Map(rows.rows.map(r => [r.functionKey, r]));
    res.json({
      success: true,
      data: FUNCTIONS.map(f => ({ ...f, allowed: byKey.get(f.key)?.allowed ?? f.default, options: byKey.get(f.key)?.options ?? f.defaultOptions ?? {} })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

// ── Specific Role Assignment ───────────────────────────────────────────────
const cleanApplicability = lines => (Array.isArray(lines) ? lines : []).map(line => {
  const out = {};
  for (const f of APPLICABILITY_FIELDS) {
    const v = uuidOrNull(line?.[f.key], f.label);
    if (v) out[f.key] = v;
  }
  return out;
}).filter(l => Object.keys(l).length > 0);

router.get('/specific-assignments', async (req, res) => {
  try {
    const photo = await photoExpr();
    const r = await pool.query(
      `SELECT a.id, a.employee_id AS "employeeId", a.role_id AS "roleId", a.applicability,
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName",
              e.employee_id AS "employeeCode", ${photo} AS photo,
              e.role AS "employeeRoleKey",
              gr.name AS "employeeRole", sr.name AS "roleName"
         FROM specific_role_assignments a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
         JOIN roles sr ON sr.id = a.role_id
         LEFT JOIN roles gr ON gr.key = e.role AND gr.kind = 'general'
        ORDER BY e.first_name, e.last_name, sr.name`
    );

    // Grouped per employee: the reference's table is one row per person with
    // their specific roles listed together, not one row per assignment.
    const byEmployee = new Map();
    for (const row of r.rows) {
      if (!byEmployee.has(row.employeeId)) {
        byEmployee.set(row.employeeId, {
          employeeId: row.employeeId, employeeName: row.employeeName,
          employeeCode: row.employeeCode, photo: row.photo,
          employeeRole: row.employeeRole || row.employeeRoleKey, roles: [],
        });
      }
      byEmployee.get(row.employeeId).roles.push({
        id: row.id, roleId: row.roleId, roleName: row.roleName, applicability: row.applicability,
      });
    }
    res.json({ success: true, data: [...byEmployee.values()] });
  } catch (err) { fail(res, err); }
});

router.post('/specific-assignments', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = uuidOrNull(req.body?.employeeId, 'Employee');
    if (!employeeId) throw bad('Employee is required');
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    if (!roles.length) throw bad('At least one role is required');

    await client.query('BEGIN');
    // Replaces this employee's specific roles wholesale: the editor shows all
    // of them at once, so a role removed there must disappear here.
    await client.query(`DELETE FROM specific_role_assignments WHERE employee_id = $1`, [employeeId]);
    for (const r of roles) {
      const roleId = uuidOrNull(r.roleId, 'Role name');
      if (!roleId) throw bad('Role name is required');
      const isSpecific = await client.query(`SELECT 1 FROM roles WHERE id = $1 AND kind = 'specific'`, [roleId]);
      if (!isSpecific.rows.length) throw bad('That is not a specific role');
      await client.query(
        `INSERT INTO specific_role_assignments (employee_id, role_id, applicability)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (employee_id, role_id) DO UPDATE SET applicability = EXCLUDED.applicability, updated_at = NOW()`,
        [employeeId, roleId, JSON.stringify(cleanApplicability(r.applicability))]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Specific role assigned' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/specific-assignments/:employeeId', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM specific_role_assignments WHERE employee_id = $1 RETURNING id`, [req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'No assignment found' });
    res.json({ success: true, message: 'Assignment removed' });
  } catch (err) { fail(res, err); }
});

// ── Administrator ──────────────────────────────────────────────────────────
router.get('/administrators', async (req, res) => {
  try {
    const photo = await photoExpr();
    const r = await pool.query(
      `SELECT a.employee_id AS "employeeId", a.service_key AS "serviceKey",
              a.settings_level AS "settingsLevel", a.data_level AS "dataLevel",
              e.employee_id AS "employeeCode",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
              ${photo} AS photo
         FROM administrator_access a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
        ORDER BY e.first_name, e.last_name`
    );
    const byEmployee = new Map();
    for (const row of r.rows) {
      if (!byEmployee.has(row.employeeId)) {
        byEmployee.set(row.employeeId, {
          employeeId: row.employeeId, employeeCode: row.employeeCode,
          name: row.name, photo: row.photo, access: {},
        });
      }
      byEmployee.get(row.employeeId).access[row.serviceKey] =
        { settings: row.settingsLevel, data: row.dataLevel };
    }
    res.json({ success: true, data: [...byEmployee.values()] });
  } catch (err) { fail(res, err); }
});

router.post('/administrators', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = uuidOrNull(req.body?.employeeId, 'User');
    if (!employeeId) throw bad('User is required');
    const emp = await client.query(
      `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [employeeId]
    );
    if (!emp.rows.length) return res.status(404).json({ success: false, message: 'User not found' });

    await client.query('BEGIN');
    // A new administrator starts with no access anywhere. The reference's
    // matrix has a cell per service either way, and a row of blanks is clearer
    // than a row that is not there.
    for (const s of SERVICES) {
      await client.query(
        `INSERT INTO administrator_access (employee_id, service_key, settings_level, data_level)
         VALUES ($1, $2, 'none', 'none') ON CONFLICT (employee_id, service_key) DO NOTHING`,
        [employeeId, s.key]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, message: `${emp.rows[0].name} added as an administrator` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.patch('/administrators/:employeeId', authorize(...WRITE), async (req, res) => {
  try {
    const { serviceKey, settingsLevel, dataLevel } = req.body || {};
    if (!SERVICE_KEYS.has(serviceKey)) throw bad('That is not a service');
    if (settingsLevel && !ACCESS_LEVELS.includes(settingsLevel)) throw bad('That is not an access level');
    if (dataLevel && !ACCESS_LEVELS.includes(dataLevel)) throw bad('That is not an access level');

    const r = await pool.query(
      `INSERT INTO administrator_access (employee_id, service_key, settings_level, data_level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, service_key) DO UPDATE
         SET settings_level = COALESCE($3, administrator_access.settings_level),
             data_level     = COALESCE($4, administrator_access.data_level),
             updated_at = NOW()
       RETURNING settings_level AS "settingsLevel", data_level AS "dataLevel"`,
      [req.params.employeeId, serviceKey, settingsLevel || 'none', dataLevel || 'none']
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/administrators/:employeeId', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM administrator_access WHERE employee_id = $1 RETURNING employee_id`, [req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not an administrator' });
    res.json({ success: true, message: 'Administrator removed' });
  } catch (err) { fail(res, err); }
});

// ── Applicability groups ───────────────────────────────────────────────────
const CRITERIA_BY_KEY = new Map(CRITERIA_FIELDS.map(c => [c.key, c]));

// Membership is worked out on read rather than stored. A group defined as
// "everyone in Content" must follow a transfer the moment it happens, not
// after whatever job would otherwise have to rebuild the list.
const membersOfGroup = async group => {
  const where = [`e.deleted_at IS NULL`, `e.status = 'active'`];
  const params = [];
  const ors = [];

  if (group.employee_ids?.length) {
    params.push(group.employee_ids);
    ors.push(`e.id = ANY($${params.length})`);
  }
  for (const c of group.criteria || []) {
    const field = CRITERIA_BY_KEY.get(c.field);
    if (!field || !c.value) continue;
    params.push(c.value);
    ors.push(`${field.column} = $${params.length}`);
  }
  // No criteria and no named employees is an empty group, not everybody.
  if (!ors.length) return [];

  const photo = await photoExpr();

  const r = await pool.query(
    `SELECT e.id, e.employee_id AS "employeeId",
            TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.email,
            ${photo} AS photo
       FROM employees e
      WHERE ${where.join(' AND ')} AND (${ors.join(' OR ')})
      ORDER BY e.first_name, e.last_name`,
    params
  );
  return r.rows;
};

router.get('/applicability-groups', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, employee_ids AS "employeeIds", criteria, created_at AS "createdAt"
         FROM applicability_groups ORDER BY name`
    );
    const withCounts = [];
    for (const g of r.rows) {
      const members = await membersOfGroup({ employee_ids: g.employeeIds, criteria: g.criteria });
      withCounts.push({ ...g, memberCount: members.length, members: members.slice(0, 10) });
    }
    res.json({ success: true, data: withCounts });
  } catch (err) { fail(res, err); }
});

router.get('/applicability-groups/:id/members', async (req, res) => {
  try {
    const g = await pool.query(`SELECT employee_ids, criteria FROM applicability_groups WHERE id = $1`, [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    res.json({ success: true, data: await membersOfGroup(g.rows[0]) });
  } catch (err) { fail(res, err); }
});

const cleanCriteria = list => (Array.isArray(list) ? list : [])
  .filter(c => CRITERIA_BY_KEY.has(c?.field) && String(c?.value ?? '').trim())
  .map(c => ({ field: c.field, value: String(c.value).trim() }));

router.post('/applicability-groups', authorize(...WRITE), async (req, res) => {
  try {
    const name = str(req.body?.name, 'Name', 150);
    const employeeIds = (Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [])
      .map(id => uuidOrNull(id, 'Employee')).filter(Boolean);
    const criteria = cleanCriteria(req.body?.criteria);
    if (!employeeIds.length && !criteria.length) {
      throw bad('Add an employee or a criterion, or the group has no members');
    }
    const r = await pool.query(
      `INSERT INTO applicability_groups (name, employee_ids, criteria)
       VALUES ($1, $2::uuid[], $3::jsonb) RETURNING id`,
      [name, employeeIds, JSON.stringify(criteria)]
    );
    res.status(201).json({ success: true, data: { id: r.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A group with that name already exists' });
    fail(res, err);
  }
});

router.patch('/applicability-groups/:id', authorize(...WRITE), async (req, res) => {
  try {
    const name = str(req.body?.name, 'Name', 150);
    const employeeIds = (Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [])
      .map(id => uuidOrNull(id, 'Employee')).filter(Boolean);
    const criteria = cleanCriteria(req.body?.criteria);
    if (!employeeIds.length && !criteria.length) {
      throw bad('Add an employee or a criterion, or the group has no members');
    }
    const r = await pool.query(
      `UPDATE applicability_groups SET name = $1, employee_ids = $2::uuid[], criteria = $3::jsonb, updated_at = NOW()
        WHERE id = $4 RETURNING id`,
      [name, employeeIds, JSON.stringify(criteria), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    res.json({ success: true, data: { id: r.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A group with that name already exists' });
    fail(res, err);
  }
});

router.delete('/applicability-groups/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM applicability_groups WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    res.json({ success: true, message: 'Group deleted' });
  } catch (err) { fail(res, err); }
});

// ── The user picker every one of these screens opens ───────────────────────
router.get('/assignable-users', async (req, res) => {
  try {
    const photo = await photoExpr();
    const r = await pool.query(
      `SELECT e.id, e.employee_id AS "employeeId",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
              e.email, ${photo} AS photo, e.role AS "roleKey"
         FROM employees e
        WHERE e.deleted_at IS NULL AND e.status = 'active'
        ORDER BY e.employee_id`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

module.exports = router;
