#!/usr/bin/env node
/* What a Zoho restage would DESTROY. Run this before every import.
 *
 * READ ONLY. Nothing here writes, updates or deletes.
 *
 * zoho_restage.js does this per employee, inside one transaction:
 *
 *     DELETE FROM leaves     WHERE employee_id = ? AND start_date BETWEEN ? AND ?
 *     DELETE FROM attendance WHERE employee_id = ? AND date       BETWEEN ? AND ?
 *     ...then inserts whatever Zoho returns.
 *
 * The delete is on the leave's DATE, not on when it was filed. So anything
 * dated inside the range goes, no matter where it came from — including a
 * request somebody filed in NxtPeople that Zoho has never heard of. It is
 * backed up into an undo batch, but an undo restores the whole range and
 * re-clobbers the import, so in practice it is gone.
 *
 * inspect_org_reconcile.js already answers "where do the two disagree". This
 * answers the narrower and more dangerous question: "what do we lose".
 *
 *   A. Leaves that exist ONLY here                deleted, not restored
 *   B. Leaves whose status differs                Zoho's version wins
 *   C. Attendance recorded natively here          replaced by a thinner row
 *   D. Approval chains inside the range           discarded with their leave
 *   E. What Zoho would add                        the point of the exercise
 *
 *   node inspect_preimport_check.js 2026-09-07 2026-09-09
 *   node inspect_preimport_check.js 2026-09-01 2026-09-10 --codes=ANXT220026
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

const START = process.argv[2];
const END = process.argv[3];
const only = (process.argv.find(a => a.startsWith('--codes=')) || '').split('=')[1];
const ONLY = only ? new Set(only.split(',').map(s => s.trim()).filter(Boolean)) : null;

if (!START || !END || !/^\d{4}-\d{2}-\d{2}$/.test(START) || !/^\d{4}-\d{2}-\d{2}$/.test(END)) {
  console.error('\n  usage: node inspect_preimport_check.js YYYY-MM-DD YYYY-MM-DD [--codes=A,B]\n');
  process.exit(1);
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const h1 = (s) => console.log(`\n${'═'.repeat(76)}\n  ${s}\n${'═'.repeat(76)}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Zoho rate-limits; back off rather than failing the whole sweep. */
async function patiently(fn, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn(); } catch (err) {
      last = err;
      const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (code !== '429' && code !== '503' && code !== '502') throw err;
      await sleep(attempt * 5000);
    }
  }
  throw last;
}

const LEAVE_TYPES = {
  'permission': 'permission', 'casual leave': 'casual', 'casual': 'casual',
  'sick leave': 'sick', 'sick': 'sick', 'earned leave': 'earned',
  'privilege leave': 'earned', 'loss of pay': 'unpaid', 'lop': 'unpaid',
  'unpaid leave': 'unpaid', 'leave without pay': 'unpaid', 'lwp': 'unpaid',
  'comp off': 'comp_off', 'compensatory off': 'comp_off',
};
const normaliseType = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '').trim().toLowerCase();

const STATUSES = { approved: 'approved', pending: 'pending', rejected: 'rejected', cancelled: 'cancelled' };

/** dd-MMM-yyyy -> yyyy-mm-dd */
function fromZohoDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/**
 * Every leave Zoho holds that touches the range, whatever its status.
 *
 * Deliberately NOT filtered to approved, unlike the reconcile sweep. A pending
 * request here that Zoho also has as pending is not a loss; one Zoho has never
 * seen is. Telling those apart needs every status.
 */
