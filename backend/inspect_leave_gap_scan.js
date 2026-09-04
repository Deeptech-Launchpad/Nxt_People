#!/usr/bin/env node
/* How many employees have leave Zoho knows about that this system does not?
 *
 * READ ONLY. Nothing here writes.
 *
 * Confirmed for two people so far, by hand: Shivanie was missing a real
 * 27 Aug casual leave day, Manikandan was missing a real 29 Aug day
 * entirely — both taken through Zoho, neither making it into this
 * system's own `leaves` table. This checks everyone at once instead of
 * one report at a time.
 *
 * One full-org sweep of Zoho's leave form (the same technique
 * zoho_restage.js already uses and already proved reaches all 6,213
 * records), summed by employee and type for this year, laid beside the
 * same sum from this system's own `leaves` table. Where the two totals
 * don't agree — beyond a small rounding tolerance, since half-day
 * apportionment can differ by a fraction — is where a real record is
 * missing (or, less often, has drifted for some other reason).
 *
 *   node inspect_leave_gap_scan.js            this year
 *   node inspect_leave_gap_scan.js 2025       a specific year
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
const TOLERANCE = 0.05; // half-day apportionment can legitimately differ by a hair

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

/* Every leave record Zoho has, this year, approved, whatever employee it
 * belongs to — one sweep rather than one call per person, the same reason
 * zoho_restage.js's own sweep exists. */
async function zohoSweepThisYear() {
  const out = [];
  for (let i = 1; i <= 40000; i += 200) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200`));
    if (leaveEnvelope(json)) throw new Error(`Zoho refused the unfiltered sweep at record ${i}`);
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (!m) continue;
      if (String(rec.ApprovalStatus || '').trim().toLowerCase() !== 'approved') continue;
      const from = fromZohoDate(rec.From);
      if (!from || Number(from.slice(0, 4)) !== YEAR) continue;
      const type = LEAVE_TYPES[normaliseLeaveType(rec.Leavetype)];
      if (!type) continue;
      out.push({ code: m[1], type, days: parseFloat(rec.Daystaken) || 0, from });
    }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  console.log(`\n=== Leave gap scan, ${YEAR} ===\n`);
  console.log('Sweeping Zoho for every approved leave record this year (one pass, all employees)...');
  const zohoRows = await zohoSweepThisYear();
  console.log(`  ${zohoRows.length} approved record(s) from Zoho.\n`);

  // Sum by code+type, in whichever unit that type actually uses — days for
  // everything except permission, which is hours.
  const zohoTotals = new Map(); // "code|type" -> total
  for (const r of zohoRows) {
    const key = `${r.code}|${r.type}`;
    zohoTotals.set(key, round2((zohoTotals.get(key) || 0) + r.days));
  }

  console.log('Summing this system\'s own leaves table the same way...\n');
  const hereRes = await pool.query(
    `SELECT e.employee_id AS code, l.leave_type AS type,
            SUM(CASE WHEN l.leave_type = 'permission' THEN l.hours ELSE l.total_days END) AS total
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'approved' AND EXTRACT(YEAR FROM l.start_date) = $1
      GROUP BY e.employee_id, l.leave_type`,
    [YEAR]);
  const hereTotals = new Map(hereRes.rows.map(r => [`${r.code}|${r.type}`, round2(parseFloat(r.total) || 0)]));

  // Every key either side has, so a person with Zoho records but nothing
  // here at all still surfaces, and vice versa.
  const allKeys = new Set([...zohoTotals.keys(), ...hereTotals.keys()]);

  const gaps = [];
  for (const key of allKeys) {
    const zoho = zohoTotals.get(key) || 0;
    const here = hereTotals.get(key) || 0;
    if (Math.abs(zoho - here) > TOLERANCE) {
      const [code, type] = key.split('|');
      gaps.push({ code, type, zoho, here, gap: round2(zoho - here) });
    }
  }
  gaps.sort((a, b) => a.code.localeCompare(b.code) || a.type.localeCompare(b.type));

  const names = new Map((await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name FROM employees`
  )).rows.map(r => [r.code, r.name.trim()]));

  const affectedEmployees = new Set(gaps.map(g => g.code));

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${affectedEmployees.size} employee(s) with at least one type where Zoho and this`);
  console.log(`  system disagree, ${gaps.length} employee+type combination(s) total.`);
  console.log('══════════════════════════════════════════════════════════\n');

  const byType = {};
  for (const g of gaps) byType[g.type] = round2((byType[g.type] || 0) + g.gap);
  console.log('Missing (Zoho has more than here), summed by type:');
  for (const [type, total] of Object.entries(byType)) {
    console.log(`  ${type.padEnd(12)} ${total > 0 ? '+' : ''}${total}${type === 'permission' ? 'h' : 'd'} net`);
  }

  console.log('\nEvery affected employee+type, one line each:\n');
  for (const g of gaps) {
    const unit = g.type === 'permission' ? 'h' : 'd';
    const sign = g.gap > 0 ? 'MISSING HERE' : 'EXTRA HERE, not in Zoho';
    console.log(`  ${g.code.padEnd(14)} ${(names.get(g.code) || '').padEnd(26)} ${g.type.padEnd(11)}`
      + ` Zoho=${g.zoho}${unit}  here=${g.here}${unit}  ${sign} (${Math.abs(g.gap)}${unit})`);
  }

  if (!gaps.length) console.log('  none — every employee+type total matches within rounding.');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
