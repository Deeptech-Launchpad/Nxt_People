/* ── Who does Zoho know that this system does not? ──────────────────────────
 *  Fifty-three people were imported. Zoho's employee form holds a hundred and
 *  fifty-two records, and the ones in between are the question nobody has put
 *  a number to: people who worked here and left.
 *
 *  Their history is only recoverable while Zoho exists, and it splits into two
 *  quite different problems:
 *
 *    somebody who IS in this system but is not active — a leaver with a
 *      record here. Their history can be imported today; the tooling already
 *      takes a list of codes and does not care about status.
 *
 *    somebody who is NOT in this system at all. Their history has nowhere to
 *      go. Importing it means creating an employee record first, which is a
 *      decision about what this system is for, not a technical step.
 *
 *  This counts both, names them, and says how much each has. It writes
 *  nothing — the point is to make the decision arithmetic rather than a guess.
 *
 *    docker compose exec backend node zoho_people_gap.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('this script is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const { zohoApi } = require('./utils/zoho');

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const clean = v => {
  const s = String(v ?? '').trim();
  return (s === '' || s === '-') ? null : s;
};
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
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

(async () => {
  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Who Zoho knows that this system does not — READ ONLY');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  // Every employee record Zoho holds, paged — a form that stops at two hundred
  // would quietly under-report exactly the people this exists to find.
  const zoho = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/employee/getRecords?sIndex=${i}&limit=200`);
    const rows = json?.response?.result;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const r = Object.values(w)[0]?.[0]; if (r) zoho.push(r); }
    if (rows.length < 200) break;
  }

  const ours = (await pool.query(
    `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            status, deleted_at IS NOT NULL AS deleted,
            exit_date::date::text AS exited
       FROM employees`)).rows;
  const byCode = new Map(ours.map(r => [String(r.code).trim(), r]));

  const active = [], inactive = [], missing = [];
  for (const z of zoho) {
    const code = clean(z.EmployeeID);
    if (!code) continue;
    const name = `${clean(z.FirstName) || ''} ${clean(z.LastName) || ''}`.trim();
    const rec = {
      code, name,
      joined: toDate(z.Dateofjoining),
      exited: toDate(z.Dateofexit),
      zohoStatus: clean(z.Employeestatus) || '—',
    };
    const mine = byCode.get(code);
    if (!mine) missing.push(rec);
    else if (mine.status === 'active' && !mine.deleted) active.push({ ...rec, mine });
    else inactive.push({ ...rec, mine });
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  ${zoho.length} employee record(s) in Zoho`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${lpad(active.length, 4)}  are active here          — imported`);
  console.log(`    ${lpad(inactive.length, 4)}  are here but NOT active — a record exists, history can be imported`);
  console.log(`    ${lpad(missing.length, 4)}  are not here at all      — nowhere to put their history\n`);

  if (inactive.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Here but not active — importable today, nothing to create');
    console.log('──────────────────────────────────────────────────────────\n');
    console.log(`  ${pad('code', 14)}${pad('name', 26)}${pad('here', 12)}${pad('joined', 12)}left`);
    for (const r of inactive) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}`
        + `${pad(r.mine.deleted ? 'deleted' : r.mine.status, 12)}`
        + `${pad(r.joined || '—', 12)}${r.exited || r.mine.exited || '—'}`);
    }
    console.log('');
    console.log(`  node zoho_restage.js "${inactive.map(r => r.code).join(',')}" 2022-01-01 2026-08-31 --apply\n`);
  }

  if (missing.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Not in this system at all');
    console.log('──────────────────────────────────────────────────────────\n');
    console.log('  Their history cannot be imported without first creating an');
    console.log('  employee record for each. That is a decision about what this');
    console.log('  system is for — an archive of everyone who ever worked here,');
    console.log('  or a record of the people who do now.\n');
    console.log(`  ${pad('code', 14)}${pad('name', 26)}${pad('zoho status', 14)}${pad('joined', 12)}left`);
    for (const r of missing) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}`
        + `${pad(r.zohoStatus.slice(0, 12), 14)}${pad(r.joined || '—', 12)}${r.exited || '—'}`);
    }
    console.log('');
  }

  // Codes we hold that Zoho has never heard of — the mirror image, and worth
  // knowing before anybody assumes the two systems describe the same people.
  const zohoCodes = new Set(zoho.map(z => clean(z.EmployeeID)).filter(Boolean));
  const onlyHere = ours.filter(r => !r.deleted && !zohoCodes.has(String(r.code).trim()));
  if (onlyHere.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${onlyHere.length} here that Zoho does not have`);
    console.log('──────────────────────────────────────────────────────────\n');
    for (const r of onlyHere) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}${r.status}`);
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
