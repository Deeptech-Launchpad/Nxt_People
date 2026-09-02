/* Operations -> Employee Information: the "…" toolbar menu.
 *
 * Import, Export, History Export, Profile Photo Upload, and the audited
 * reveal behind "Show masked data".
 *
 * Two rules shape the whole file:
 *
 *   1. An import that half-succeeds silently is worse than one that refuses.
 *      Every row is validated first, nothing is written unless the caller asks
 *      to commit, and each skipped row comes back with the reason it was
 *      skipped and its line number.
 *   2. Identity numbers are never handed out as a side effect of listing.
 *      Revealing them is a deliberate request, full access only, and it writes
 *      an audit row naming who looked and at whom — because the interesting
 *      question afterwards is never "what was the PAN" but "who read it".
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');
const { buildCriteria } = require('../utils/listQuery');
const { canImportExport } = require('./employee-info-permissions');
const logger = require('../logger');

router.use(protect);
const WRITE_ROLES = ['admin', 'director', 'hr_admin'];
router.use(authorize(...WRITE_ROLES));

/* Import and Export can additionally be granted per role and per form in
 * Access Control. Full access is unaffected; this only ever widens to a
 * narrower role, and the route guard above still stands in front of it. */
const gate = (kind) => async (req, res, next) => {
  const form = req.params.module || 'employee';
  try {
    if (await canImportExport(req.user, form, kind)) return next();
    res.status(403).json({ success: false,
      message: `Your role is not allowed to ${kind} ${form}.` });
  } catch { next(); }   // an unreadable table must not block an administrator
};

const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* ── Import ──────────────────────────────────────────────────────────────── */

