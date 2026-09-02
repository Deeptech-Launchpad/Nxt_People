/* Settings -> Employee Information -> Access Control.
 *
 * Field, import/export and tabular-section permissions, per role and per form.
 *
 * The governing rule, and the reason this file is separate: THESE MAY ONLY
 * NARROW. Every helper resolves to "what the code already allows, minus what
 * this screen takes away". Nothing here can grant access the code withholds,
 * for two reasons:
 *
 *   - An empty table must behave exactly as the system did before this screen
 *     existed. Absence means "as before", so deploying it changes nothing.
 *   - Identity numbers stay behind the audited reveal whatever is configured.
 *     An administrator can hide Aadhaar from a role; nobody can turn it into a
 *     plain column or switch the audit off. An audit trail that can be
 *     disabled is not one.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');
const { isFullAccess } = require('../utils/roles');

router.use(protect);
const WRITE = ['admin', 'director', 'hr_admin'];

/* The roles the permission grids list. Taken from the role column rather than
 * a constant, so a role added elsewhere appears here without a code change. */
async function roleList() {
  const r = await pool.query(
    `SELECT DISTINCT role FROM employees WHERE role IS NOT NULL AND role <> '' ORDER BY role`);
  return r.rows.map(x => x.role);
}

/* The employee record's sections and fields, in the order the record shows
 * them. One definition, used by the grid and by the enforcement helper, so a
 * field cannot be permissionable on screen and unprotected in the response. */
const FIELD_SECTIONS = [
  { key: 'basic', label: 'Basic information', fields: [
    ['employeeId', 'Employee ID'], ['firstName', 'First Name'], ['lastName', 'Last Name'],
    ['nickName', 'Nick name'], ['email', 'Email address'], ['photoUrl', 'Photo'],
  ] },
  { key: 'work', label: 'Work Information', fields: [
    ['department', 'Department'], ['designation', 'Designation'], ['role', 'Role'],
    ['workLocation', 'Location'], ['employmentType', 'Employment Type'],
    ['status', 'Employee Status'], ['sourceOfHire', 'Source of Hire'],
    ['dateOfJoining', 'Date of Joining'], ['totalExperience', 'Total Experience'],
  ] },
  { key: 'hierarchy', label: 'Hierarchy Information', fields: [
    ['reportingManager', 'Reporting Manager'], ['secondaryManager', 'Secondary Reporting Manager'],
    ['approvingAuthority', 'Approving Authority'],
  ] },
  { key: 'personal', label: 'Personal Details', fields: [
    ['dateOfBirth', 'Date of Birth'], ['gender', 'Gender'], ['maritalStatus', 'Marital Status'],
    ['bloodGroup', 'Blood Group'], ['nationality', 'Nationality'], ['aboutMe', 'About Me'],
    ['expertise', 'Ask me about/Expertise'],
  ] },
  /* Always restricted, never revealed by this screen. `protected` is why the
   * grid greys the Edit column and refuses to widen View. */
  { key: 'identity', label: 'Identity Information', protectedSection: true, fields: [
    ['aadhaarNumber', 'Aadhaar'], ['panNumber', 'PAN'], ['uanNumber', 'UAN'],
  ] },
  { key: 'contact', label: 'Contact Details', fields: [
    ['workPhone', 'Work Phone Number'], ['extension', 'Extension'], ['phone', 'Personal Mobile Number'],
    ['personalEmail', 'Personal Email Address'], ['seatingLocation', 'Seating Location'],
    ['tags', 'Tags'], ['presentAddress', 'Present Address'], ['permanentAddress', 'Permanent Address'],
  ] },
  { key: 'separation', label: 'Separation Information', fields: [
    ['exitDate', 'Date of Exit'], ['noticePeriodEndDate', 'Notice Period End'],
  ] },
  { key: 'system', label: 'System Fields', fields: [
    ['createdBy', 'Added By'], ['createdAt', 'Added Time'],
    ['updatedBy', 'Modified By'], ['updatedAt', 'Modified Time'],
    ['onboardingStatus', 'Onboarding Status'],
  ] },
];

/* All three have a table behind them now, so these grids govern real writes —
 * employee-records.js asks tabularAllows() before every add, edit and delete. */
const TABULAR_SECTIONS = [
  { key: 'education', label: 'Education Details', built: true },
  { key: 'work_experience', label: 'Work experience', built: true },
  { key: 'dependents', label: 'Dependent Details', built: true },
];

