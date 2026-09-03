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
const { serverError } = require('../utils/serverError');
const geofence = require('../utils/geofence');
const { logAudit } = require('../utils/audit');
const { buildCriteria, buildOrder, buildPaging } = require('../utils/listQuery');

// Departments and Designations record who added and last changed a row; the
// other resources in this file do not have those columns.
const AUTHORED = new Set(['departments', 'designations']);

/* Field registries for the Employee Information list tabs. Only what is here
 * can be filtered or sorted on, and the SQL always uses `column` from this
 * table rather than anything from the request. `label` is what the filter
 * panel and the column picker show. */
const LIST_FIELDS = {
  departments: {
    name:       { column: 'd.name',        label: 'Department Name', type: 'text' },
    mailAlias:  { column: 'd.mail_alias',  label: 'Mail Alias',      type: 'text' },
    headName:   { column: "TRIM(CONCAT(h.first_name, ' ', h.last_name))", label: 'Department Lead', type: 'text' },
    parentName: { column: 'p.name',        label: 'Parent Department', type: 'text' },
    addedBy:    { column: "TRIM(CONCAT(cb.first_name, ' ', cb.last_name))", label: 'Added By', type: 'text' },
    addedTime:  { column: 'd.created_at',  label: 'Added Time',      type: 'datetime' },
    modifiedBy: { column: "TRIM(CONCAT(ub.first_name, ' ', ub.last_name))", label: 'Modified By', type: 'text' },
    modifiedTime: { column: 'd.updated_at', label: 'Modified Time',  type: 'datetime' },
  },
  designations: {
    name:       { column: 'g.name',        label: 'Designation Name', type: 'text' },
    mailAlias:  { column: 'g.mail_alias',  label: 'Mail Alias',       type: 'text' },
    addedBy:    { column: "TRIM(CONCAT(cb.first_name, ' ', cb.last_name))", label: 'Added By', type: 'text' },
    addedTime:  { column: 'g.created_at',  label: 'Added Time',       type: 'datetime' },
    modifiedBy: { column: "TRIM(CONCAT(ub.first_name, ' ', ub.last_name))", label: 'Modified By', type: 'text' },
    modifiedTime: { column: 'g.updated_at', label: 'Modified Time',   type: 'datetime' },
  },
};

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

/* Coordinates and the fence around them.
 *
 * Kept out of the resource definition so the rules read as rules: a point is
 * both halves or neither, a latitude is a latitude, and a fence somebody can
 * cross in three steps or that covers the next town are both typos. */