/* Column heading -> what it means. Matching on a normalised heading rather
 * than position, because a spreadsheet somebody has reordered is the normal
 * case, not the exception. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const IMPORTS = {
  employees: {
    label: 'Employees',
    key: 'employeeId',
    columns: {
      employeeid: 'employeeId', empid: 'employeeId',
      firstname: 'firstName', lastname: 'lastName',
      emailaddress: 'email', email: 'email',
      nickname: 'nickName', department: 'department', designation: 'designation',
      employmenttype: 'employmentType', sourceofhire: 'sourceOfHire',
      dateofjoining: 'joiningDate', location: 'workLocation',
      workphonenumber: 'workPhone', extension: 'extension',
      personalemailaddress: 'personalEmail', personalmobilenumber: 'phone',
      gender: 'gender', maritalstatus: 'maritalStatus', dateofbirth: 'dateOfBirth',
    },
    required: ['employeeId', 'firstName', 'lastName', 'email'],
    /* Exactly the headings Export emits, so export -> edit -> import round
     * trips. A template with different wording would look right and then be
     * rejected by the importer that produced it. */
    template: ['Employee ID', 'First Name', 'Last Name', 'Nick name', 'Email address',
      'Department', 'Designation', 'Employment Type', 'Source of Hire', 'Date of Joining',
      'Location', 'Work Phone Number', 'Extension', 'Personal Email Address',
      'Personal Mobile Number', 'Gender', 'Marital Status', 'Date of Birth'],
    // Import UPDATES existing people and creates new ones; a spreadsheet of
    // corrections is the common use, and refusing every known id would make
    // the feature useless.
    async findExisting(client, row) {
      const r = await client.query(
        `SELECT id FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [row.employeeId]);
      return r.rows[0]?.id || null;
    },
    async insert(client, row, actorId) {
      const r = await client.query(
        `INSERT INTO employees (employee_id, first_name, last_name, email, nick_name,
            department, designation, employment_type, source_of_hire, date_of_joining,
            work_location, work_phone, extension, personal_email, phone, gender,
            marital_status, date_of_birth, role, status, is_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 'team_member','active',TRUE)
         RETURNING id`,
        [row.employeeId, row.firstName, row.lastName, row.email, row.nickName || null,
         row.department || null, row.designation || null, row.employmentType || null,
         row.sourceOfHire || null, row.joiningDate || null, row.workLocation || null,
         row.workPhone || null, row.extension || null, row.personalEmail || null,
         row.phone || null, row.gender || null, row.maritalStatus || null, row.dateOfBirth || null]);
      return r.rows[0].id;
    },
    async update(client, id, row) {
      // Only columns actually present in the sheet are written, so importing a
      // two-column correction file cannot blank everything else.
      const map = {
        first_name: row.firstName, last_name: row.lastName, email: row.email,
        nick_name: row.nickName, department: row.department, designation: row.designation,
        employment_type: row.employmentType, source_of_hire: row.sourceOfHire,
        date_of_joining: row.joiningDate, work_location: row.workLocation,
        work_phone: row.workPhone, extension: row.extension,
        personal_email: row.personalEmail, phone: row.phone, gender: row.gender,
        marital_status: row.maritalStatus, date_of_birth: row.dateOfBirth,
      };
      const cols = Object.keys(map).filter(k => map[k] !== undefined && map[k] !== '');
      if (!cols.length) return;
      await client.query(
        `UPDATE employees SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
          WHERE id = $${cols.length + 1}`,
        [...cols.map(c => map[c]), id]);
    },
  },

  departments: {
    label: 'Departments',
    key: 'name',
    columns: { departmentname: 'name', name: 'name', mailalias: 'mailAlias' },
    required: ['name'],
    template: ['Department Name', 'Mail Alias'],
    async findExisting(client, row) {
      const r = await client.query(`SELECT id FROM departments WHERE LOWER(name) = LOWER($1)`, [row.name]);
      return r.rows[0]?.id || null;
    },
    async insert(client, row, actorId) {
      const r = await client.query(
        `INSERT INTO departments (name, mail_alias, created_by, updated_by)
         VALUES ($1,$2,$3,$3) RETURNING id`, [row.name, row.mailAlias || null, actorId]);
      return r.rows[0].id;
    },
    async update(client, id, row, actorId) {
      await client.query(
        `UPDATE departments SET mail_alias = COALESCE($1, mail_alias), updated_by = $2, updated_at = NOW()
          WHERE id = $3`, [row.mailAlias || null, actorId, id]);
    },
  },

  designations: {
    label: 'Designations',
    key: 'name',
    columns: { designationname: 'name', name: 'name', mailalias: 'mailAlias' },
    required: ['name'],
    template: ['Designation Name', 'Mail Alias'],
    async findExisting(client, row) {
      const r = await client.query(`SELECT id FROM designations WHERE LOWER(name) = LOWER($1)`, [row.name]);
      return r.rows[0]?.id || null;
    },
    async insert(client, row, actorId) {
      const r = await client.query(
        `INSERT INTO designations (name, mail_alias, created_by, updated_by)
         VALUES ($1,$2,$3,$3) RETURNING id`, [row.name, row.mailAlias || null, actorId]);
      return r.rows[0].id;
    },
    async update(client, id, row, actorId) {
      await client.query(
        `UPDATE designations SET mail_alias = COALESCE($1, mail_alias), updated_by = $2, updated_at = NOW()
          WHERE id = $3`, [row.mailAlias || null, actorId, id]);
    },
  },
};

const MAX_IMPORT_ROWS = 1000;

/* Excel dates arrive as serial numbers when the cell is date-formatted and as
 * text when it is not, and "31/01/2026" is not what Date() expects. Returning
 * null on anything unrecognised is deliberate: a wrong joining date is worse
 * than a missing one. */
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = xlsx.SSF ? xlsx.SSF.parse_date_code(v) : null;
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

const DATE_FIELDS = new Set(['joiningDate', 'dateOfBirth']);

router.post('/import/:module', gate('import'), (req, res, next) => {
  sheetUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'That file is over 5 MB.' });
      }
      return res.status(400).json({ success: false, message: 'Could not read that upload.' });
    }
    next();
  });
}, async (req, res) => {
  const spec = IMPORTS[req.params.module];
  if (!spec) return res.status(404).json({ success: false, message: 'Unknown module' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Attach a .xlsx or .csv file' });

  // Default is a DRY RUN. Committing has to be asked for, so the first press
  // always shows what would happen rather than doing it.
  const commit = String(req.body?.commit) === 'true';

  const client = await pool.connect();
  try {
    let sheet;
    try {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
      sheet = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } catch {
      return res.status(400).json({ success: false, message: 'That file is not a readable spreadsheet.' });
    }
    if (!sheet.length) return res.status(400).json({ success: false, message: 'That sheet has no rows.' });
    if (sheet.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        success: false,
        message: `That sheet has ${sheet.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it and import in parts.`,
      });
    }

    // Heading row -> field names, so unknown columns are reported rather than
    // silently ignored.
    const headings = Object.keys(sheet[0]);
    const mapped = {}, unknown = [];
    for (const h of headings) {
      const field = spec.columns[norm(h)];
      if (field) mapped[h] = field; else unknown.push(h);
    }
    const missing = spec.required.filter(f => !Object.values(mapped).includes(f));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `That sheet is missing required column(s): ${missing.join(', ')}`,
        unknownColumns: unknown,
      });
    }

    const results = { created: 0, updated: 0, skipped: [] };
    const seen = new Set();
    await client.query('BEGIN');

    for (let i = 0; i < sheet.length; i++) {
      const line = i + 2;                       // +1 for the heading, +1 for 1-based
      const raw = sheet[i];
      const row = {};
      for (const [h, field] of Object.entries(mapped)) {
        const v = raw[h];
        row[field] = DATE_FIELDS.has(field) ? parseDate(v) : String(v ?? '').trim();
      }

      const blank = spec.required.filter(f => !row[f]);
      if (blank.length) { results.skipped.push({ line, reason: `Missing ${blank.join(', ')}` }); continue; }

      // A file that lists the same person twice would otherwise create one and
      // update it in the same run, which reads as a success and is not.
      const dedupe = String(row[spec.key]).toLowerCase();
      if (seen.has(dedupe)) { results.skipped.push({ line, reason: `Duplicate of an earlier row (${row[spec.key]})` }); continue; }
      seen.add(dedupe);

      for (const f of Object.keys(row)) {
        if (DATE_FIELDS.has(f) && row[f] === null && String(raw[Object.keys(mapped).find(h => mapped[h] === f)] ?? '').trim() !== '') {
          results.skipped.push({ line, reason: `Could not read the date in ${f}` });
          row.__bad = true;
        }
      }
      if (row.__bad) continue;

      try {
        const existing = await spec.findExisting(client, row);
        if (existing) { if (commit) await spec.update(client, existing, row, req.user._id); results.updated++; }
        else          { if (commit) await spec.insert(client, row, req.user._id);          results.created++; }
      } catch (err) {
        if (err.code === '23505') results.skipped.push({ line, reason: 'Already exists (duplicate key)' });
        else {
          logger.warn({ err: err.message, line }, '[import] row failed');
          results.skipped.push({ line, reason: 'Could not be saved' });
        }
      }
    }

    if (commit) {
      await client.query('COMMIT');
      await logAudit(req, {
        action: 'IMPORT', resource: spec.label, resourceId: req.params.module,
        changes: { summary: `${results.created} created, ${results.updated} updated, ${results.skipped.length} skipped` },
      });
    } else {
      await client.query('ROLLBACK');
    }

    res.json({
      success: true, committed: commit, module: req.params.module,
      totalRows: sheet.length, unknownColumns: unknown, ...results,
      message: commit
        ? `${results.created} created, ${results.updated} updated, ${results.skipped.length} skipped`
        : `Preview only — nothing saved. ${results.created} would be created, ${results.updated} updated, ${results.skipped.length} skipped.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally { client.release(); }
});

/* ── Export ──────────────────────────────────────────────────────────────── */

const EXPORTS = {
  employees: {
    label: 'Employees',
    sql: `SELECT e.employee_id AS "Employee ID", e.first_name AS "First Name",
            e.last_name AS "Last Name", e.nick_name AS "Nick name", e.email AS "Email address",
            e.department AS "Department", e.designation AS "Designation",
            e.employment_type AS "Employment Type", e.status AS "Employee Status",
            e.source_of_hire AS "Source of Hire",
            COALESCE(e.date_of_joining, e.joining_date) AS "Date of Joining",
            e.total_experience AS "Total Experience",
            TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS "Reporting Manager",
            e.date_of_birth AS "Date of Birth", e.gender AS "Gender",
            e.marital_status AS "Marital Status", e.work_phone AS "Work Phone Number",
            e.extension AS "Extension", e.work_location AS "Location",
            e.phone AS "Personal Mobile Number", e.personal_email AS "Personal Email Address",
            e.exit_date AS "Date of Exit", e.created_at AS "Added Time", e.updated_at AS "Modified Time"
          FROM employees e LEFT JOIN employees m ON e.reporting_manager_id = m.id
          WHERE e.deleted_at IS NULL`,
    fields: {
      employeeId: { column: 'e.employee_id' }, firstName: { column: 'e.first_name' },
      lastName: { column: 'e.last_name' }, email: { column: 'e.email' },
      department: { column: 'e.department' }, designation: { column: 'e.designation' },
      status: { column: 'e.status' }, employmentType: { column: 'e.employment_type' },
      joiningDate: { column: 'e.date_of_joining' }, workLocation: { column: 'e.work_location' },
      gender: { column: 'e.gender' },
    },
  },
  departments: {
    label: 'Departments',
    sql: `SELECT d.name AS "Department Name", d.mail_alias AS "Mail Alias",
            TRIM(CONCAT(h.first_name, ' ', h.last_name)) AS "Department Lead",
            p.name AS "Parent Department",
            TRIM(CONCAT(cb.first_name, ' ', cb.last_name)) AS "Added By",
            d.created_at AS "Added Time",
            TRIM(CONCAT(ub.first_name, ' ', ub.last_name)) AS "Modified By",
            d.updated_at AS "Modified Time"
          FROM departments d
            LEFT JOIN employees h ON h.id = d.head_id
            LEFT JOIN departments p ON p.id = d.parent_id
            LEFT JOIN employees cb ON cb.id = d.created_by
            LEFT JOIN employees ub ON ub.id = d.updated_by
          WHERE 1=1`,
    fields: { name: { column: 'd.name' }, mailAlias: { column: 'd.mail_alias' } },
  },
  designations: {
    label: 'Designations',
    sql: `SELECT g.name AS "Designation Name", g.mail_alias AS "Mail Alias",
            TRIM(CONCAT(cb.first_name, ' ', cb.last_name)) AS "Added By",
            g.created_at AS "Added Time",
            TRIM(CONCAT(ub.first_name, ' ', ub.last_name)) AS "Modified By",
            g.updated_at AS "Modified Time"
          FROM designations g
            LEFT JOIN employees cb ON cb.id = g.created_by
            LEFT JOIN employees ub ON ub.id = g.updated_by
          WHERE 1=1`,
    fields: { name: { column: 'g.name' }, mailAlias: { column: 'g.mail_alias' } },
  },
};

const sendSheet = (res, rows, sheetName, filename) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), sheetName.slice(0, 31));
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
};

