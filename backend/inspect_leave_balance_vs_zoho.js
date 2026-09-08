#!/usr/bin/env node
/* Do the available and booked leave figures here agree with Zoho?
 *
 * READ ONLY. Nothing here writes.
 *
 * Half of this question can be answered from the API and half cannot, so
 * this is explicit about which is which rather than implying it checked
 * everything:
 *
 *   BOOKED — checkable, and checked here twice over. What leave_balances
 *   says was booked, against what this system's own leaves table actually
 *   holds, against what Zoho's leave records hold for the same year. All
 *   three should agree. Where the stored `booked` is lower than the leave
 *   actually taken, that is the Customize Balance fingerprint
 *   inspect_leave_balance_audit.js already documented: writing a balance by
 *   hand sets booked to 0 and never updates it again, and from that moment
 *   the person's own leave stops counting against their balance.
 *
 *   AVAILABLE — NOT checkable against Zoho. Every balance-shaped Zoho
 *   endpoint refuses this token (zoho_balance_scope_check.js proved that:
 *   leave/getUserRecord, forms/P_LeaveBalance, forms/leavetype all 401/403,
 *   and the form list has no balance form at all). The only way balances
 *   ever arrived was a manual Customize Balance CSV through
 *   import_zoho_balances.js. So the stored figure is printed here to be read
 *   against Zoho's screen by eye, and nothing pretends otherwise.
 *
 *   node inspect_leave_balance_vs_zoho.js           this year
 *   node inspect_leave_balance_vs_zoho.js 2025      a specific year
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const YEAR = parseInt(process.argv[2], 10) || new Date().getFullYear();
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const TOLERANCE = 0.05;
const pad = (s, n) => String(s ?? '').padEnd(n);
// availableFor() returns null for these two, so leave_balances is never
// consulted for them and a booked figure of 0 carries no consequence.
const NOT_ENFORCED_BY_BALANCE = new Set(['permission', 'unpaid']);

const LEAVE_TYPES = {
  'permission': 'permission', 'casual leave': 'casual', 'casual': 'casual',
  'sick leave': 'sick', 'sick': 'sick', 'earned leave': 'earned',
  'privilege leave': 'earned', 'loss of pay': 'unpaid', 'lop': 'unpaid',
  'unpaid leave': 'unpaid', 'leave without pay': 'unpaid', 'lwp': 'unpaid',
  'comp off': 'comp_off', 'compensatory off': 'comp_off',
};
const normalise = (raw) => String(raw ?? '').replace(/\s*(19|20)\d{2}\s*$/, '').trim().toLowerCase();
const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function patiently(fn) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (code !== '429' && code !== '503' && code !== '502') throw err;
      await sleep(attempt * 5000);
    }
  }
  throw last;
}

async function zohoLeaveSweep() {
  const out = [];
  for (let i = 1; i <= 40000; i += 200) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200`));
    const resp = json?.response;
    if (!resp || typeof resp !== 'object' || !('result' in resp)) throw new Error(`Zoho refused the sweep at ${i}`);
    const rows = resp.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (!m) continue;
      if (String(rec.ApprovalStatus || '').trim().toLowerCase() !== 'approved') continue;
      const from = fromZohoDate(rec.From);
      if (!from || Number(from.slice(0, 4)) !== YEAR) continue;
      const type = LEAVE_TYPES[normalise(rec.Leavetype)];
      if (!type) continue;
      out.push({ code: m[1], type, days: parseFloat(rec.Daystaken) || 0 });
    }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  console.log(`\n=== Leave balance: available and booked, ${YEAR} ===\n`);
  console.log('Sweeping Zoho leave records (one pass, all employees)...');
  const zohoRows = await zohoLeaveSweep();
  const zohoTaken = new Map(); // code|type -> days
  for (const r of zohoRows) {
    const k = `${r.code}|${r.type}`;
    zohoTaken.set(k, round2((zohoTaken.get(k) || 0) + r.days));
  }
  console.log(`  ${zohoRows.length} approved record(s) in ${YEAR}.\n`);

  // What this system's own leave records add up to.
  const hereTaken = new Map();
  for (const r of (await pool.query(
    `SELECT e.employee_id AS code, l.leave_type AS type,
            SUM(CASE WHEN l.leave_type = 'permission' THEN l.hours ELSE l.total_days END) AS total
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'approved' AND EXTRACT(YEAR FROM l.start_date) = $1
      GROUP BY e.employee_id, l.leave_type`, [YEAR])).rows) {
    hereTaken.set(`${r.code}|${r.type}`, round2(parseFloat(r.total) || 0));
  }

  // What the balance table claims.
  const stored = new Map(); // code|type -> { available, booked }
  for (const r of (await pool.query(
    `SELECT e.employee_id AS code, lt.code AS type,
            lb.available::float8 AS available, lb.booked::float8 AS booked
       FROM leave_balances lb
       JOIN employees e ON e.id = lb.employee_id
       JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.year = $1`, [YEAR])).rows) {
    stored.set(`${r.code}|${r.type}`, { available: round2(r.available), booked: round2(r.booked) });
  }

  const names = new Map((await pool.query(
    `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name
       FROM employees WHERE employee_id ~ '^ANXT' AND status = 'active'`)).rows.map(r => [r.code, r.name]));

  const keys = new Set([...zohoTaken.keys(), ...hereTaken.keys(), ...stored.keys()]
    .filter(k => names.has(k.split('|')[0])));

  const takenGaps = [], bookedGaps = [];
  for (const k of keys) {
    const [code, type] = k.split('|');
    const z = zohoTaken.get(k) || 0;
    const h = hereTaken.get(k) || 0;
    const s = stored.get(k);
    if (Math.abs(z - h) > TOLERANCE) takenGaps.push({ code, type, zoho: z, here: h });
    if (s && Math.abs(s.booked - h) > TOLERANCE) bookedGaps.push({ code, type, booked: s.booked, taken: h, available: s.available });
  }
  const sortKey = (a, b) => a.code.localeCompare(b.code) || a.type.localeCompare(b.type);
  takenGaps.sort(sortKey); bookedGaps.sort(sortKey);

  console.log('══════════════════════════════════════════════════════════');
  console.log('  1. Leave TAKEN — Zoho records vs this system\'s records');
  console.log('══════════════════════════════════════════════════════════\n');
  for (const g of takenGaps) {
    const u = g.type === 'permission' ? 'h' : 'd';
    console.log(`  ${pad(g.code, 14)}${pad(names.get(g.code) || '', 26)}${pad(g.type, 11)}`
      + `Zoho=${g.zoho}${u}  here=${g.here}${u}  ${g.zoho > g.here ? 'MISSING HERE' : 'extra here'}`);
  }
  if (!takenGaps.length) console.log('  none — every employee+type total matches Zoho within rounding.');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  2. BOOKED figure vs leave actually taken (both from here)');
  console.log('══════════════════════════════════════════════════════════\n');
  /* This section used to warn that a low `booked` let people re-book leave
   * they had already used. That was checked afterwards and is NOT true for
   * the two types it actually fires on: availableFor() in utils/leaveBalance.js
   * returns null for BOTH permission and unpaid by design — permission is
   * hours against a monthly cap enforced elsewhere, and unpaid has no ceiling
   * at all — so neither reads leave_balances and `booked` is not the
   * enforcement path for them. The warning stays only for the types that DO
   * read that table. */
  console.log('  For casual, sick, earned and comp-off, booked lower than taken means');
  console.log('  the stored balance stopped counting that person\'s leave.\n');
  console.log('  For PERMISSION and UNPAID it means nothing: availableFor() returns');
  console.log('  null for both by design, so leave_balances is not consulted and');
  console.log('  booked=0 on those rows is expected, not a fault.\n');
  for (const g of bookedGaps) {
    const u = g.type === 'permission' ? 'h' : 'd';
    console.log(`  ${pad(g.code, 14)}${pad(names.get(g.code) || '', 26)}${pad(g.type, 11)}`
      + `booked=${g.booked}${u}  actually taken=${g.taken}${u}  available shows ${g.available}${u}`
      + `${g.booked < g.taken && !NOT_ENFORCED_BY_BALANCE.has(g.type) ? '   <-- under-counted' : ''}`);
  }
  if (!bookedGaps.length) console.log('  none — every stored booked figure matches the leave on file.');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  3. AVAILABLE — cannot be checked against Zoho');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  Zoho refuses every balance endpoint on this token, and its form');
  console.log('  list has no balance form, so there is nothing to compare against.');
  console.log('  These are the figures held here, to read against Zoho\'s');
  console.log('  Customize Balance screen by eye. To bring Zoho\'s across, export');
  console.log('  that screen to CSV and run import_zoho_balances.js.\n');

  const byEmp = new Map();
  for (const [k, v] of stored) {
    const [code, type] = k.split('|');
    if (!names.has(code)) continue;
    if (!byEmp.has(code)) byEmp.set(code, []);
    byEmp.get(code).push(`${type}=${v.available}`);
  }
  for (const code of [...byEmp.keys()].sort()) {
    console.log(`  ${pad(code, 14)}${pad(names.get(code) || '', 26)}${byEmp.get(code).sort().join('  ')}`);
  }
  const noRow = [...names.keys()].filter(c => !byEmp.has(c)).sort();
  if (noRow.length) {
    console.log(`\n  ${noRow.length} active employee(s) have NO leave_balances row for ${YEAR} at all,`);
    console.log('  so their balance is computed from policy each time it is asked for:\n');
    console.log(`    ${noRow.join(', ')}`);
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
