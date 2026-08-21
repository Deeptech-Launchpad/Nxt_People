/* ── Bring Zoho's employee profile across ───────────────────────────────────
 *  Attendance and leave were rows nobody had. A profile is different: these
 *  people already exist here, with a login, a role and a manager, and this
 *  overwrites a live record rather than filling an empty one. So it is
 *  deliberately narrow.
 *
 *  What it will never touch, whatever Zoho says:
 *
 *    id, employee_id, password        identity and credentials
 *    email                            the login itself
 *    role, allow_access, login_*      access control. Zoho has a Role field
 *                                     and importing it would let a Zoho edit
 *                                     grant permissions in this system.
 *    status                           drives whether somebody can get in
 *    mfa_*, tokens_revoked_at         security state
 *
 *  Everything else is an allowlist, written out one column at a time, so a new
 *  Zoho field cannot silently start writing somewhere.
 *
 *  Managers are resolved to real people here — by work email first, then by the
 *  employee code inside Zoho's "Name Name CODE" string. A manager who cannot be
 *  found is reported and left alone rather than set to null, because null means
 *  "reports to nobody" and that is a claim, not an absence.
 *
 *  The whole previous row is backed up to import_backups first, under the same
 *  batch machinery as the attendance restage, so restore_import_backup.js
 *  reverses it.
 *
 *    docker compose exec backend node zoho_profile.js ANXT2600149,ANXT2300104
 *    docker compose exec backend node zoho_profile.js ANXT2600149,ANXT2300104 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_profile.js does not send mail'); },
  verify: async () => { throw new Error('zoho_profile.js does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const APPLY = process.argv.includes('--apply');
const pad = (s, n) => String(s ?? '').padEnd(n);

const clean = v => {
  const s = String(v ?? '').trim();
  return (s === '' || s === '-' || s.toLowerCase() === 'null') ? null : s;
};

/* Zoho writes dates differently between forms — the leave form uses
 * dd/MM/yyyy, employee records have been seen as dd-MMM-yyyy. Guessing one and
 * silently dropping the other would leave a joining date empty, which reads as
 * "no joining date" rather than "we could not read it". */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const toDate = (v) => {
  const s = clean(v);
  if (!s) return null;
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;   // undefined means "could not read", null means "empty"
};

/* The allowlist. Zoho field → our column, and how to read it.
 *
 * Written out rather than derived, because a mapping that walks the record and
 * matches names would start writing to a column the day Zoho adds a field that
 * happens to be called something familiar. */
const FIELDS = [
  ['FirstName',           'first_name',          clean],
  ['LastName',            'last_name',           clean],
  ['Nick_Name',           'nick_name',           clean],
  ['EmailID',             'official_email',      clean],
  ['Other_Email',         'personal_email',      clean],
  ['Mobile',              'phone',               clean],
  ['Work_phone',          'work_phone',          clean],
  ['Extension',           'extension',           clean],
  ['Date_of_birth',       'date_of_birth',       toDate],
  ['Gender',              'gender',              clean],
  ['Marital_status',      'marital_status',      clean],
  ['Present_Address',     'current_address',     clean],
  ['Permanent_Address',   'permanent_address',   clean],
  ['Pan_Number',          'pan_number',          clean],
  ['Aadhaar_Number',      'aadhaar_number',      clean],
  ['UAN_Number',          'uan_number',          clean],
  ['Department',          'department',          clean],
  ['Designation',         'designation',         clean],
  ['Employee_type',       'employee_type',       clean],
  ['Work_location',       'work_location',       clean],
  ['Source_of_hire',      'source_of_hire',      clean],
  ['AboutMe',             'about_me',            clean],
  ['Expertise',           'expertise',           clean],
  ['total_experience',    'total_experience',    clean],
  ['Dateofjoining',       'joining_date',        toDate],
  ['Dateofjoining',       'date_of_joining',     toDate],   // both columns exist
  ['Dateofexit',          'exit_date',           toDate],
];

// Never written, however tempting the field name looks.
const FORBIDDEN = new Set([
  'id', 'employee_id', 'password', 'email', 'role', 'allow_access',
  'login_enabled', 'login_disabled_at', 'status', 'mfa_enabled', 'mfa_secret',
  'mfa_backup_codes', 'tokens_revoked_at', 'deleted_at',
]);
for (const [, col] of FIELDS) {
  if (FORBIDDEN.has(col)) throw new Error(`${col} is on the allowlist and must not be`);
}

async function zohoEmployee(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'EmployeeID', searchOperator: 'Is', searchText: code,
  }));
  const json = await zohoApi(`forms/employee/getRecords?sIndex=1&limit=5&searchParams=${search}`);
  const rows = json?.response?.result;
  if (!Array.isArray(rows)) return null;
  for (const w of rows) {
    const rec = Object.values(w)[0]?.[0];
    if (rec && String(rec.EmployeeID ?? '').trim() === code) return rec;
  }
  return null;
}

/* Zoho names a manager as "Firstname Lastname CODE", and carries their mail id
 * beside it. Email is the reliable key; the code embedded in the string is the
 * fallback. Anything else stays as it is — writing null would say this person
 * reports to nobody, which is a different claim from "we could not tell". */
async function resolveManager(nameStr, mailId) {
  const email = clean(mailId);
  if (email) {
    const r = (await pool.query(
      `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM employees
        WHERE deleted_at IS NULL AND (LOWER(email) = LOWER($1) OR LOWER(official_email) = LOWER($1))
        LIMIT 1`, [email])).rows[0];
    if (r) return { id: r.id, how: `by email ${email}`, name: r.name };
  }
  const code = (String(nameStr ?? '').match(/\b([A-Z]{2,}\d{4,})\b/) || [])[1];
  if (code) {
    const r = (await pool.query(
      `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM employees
        WHERE deleted_at IS NULL AND employee_id = $1 LIMIT 1`, [code])).rows[0];
    if (r) return { id: r.id, how: `by code ${code}`, name: r.name };
  }
  return { id: undefined, how: clean(nameStr) ? `no match for "${clean(nameStr)}"` : 'not set in Zoho' };
}

