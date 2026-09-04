/* ── Where does the .75 actually come from? ──────────────────────────────────
 *  "1 casual leave a month is 12 a year — why does the balance show 12.75?"
 *  is the right question, and up to now the honest answer has been "the CSV
 *  says so" — which explains WHERE the number was written, not why it is
 *  what it is.
 *
 *  This traces it properly, from the one Zoho source that IS reachable with
 *  the current token: the leave module itself (zoho_restage.js already
 *  proved forms/leave/getRecords answers). It pulls every casual leave
 *  record this person has ever had in Zoho — not just this year, every year
 *  on file — and lays it beside what "1/month, resets every January" would
 *  predict, so the gap between prediction and reality has an actual size
 *  instead of a shrug.
 *
 *  Three things commonly produce a fraction that a flat monthly accrual
 *  does not, and this can tell them apart:
 *
 *    CARRY-FORWARD    a balance left over from a prior year, added to this
 *                      year's fresh grant rather than lapsing on 1 January.
 *    A HALF/QUARTER DAY  taken at some point, which a monthly count of
 *                      whole days never predicts.
 *    A MANUAL ADJUSTMENT  HR crediting or debiting the balance directly in
 *                      Zoho, outside any leave application — invisible to
 *                      the leave ledger entirely, and the only one of the
 *                      three this script cannot see or rule out.
 *
 *  Read-only. GET requests to Zoho only.
 *
 *    docker compose exec backend node zoho_trace_casual_balance.js ANXT2300104
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

const CODE = process.argv[2];
if (!CODE) { console.error('Usage: node zoho_trace_casual_balance.js <EMPLOYEE_CODE>'); process.exit(1); }

const LEAVE_TYPES = {
  'permission': 'permission', 'casual leave': 'casual', 'casual': 'casual',
  'sick leave': 'sick', 'sick': 'sick', 'earned leave': 'earned',
  'privilege leave': 'earned', 'loss of pay': 'unpaid', 'lop': 'unpaid',
  'unpaid leave': 'unpaid', 'leave without pay': 'unpaid', 'lwp': 'unpaid',
  'comp off': 'comp_off', 'compensatory off': 'comp_off',
};
const normaliseLeaveType = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '').trim().toLowerCase();

const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const leaveEnvelope = (json) => {
  const resp = json?.response;
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return 'no response object';
  if ('result' in resp) return null;
  if ('errors' in resp || 'error' in resp || 'message' in resp) {
    return String(resp.message || JSON.stringify(resp.error || resp.errors || {})).slice(0, 80);
  }
  return 'no result and no error';
};

/* Every leave record for this one code, every year on file — not scoped to
 * 2026. The balance being explained is 2026's, but a carry-forward can only
 * be seen by looking at what was left over from before it. */
async function allLeaveFor(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 5000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const why = leaveEnvelope(json);
    if (why) throw new Error(`Zoho refused the read: ${why}`);
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const rec = Object.values(w)[0]?.[0]; if (rec) out.push(rec); }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  console.log(`\n=== Tracing ${CODE}'s casual leave balance ===\n`);

  const who = await pool.query(
    `SELECT first_name || ' ' || COALESCE(last_name,'') AS name, joining_date::text AS joining
       FROM employees WHERE employee_id = $1`, [CODE]);
  if (!who.rows.length) { console.log(`No employee with code ${CODE} here.`); await pool.end(); return; }
  console.log(`  ${who.rows[0].name.trim()}, joined ${who.rows[0].joining}\n`);

  const stored = await pool.query(
    `SELECT lb.available, lb.booked, lb.year
       FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id = lt.id
      WHERE lb.employee_id = (SELECT id FROM employees WHERE employee_id = $1) AND lt.code = 'casual'
      ORDER BY lb.year DESC LIMIT 1`, [CODE]);
  const cur = stored.rows[0];
  console.log(`  Stored in leave_balances: available=${cur?.available ?? '(none)'} booked=${cur?.booked ?? '(none)'} for ${cur?.year ?? '-'}\n`);

  console.log('  Pulling every leave record Zoho has for this code...\n');
  const records = await allLeaveFor(CODE);
  const casual = records
    .filter(r => LEAVE_TYPES[normaliseLeaveType(r.Leavetype)] === 'casual')
    .map(r => ({
      from: fromZohoDate(r.From), to: fromZohoDate(r.To) || fromZohoDate(r.From),
      days: parseFloat(r.Daystaken) || 0,
      status: String(r.ApprovalStatus || '').trim().toLowerCase(),
      unit: r.Unit || '',
    }))
    .sort((a, b) => (a.from || '').localeCompare(b.from || ''));

  console.log(`  ${casual.length} casual leave record(s) total, every year on file:\n`);
  const byYear = new Map();
  for (const c of casual) {
    const y = (c.from || '').slice(0, 4) || '?';
    if (!byYear.has(y)) byYear.set(y, { approved: 0, other: 0, rows: [] });
    const bucket = byYear.get(y);
    if (c.status === 'approved') bucket.approved += c.days; else bucket.other += c.days;
    bucket.rows.push(c);
  }

  for (const [year, b] of [...byYear.entries()].sort()) {
    console.log(`  ${year}: ${b.approved}d approved, ${b.other}d not approved (pending/rejected/cancelled)`);
    for (const r of b.rows) {
      console.log(`      ${r.from}${r.to !== r.from ? ' to ' + r.to : ''}   ${String(r.days).padStart(5)}d   ${r.status}`);
    }
  }

  const approved2026 = byYear.get('2026')?.approved || 0;
  console.log(`\n  2026 approved casual so far, from Zoho's own leave records: ${approved2026}d`);
  console.log(`  This system's leave table should show the same figure for 2026 —`);
  console.log(`  if it does not, the two disagree about what was actually taken.`);

  console.log('\n  If the policy really is a flat 1/month with no carry-forward:');
  console.log(`    12 granted for 2026, minus ${approved2026}d taken = ${12 - approved2026}d predicted.`);
  console.log(`    Stored balance says: ${cur?.available ?? '?'}d.`);
  const gap = cur ? Math.round((parseFloat(cur.available) - (12 - approved2026)) * 100) / 100 : null;
  if (gap !== null) {
    console.log(`    Gap: ${gap}d — ${gap === 0 ? 'exactly matches, no mystery' :
      gap > 0 ? 'the stored balance is HIGHER than a flat 12/year predicts' :
                'the stored balance is LOWER than a flat 12/year predicts'}.`);
    console.log('    If this gap is not explained by a half-day record above, it is either');
    console.log('    a carried-forward balance from before 2026 or a manual adjustment made');
    console.log('    directly in Zoho — the leave ledger has no record of either.');
  }

  await pool.end();
})().catch(async e => { console.error('\nFAILED:', e.message); try { await pool.end(); } catch {} process.exit(1); });
