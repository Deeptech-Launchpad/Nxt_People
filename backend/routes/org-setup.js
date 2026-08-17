/**
 * routes/org-setup.js
 * Manage Accounts → Organization Setup: locations, departments and designations.
 *
 * All three are the same shape — a named list an employee is assigned to — so
 * they share one implementation rather than three that drift. What differs per
 * resource is its columns and its extra rules, declared in RESOURCES.
 *
 * Employees still carry the plain text of their location, department and
 * designation alongside the foreign key. Every report, export and filter reads
 * that text, so renaming a row rewrites it on the linked employees in the same
 * transaction — otherwise a rename would quietly split one department into two
 * across the reports.
 *
 * Readable by any signed-in user, because the employee directory and its
 * filters need the lists. Only full-access roles can change them.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const str = (v, label, { max = 150, required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (s.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return s;
};

const uuidOrNull = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error(`${label} is not valid`);
  }
  return s;
};

const RESOURCES = {
  locations: {
    table: 'work_locations',
    alias: 'l',
    employeeIdColumn: 'work_location_id',
    employeeTextColumn: 'work_location',
    label: 'Location',
    // The count is what makes this list safe to edit — you can see what a
    // deletion would strand before you attempt it.
    select: `
      l.id, l.name, l.mail_alias AS "mailAlias", l.description,
      l.address_line1 AS "addressLine1", l.address_line2 AS "addressLine2",
      l.city, l.state, l.country, l.postal_code AS "postalCode",
      l.timezone, l.is_active AS "isActive",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.work_location_id = l.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: 'work_locations l',
    order: 'l.name',
    clean: b => ({
      name: str(b.name, 'Location name', { required: true }),
      mail_alias: str(b.mailAlias, 'Mail alias'),
      description: str(b.description, 'Description', { max: 500 }),
      address_line1: str(b.addressLine1, 'Address line 1', { max: 255 }),
      address_line2: str(b.addressLine2, 'Address line 2', { max: 255 }),
      city: str(b.city, 'City', { max: 120 }),
      state: str(b.state, 'State', { max: 120 }),
      country: str(b.country, 'Country', { max: 120 }) || 'India',
      postal_code: str(b.postalCode, 'Postal code', { max: 20 }),
      // India-only deployment: attendance, payroll and cron all assume this
      // zone, so a per-location zone would be a promise we cannot keep.
      timezone: 'Asia/Kolkata',
      is_active: b.isActive !== false,
    }),
  },

  departments: {
    table: 'departments',
    alias: 'd',
    employeeIdColumn: 'department_id',
    employeeTextColumn: 'department',
    label: 'Department',
    select: `
      d.id, d.name, d.mail_alias AS "mailAlias",
      d.head_id AS "headId", d.parent_id AS "parentId",
      d.is_active AS "isActive",
      TRIM(CONCAT(h.first_name, ' ', h.last_name)) AS "headName",
      p.name AS "parentName",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.department_id = d.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: `departments d
             LEFT JOIN employees h ON h.id = d.head_id
             LEFT JOIN departments p ON p.id = d.parent_id`,
    order: 'd.name',
    clean: b => ({
      name: str(b.name, 'Department name', { required: true }),
      mail_alias: str(b.mailAlias, 'Mail alias'),
      head_id: uuidOrNull(b.headId, 'Department lead'),
      parent_id: uuidOrNull(b.parentId, 'Parent department'),
      is_active: b.isActive !== false,
    }),
    // A department that is its own ancestor makes the org tree infinite.
    async validate(client, id, values) {
      if (!values.parent_id) return;
      if (id && values.parent_id === id) throw new Error('A department cannot be its own parent');
      if (!id) return;
      const r = await client.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id FROM departments WHERE id = $1
           UNION ALL
           SELECT d.id, d.parent_id FROM departments d JOIN chain c ON d.id = c.parent_id
         ) SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
        [values.parent_id, id]
      );
      if (r.rows.length) throw new Error('That would make the department its own ancestor');
    },
  },

  business_units: {
    table: 'business_units',
    alias: 'b',
    employeeIdColumn: 'business_unit_id',
    employeeTextColumn: null,
    label: 'Business unit',
    select: `
      b.id, b.name, b.description, b.company_id AS "companyId",
      co.name AS "companyName", b.is_active AS "isActive",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.business_unit_id = b.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: 'business_units b LEFT JOIN companies co ON co.id = b.company_id',
    order: 'b.name',
    clean: b => ({
      name: str(b.name, 'Name', { required: true }),
      description: str(b.description, 'Description', { max: 100 }),
      company_id: uuidOrNull(b.companyId, 'Company'),
      is_active: b.isActive !== false,
    }),
  },

  divisions: {
    table: 'divisions',
    alias: 'v',
    employeeIdColumn: 'division_id',
    employeeTextColumn: null,
    label: 'Division',
    select: `
      v.id, v.name, v.description, v.parent_id AS "parentId",
      p.name AS "parentName", v.business_unit_id AS "businessUnitId",
      bu.name AS "businessUnitName", v.is_active AS "isActive",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.division_id = v.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: `divisions v
             LEFT JOIN divisions p ON p.id = v.parent_id
             LEFT JOIN business_units bu ON bu.id = v.business_unit_id`,
    order: 'v.name',
    clean: b => ({
      name: str(b.name, 'Name', { required: true }),
      description: str(b.description, 'Description', { max: 100 }),
      parent_id: uuidOrNull(b.parentId, 'Parent division'),
      business_unit_id: uuidOrNull(b.businessUnitId, 'Business unit'),
      is_active: b.isActive !== false,
    }),
    // Divisions nest, so the same ancestry guard the departments have.
    async validate(client, id, values) {
      if (!values.parent_id) return;
      if (id && values.parent_id === id) throw new Error('A division cannot be its own parent');
      if (!id) return;
      const r = await client.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id FROM divisions WHERE id = $1
           UNION ALL
           SELECT d.id, d.parent_id FROM divisions d JOIN chain c ON d.id = c.parent_id
         ) SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
        [values.parent_id, id]
      );
      if (r.rows.length) throw new Error('That would make the division its own ancestor');
    },
  },

  companies: {
    table: 'companies',
    alias: 'c',
    employeeIdColumn: 'company_id',
    employeeTextColumn: 'company',
    label: 'Company',
    // The legal entity people are employed by. The table has existed since the
    // first schema with exactly one row and nothing referencing it, while every
    // employee carried the name as free text — the same drift that gave six
    // work locations to an org with two.
    select: `
      c.id, c.name, c.code, c.description, c.is_active AS "isActive",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.company_id = c.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: 'companies c',
    order: 'c.name',
    clean: b => ({
      name: str(b.name, 'Company name', { required: true, max: 255 }),
      code: str(b.code, 'Code', { max: 50 }),
      description: str(b.description, 'Description', { max: 500 }),
      is_active: b.isActive !== false,
    }),
  },

  designations: {
    table: 'designations',
    alias: 'g',
    employeeIdColumn: 'designation_id',
    employeeTextColumn: 'designation',
    label: 'Designation',
    select: `
      g.id, g.name, g.mail_alias AS "mailAlias", g.is_active AS "isActive",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.designation_id = g.id AND e.deleted_at IS NULL) AS "userCount"`,
    from: 'designations g',
    order: 'g.name',
    clean: b => ({
      name: str(b.name, 'Designation name', { required: true }),
      mail_alias: str(b.mailAlias, 'Mail alias'),
      is_active: b.isActive !== false,
    }),
  },
};

const resourceOf = req => RESOURCES[req.params.resource] || null;

router.get('/:resource', async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });
  try {
    const result = await pool.query(`SELECT ${r.select} FROM ${r.from} ORDER BY ${r.order}`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// Who is on a row. The reference makes the associated-users count a link, and
// the employee directory cannot filter by location, business unit or division
// — only by department and designation name — so the list comes from here,
// keyed by the foreign key rather than by a name that can be duplicated.
router.get('/:resource/:id/employees', async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });
  try {
    const result = await pool.query(
      `SELECT e.id, e.employee_id AS "employeeId",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
              e.email, e.designation, e.department, e.status
         FROM employees e
        WHERE e.${r.employeeIdColumn} = $1 AND e.deleted_at IS NULL
        ORDER BY e.first_name, e.last_name`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

router.post('/:resource', authorize(...WRITE_ROLES), async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });

  let values;
  try { values = r.clean(req.body || {}); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (r.validate) await r.validate(client, null, values);
    const cols = Object.keys(values);
    const result = await client.query(
      `INSERT INTO ${r.table} (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map(c => values[c])
    );
    await client.query('COMMIT');
    const row = await pool.query(`SELECT ${r.select} FROM ${r.from} WHERE ${r.alias}.id = $1`, [result.rows[0].id]);
    res.status(201).json({ success: true, data: row.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ success: false, message: `That ${r.label.toLowerCase()} already exists` });
    const known = /is required|characters or fewer|is not valid|its own/i.test(err.message || '');
    res.status(known ? 400 : 500).json({ success: false, message: known ? err.message : 'An internal server error occurred' });
  } finally { client.release(); }
});

router.put('/:resource/:id', authorize(...WRITE_ROLES), async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });

  let values;
  try { values = r.clean(req.body || {}); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (r.validate) await r.validate(client, req.params.id, values);

    const cols = Object.keys(values);
    const upd = await client.query(
      `UPDATE ${r.table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map(c => values[c]), req.params.id]
    );
    if (!upd.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: `${r.label} not found` });
    }

    // Keep the denormalised text on employees in step with the new name.
    // Without this a rename splits the value across reports: the linked rows
    // still say the old name, and every grouping shows both. Business units and
    // divisions carry no such column, so there is nothing to keep in step.
    if (r.employeeTextColumn) {
      await client.query(
        `UPDATE employees SET ${r.employeeTextColumn} = $1, updated_at = NOW()
          WHERE ${r.employeeIdColumn} = $2 AND ${r.employeeTextColumn} IS DISTINCT FROM $1`,
        [values.name, req.params.id]
      );
    }

    await client.query('COMMIT');
    const row = await pool.query(`SELECT ${r.select} FROM ${r.from} WHERE ${r.alias}.id = $1`, [req.params.id]);
    res.json({ success: true, data: row.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ success: false, message: `That ${r.label.toLowerCase()} already exists` });
    const known = /is required|characters or fewer|is not valid|its own/i.test(err.message || '');
    res.status(known ? 400 : 500).json({ success: false, message: known ? err.message : 'An internal server error occurred' });
  } finally { client.release(); }
});

router.delete('/:resource/:id', authorize(...WRITE_ROLES), async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });
  try {
    // Refused rather than cascaded. The foreign key is ON DELETE SET NULL, so
    // deleting would silently strip the value from everyone who had it — and
    // the employee's own text column would be left behind, disagreeing.
    const inUse = await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees
        WHERE ${r.employeeIdColumn} = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (inUse.rows[0].n > 0) {
      return res.status(400).json({
        success: false,
        message: `${inUse.rows[0].n} employee(s) still have this ${r.label.toLowerCase()}. Reassign them first.`,
      });
    }
    if (r.table === 'departments' || r.table === 'divisions') {
      const child = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${r.table} WHERE parent_id = $1`, [req.params.id]
      );
      if (child.rows[0].n > 0) {
        return res.status(400).json({
          success: false,
          message: `That ${r.label.toLowerCase()} still has children`,
        });
      }
    }
    if (r.table === 'companies') {
      const units = await pool.query(`SELECT COUNT(*)::int AS n FROM business_units WHERE company_id = $1`, [req.params.id]);
      if (units.rows[0].n > 0) {
        return res.status(400).json({ success: false, message: 'That company still has business units' });
      }
    }
    if (r.table === 'business_units') {
      const divs = await pool.query(`SELECT COUNT(*)::int AS n FROM divisions WHERE business_unit_id = $1`, [req.params.id]);
      if (divs.rows[0].n > 0) {
        return res.status(400).json({ success: false, message: 'That business unit still has divisions' });
      }
    }
    const del = await pool.query(`DELETE FROM ${r.table} WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!del.rows.length) return res.status(404).json({ success: false, message: `${r.label} not found` });
    res.json({ success: true, message: `${r.label} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
