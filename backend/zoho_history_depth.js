/* ── How far back does Zoho actually go? ────────────────────────────────────
 *  Eight months were imported because eight months were asked for. Before the
 *  cutover somebody has to decide whether that is the whole history or a
 *  fraction of it, and that decision needs a number rather than an assumption.
 *
 *  So this walks backwards a year at a time for the longest-serving people and
 *  reports what Zoho answers with: how many days it returns, and how many of
 *  them somebody actually punched. It stops when a year comes back empty, and
 *  then checks the year before that too — a single quiet year in the middle of
 *  a record is not the same as the beginning of one, and stopping at the first
 *  gap would report a career as starting years after it did.
 *
 *  Leave is asked separately, because leave and attendance do not necessarily
 *  begin on the same day.
 *
 *  Read-only in both directions, and it paces itself.
 *
 *    docker compose exec backend node zoho_history_depth.js
 *    docker compose exec backend node zoho_history_depth.js ANXT220001,ANXT220002
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

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const THIS_YEAR = new Date().getFullYear();
const FLOOR = THIS_YEAR - 12;          // far enough back for any real company

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

async function patiently(fn) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      const c = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (c !== '429' && c !== '503') throw err;
      await sleep(attempt * 4000);
    }
  }
  throw last;
}

const yearOfAttendance = (code, year) => patiently(async () => {
  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(`${year}-01-01`))}`
    + `&edate=${encodeURIComponent(zohoDMY(`${year}-12-31`))}&dateFormat=dd-MM-yyyy`);
  const body = json?.response?.result ?? json?.response ?? json;
  if (!body || typeof body !== 'object' || 'error' in body || 'errors' in body) return null;
  const days = Object.entries(body).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  const punched = days.filter(([, v]) => v?.FirstIn && v.FirstIn !== '-');
  return {
    days: days.length,
    punched: punched.length,
    first: punched.length ? punched.map(([d]) => d).sort()[0] : null,
  };
});

const allLeave = (code) => patiently(async () => {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const rows = json?.response?.result;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const r = Object.values(w)[0]?.[0]; if (r) out.push(r); }
    if (rows.length < 200) break;
  }
  // Whole-word match: Employee_ID reads "Balaji D ANXT2600149", and Contains
  // alone lets a short code match somebody else's longer one.
  const mine = out.filter(r => String(r.Employee_ID ?? '').split(/\s+/).includes(code));
  const dates = mine.map(r => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(r.From || ''));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }).filter(Boolean).sort();
  return { count: mine.length, first: dates[0] || null, last: dates[dates.length - 1] || null };
});

(async () => {
  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  // The longest-serving people, because they are the ones whose history could
  // be deepest. Asking a 2026 joiner how far Zoho goes back tells you nothing.
  const people = CODES.length
    ? (await pool.query(
        `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
                joining_date::date::text AS joined
           FROM employees WHERE employee_id = ANY($1) AND deleted_at IS NULL
          ORDER BY joining_date`, [CODES])).rows
    : (await pool.query(
        `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
                joining_date::date::text AS joined
           FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND joining_date IS NOT NULL
            AND COALESCE(employment_type, '') <> 'Employee Profile'
          ORDER BY joining_date LIMIT 5`)).rows;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  How far back Zoho goes — READ ONLY');
  console.log(`  ${people.length} of the longest-serving people`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  const earliest = [];
  for (const p of people) {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${p.name}   ${p.code}   joined ${p.joined || 'not recorded'}`);
    console.log('──────────────────────────────────────────────────────────\n');
    console.log(`    ${pad('year', 8)}${lpad('days', 7)}${lpad('punched', 9)}   first punch`);

    let quiet = 0, firstSeen = null;
    for (let y = THIS_YEAR; y >= FLOOR; y--) {
      let r = null;
      try { r = await yearOfAttendance(p.code, y); }
      catch (e) {
        console.log(`    ${pad(y, 8)}${lpad('—', 7)}${lpad('—', 9)}   ${String(e.message).slice(0, 40)}`);
        break;
      }
      await sleep(600);

      if (!r) { console.log(`    ${pad(y, 8)}${lpad('—', 7)}${lpad('—', 9)}   Zoho refused this year`); break; }
      console.log(`    ${pad(y, 8)}${lpad(r.days, 7)}${lpad(r.punched, 9)}   ${r.first || ''}`);
      if (r.punched > 0) { firstSeen = r.first; quiet = 0; }
      else if (++quiet >= 2) {
        // Two empty years in a row is the end of the record, not a quiet spell.
        console.log(`    ${pad('', 8)}${lpad('', 7)}${lpad('', 9)}   two empty years — stopping`);
        break;
      }
    }

    let lv = null;
    try { lv = await allLeave(p.code); } catch { /* reported below */ }
    await sleep(600);
    console.log(`\n    leave: ${lv ? `${lv.count} record(s), ${lv.first} to ${lv.last}` : 'could not read'}`);
    console.log(`    earliest punch found: ${firstSeen || 'none'}\n`);
    earliest.push({ ...p, firstSeen, leaveFirst: lv?.first || null });
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('  What this means for the range to import');
  console.log('──────────────────────────────────────────────────────────\n');
  const punches = earliest.map(e => e.firstSeen).filter(Boolean).sort();
  const leaves = earliest.map(e => e.leaveFirst).filter(Boolean).sort();
  const oldest = [punches[0], leaves[0]].filter(Boolean).sort()[0];

  for (const e of earliest) {
    console.log(`    ${pad(e.code, 14)}${pad(e.name.slice(0, 24), 26)}`
      + `joined ${pad(e.joined, 12)}punches from ${pad(e.firstSeen || '—', 12)}`
      + `leave from ${e.leaveFirst || '—'}`);
  }

  console.log(`\n  The oldest record found is ${oldest || 'none'}.`);
  if (oldest) {
    console.log(`  Importing everything would mean a range starting ${oldest.slice(0, 4)}-01-01,`);
    console.log(`  against the ${THIS_YEAR}-01-01 that was used. That is`
      + ` ${THIS_YEAR - Number(oldest.slice(0, 4))} extra year(s).`);
  }
  console.log('\n  This asked only the longest-serving people. Somebody who joined');
  console.log('  earlier and left would have more, and is not in this sample.\n');

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
