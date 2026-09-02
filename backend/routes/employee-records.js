/* The employee record's child sections and its optional forms.
 *
 *   /employee-records/:employeeId/experience   Work experience
 *   /employee-records/:employeeId/dependents   Dependent Details
 *   /employee-records/:employeeId/health       Employee Health Data
 *   /employee-records/:employeeId/vaccinations Vaccination Status
 *
 * Two things govern every route here:
 *
 *   - TABULAR SECTION PERMISSIONS decide who may add, edit or delete a row.
 *     They were a grid that governed nothing because these tables did not
 *     exist; now they do, so the grid is enforced.
 *   - The optional forms are OFF until switched on in Extend Service, and
 *     refuse writes while off. A toggle that only hides the screen while the
 *     API keeps accepting data is not a switch.
 *
 * Health data is the most sensitive thing in the product. It lives in its own
 * table so a route selecting e.* cannot leak it, it is full-access or self
 * only, and every read of somebody else's is audited.
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

const str = (v, field, { required = false, max = 255 } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (required) throw new Error(`${field} is required`); return null; }
  if (s.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return s;
};
const dateOrNull = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const known = (e) => /is required|characters or fewer|cannot|must be|not allowed|switched off/i.test(e.message || '');
const fail = (res, err) => (known(err)
  ? res.status(400).json({ success: false, message: err.message })
  : serverError(res, err));

/* Reading your own record is always allowed; reading somebody else's needs
 * full access. Managers are deliberately not included: a reporting line is a
 * reason to approve leave, not to read a colleague's dependents. */
const mayRead = (user, employeeId) =>
  isFullAccess(user.role) || String(user._id) === String(employeeId);

/** Whether this role may add / edit / delete rows in a tabular section. */
async function tabularAllows(user, section, action) {
  if (isFullAccess(user.role)) return true;
  const r = await pool.query(
    `SELECT can_add, can_edit, can_delete FROM tabular_section_permissions
      WHERE form='employee' AND section=$1 AND role=$2`, [section, user.role]);
  if (!r.rows.length) return false;
  const row = r.rows[0];
  return action === 'add' ? row.can_add : action === 'edit' ? row.can_edit : row.can_delete;
}

