/* ── Everything Zoho holds for these people, and where it could land ────────
 *  Attendance and leave were imported because those were the two things asked
 *  for. Zoho offers sixteen forms and the earlier probe only ever looked at
 *  three of them, filtered by a regex for names containing "attend" or
 *  "leave" — so whatever else is in there has never been looked at.
 *
 *  This opens all of them and reports, per form:
 *
 *    how many records exist at all
 *    whether the records carry an employee, and under which field
 *    how many belong to the people named
 *    what the fields are called, on a real record
 *
 *  and then says, for each, whether this system has somewhere to put it.
 *
 *  Read-only in both directions: every Zoho call is a GET, the database
 *  refuses anything that is not a SELECT and proves it on startup, and the
 *  mail transport throws if touched.
 *
 *    docker compose exec backend node zoho_survey.js ANXT2600149,ANXT2300104
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_survey.js does not send mail'); },
  verify: async () => { throw new Error('zoho_survey.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('zoho_survey.js is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const { zohoApi } = require('./utils/zoho');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const pad = (s, n) => String(s ?? '').padEnd(n);

/* Where each kind of Zoho record could land here. Written down rather than
 * worked out per form at import time, because "we have nowhere to put this" is
 * the single most useful thing this can report — it is the work, not a
 * footnote to it. */
const DESTINATIONS = [
  [/^leave$/i,                     'leaves', 'imported already'],
  [/^attendance/i,                 'attendance', 'imported already'],
  [/timesheet|^p_task$|job|project/i, 'projects / timesheets', 'tables exist, nothing reads Zoho'],
  [/compensat|comp.?off/i,         'comp_offs', 'table exists'],
  [/regulari/i,                    'regularizations', 'table exists'],
  [/on.?duty|onduty/i,             'on_duty_requests', 'table exists'],
  [/wfh|work.?from.?home|remote/i, 'wfh_requests', 'check the table name'],
  [/holiday/i,                     'holidays', 'table exists'],
  [/shift/i,                       'shifts', 'table exists'],
  [/^employee$|p_employee/i,       'employees', 'profiles — these people already exist here'],
  [/depart/i,                      'departments', 'table exists'],
  [/designation|role/i,            'designations', 'table exists'],
  [/proof|letter|bonafide|experience|document|file/i, 'documents', 'table exists'],
  [/exit.?interview|resignation/i, 'employees.exit_date', 'partly — no interview table'],
  [/travel|expense|claim/i,        '—', 'no table here'],
  [/appraisal|goal|review|kra/i,   '—', 'no table here'],
  [/asset/i,                       '—', 'no table here'],
  [/benefit|insurance/i,           '—', 'no table here'],
  [/client/i,                      '—', 'no table here'],
  [/announce/i,                    'announcements', 'table exists'],
];
/* Match the form's own link name first and its display label only as a
 * fallback. Testing an anchored pattern against "name label" joined together
 * can never match, which is how /^leave$/ failed to recognise the leave form —
 * the one form already being imported. */
const destinationFor = (name, label) => {
  for (const [re, table, note] of DESTINATIONS) if (re.test(name)) return { table, note };
  for (const [re, table, note] of DESTINATIONS) if (label && re.test(label)) return { table, note };
  return { table: '?', note: 'not recognised — needs a decision' };
};

// Which field on a record names the person it belongs to.
const EMP_FIELDS = ['Employee_ID', 'EmployeeID', 'Employee', 'Emp_ID', 'Employee_Id', 'Owner'];
const employeeFieldOf = (rec) => EMP_FIELDS.find(f => f in (rec || {}))
  || Object.keys(rec || {}).find(k => /employee/i.test(k) && !/\.(ID|details)$/.test(k));

async function records(form, { limit = 200, search = null } = {}) {
  const q = `forms/${encodeURIComponent(form)}/getRecords?sIndex=1&limit=${limit}`
    + (search ? `&searchParams=${encodeURIComponent(JSON.stringify(search))}` : '');
  const json = await zohoApi(q);
  const body = json?.response?.result;
  if (!Array.isArray(body)) return null;      // an error envelope, not records
  return body.map(w => Object.values(w)[0]?.[0]).filter(Boolean);
}