const FORMS = ['employee', 'department', 'designation'];
const formOr400 = (v) => {
  const f = String(v || 'employee');
  if (!FORMS.includes(f)) throw new Error('Unknown form');
  return f;
};

/* ── Field permissions ───────────────────────────────────────────────────── */

router.get('/fields', authorize(...WRITE), async (req, res) => {
  try {
    const form = formOr400(req.query.form);
    const role = String(req.query.role || '').trim();
    const rows = role
      ? (await pool.query(
          `SELECT field_key AS "fieldKey", can_view AS "canView", can_edit AS "canEdit"
             FROM field_permissions WHERE form=$1 AND role=$2`, [form, role])).rows
      : [];
    const map = Object.fromEntries(rows.map(r => [r.fieldKey, r]));
    res.json({
      success: true,
      data: {
        form, role,
        roles: await roleList(),
        sections: FIELD_SECTIONS.map(s => ({
          key: s.key, label: s.label, protected: !!s.protectedSection,
          fields: s.fields.map(([key, label]) => ({
            key, label,
            /* Default is view-yes / edit-no, which is what the record already
               did. Identity fields default to NOT viewable in a grid — they
               were never in the list payload to begin with. */
            canView: map[key]?.canView ?? !s.protectedSection,
            canEdit: map[key]?.canEdit ?? false,
            locked: !!s.protectedSection,
          })),
        })),
      },
    });
  } catch (err) {
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.put('/fields', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const form = formOr400(req.body.form);
    const role = String(req.body.role || '').trim();
    if (!role) return res.status(400).json({ success: false, message: 'Choose a role' });

    const locked = new Set(FIELD_SECTIONS.filter(s => s.protectedSection).flatMap(s => s.fields.map(f => f[0])));
    const incoming = Array.isArray(req.body.fields) ? req.body.fields : [];

    await client.query('BEGIN');
    let changed = 0;
    for (const f of incoming) {
      const key = String(f.key || '');
      if (!key) continue;
      /* A protected field may be switched OFF but never on. Accepting the
       * widening silently would leave the screen showing a permission the
       * code does not honour, which is worse than refusing it. */
      const canView = locked.has(key) ? false : !!f.canView;
      const canEdit = locked.has(key) ? false : !!f.canEdit;
      await client.query(
        `INSERT INTO field_permissions (form, role, field_key, can_view, can_edit, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (form, role, field_key)
         DO UPDATE SET can_view=EXCLUDED.can_view, can_edit=EXCLUDED.can_edit, updated_at=NOW()`,
        [form, role, key, canView, canEdit]);
      changed++;
    }
    await client.query('COMMIT');

    await logAudit(req, { action: 'UPDATE', resource: 'Field permissions', resourceId: `${form}:${role}`,
      changes: { summary: `${changed} field(s) set for ${role}` } });
    res.json({ success: true, updated: changed });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  } finally { client.release(); }
});

/* ── Import / Export permissions ─────────────────────────────────────────── */

router.get('/import-export', authorize(...WRITE), async (req, res) => {
  try {
    const form = formOr400(req.query.form);
    const rows = (await pool.query(
      `SELECT role, can_import AS "canImport", can_export AS "canExport"
         FROM import_export_permissions WHERE form=$1`, [form])).rows;
    const map = Object.fromEntries(rows.map(r => [r.role, r]));
    const roles = await roleList();
    res.json({
      success: true,
      data: {
        form,
        rows: roles.map(role => ({
          role,
          /* Full access has always been able to import and export; this table
           * only ever adds it for somebody else. Defaulting a full-access role
           * to false would take away something that already worked. */
          canImport: map[role]?.canImport ?? isFullAccess(role),
          canExport: map[role]?.canExport ?? isFullAccess(role),
        })),
      },
    });
  } catch (err) {
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.put('/import-export', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const form = formOr400(req.body.form);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.role) continue;
      await client.query(
        `INSERT INTO import_export_permissions (form, role, can_import, can_export, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (form, role)
         DO UPDATE SET can_import=EXCLUDED.can_import, can_export=EXCLUDED.can_export, updated_at=NOW()`,
        [form, r.role, !!r.canImport, !!r.canExport]);
    }
    await client.query('COMMIT');
    await logAudit(req, { action: 'UPDATE', resource: 'Import/Export permissions', resourceId: form,
      changes: { summary: `${rows.length} role(s) set` } });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  } finally { client.release(); }
});

