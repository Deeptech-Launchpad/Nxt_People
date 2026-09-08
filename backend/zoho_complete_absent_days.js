#!/usr/bin/env node
/* Turn a local 'absent' day into what it actually was, when Zoho has proof.
 *
 * inspect_org_reconcile.js and inspect_absent_signature.js found the real
 * shape of the "LOP disagreement" pattern: 15 of 17 flagged days this week
 * were forgot-to-check-out (a real punch here, no check-out ever recorded),
 * one was a genuine no-punch absence, one was odd. None were a Zoho
 * data-transfer gap -- --fill-gaps-only in zoho_restage.js already handles
 * the case where NO row exists at all.
 *
 * This is the other half: a LOCAL row exists and reads 'absent', but Zoho's
 * own record for that date shows a real punch. This script re-runs THIS
 * system's own classification engine (classifyDay) over Zoho's facts --
 * never Zoho's own verdict, same principle zoho_restage.js already follows
 * -- and only touches the row when that produces something other than
 * 'absent'. If Zoho shows no punch either, or our rules still say absent
 * even with Zoho's facts, the row is left exactly as it is.
 *
 * Never deletes, never inserts. Only ever UPDATEs an existing 'absent' row's
 * check_in / check_out / working_hours / status / late_minutes / location
 * fields, and only when the corrected verdict actually changes. Backs up
 * the row's prior values first; restore_attendance_correction.js undoes it.
 *
 * Named employees only, never "everybody". Dry run by default.
 *
 *   node zoho_complete_absent_days.js CODE1,CODE2 2026-09-01 2026-09-07
 *   node zoho_complete_absent_days.js CODE1,CODE2 2026-09-01 2026-09-07 --apply
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
const { classifyDay, resolvePolicy, expectedFor } = require('./utils/attendanceRule');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const START = process.argv[3];
const END = process.argv[4];
const APPLY = process.argv.includes('--apply');

if (!CODES.length || !/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.log('\n  usage: node zoho_complete_absent_days.js <CODE[,CODE...]> <START> <END> [--apply]\n');
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const num = (v) => { const c = notDash(v); if (c === null) return null; const n = Number(c); return Number.isFinite(n) ? n : null; };
const p2 = n => String(n).padStart(2, '0');

const fromZohoStamp = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[4]);
  const ampm = (m[6] || '').toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const utc = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5])) - 330 * 60000);
  return `${utc.getUTCFullYear()}-${p2(utc.getUTCMonth() + 1)}-${p2(utc.getUTCDate())} `
    + `${p2(utc.getUTCHours())}:${p2(utc.getUTCMinutes())}:00`;
};
const hhmmToHours = (s) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};
const clockMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
};
const latenessOf = (r) => {
  const shiftStart = clockMinutes(r.ShiftStartTime);
  const arrived = clockMinutes(String(notDash(r.FirstIn) ?? '').split(/\s+/).slice(1).join(' '));
  if (shiftStart === null || arrived === null) return 0;
  return Math.max(0, arrived - shiftStart);
};
const cappedHours = (reported, checkIn, checkOut) => {
  if (reported == null) return reported;
  if (!checkIn || !checkOut) return reported;
  const span = (new Date(checkOut + 'Z') - new Date(checkIn + 'Z')) / 3600000;
  if (!Number.isFinite(span) || span <= 0) return reported;
  return reported > span + (1 / 60) ? Math.round(span * 100) / 100 : reported;
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
async function zohoAttendanceWindow(code, start, end) {
  const json = await patiently(() => zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(start))}&edate=${encodeURIComponent(zohoDMY(end))}`
    + `&dateFormat=dd-MM-yyyy`));
  return json?.response?.result ?? json?.response ?? json;
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Complete local 'absent' days from Zoho facts — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${CODES.join(', ')}   ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const backupTable = (await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t;
  if (!backupTable) {
    console.log('  import_backups does not exist -- run migrate_import_backup.js first.\n');
    await pool.end();
    process.exit(1);
  }

  const cfg = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
  const policy = resolvePolicy(cfg);
  console.log(`  policy: mode=${policy.mode} punchIsEnough=${policy.punchIsEnough} tolerance=${policy.toleranceMinutes}min\n`);

  const candidates = [];  // { emp, date, current, proposed, verdict }
  const implausible = []; // Zoho closed the day with the NEXT day's punch

  for (const token of CODES) {
    const emp = (await pool.query(
      `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
              date_of_joining::text AS joined, exit_date::text AS exited, shift_id
         FROM employees WHERE employee_id = $1`, [token])).rows[0];
    if (!emp) { console.log(`  Nobody matches "${token}" — stopping.\n`); await pool.end(); process.exit(1); }

    const grace = (await pool.query(
      `SELECT COALESCE(sh.grace_minutes, 15) AS g FROM shifts sh WHERE sh.id = $1`, [emp.shift_id]))
      .rows[0]?.g ?? 15;

    let zohoAtt;
    try { zohoAtt = await zohoAttendanceWindow(emp.code, START, END); }
    catch (err) { console.log(`  ${emp.code}: could not read Zoho attendance — ${String(err.message).slice(0, 90)}`); continue; }
    if (!zohoAtt || typeof zohoAtt !== 'object' || 'error' in zohoAtt || 'errors' in zohoAtt) {
      console.log(`  ${emp.code}: Zoho attendance not usable, skipped.`); continue;
    }

    const absentRows = (await pool.query(
      `SELECT id, date::text AS date, check_in::text AS "checkIn", check_out::text AS "checkOut",
              status, working_hours AS "workingHours", late_minutes AS "lateMinutes"
         FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date AND status = 'absent'`,
      [emp.id, START, END])).rows;
    if (!absentRows.length) continue;

    for (const row of absentRows) {
      if (emp.joined && row.date < emp.joined) continue;
      if (emp.exited && row.date > emp.exited) continue;
      const zRec = zohoAtt[row.date];
      if (!zRec) continue; // Zoho is silent too -- nothing to complete from here

      const checkIn = fromZohoStamp(notDash(zRec.FirstIn));
      const checkOut = fromZohoStamp(notDash(zRec.LastOut));
      if (!checkIn) continue; // Zoho itself has no punch -- the absence stands

      const reportedHours = hhmmToHours(zRec.TotalHours) ?? 0;
      const hours = cappedHours(reportedHours, checkIn, checkOut) ?? 0;
      const shiftHours = hhmmToHours(zRec.WorkingHours);
      const lateMinutes = latenessOf(zRec);

      const leaveRows = (await pool.query(
        `SELECT leave_type, total_days, hours, is_half_day FROM leaves
          WHERE employee_id = $1 AND status = 'approved' AND start_date <= $2::date AND end_date >= $2::date`,
        [emp.id, row.date])).rows;
      let leavePortion = 0, permissionHours = 0;
      for (const l of leaveRows) {
        if (l.leave_type === 'permission') permissionHours += parseFloat(l.hours) || 0;
        else leavePortion = Math.max(leavePortion, l.is_half_day ? 0.5 : 1);
      }

      /* An implausibly long day is Zoho's missing-checkout artifact, not a day
       * somebody worked.
       *
       * When a person forgets to check out, Zoho fills LastOut with their NEXT
       * check-in — so the day comes back as "04:06 to 04:06 the following
       * morning", exactly 24 hours. Seen live on Deepa Ganesan 2026-09-07, and
       * on three rows an earlier batch wrote before this guard existed
       * (23.92h, 23.97h, 23.97h). Importing it hands somebody a 24-hour
       * payable day and inflates overtime off a punch that never happened.
       *
       * cappedHours does not catch these: it caps reported hours at the span,
       * and here the span itself is the wrong number. */
      if (checkOut && checkOut.slice(0, 10) !== row.date) {
        implausible.push({ emp, date: row.date, checkIn, checkOut, hours: Number(hours.toFixed(2)),
          zohoStatus: String(zRec.Status ?? '').trim() });
        continue;
      }

      const verdict = classifyDay({
        workedHours: hours, hasPunch: true, leavePortion, permissionHours,
        onDuty: false, lateMinutes, graceMinutes: Number(grace), cfg, shiftHours,
      });
      if (verdict.status === 'absent') continue; // our own rules agree with the absence -- leave it

      candidates.push({
        emp, date: row.date, current: row,
        proposed: {
          checkIn, checkOut, hours: Number(hours.toFixed(2)), lateMinutes, status: verdict.status,
          inLoc: notDash(zRec.FirstIn_Location), outLoc: notDash(zRec.LastOut_Location),
          inLat: num(zRec.FirstIn_Latitude), inLng: num(zRec.FirstIn_Longitude),
          outLat: num(zRec.LastOut_Latitude), outLng: num(zRec.LastOut_Longitude),
        },
        zohoStatus: String(zRec.Status ?? '').trim(),
      });
    }
  }

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`  ${candidates.length} day(s) would be corrected`);
  console.log(`──────────────────────────────────────────────────────────\n`);
  for (const c of candidates) {
    console.log(`  ${pad(c.emp.code, 14)}${pad(c.emp.name.slice(0, 22), 24)}${c.date}`);
    console.log(`      now:      status=${c.current.status}  in=${c.current.checkIn || 'null'}  out=${c.current.checkOut || 'null'}`);
    console.log(`      becomes:  status=${c.proposed.status}  in=${c.proposed.checkIn}  out=${c.proposed.checkOut || 'null'}  ${c.proposed.hours}h  late ${c.proposed.lateMinutes}min`);
    console.log(`      (Zoho said "${c.zohoStatus}")\n`);
  }
  if (!candidates.length) console.log('  none — nothing to correct.\n');

  if (implausible.length) {
    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`  ${implausible.length} day(s) REFUSED — Zoho closed them with the next day's punch`);
    console.log(`──────────────────────────────────────────────────────────\n`);
    console.log('  Zoho fills LastOut with the following check-in when somebody');
    console.log('  forgets to check out, so the day reads as ~24 hours. Importing');
    console.log('  that would hand over a payable day nobody worked. These need a');
    console.log('  regularization with the real checkout time instead.\n');
    for (const r of implausible) {
      console.log(`  ${pad(r.emp.code, 14)}${pad(r.emp.name.slice(0, 22), 24)}${r.date}`
        + `   Zoho: ${r.checkIn} -> ${r.checkOut}  (${r.hours}h)  "${r.zohoStatus}"`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }
  if (!candidates.length) { await pool.end(); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const batch = `absentfix-${stamp}`;
  let done = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of candidates) {
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         SELECT $1, 'attendance_correction', $2, to_jsonb(t)
           FROM attendance t WHERE t.id = $3`,
        [batch, c.emp.id, c.current.id]);

      await client.query(
        `UPDATE attendance SET check_in = $1::timestamp, check_out = $2::timestamp,
                working_hours = $3, status = $4, late_minutes = $5,
                check_in_location = $6, check_out_location = $7,
                check_in_latitude = $8, check_in_longitude = $9,
                check_out_latitude = $10, check_out_longitude = $11
          WHERE id = $12`,
        [c.proposed.checkIn, c.proposed.checkOut, c.proposed.hours, c.proposed.status, c.proposed.lateMinutes,
         c.proposed.inLoc, c.proposed.outLoc, c.proposed.inLat, c.proposed.inLng, c.proposed.outLat, c.proposed.outLng,
         c.current.id]);
      done++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`\n  Failed after ${done} row(s), rolled back everything in this batch: ${err.message}\n`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${done} row(s) corrected under batch ${batch}`);
  console.log(`  To undo:  node restore_attendance_correction.js ${batch} --apply`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