(async () => {
  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  What else Zoho has for these people — READ ONLY');
  console.log(`  ${CODES.length ? CODES.join(', ') : 'everybody'}`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  // ── Every form, not the three that matched a regex ───────────────────────
  let forms = [];
  try {
    const list = await zohoApi('forms');
    const raw = list?.response?.result || list?.response || list || [];
    const flat = Array.isArray(raw) ? raw : Object.values(raw).flat();
    forms = flat
      .map(f => ({
        name: f.formLinkName || f.linkName || f.formName || f.displayName,
        label: f.displayName || f.formName || '',
      }))
      .filter(f => f.name);
  } catch (e) {
    console.log(`  Could not list forms: ${String(e.message).slice(0, 140)}\n`);
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  ${forms.length} form(s) Zoho is offering`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`  ${pad('form', 26)}${pad('records', 9)}${pad('keyed by', 16)}${pad('ours', 6)}where it goes\n`);

  const findings = [];
  for (const f of forms) {
    let rows = null;
    try { rows = await records(f.name); }
    catch { /* reported as unreadable below */ }

    if (rows === null) {
      console.log(`  ${pad(f.name, 26)}${pad('—', 9)}${pad('unreadable', 16)}`);
      findings.push({ ...f, readable: false });
      continue;
    }

    const sample = rows[0];
    const empField = sample ? employeeFieldOf(sample) : null;
    const ours = CODES.length && empField
      ? rows.filter(r => CODES.some(c => String(r[empField] ?? '').includes(c)))
      : [];
    const mine = CODES.length && empField ? ours.length : null;
    const dest = destinationFor(f.name, f.label);

    console.log(`  ${pad(f.name, 26)}${pad(rows.length + (rows.length === 200 ? '+' : ''), 9)}`
      + `${pad(empField || 'not per-person', 16)}${pad(mine === null ? '-' : mine, 6)}`
      + `${dest.table}${dest.note ? `  (${dest.note})` : ''}`);

    // The sample has to be one of THEIRS where there is one — the form's first
    // record is somebody else's, and its fields are what an importer must read.
    findings.push({ ...f, readable: true, count: rows.length, empField, mine,
                    sample: ours[0] || sample, dest });
  }

  // ── The fields, for anything that actually concerns these people ──────────
  const worth = findings.filter(f => f.readable && (f.mine > 0 || (f.count > 0 && !f.empField)));
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  What those records look like');
  console.log('──────────────────────────────────────────────────────────');
  for (const f of worth) {
    console.log(`\n  ── ${f.name}${f.label && f.label !== f.name ? `  (${f.label})` : ''}`
      + `   ${f.mine ?? f.count} record(s)`);
    console.log(`     goes to: ${f.dest.table}   ${f.dest.note}`);
    console.log(`     fields: ${Object.keys(f.sample || {}).join(', ')}`);
  }

  // ── And the module endpoints, which are not forms ────────────────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Modules, which do not appear in the form list');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log('    attendance/getUserReport      imported already (needs dateFormat)');
  console.log('    leave module                  not granted on this token');
  console.log('    timetracker / timesheets      not granted on this token\n');

  // ── What we hold for them now, for scale ─────────────────────────────────
  if (CODES.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  What this system already holds for them');
    console.log('──────────────────────────────────────────────────────────\n');
    for (const code of CODES) {
      const emp = (await pool.query(
        `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name
           FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code])).rows[0];
      if (!emp) { console.log(`    ${code} is not here.`); continue; }
      const counts = await Promise.all([
        ['attendance', 'attendance'], ['leaves', 'leaves'],
        ['comp_offs', 'comp_offs'], ['on_duty_requests', 'on_duty_requests'],
        ['regularizations', 'regularizations'],
      ].map(async ([label, table]) => {
        try {
          const n = (await pool.query(
            `SELECT COUNT(*)::int n FROM ${table} WHERE employee_id = $1`, [emp.id])).rows[0].n;
          return `${label} ${n}`;
        } catch { return `${label} (no such table)`; }
      }));
      console.log(`    ${pad(emp.name, 22)}${counts.join('   ')}`);
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