const geoFields = (b) => {
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  const lat = has(b.latitude) ? Number(b.latitude) : null;
  const lng = has(b.longitude) ? Number(b.longitude) : null;

  if ((lat === null) !== (lng === null)) {
    throw new Error('A location needs both a latitude and a longitude, or neither');
  }
  if (lat !== null) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Longitude must be between -180 and 180');
  }

  let radius = null;
  if (has(b.radiusMeters)) {
    radius = Math.round(Number(b.radiusMeters));
    if (!Number.isFinite(radius) || radius < 20 || radius > 5000) {
      throw new Error('The radius must be between 20 and 5000 metres');
    }
  }

  return {
    latitude: lat,
    longitude: lng,
    radius_meters: radius,
    geofence_enabled: b.geofenceEnabled !== false,
  };
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
      l.latitude::float8 AS "latitude", l.longitude::float8 AS "longitude",
      l.radius_meters AS "radiusMeters", l.geofence_enabled AS "geofenceEnabled",
      l.coordinates_set_at AS "coordinatesSetAt",
      TRIM(CONCAT(gb.first_name, ' ', gb.last_name)) AS "coordinatesSetBy",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.work_location_id = l.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.work_location_id = l.id AND e.deleted_at IS NULL) AS "totalCount"`,
    from: 'work_locations l LEFT JOIN employees gb ON gb.id = l.coordinates_set_by',
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
      /* The geofence. Both coordinates or neither — a half-set point would
       * put the office on the equator, and the column CHECK refuses it
       * anyway; catching it here says so in words instead of a constraint
       * name. A null radius means "use the organisation default", so
       * changing that default moves every location that never overrode it. */
      ...geoFields(b),
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
      d.created_at AS "addedTime", d.updated_at AS "modifiedTime",
      TRIM(CONCAT(cb.first_name, ' ', cb.last_name)) AS "addedBy",
      TRIM(CONCAT(ub.first_name, ' ', ub.last_name)) AS "modifiedBy",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.department_id = d.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.department_id = d.id AND e.deleted_at IS NULL) AS "totalCount"`,
    from: `departments d
             LEFT JOIN employees h ON h.id = d.head_id
             LEFT JOIN departments p ON p.id = d.parent_id
             LEFT JOIN employees cb ON cb.id = d.created_by
             LEFT JOIN employees ub ON ub.id = d.updated_by`,
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
        WHERE e.business_unit_id = b.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.business_unit_id = b.id AND e.deleted_at IS NULL) AS "totalCount"`,
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
        WHERE e.division_id = v.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.division_id = v.id AND e.deleted_at IS NULL) AS "totalCount"`,
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
        WHERE e.company_id = c.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.company_id = c.id AND e.deleted_at IS NULL) AS "totalCount"`,
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
      g.created_at AS "addedTime", g.updated_at AS "modifiedTime",
      TRIM(CONCAT(cb.first_name, ' ', cb.last_name)) AS "addedBy",
      TRIM(CONCAT(ub.first_name, ' ', ub.last_name)) AS "modifiedBy",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.designation_id = g.id AND e.deleted_at IS NULL AND e.status = 'active') AS "userCount",
      (SELECT COUNT(*)::int FROM employees e
        WHERE e.designation_id = g.id AND e.deleted_at IS NULL) AS "totalCount"`,
    from: `designations g
             LEFT JOIN employees cb ON cb.id = g.created_by
             LEFT JOIN employees ub ON ub.id = g.updated_by`,
    order: 'g.name',
    clean: b => ({
      name: str(b.name, 'Designation name', { required: true }),
      mail_alias: str(b.mailAlias, 'Mail alias'),
      is_active: b.isActive !== false,
    }),
  },
};

const resourceOf = req => RESOURCES[req.params.resource] || null;

/* Settings -> Organization Setup calls this with no query at all and must keep
 * getting the whole list in one response, so paging is OPT-IN: without `page`
 * or `limit` nothing about the old behaviour changes. Employee Information's
 * list tabs pass them, plus criteria and a sort key. */
router.get('/:resource', async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });
  try {
    const fields = LIST_FIELDS[req.params.resource] || {};
    const { clause, params, applied } = buildCriteria(fields, req.query.criteria, 1);

    // `q` is the panel's plain search box: the resource's own name column.
    const search = String(req.query.q || '').trim();
    let where = clause;
    const allParams = [...params];
    if (search) {
      allParams.push(`%${search}%`);
      where += ` AND ${r.alias}.name ILIKE $${allParams.length}`;
    }

    const order = buildOrder(fields, req.query.sortBy, req.query.sortDir, r.order);
    const paged = req.query.page !== undefined || req.query.limit !== undefined;

    // WHERE 1=1 so the criteria fragments can all begin with AND.
    const sql = `SELECT ${r.select} FROM ${r.from} WHERE 1=1${where} ORDER BY ${order}`;

    if (!paged) {
      const result = await pool.query(sql, allParams);
      return res.json({ success: true, data: result.rows, total: result.rows.length, applied });
    }

    const { page, limit, offset } = buildPaging(req.query);
    const [countRes, result] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM ${r.from} WHERE 1=1${where}`, allParams),
      pool.query(`${sql} LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}`,
        [...allParams, limit, offset]),
    ]);
    res.json({
      success: true, data: result.rows,
      total: countRes.rows[0]?.n || 0, page, limit, applied,
    });
  } catch (err) {
    serverError(res, err);
  }
});

/* The filter panel and the column picker need to know what a module offers
 * without hard-coding it in the frontend, which is how the two drift apart. */
router.get('/:resource/fields', (req, res) => {
  const fields = LIST_FIELDS[req.params.resource];
  if (!fields) return res.status(404).json({ success: false, message: 'Unknown resource' });
  res.json({
    success: true,
    data: Object.entries(fields).map(([key, f]) => ({ key, label: f.label, type: f.type })),
  });
});

// Who is on a row. The reference makes the associated-users count a link, and
// the employee directory cannot filter by location, business unit or division
// — only by department and designation name — so the list comes from here,
// keyed by the foreign key rather than by a name that can be duplicated.
//
// Current employees only, matching the count that opened it. `?all=true` adds
// the people who have left, which is what the delete guard is counting.
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
          ${req.query.all === 'true' ? '' : `AND e.status = 'active'`}
        ORDER BY e.first_name, e.last_name`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    serverError(res, err);
  }
});