/* ── Tabular section permissions ─────────────────────────────────────────── */

router.get('/tabular', authorize(...WRITE), async (req, res) => {
  try {
    const form = formOr400(req.query.form);
    const section = String(req.query.section || 'education');
    const spec = TABULAR_SECTIONS.find(s => s.key === section);
    if (!spec) return res.status(400).json({ success: false, message: 'Unknown section' });

    const rows = (await pool.query(
      `SELECT role, can_add AS "canAdd", can_edit AS "canEdit", can_delete AS "canDelete"
         FROM tabular_section_permissions WHERE form=$1 AND section=$2`, [form, section])).rows;
    const map = Object.fromEntries(rows.map(r => [r.role, r]));
    const roles = await roleList();
    res.json({
      success: true,
      data: {
        form, section,
        sections: TABULAR_SECTIONS,
        /* Said out loud rather than shown as a working grid: two of the three
         * sections have no table behind them yet, so permissions on them would
         * govern nothing. */
        built: !!spec.built,
        rows: roles.map(role => ({
          role,
          canAdd: map[role]?.canAdd ?? isFullAccess(role),
          canEdit: map[role]?.canEdit ?? isFullAccess(role),
          canDelete: map[role]?.canDelete ?? isFullAccess(role),
        })),
      },
    });
  } catch (err) {
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

router.put('/tabular', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const form = formOr400(req.body.form);
    const section = String(req.body.section || '');
    if (!TABULAR_SECTIONS.some(s => s.key === section)) {
      return res.status(400).json({ success: false, message: 'Unknown section' });
    }
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.role) continue;
      await client.query(
        `INSERT INTO tabular_section_permissions (form, section, role, can_add, can_edit, can_delete, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (form, section, role)
         DO UPDATE SET can_add=EXCLUDED.can_add, can_edit=EXCLUDED.can_edit,
                       can_delete=EXCLUDED.can_delete, updated_at=NOW()`,
        [form, section, r.role, !!r.canAdd, !!r.canEdit, !!r.canDelete]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (/Unknown form/.test(err.message)) return res.status(400).json({ success: false, message: err.message });
    serverError(res, err);
  } finally { client.release(); }
});

/* ── Enforcement helpers, for the routes that serve records ──────────────── */

const cache = { at: 0, byRole: new Map() };
const TTL = 30 * 1000;

/** Field keys this role may NOT view. Empty when nothing is configured. */
async function hiddenFieldsFor(role, form = 'employee') {
  const key = `${form}:${role}`;
  if (Date.now() - cache.at > TTL) { cache.byRole.clear(); cache.at = Date.now(); }
  if (cache.byRole.has(key)) return cache.byRole.get(key);
  let set = new Set();
  try {
    const r = await pool.query(
      `SELECT field_key FROM field_permissions
        WHERE form=$1 AND role=$2 AND can_view = FALSE`, [form, role]);
    set = new Set(r.rows.map(x => x.field_key));
  } catch { /* unreadable config must not blank a record */ }
  cache.byRole.set(key, set);
  return set;
}

/** Strip fields a role may not see. Full access is exempt: this screen exists
 *  to restrain narrower roles, and locking an administrator out of the record
 *  they administer would make the product unusable by its own owner. */
async function applyFieldPermissions(row, user, form = 'employee') {
  if (!row || isFullAccess(user?.role)) return row;
  const hidden = await hiddenFieldsFor(user.role, form);
  if (!hidden.size) return row;
  const out = { ...row };
  for (const k of hidden) delete out[k];
  return out;
}

async function canImportExport(user, form, kind) {
  if (isFullAccess(user?.role)) return true;
  const r = await pool.query(
    `SELECT can_import AS i, can_export AS e FROM import_export_permissions
      WHERE form=$1 AND role=$2`, [form, user?.role]);
  if (!r.rows.length) return false;
  return kind === 'import' ? !!r.rows[0].i : !!r.rows[0].e;
}

module.exports = router;
module.exports.FIELD_SECTIONS = FIELD_SECTIONS;
module.exports.TABULAR_SECTIONS = TABULAR_SECTIONS;
module.exports.hiddenFieldsFor = hiddenFieldsFor;
module.exports.applyFieldPermissions = applyFieldPermissions;
module.exports.canImportExport = canImportExport;
module.exports.invalidateFieldPermissions = () => { cache.at = 0; cache.byRole.clear(); };