const guard = (section, action) => async (req, res, next) => {
  try {
    if (!mayRead(req.user, req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    if (await tabularAllows(req.user, section, action)) return next();
    res.status(403).json({ success: false, message: `Your role may not ${action} ${section.replace('_', ' ')}.` });
  } catch (err) { fail(res, err); }
};

/** An optional form must be switched on in Extend Service before it accepts data. */
async function formEnabled(key) {
  const r = await pool.query(`SELECT is_enabled FROM extend_service_forms WHERE form_key=$1`, [key]);
  return !!r.rows[0]?.is_enabled;
}

/* ── Work experience ─────────────────────────────────────────────────────── */

const EXPERIENCE_SELECT = `
  id AS "_id", company_name AS "companyName", job_title AS "jobTitle",
  from_date AS "fromDate", to_date AS "toDate", job_description AS "jobDescription",
  relevant, created_at AS "createdAt"`;

router.get('/:employeeId/experience', async (req, res) => {
  try {
    if (!mayRead(req.user, req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    const r = await pool.query(
      `SELECT ${EXPERIENCE_SELECT} FROM employee_work_experience
        WHERE employee_id=$1 ORDER BY from_date DESC NULLS LAST`, [req.params.employeeId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

const cleanExperience = (b) => {
  const from = dateOrNull(b.fromDate), to = dateOrNull(b.toDate);
  if (from && to && to < from) throw new Error('The end date cannot be before the start date');
  return {
    companyName: str(b.companyName, 'Company name', { required: true }),
    jobTitle: str(b.jobTitle, 'Job title'),
    fromDate: from, toDate: to,
    jobDescription: str(b.jobDescription, 'Job description', { max: 2000 }),
    relevant: !!b.relevant,
  };
};

router.post('/:employeeId/experience', guard('work_experience', 'add'), async (req, res) => {
  try {
    const v = cleanExperience(req.body);
    const r = await pool.query(
      `INSERT INTO employee_work_experience
         (employee_id, company_name, job_title, from_date, to_date, job_description, relevant)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${EXPERIENCE_SELECT}`,
      [req.params.employeeId, v.companyName, v.jobTitle, v.fromDate, v.toDate, v.jobDescription, v.relevant]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/:employeeId/experience/:id', guard('work_experience', 'edit'), async (req, res) => {
  try {
    const v = cleanExperience(req.body);
    const r = await pool.query(
      `UPDATE employee_work_experience
          SET company_name=$1, job_title=$2, from_date=$3, to_date=$4,
              job_description=$5, relevant=$6, updated_at=NOW()
        WHERE id=$7 AND employee_id=$8 RETURNING ${EXPERIENCE_SELECT}`,
      [v.companyName, v.jobTitle, v.fromDate, v.toDate, v.jobDescription, v.relevant,
       req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/:employeeId/experience/:id', guard('work_experience', 'delete'), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM employee_work_experience WHERE id=$1 AND employee_id=$2 RETURNING id`,
      [req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ── Dependents ──────────────────────────────────────────────────────────── */

const DEPENDENT_SELECT = `
  id AS "_id", name, relationship, date_of_birth AS "dateOfBirth", created_at AS "createdAt"`;

router.get('/:employeeId/dependents', async (req, res) => {
  try {
    if (!mayRead(req.user, req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    const r = await pool.query(
      `SELECT ${DEPENDENT_SELECT} FROM employee_dependents WHERE employee_id=$1 ORDER BY name`,
      [req.params.employeeId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

const cleanDependent = (b) => ({
  name: str(b.name, 'Name', { required: true }),
  relationship: str(b.relationship, 'Relationship', { max: 60 }),
  dateOfBirth: dateOrNull(b.dateOfBirth),
});

router.post('/:employeeId/dependents', guard('dependents', 'add'), async (req, res) => {
  try {
    const v = cleanDependent(req.body);
    const r = await pool.query(
      `INSERT INTO employee_dependents (employee_id, name, relationship, date_of_birth)
       VALUES ($1,$2,$3,$4) RETURNING ${DEPENDENT_SELECT}`,
      [req.params.employeeId, v.name, v.relationship, v.dateOfBirth]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/:employeeId/dependents/:id', guard('dependents', 'edit'), async (req, res) => {
  try {
    const v = cleanDependent(req.body);
    const r = await pool.query(
      `UPDATE employee_dependents SET name=$1, relationship=$2, date_of_birth=$3, updated_at=NOW()
        WHERE id=$4 AND employee_id=$5 RETURNING ${DEPENDENT_SELECT}`,
      [v.name, v.relationship, v.dateOfBirth, req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/:employeeId/dependents/:id', guard('dependents', 'delete'), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM employee_dependents WHERE id=$1 AND employee_id=$2 RETURNING id`,
      [req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

/* ── Employee Health Data ────────────────────────────────────────────────── */

const HEALTH_SELECT = `
  employee_id AS "employeeId", blood_group AS "bloodGroup", height_cm AS "heightCm",
  weight_kg AS "weightKg", allergies, chronic_conditions AS "chronicConditions",
  medications, emergency_contact_name AS "emergencyContactName",
  emergency_contact_phone AS "emergencyContactPhone", doctor_name AS "doctorName",
  doctor_phone AS "doctorPhone", insurance_provider AS "insuranceProvider",
  insurance_number AS "insuranceNumber", notes, updated_at AS "updatedAt"`;

router.get('/:employeeId/health', async (req, res) => {
  try {
    if (!(await formEnabled('employee_health'))) {
      return res.status(403).json({ success: false,
        message: 'Employee Health Data is switched off in Settings → Employee Information → Extend Service.' });
    }
    if (!mayRead(req.user, req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    const r = await pool.query(
      `SELECT ${HEALTH_SELECT} FROM employee_health_data WHERE employee_id=$1`, [req.params.employeeId]);

    /* Reading somebody else's health record is worth recording. Reading your
     * own is not — an audit entry every time a person opens their own page is
     * noise that buries the entries that matter. */
    if (String(req.user._id) !== String(req.params.employeeId) && r.rows.length) {
      await logAudit(req, { action: 'VIEW', resource: 'Employee health data',
        resourceId: req.params.employeeId, changes: { summary: 'Health record viewed' } });
    }
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) { fail(res, err); }
});

router.put('/:employeeId/health', authorize(...WRITE), async (req, res) => {
  try {
    if (!(await formEnabled('employee_health'))) {
      throw new Error('Employee Health Data is switched off in Extend Service.');
    }
    const b = req.body || {};
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const r = await pool.query(
      `INSERT INTO employee_health_data
         (employee_id, blood_group, height_cm, weight_kg, allergies, chronic_conditions,
          medications, emergency_contact_name, emergency_contact_phone, doctor_name,
          doctor_phone, insurance_provider, insurance_number, notes, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (employee_id) DO UPDATE SET
         blood_group=EXCLUDED.blood_group, height_cm=EXCLUDED.height_cm,
         weight_kg=EXCLUDED.weight_kg, allergies=EXCLUDED.allergies,
         chronic_conditions=EXCLUDED.chronic_conditions, medications=EXCLUDED.medications,
         emergency_contact_name=EXCLUDED.emergency_contact_name,
         emergency_contact_phone=EXCLUDED.emergency_contact_phone,
         doctor_name=EXCLUDED.doctor_name, doctor_phone=EXCLUDED.doctor_phone,
         insurance_provider=EXCLUDED.insurance_provider,
         insurance_number=EXCLUDED.insurance_number, notes=EXCLUDED.notes,
         updated_by=EXCLUDED.updated_by, updated_at=NOW()
       RETURNING ${HEALTH_SELECT}`,
      [req.params.employeeId, str(b.bloodGroup, 'Blood group', { max: 10 }),
       num(b.heightCm), num(b.weightKg),
       str(b.allergies, 'Allergies', { max: 2000 }),
       str(b.chronicConditions, 'Conditions', { max: 2000 }),
       str(b.medications, 'Medications', { max: 2000 }),
       str(b.emergencyContactName, 'Emergency contact'),
       str(b.emergencyContactPhone, 'Emergency phone', { max: 40 }),
       str(b.doctorName, 'Doctor'), str(b.doctorPhone, 'Doctor phone', { max: 40 }),
       str(b.insuranceProvider, 'Insurer'), str(b.insuranceNumber, 'Policy number', { max: 80 }),
       str(b.notes, 'Notes', { max: 4000 }), req.user._id]);

    /* The values are never written to the audit trail — that a health record
     * changed is worth knowing; what somebody's medication is, is not
     * something to copy into a table every admin can read. */
    await logAudit(req, { action: 'UPDATE', resource: 'Employee health data',
      resourceId: req.params.employeeId, changes: { summary: 'Health record updated' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

/* ── Vaccination status ──────────────────────────────────────────────────── */

const VACCINATION_SELECT = `
  id AS "_id", vaccine, dose, vaccinated_on AS "vaccinatedOn",
  certificate_path AS "certificatePath", certificate_name AS "certificateName",
  notes, created_at AS "createdAt"`;

router.get('/:employeeId/vaccinations', async (req, res) => {
  try {
    if (!(await formEnabled('vaccination'))) {
      return res.status(403).json({ success: false,
        message: 'Vaccination Status is switched off in Settings → Employee Information → Extend Service.' });
    }
    if (!mayRead(req.user, req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    const r = await pool.query(
      `SELECT ${VACCINATION_SELECT} FROM employee_vaccinations
        WHERE employee_id=$1 ORDER BY vaccinated_on DESC NULLS LAST`, [req.params.employeeId]);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/:employeeId/vaccinations', authorize(...WRITE), async (req, res) => {
  try {
    if (!(await formEnabled('vaccination'))) {
      throw new Error('Vaccination Status is switched off in Extend Service.');
    }
    const r = await pool.query(
      `INSERT INTO employee_vaccinations (employee_id, vaccine, dose, vaccinated_on, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${VACCINATION_SELECT}`,
      [req.params.employeeId, str(req.body.vaccine, 'Vaccine', { required: true, max: 120 }),
       str(req.body.dose, 'Dose', { max: 40 }), dateOrNull(req.body.vaccinatedOn),
       str(req.body.notes, 'Notes', { max: 1000 })]);
    await logAudit(req, { action: 'CREATE', resource: 'Employee vaccination',
      resourceId: req.params.employeeId, changes: { summary: 'Vaccination recorded' } });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/:employeeId/vaccinations/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM employee_vaccinations WHERE id=$1 AND employee_id=$2 RETURNING id`,
      [req.params.id, req.params.employeeId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Row not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

module.exports = router;