const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

/* Declared BEFORE the generic /:resource routes below. Express matches in
 * order, and `PUT /:resource/:id` happily reads "geofence/config" as a
 * resource called geofence with the id config — which answered "Unknown
 * resource" until these moved up here. */
/* ── The geofence: testing a pin, and the org-wide defaults ──────────────── */

/* "Test from where I am". Stand at the office, press it, and read the
 * distance to every location. This is what catches a pin dropped on the
 * wrong side of the road BEFORE it starts deciding how people's days are
 * recorded — which is the only moment the mistake is cheap.
 *
 * Deliberately a POST that stores nothing: it is a question, not a punch. */
router.post('/geofence/test', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: 'Send the latitude and longitude to test from' });
    }
    const acc = Number.isFinite(Number(req.body?.accuracy)) ? Math.round(Number(req.body.accuracy)) : null;
    const cfg = await geofence.config();
    let ranked = await geofence.rankLocations({ latitude: lat, longitude: lng });

    /* Testing a pin that has not been saved yet.
     *
     * Without this the test measured against the STORED coordinates while the
     * form showed something else — so an admin who had just captured a new
     * point, or typed a wider radius, was told about the old one. The first
     * person to use it read "the 200 m fence" with 500 on screen in front of
     * them. A test that answers a different question than the one being asked
     * is worse than no test.
     *
     * The candidate is measured alongside the saved ones and marked, so a
     * pin can be proved before it is committed. */
    const cand = req.body?.against;
    if (cand && Number.isFinite(Number(cand.latitude)) && Number.isFinite(Number(cand.longitude))) {
      const radius = Number(cand.radiusMeters) || cfg.defaultRadiusMeters;
      const distance = geofence.distanceMeters(lat, lng, Number(cand.latitude), Number(cand.longitude));
      ranked = [{
        id: cand.id || null,
        name: (cand.name || 'this location') + ' (unsaved)',
        radius, distance, inside: distance <= radius, candidate: true,
      }, ...ranked.filter(r => !cand.id || r.id !== cand.id)]
        .sort((a, b) => a.distance - b.distance);
    }

    const inside = ranked.find(r => r.inside) || null;
    /* The same accuracy rule the real classification uses, so the test cannot
     * report a confident answer the punch itself would refuse to give. */
    const tooVague = cfg.requireAccuracy && acc !== null && ranked.length && acc > ranked[0].radius;

    res.json({
      success: true,
      data: {
        locations: ranked,
        accuracy: acc,
        verdict: !ranked.length ? 'no-locations'
          : tooVague ? 'too-vague'
          : inside ? 'inside' : 'outside',
        inside,
        nearest: ranked[0] || null,
        message: !ranked.length
          ? 'No location has coordinates yet, so there is nothing to test against.'
          : tooVague
            ? `This fix is accurate to ${acc} m, which is wider than the ${ranked[0].radius} m fence — a punch this vague would be recorded as unknown.`
            : inside
              ? `You are ${inside.distance} m from ${inside.name}, inside its ${inside.radius} m fence. A punch here counts as office.`
              : `You are ${ranked[0].distance} m from the nearest location (${ranked[0].name}), outside its ${ranked[0].radius} m fence. A punch here counts as working from home.`,
      },
    });
  } catch (err) { serverError(res, err); }
});

router.get('/geofence/config', async (req, res) => {
  try { res.json({ success: true, data: await geofence.config() }); }
  catch (err) { serverError(res, err); }
});