/* The export honours the filters that are on screen. An export that quietly
 * ignores them hands somebody a file that disagrees with the table they were
 * looking at, and they have no way to tell. */
router.get('/export/:module', gate('export'), async (req, res) => {
  const spec = EXPORTS[req.params.module];
  if (!spec) return res.status(404).json({ success: false, message: 'Unknown module' });
  try {
    const { clause, params, applied } = buildCriteria(spec.fields, req.query.criteria, 1);
    const rows = (await pool.query(`${spec.sql}${clause} LIMIT 20000`, params)).rows;

    await logAudit(req, {
      action: 'EXPORT', resource: spec.label, resourceId: req.params.module,
      changes: { summary: `${rows.length} row(s) exported`, filters: applied },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    sendSheet(res, rows, spec.label, `${req.params.module}-${stamp}.xlsx`);
  } catch (err) { serverError(res, err); }
});

/* History Export: the audit trail for a module, flattened one row per changed
 * FIELD rather than per entry — a spreadsheet with a JSON blob in a cell is
 * not something anybody can filter. */
router.get('/history-export/:module', gate('export'), async (req, res) => {
  const spec = EXPORTS[req.params.module];
  if (!spec) return res.status(404).json({ success: false, message: 'Unknown module' });
  try {
    const resource = req.params.module === 'employees' ? 'Employee' : spec.label;
    const r = await pool.query(
      `SELECT al.created_at, al.action, al.resource_id, al.changes,
              TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS actor, al.actor_email
         FROM audit_log al LEFT JOIN employees a ON a.id = al.actor_id
        WHERE al.resource = $1
        ORDER BY al.created_at DESC LIMIT 20000`, [resource]);

    const out = [];
    for (const row of r.rows) {
      const fields = row.changes?.fields || [];
      const base = {
        'When': row.created_at, 'Action': row.action,
        'Changed By': row.actor || row.actor_email || '',
        'Record': row.resource_id,
      };
      if (!fields.length) {
        out.push({ ...base, 'Field': '', 'Old Value': '', 'New Value': '',
          'Summary': row.changes?.summary || '' });
      } else {
        for (const f of fields) {
          out.push({ ...base, 'Field': f.field, 'Old Value': f.from ?? '', 'New Value': f.to ?? '',
            'Summary': row.changes?.summary || '' });
        }
      }
    }

    await logAudit(req, {
      action: 'EXPORT', resource: `${spec.label} history`, resourceId: req.params.module,
      changes: { summary: `${out.length} history row(s) exported` },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    sendSheet(res, out.length ? out : [{ When: '', Action: '', Field: '' }],
      'History', `${req.params.module}-history-${stamp}.xlsx`);
  } catch (err) { serverError(res, err); }
});

/* A blank sheet with the right headings, so an import can start from something
 * that is guaranteed to match rather than from a guess. */
router.get('/import-template/:module', (req, res) => {
  const spec = IMPORTS[req.params.module];
  if (!spec) return res.status(404).json({ success: false, message: 'Unknown module' });
  const blank = {};
  for (const h of spec.template) blank[h] = '';
  sendSheet(res, [blank], spec.label, `${req.params.module}-import-template.xlsx`);
});

/* ── Profile photos, in bulk ─────────────────────────────────────────────── */

const PHOTO_DIR = path.join(__dirname, '..', 'uploads', 'photos');
const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const bulkPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 200 },
  fileFilter: (req, file, cb) =>
    cb(null, ALLOWED_PHOTO_EXTS.has(path.extname(file.originalname).toLowerCase())),
});

/* Files are matched to people by FILENAME — "ANXT220016.jpg" is that person's
 * photo. Anything that does not match an employee id is reported back rather
 * than dropped, so a typo in a filename is visible instead of looking like a
 * photo that failed to upload. */
router.post('/photos', (req, res, next) => {
  bulkPhotoUpload.array('photos', 200)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, message: 'One of those images is over 5 MB.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ success: false, message: 'Up to 200 photos at a time.' });
      return res.status(400).json({ success: false, message: 'Could not read that upload.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'Attach at least one image' });

    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const matched = [], unmatched = [];

    for (const f of files) {
      const code = path.basename(f.originalname, path.extname(f.originalname)).trim();
      const emp = await pool.query(
        `SELECT id, photo_url FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code]);
      if (!emp.rows.length) { unmatched.push({ file: f.originalname, reason: `No employee with ID "${code}"` }); continue; }

      const ext = path.extname(f.originalname).toLowerCase();
      const name = `bulk-${emp.rows[0].id}-${Date.now()}${ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, name), f.buffer);
      const url = `/uploads/photos/${name}`;

      await pool.query(`UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
        [url, emp.rows[0].id]);

      // Best-effort cleanup of the file it replaced, so the directory does not
      // grow by one image per re-upload forever.
      const old = emp.rows[0].photo_url;
      if (old && old.startsWith('/uploads/photos/')) {
        fs.unlink(path.join(__dirname, '..', old), () => {});
      }
      matched.push({ file: f.originalname, employeeId: code });
    }

    await logAudit(req, {
      action: 'UPDATE', resource: 'Employee photos', resourceId: 'bulk',
      changes: { summary: `${matched.length} photo(s) set, ${unmatched.length} unmatched` },
    });

    res.json({
      success: true, matched, unmatched,
      message: `${matched.length} photo(s) updated${unmatched.length ? `, ${unmatched.length} could not be matched` : ''}`,
    });
  } catch (err) { serverError(res, err); }
});

/* ── Show masked data ────────────────────────────────────────────────────── */

/* The list never carries identity numbers, so revealing them is a fresh
 * request rather than something the browser already holds. One audit row per
 * reveal, naming who looked and at how many people: the question worth
 * answering later is who read these, not what they were.
 *
 * Capped, because "reveal everything" is not a thing anybody needs to do in
 * one press and is exactly what an exfiltration looks like. */
const REVEAL_LIMIT = 100;

router.post('/reveal', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: 'Nothing to reveal' });
    if (ids.length > REVEAL_LIMIT) {
      return res.status(400).json({ success: false,
        message: `Reveal is limited to ${REVEAL_LIMIT} people at a time.` });
    }
    const reason = String(req.body?.reason || '').trim();

    const r = await pool.query(
      `SELECT id AS "_id", employee_id AS "employeeId",
              aadhaar_number AS "aadhaarNumber", pan_number AS "panNumber", uan_number AS "uanNumber"
         FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]);

    await logAudit(req, {
      action: 'REVEAL', resource: 'Employee identity', resourceId: ids.length === 1 ? ids[0] : 'bulk',
      changes: {
        summary: `Identity numbers revealed for ${r.rows.length} employee(s)`,
        fields: [
          { field: 'employees', from: null, to: r.rows.map(x => x.employeeId).join(', ').slice(0, 500) },
          ...(reason ? [{ field: 'reason', from: null, to: reason }] : []),
        ],
      },
    });

    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