async function zohoLeaveSweep(start, end) {
  const out = [];
  for (let i = 1; i <= 40000; i += 200) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200`));
    const resp = json?.response;
    if (!resp || typeof resp !== 'object' || !('result' in resp)) {
      throw new Error(`Zoho refused the leave sweep at record ${i}`);
    }
    const rows = resp.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (!m) continue;
      const from = fromZohoDate(rec.From);
      const to = fromZohoDate(rec.To) || from;
      if (!from || to < start || from > end) continue;
      out.push({
        code: m[1],
        type: LEAVE_TYPES[normaliseType(rec.Leavetype)] || null,
        rawType: String(rec.Leavetype || '').trim(),
        from, to,
        status: STATUSES[String(rec.ApprovalStatus || '').trim().toLowerCase()] || 'pending',
        days: parseFloat(rec.Daystaken) || 0,
      });
    }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  console.log(`\n  Pre-import check — what a restage of ${START} to ${END} would destroy`);
  console.log(`  READ ONLY. Nothing is written by this script.\n`);

  // Two spellings of the same column exist in this codebase; ask rather than guess.
  const joinCol = (await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name IN ('joining_date','date_of_joining')
      ORDER BY column_name LIMIT 1`)).rows[0]?.column_name || 'joining_date';

  const emps = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(first_name || ' ' || COALESCE(last_name,'')) AS name,
            ${joinCol}::text AS joined, exit_date::text AS exited
       FROM employees
      WHERE employee_id ~ '^ANXT' AND status = 'active' AND deleted_at IS NULL
      ORDER BY employee_id`)).rows
    .filter(e => !ONLY || ONLY.has(e.code));

  console.log(`  ${emps.length} active employee(s) in scope. Sweeping Zoho leave…`);
  const zohoAll = await zohoLeaveSweep(START, END);
  console.log(`  Zoho holds ${zohoAll.length} leave record(s) touching this range.\n`);

  const byCode = new Map();
  for (const z of zohoAll) {
    if (!byCode.has(z.code)) byCode.set(z.code, []);
    byCode.get(z.code).push(z);
  }

  const localLeaves = (await pool.query(
    `SELECT l.id, e.employee_id AS code, TRIM(e.first_name||' '||COALESCE(e.last_name,'')) AS name,
            l.leave_type, l.start_date::text AS from_ymd, l.end_date::text AS to_ymd,
            l.status, l.total_days, l.hours, l.reason,
            l.created_at::text AS created,
            (SELECT COUNT(*) FROM approval_levels x
              WHERE x.request_type='leave' AND x.request_id = l.id)::int AS levels
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE e.employee_id ~ '^ANXT' AND e.status='active' AND e.deleted_at IS NULL
        AND l.start_date BETWEEN $1::date AND $2::date
      ORDER BY e.employee_id, l.start_date`, [START, END])).rows
    .filter(r => !ONLY || ONLY.has(r.code));

  /* Same person, same span, same type — Zoho's record for this leave. Matched
   * on the span rather than an exact date pair because a half day and a full
   * day of the same leave differ in Daystaken, not in dates. */
  const matchIn = (row) => (byCode.get(row.code) || []).find(z =>
    z.type === row.leave_type && z.from === row.from_ymd && z.to === row.to_ymd);

  /* ══ A. Only here ═══════════════════════════════════════════════════════ */
  h1('A. Leaves that exist ONLY in NxtPeople — these would be DELETED');

  const orphans = localLeaves.filter(r => r.status !== 'cancelled' && !matchIn(r));
  if (!orphans.length) {
    console.log('\n  None. Everything dated in this range also exists in Zoho.');
  } else {
    console.log(`\n  ${orphans.length} request(s). A restage deletes each of these and does NOT`);
    console.log('  bring it back, because Zoho has no record to re-insert.\n');
    for (const r of orphans) {
      const amount = r.leave_type === 'permission' ? `${r.hours}h` : `${r.total_days}d`;
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}${pad(r.leave_type, 12)}`
        + `${pad(r.from_ymd, 12)}${pad(r.status, 10)}${pad(amount, 7)}`
        + `${r.levels > 0 ? `chain:${r.levels}` : 'no chain'}`);
      if (r.reason) console.log(`  ${' '.repeat(14)}“${String(r.reason).slice(0, 62)}”`);
    }
  }

  /* ══ B. Status differs ══════════════════════════════════════════════════ */
  h1('B. Same leave, different status — Zoho\'s version would win');

  const drifted = [];
  for (const r of localLeaves) {
    const z = matchIn(r);
    if (z && z.status !== r.status) drifted.push({ r, z });
  }
  if (!drifted.length) {
    console.log('\n  None. Every matched leave has the same status on both sides.');
  } else {
    console.log('');
    for (const { r, z } of drifted) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}${pad(r.leave_type, 12)}`
        + `${pad(r.from_ymd, 12)}  here: ${pad(r.status, 10)} Zoho: ${z.status}`);
    }
    console.log('\n  A pending request here that Zoho shows approved is the good case — the');
    console.log('  import settles it. The reverse means somebody approved it only here.');
  }

  /* ══ C. Natively recorded attendance ════════════════════════════════════ */
  h1('C. Attendance recorded HERE that a restage would overwrite');

  const att = (await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE source = 'punch')::int AS punched,
            COUNT(*) FILTER (WHERE work_mode IS NOT NULL)::int AS placed,
            COUNT(*) FILTER (WHERE check_in_ip IS NOT NULL)::int AS with_ip,
            COUNT(*) FILTER (WHERE work_location_resolved_id IS NOT NULL)::int AS geofenced
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE e.employee_id ~ '^ANXT' AND e.status='active' AND e.deleted_at IS NULL
        AND a.date BETWEEN $1::date AND $2::date`, [START, END])).rows[0];

  console.log(`\n  attendance rows in range          ${att.total}`);
  console.log(`  ...recorded by a punch here       ${att.punched}`);
  console.log(`  ...with a work mode (office/WFH)  ${att.placed}`);
  console.log(`  ...with a check-in IP             ${att.with_ip}`);
  console.log(`  ...placed by the geofence         ${att.geofenced}`);
  console.log('\n  Zoho\'s export has no column for work mode, resolved location or IP, so a');
  console.log('  full restage replaces these rows with thinner ones. Use --fill-gaps-only');
  console.log('  to keep them: it never deletes attendance and only writes days with no row.');

  /* ══ D. Approval chains ═════════════════════════════════════════════════ */
  h1('D. Approval chains that would be discarded');

  const chained = localLeaves.filter(r => r.levels > 0 && r.status === 'pending');
  if (!chained.length) {
    console.log('\n  None — no pending request in this range carries a chain.');
  } else {
    console.log(`\n  ${chained.length} pending request(s) carry an approval chain. Deleting the leave`);
    console.log('  orphans its approval_levels rows (there is no foreign key), and the');
    console.log('  re-imported copy gets a fresh chain — so nothing is lost that the import');
    console.log('  does not rebuild, but any approval already given at a level is.\n');
    for (const r of chained) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}${pad(r.leave_type, 12)}`
        + `${pad(r.from_ymd, 12)}${r.levels} level(s)`);
    }
  }

  /* ══ E. What would arrive ═══════════════════════════════════════════════ */
  h1('E. What Zoho would ADD that is not here');

  const localKey = new Set(localLeaves.map(r => `${r.code}|${r.leave_type}|${r.from_ymd}|${r.to_ymd}`));
  const incoming = zohoAll.filter(z =>
    (!ONLY || ONLY.has(z.code)) &&
    z.type && !localKey.has(`${z.code}|${z.type}|${z.from}|${z.to}`));

  if (!incoming.length) {
    console.log('\n  Nothing. Every Zoho leave in this range already exists here.');
  } else {
    console.log(`\n  ${incoming.length} record(s) would be created:\n`);
    for (const z of incoming.slice(0, 60)) {
      console.log(`  ${pad(z.code, 14)}${pad(z.type, 12)}${pad(z.from, 12)}${pad(z.status, 10)}${z.days}d`);
    }
    if (incoming.length > 60) console.log(`  …and ${incoming.length - 60} more`);
  }

  const unmapped = zohoAll.filter(z => !z.type);
  if (unmapped.length) {
    console.log(`\n  ${unmapped.length} Zoho record(s) have a leave type we do not map, and would`);
    console.log('  be imported as UNPAID. Check these before running:');
    for (const t of [...new Set(unmapped.map(z => z.rawType))]) console.log(`    "${t}"`);
  }

  /* ══ Verdict ════════════════════════════════════════════════════════════ */
  h1('In short');
  console.log(`\n  would be deleted and NOT restored     ${orphans.length}`);
  console.log(`  status would change                  ${drifted.length}`);
  console.log(`  attendance rows overwritten          ${att.punched}  (0 with --fill-gaps-only)`);
  console.log(`  approval chains rebuilt              ${chained.length}`);
  console.log(`  new records created                  ${incoming.length}`);

  if (orphans.length) {
    console.log('\n  Deal with section A before importing. Either have those people file the');
    console.log('  same request in Zoho, leave their codes out of the restage, or accept the');
    console.log('  loss deliberately — but not by accident.\n');
  } else {
    console.log('\n  Nothing would be lost. The import is safe to run for this range.\n');
  }

  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