router.put('/geofence/config', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const cur = await geofence.config();
    const b = req.body || {};
    const next = { ...cur };

    if (b.classifyEnabled !== undefined) next.classifyEnabled = !!b.classifyEnabled;
    if (b.requireAccuracy !== undefined) next.requireAccuracy = !!b.requireAccuracy;
    if (b.blockOutsideFence !== undefined) next.blockOutsideFence = !!b.blockOutsideFence;

    if (b.defaultRadiusMeters !== undefined) {
      const r = Math.round(Number(b.defaultRadiusMeters));
      if (!Number.isFinite(r) || r < 20 || r > 5000) {
        return res.status(400).json({ success: false, message: 'The default radius must be between 20 and 5000 metres' });
      }
      next.defaultRadiusMeters = r;
    }
    if (b.unknownCountsAs !== undefined) {
      if (!['unknown', 'office', 'wfh'].includes(b.unknownCountsAs)) {
        return res.status(400).json({ success: false, message: 'A punch we cannot place must count as unknown, office or wfh' });
      }
      next.unknownCountsAs = b.unknownCountsAs;
    }

    /* Refusing to switch on a fence that would classify everybody the same
     * way. Turning it on with no point set would mark every single punch
     * unknown — an org-wide change that looks like a broken feature rather
     * than a configuration mistake. */
    if (next.classifyEnabled && !cur.classifyEnabled) {
      const placed = await pool.query(
        `SELECT COUNT(*)::int AS n FROM work_locations
          WHERE is_active AND geofence_enabled AND latitude IS NOT NULL`);
      if (!placed.rows[0].n) {
        return res.status(400).json({
          success: false,
          message: 'Set the coordinates on at least one location before switching classification on — otherwise every punch would be recorded as unknown.',
        });
      }
    }

    await pool.query(`UPDATE settings SET geofence_config = $1::jsonb`, [JSON.stringify(next)]);
    await logAudit(req, {
      action: 'UPDATE', resource: 'Geofence configuration',
      changes: { summary: `classification ${next.classifyEnabled ? 'on' : 'off'}, default radius ${next.defaultRadiusMeters} m` },
    });
    res.json({ success: true, data: next });
  } catch (err) { serverError(res, err); }
});


router.post('/:resource', authorize(...WRITE_ROLES), async (req, res) => {
  const r = resourceOf(req);
  if (!r) return res.status(404).json({ success: false, message: 'Unknown resource' });

  let values;
  try { values = r.clean(req.body || {}); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  // Only the two tables that gained the columns; setting them on companies or
  // locations would be a column-does-not-exist error at runtime.
  if (AUTHORED.has(req.params.resource)) {
    values.created_by = req.user._id;
    values.updated_by = req.user._id;
  }

  /* Who placed the pin and when. A geofence decides how somebody's day is
   * recorded, so the point it turns on is worth being able to trace back to
   * a person and a moment. */
  if (req.params.resource === 'locations' && values.latitude !== null && values.latitude !== undefined) {
    values.coordinates_set_at = new Date();
    values.coordinates_set_by = req.user._id;
  }

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

  if (AUTHORED.has(req.params.resource)) values.updated_by = req.user._id;

  /* Re-stamp only when the point actually MOVES. Re-saving a location to
   * change its description should not rewrite who set the coordinates — that
   * would quietly hand authorship of a geofence to whoever last edited an
   * address. */
  if (req.params.resource === 'locations') {
    const before = await pool.query(
      `SELECT latitude::float8 AS lat, longitude::float8 AS lng FROM work_locations WHERE id=$1`,
      [req.params.id]);
    const b = before.rows[0] || {};
    const moved = Number(b.lat) !== Number(values.latitude) || Number(b.lng) !== Number(values.longitude);
    if (moved && values.latitude !== null && values.latitude !== undefined) {
      values.coordinates_set_at = new Date();
      values.coordinates_set_by = req.user._id;
    } else if (moved) {
      values.coordinates_set_at = null;
      values.coordinates_set_by = null;
    }
  }

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
    //
    // This counts everyone still on file, not just the current staff the list
    // shows. A former employee's records are still read by every report and by
    // payroll history, and blanking their department because nobody current is
    // in it would rewrite the past.
    const inUse = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE status <> 'active')::int AS former
         FROM employees
        WHERE ${r.employeeIdColumn} = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    const { n, former } = inUse.rows[0];
    if (n > 0) {
      // Saying only "82 employees" against a list showing 0 reads as a bug.
      const who = former === n
        ? `${former} former employee(s)`
        : former > 0 ? `${n} employee(s), ${former} of them former,` : `${n} employee(s)`;
      return res.status(400).json({
        success: false,
        message: `${who} still have this ${r.label.toLowerCase()}. Reassign them first.`,
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
    serverError(res, err);
  }
});

module.exports = router;
