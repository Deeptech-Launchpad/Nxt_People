#!/usr/bin/env node
/* Bring Zoho's Client visit days across as on-duty, and report on the other
 * day types nothing here reads.
 *
 * Dry run by default. Only ever INSERTs into on_duty_requests — never
 * deletes, never updates, and never touches attendance or leaves.
 *
 * WHY: inspect_zoho_status_vocabulary.js found Zoho marking days "Client
 * visit" with no punch, because the person was at a client site. Nothing
 * here has ever read on-duty out of Zoho (zoho_survey.js reported the table
 * as "exists, nothing reads Zoho"), so absentDaysForRange — which excludes
 * days covered by an approved on-duty request — has nothing to exclude, and
 * every one of those days is counted as an absence. Natarajan Aunachalam
 * had seven of them.
 *
 * A day is skipped, not imported, when an on-duty row already covers it, or
 * when approved leave already covers it: either way the day is already
 * accounted for and a second record would double-count it.
 *
 * The other two categories the vocabulary scan flagged as "no attendance row
 * here" are REPORTED ONLY, because a leave day is not supposed to have an
 * attendance row — the leaves table carries it — and the leave totals
 * already reconcile with Zoho exactly. This prints whether a leave record
 * really does cover each of those days, so "no row here" is not mistaken for
 * "missing" a second time.
 *
 *   node zoho_import_on_duty.js 2026-01-01 2026-09-07
 *   node zoho_import_on_duty.js 2026-01-01 2026-09-07 --apply
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
const APPLY = process.argv.includes('--apply');
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.log('\n  usage: node zoho_import_on_duty.js <START> <END> [--apply]\n');
  process.exit(1);
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

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

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Zoho Client visit -> on-duty — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const emps = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id ~ '^ANXT' AND status = 'active' ORDER BY employee_id`)).rows;
  console.log(`Checking ${emps.length} active employee(s), one Zoho call each...\n`);

  const toImport = [];   // whole-day client visits with nothing covering them
  const covered = [];    // client visit days already accounted for
  const partials = [];   // part client visit, part absence — reported, never imported
  const others = [];     // comp off / combined leave days, reported only
  let checked = 0;

  for (const emp of emps) {
    checked++;
    if (checked % 20 === 0) console.log(`  ...${checked}/${emps.length}`);

    let zohoAtt;
    try {
      const json = await patiently(() => zohoApi(
        `attendance/getUserReport?empId=${encodeURIComponent(emp.code)}`
        + `&sdate=${encodeURIComponent(zohoDMY(START))}&edate=${encodeURIComponent(zohoDMY(END))}`
        + `&dateFormat=dd-MM-yyyy`));
      zohoAtt = json?.response?.result ?? json?.response ?? json;
    } catch { continue; }
    if (!zohoAtt || typeof zohoAtt !== 'object' || 'error' in zohoAtt || 'errors' in zohoAtt) continue;

    for (const [iso, rec] of Object.entries(zohoAtt)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < START || iso > END) continue;
      if (emp.joined && iso < emp.joined) continue;
      if (emp.exited && iso > emp.exited) continue;

      const status = String(rec.Status ?? '').trim();
      const isClientVisit = /client\s*visit/i.test(status);
      const isCompOff = /compensatory\s*off/i.test(status);
      const isCombinedLeave = /leave/i.test(status) && status.includes(',') && !/present|absent/i.test(status.split(',').pop());

      if (!isClientVisit && !isCompOff && !isCombinedLeave) continue;

      const hasLeave = (await pool.query(
        `SELECT leave_type, status FROM leaves
          WHERE employee_id = $1 AND status = 'approved'
            AND start_date <= $2::date AND end_date >= $2::date`,
        [emp.id, iso])).rows;
      const hasOnDuty = (await pool.query(
        `SELECT id FROM on_duty_requests
          WHERE employee_id = $1 AND status = 'approved'
            AND start_date <= $2::date AND end_date >= $2::date`,
        [emp.id, iso])).rows;

      if (!isClientVisit) {
        others.push({ emp, iso, status, hasLeave, kind: isCompOff ? 'Compensatory Off' : 'combined leave' });
        continue;
      }

      /* Whole-day client visits only.
       *
       * Zoho grades a day on a sliding scale, and several of these are part
       * client visit and part absence — "Client visit(First Half), 0.5 day
       * Absent". on_duty_requests written as unit='days' excludes the WHOLE
       * day from absence, so importing one of those would quietly cancel the
       * half-day absence Zoho recorded and credit half a day nobody worked.
       *
       * The table does carry unit='hours' with a start and end time, but
       * Zoho's fraction does not say WHICH hours, and inventing a window to
       * fit a number is how a guess becomes a record. So a partial day is
       * reported for somebody to decide on, never imported. */
      const partial = /\d+(?:\.\d+)?\s*day\s+absent/i.test(status);
      const row = { emp, iso, status, hasLeave, hasOnDuty, partial };
      if (hasOnDuty.length || hasLeave.length) covered.push(row);
      else if (partial) partials.push(row);
      else toImport.push(row);
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  Client visit: ${toImport.length} day(s) to import, ${covered.length} already covered`);
  console.log(`──────────────────────────────────────────────────────────\n`);
  for (const r of toImport) {
    console.log(`  ${pad(r.emp.code, 14)}${pad(r.emp.name.slice(0, 24), 26)}${r.iso}   Zoho: "${r.status}"`);
  }
  if (!toImport.length) console.log('  none.');
  for (const r of covered) {
    console.log(`  ${pad(r.emp.code, 14)}${pad(r.emp.name.slice(0, 24), 26)}${r.iso}   already covered by `
      + `${r.hasOnDuty.length ? 'an on-duty record' : `approved ${r.hasLeave.map(l => l.leave_type).join('/')} leave`} — skipped`);
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  Part client visit, part absence: ${partials.length} day(s) — NOT imported`);
  console.log(`──────────────────────────────────────────────────────────\n`);
  console.log('  A whole-day on-duty record would excuse the whole day and cancel');
  console.log('  the absence Zoho recorded on it. Zoho does not say which hours');
  console.log('  the visit covered, so these need a person to decide.\n');
  for (const r of partials) {
    console.log(`  ${pad(r.emp.code, 14)}${pad(r.emp.name.slice(0, 24), 26)}${r.iso}   Zoho: "${r.status}"`);
  }
  if (!partials.length) console.log('  none.');

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  Reported only, never imported: ${others.length} day(s)`);
  console.log(`──────────────────────────────────────────────────────────\n`);
  console.log('  A leave day is not supposed to have an attendance row — the');
  console.log('  leaves table carries it. This shows whether one really does.\n');
  for (const r of others) {
    console.log(`  ${pad(r.emp.code, 14)}${r.iso}  ${pad(r.kind, 18)}Zoho: "${r.status.slice(0, 40)}"`);
    console.log(`      leave on file here: ${r.hasLeave.length ? r.hasLeave.map(l => l.leave_type).join(', ') : 'NONE — this one really is missing'}`);
  }
  if (!others.length) console.log('  none.');

  if (!APPLY) {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }
  if (!toImport.length) { console.log('\n  Nothing to import.\n'); await pool.end(); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const batch = `onduty-${stamp}`;
  const client = await pool.connect();
  let done = 0;
  try {
    await client.query('BEGIN');
    for (const r of toImport) {
      const ins = await client.query(
        `INSERT INTO on_duty_requests
           (employee_id, start_date, end_date, unit, request_type, reason, status, approved_at)
         VALUES ($1, $2::date, $2::date, 'days', 'client_visit', $3, 'approved', NOW())
         RETURNING id`,
        [r.emp.id, r.iso, `Imported from Zoho (${batch}): ${r.status}`]);
      // A trail, so these rows can be found and removed again as a group.
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         VALUES ($1, 'on_duty_import', $2, $3::jsonb)`,
        [batch, r.emp.id, JSON.stringify({ id: ins.rows[0].id, date: r.iso, zohoStatus: r.status })]);
      done++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`\n  Failed after ${done}, rolled back: ${err.message}\n`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${done} on-duty day(s) imported under batch ${batch}`);
  console.log(`  These rows carry that batch in their reason, and a trail row in`);
  console.log(`  import_backups under table_name 'on_duty_import'.`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
