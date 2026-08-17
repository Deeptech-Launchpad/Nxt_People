/**
 * routes/org-details.js
 * Manage Accounts → Organization Setup → Organization Details and
 * Organization Policy.
 *
 * Two sections on one settings row, but read and written separately, because
 * the reference saves them independently and one form's validation failing
 * should not discard the other's edits.
 *
 * The policy blob's two halves also save independently — the reference puts a
 * Save on Alert & Chat and another on Locale & Display format — so the PATCH
 * takes whichever keys it is given and merges, rather than replacing the whole
 * object and blanking the half that was not on screen.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];

const str = (v, label, max) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return s;
};

const known = m => /must be|is required|not valid|Enter a/i.test(m || '');
const fail = (res, err) => res.status(known(err.message) ? 400 : 500)
  .json({ success: false, message: known(err.message) ? err.message : 'An internal server error occurred' });

// ── Organization Details ───────────────────────────────────────────────────
const DETAIL_ROW = `
  company_name AS "name", company_email AS "contactEmail",
  org_logo_url AS "logoUrl", org_website AS "website", org_type AS "type",
  org_contact_person AS "contactPerson", org_contact_number AS "contactNumber",
  org_address_line1 AS "addressLine1", org_address_line2 AS "addressLine2",
  org_city AS "city", org_state AS "state", org_country AS "country",
  org_postal_code AS "postalCode"`;

// The reference's Type of organization list.
const ORG_TYPES = [
  'Consultant', 'Product', 'Service', 'Manufacturing', 'Education',
  'Healthcare', 'Non-profit', 'Government', 'Other',
];

router.get('/details', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${DETAIL_ROW} FROM settings LIMIT 1`);
    res.json({ success: true, data: { ...(r.rows[0] || {}), organizationTypes: ORG_TYPES } });
  } catch (err) { fail(res, err); }
});

router.patch('/details', authorize(...WRITE), async (req, res) => {
  const b = req.body || {};
  try {
    const name = str(b.name, 'Name', 255);
    if (!name) throw new Error('Name is required');
    const email = str(b.contactEmail, 'Contact email', 255);
    if (!email) throw new Error('Contact email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid contact email');

    const type = b.type && ORG_TYPES.includes(b.type) ? b.type : null;

    const r = await pool.query(
      `UPDATE settings
          SET company_name = $1, company_email = $2, org_logo_url = $3, org_website = $4,
              org_type = $5, org_contact_person = $6, org_contact_number = $7,
              org_address_line1 = $8, org_address_line2 = $9, org_city = $10,
              org_state = $11, org_country = $12, org_postal_code = $13, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
       RETURNING ${DETAIL_ROW}`,
      [name, email, str(b.logoUrl, 'Logo', 500), str(b.website, 'Website', 255), type,
       str(b.contactPerson, 'Contact person', 150), str(b.contactNumber, 'Contact number', 40),
       str(b.addressLine1, 'Address line 1', 255), str(b.addressLine2, 'Address line 2', 255),
       str(b.city, 'City', 120), str(b.state, 'State', 120), str(b.country, 'Country', 120),
       str(b.postalCode, 'Postal code', 20)]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });
    res.json({ success: true, data: { ...r.rows[0], organizationTypes: ORG_TYPES } });
  } catch (err) { fail(res, err); }
});

// ── Organization Policy ────────────────────────────────────────────────────
const bool = v => !!v;

const TIME_FORMATS = ['12', '24'];
const NAME_FORMATS = ['first_name', 'first_last', 'last_first', 'employee_id_first'];
const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MMM-yyyy'];
const PICTURE_ACTORS = ['employee', 'admin', 'employee_and_admin'];

// Each half is cleaned only if it was sent. The two Save buttons post different
// halves, and replacing the whole blob either way would blank whichever half
// the form was not showing.
function cleanPolicy(current, patch) {
  const out = { ...current };

  if (patch.alertAndChat) {
    out.alertAndChat = {
      notifications: bool(patch.alertAndChat.notifications),
      chat: bool(patch.alertAndChat.chat),
    };
  }
  if (patch.personalInformation) {
    const p = patch.personalInformation;
    out.personalInformation = {
      birthday: bool(p.birthday), workAnniversary: bool(p.workAnniversary), mobileNumber: bool(p.mobileNumber),
    };
  }
  if (patch.employeeSearch) {
    out.employeeSearch = { byMobileNumber: bool(patch.employeeSearch.byMobileNumber) };
  }
  if (patch.profilePicture) {
    const p = patch.profilePicture;
    if (p.updatableBy && !PICTURE_ACTORS.includes(p.updatableBy)) throw new Error('That is not a valid choice');
    const mandate = bool(p.mandateApproval);
    out.profilePicture = {
      updatableBy: p.updatableBy || null,
      mandateApproval: mandate,
      // An approver only means anything while approval is mandated; keeping one
      // under a switched-off setting would resurface silently if re-enabled.
      approver: mandate ? (p.approver || null) : null,
    };
  }
  if (patch.coverImage) {
    out.coverImage = {
      allowSystemOptions: bool(patch.coverImage.allowSystemOptions),
      allowCustomUpload: bool(patch.coverImage.allowCustomUpload),
    };
  }
  if (patch.locale) {
    const l = patch.locale;
    if (l.timeFormat && !TIME_FORMATS.includes(String(l.timeFormat))) throw new Error('Time format is not valid');
    if (l.nameFormat && !NAME_FORMATS.includes(l.nameFormat)) throw new Error('Name format is not valid');
    if (l.dateFormat && !DATE_FORMATS.includes(l.dateFormat)) throw new Error('Date format is not valid');
    out.locale = {
      country: str(l.country, 'Country', 120) || 'India',
      // India-only deployment: attendance, payroll and cron all assume this
      // zone, so it is reported rather than accepted.
      timezone: 'Asia/Kolkata',
      timeFormat: String(l.timeFormat || '12'),
      nameFormat: l.nameFormat || 'first_name',
      dateFormat: l.dateFormat || 'dd/MM/yyyy',
    };
  }
  if (patch.recycleBin) {
    const months = Number(patch.recycleBin.retentionMonths);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw new Error('Retention must be a whole number of months between 1 and 120');
    }
    out.recycleBin = { retentionMonths: months };
  }
  return out;
}

router.get('/policy', async (req, res) => {
  try {
    const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
    res.json({
      success: true,
      data: {
        ...(r.rows[0]?.c || {}),
        options: { timeFormats: TIME_FORMATS, nameFormats: NAME_FORMATS, dateFormats: DATE_FORMATS, pictureActors: PICTURE_ACTORS },
      },
    });
  } catch (err) { fail(res, err); }
});

router.patch('/policy', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1 FOR UPDATE`);
    const merged = cleanPolicy(current.rows[0]?.c || {}, req.body || {});
    const r = await client.query(
      `UPDATE settings SET organization_policy_config = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
       RETURNING organization_policy_config AS c`,
      [JSON.stringify(merged)]
    );
    await client.query('COMMIT');
    res.json({
      success: true,
      data: {
        ...r.rows[0].c,
        options: { timeFormats: TIME_FORMATS, nameFormats: NAME_FORMATS, dateFormats: DATE_FORMATS, pictureActors: PICTURE_ACTORS },
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

// ── Organization Structure ─────────────────────────────────────────────────
// The three component names are configuration, not fixed strings: the reference
// lets an organization call a legal entity whatever it calls one.
const LABEL_KEYS = ['legalEntity', 'businessUnit', 'division'];
const DEFAULT_LABELS = { legalEntity: 'Company', businessUnit: 'Business Unit', division: 'Division' };

router.get('/structure', async (req, res) => {
  try {
    const r = await pool.query(`SELECT org_structure_config AS c FROM settings LIMIT 1`);
    const c = r.rows[0]?.c || {};
    res.json({
      success: true,
      data: { enabled: !!c.enabled, labels: { ...DEFAULT_LABELS, ...(c.labels || {}) } },
    });
  } catch (err) { fail(res, err); }
});

router.patch('/structure', authorize(...WRITE), async (req, res) => {
  const b = req.body || {};
  try {
    const labels = {};
    for (const key of LABEL_KEYS) {
      const v = str(b.labels?.[key], 'Component name', 60);
      // A blank component name would leave a rail item and a heading with no
      // word in them, so the built-in stands in.
      labels[key] = v || DEFAULT_LABELS[key];
    }
    const r = await pool.query(
      `UPDATE settings SET org_structure_config = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
       RETURNING org_structure_config AS c`,
      [JSON.stringify({ enabled: !!b.enabled, labels })]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });
    res.json({ success: true, data: r.rows[0].c });
  } catch (err) { fail(res, err); }
});

// The tree the reference draws under Manage Structure: the organization at the
// root, its legal entities beneath, then business units, then divisions.
router.get('/structure/tree', async (req, res) => {
  try {
    const [org, companies, units, divisions] = await Promise.all([
      pool.query(`SELECT company_name AS name, org_structure_config AS c FROM settings LIMIT 1`),
      pool.query(`SELECT id, name FROM companies ORDER BY name`),
      pool.query(`SELECT id, name, company_id AS "companyId" FROM business_units ORDER BY name`),
      pool.query(`SELECT id, name, parent_id AS "parentId", business_unit_id AS "businessUnitId" FROM divisions ORDER BY name`),
    ]);

    // Divisions nest, so each one is placed under its parent division where it
    // has one, and under its business unit otherwise.
    const divisionsOf = (businessUnitId, parentId) =>
      divisions.rows
        .filter(d => (parentId ? d.parentId === parentId : !d.parentId && d.businessUnitId === businessUnitId))
        .map(d => ({ id: d.id, name: d.name, kind: 'division', children: divisionsOf(null, d.id) }));

    res.json({
      success: true,
      data: {
        name: org.rows[0]?.name || 'Organization',
        labels: { ...DEFAULT_LABELS, ...(org.rows[0]?.c?.labels || {}) },
        enabled: !!org.rows[0]?.c?.enabled,
        children: companies.rows.map(co => ({
          id: co.id, name: co.name, kind: 'company',
          children: units.rows
            .filter(u => u.companyId === co.id)
            .map(u => ({ id: u.id, name: u.name, kind: 'business_unit', children: divisionsOf(u.id, null) })),
        })),
        // A business unit with no company, or a division with no business unit,
        // would otherwise vanish from the tree rather than showing as unplaced.
        unplaced: {
          businessUnits: units.rows.filter(u => !u.companyId).map(u => ({ id: u.id, name: u.name })),
          divisions: divisions.rows.filter(d => !d.parentId && !d.businessUnitId).map(d => ({ id: d.id, name: d.name })),
        },
      },
    });
  } catch (err) { fail(res, err); }
});

module.exports = router;