/* Exported so the parsing can be tested against real Zoho strings without a
 * database or a network. Requiring this file used to run the whole import, so
 * a test had to lift the functions out of the source text with string
 * surgery — which broke the moment a helper referenced a constant beside it. */
module.exports = { toDate, clean, FIELDS, FORBIDDEN };

if (require.main !== module) return;

(async () => {
  if (!CODES.length) {
    console.log('\n  usage: node zoho_profile.js <CODE[,CODE...]> [--apply]\n');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Zoho employee profiles — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${CODES.join(', ')}`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (!(await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t) {
    console.log('  import_backups does not exist, so nothing here could be undone.\n');
    console.log('  Run: docker compose exec backend node migrate_import_backup.js\n');
    await pool.end();
    process.exit(1);
  }

  const plan = [];
  for (const code of CODES) {
    const mine = (await pool.query(
      `SELECT * FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code])).rows[0];
    if (!mine) { console.log(`  ${code} is not in this database — skipped.\n`); continue; }

    const theirs = await zohoEmployee(code).catch(e => {
      console.log(`  ${code}: could not read Zoho — ${String(e.message).slice(0, 120)}`); return null;
    });
    if (!theirs) { console.log(`  ${code} has no employee record in Zoho — skipped.\n`); continue; }

    const changes = [];
    const unreadable = [];
    for (const [zField, col, read] of FIELDS) {
      const value = read(theirs[zField]);
      if (value === undefined) { unreadable.push([zField, col, theirs[zField]]); continue; }
      if (value === null) continue;              // Zoho has nothing; keep ours
      const current = mine[col] instanceof Date
        ? mine[col].toISOString().slice(0, 10)
        : (mine[col] === null || mine[col] === undefined ? null : String(mine[col]));
      const currentCmp = current === null ? null : current.slice(0, value.length === 10 ? 10 : current.length);
      if (String(currentCmp ?? '') !== String(value)) changes.push({ col, from: current, to: value });
    }

    const mgr = await resolveManager(theirs.Reporting_To, theirs['Reporting_To.MailID']);
    const mgr2 = await resolveManager(theirs.Second_Reporting_To, null);
    if (mgr.id && mgr.id !== mine.reporting_manager_id) {
      changes.push({ col: 'reporting_manager_id', from: mine.reporting_manager_id, to: mgr.id, note: `${mgr.name} — ${mgr.how}` });
    }
    if (mgr2.id && mgr2.id !== mine.secondary_manager_id) {
      changes.push({ col: 'secondary_manager_id', from: mine.secondary_manager_id, to: mgr2.id, note: `${mgr2.name} — ${mgr2.how}` });
    }

    plan.push({ code, mine, theirs, changes, unreadable, mgr, mgr2 });
  }

  for (const p of plan) {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${p.mine.first_name} ${p.mine.last_name}   ${p.code}`);
    console.log('──────────────────────────────────────────────────────────\n');

    if (!p.changes.length) {
      console.log('    Nothing differs. Zoho and this system already agree.\n');
    } else {
      console.log(`    ${p.changes.length} field(s) would change:\n`);
      console.log(`      ${pad('column', 24)}${pad('here now', 26)}from Zoho`);
      for (const c of p.changes) {
        console.log(`      ${pad(c.col, 24)}${pad(c.from ?? '(empty)', 26)}${c.to}`
          + `${c.note ? `   ${c.note}` : ''}`);
      }
      console.log('');
    }

    if (p.unreadable.length) {
      console.log('    Zoho sent a value these could not be read from — left alone:\n');
      for (const [zf, col, raw] of p.unreadable) {
        console.log(`      ${pad(zf, 22)}→ ${pad(col, 20)}${JSON.stringify(raw)}`);
      }
      console.log('');
    }

    for (const [label, r] of [['reporting manager', p.mgr], ['second manager', p.mgr2]]) {
      if (r.id === undefined && r.how !== 'not set in Zoho') {
        console.log(`    ${label}: ${r.how} — left as it is, because null would`);
        console.log('    mean "reports to nobody" rather than "we could not tell"\n');
      }
    }
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const batch = `profile-${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let touched = 0;
    for (const p of plan) {
      if (!p.changes.length) continue;

      // The whole row, before anything is changed to it.
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         SELECT $1, 'employees', $2, to_jsonb(e) FROM employees e WHERE e.id = $2`,
        [batch, p.mine.id]);
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         VALUES ($1, '_manifest', $2, $3::jsonb)`,
        [batch, p.mine.id, JSON.stringify({
          code: p.code, name: `${p.mine.first_name} ${p.mine.last_name}`,
          tables: ['employees'], fields: p.changes.map(c => c.col),
        })]);

      const sets = p.changes.map((c, i) => `${c.col} = $${i + 2}`).join(', ');
      await client.query(
        `UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1`,
        [p.mine.id, ...p.changes.map(c => c.to)]);
      console.log(`    ${pad(p.code, 16)}${p.changes.length} field(s) updated`);
      touched++;
    }
    await client.query('COMMIT');

    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ${touched} profile(s) updated.`);
    if (touched) console.log(`\n  To undo:  node restore_import_backup.js ${batch} --apply`);
    console.log('══════════════════════════════════════════════════════════\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}`);
    console.log('  Nothing was changed.\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
