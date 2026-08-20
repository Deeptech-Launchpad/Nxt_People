// Does an approved regularization store the time the employee actually typed?
//
// attendance.check_in is a naive TIMESTAMP holding a UTC wall clock: the punch
// handler passes `new Date()` from a UTC container, and the late_minutes
// backfill in migrate_fixes.js reads it back with AT TIME ZONE 'UTC'. A
// regularization that writes the IST clock straight in lands 5h30m off, which
// is exactly what Balaji's 2026-07-10 row shows on live.
//
// So the assertion is not "a row was written" — it is that the row, read back
// the way every report reads it, says 09:53.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x)}`); };

const IN = '09:53:00', OUT = '18:30:00';
const made = [];

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];

  // A date far enough back that no real row exists for it.
  const DATE = '2019-03-14';
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE]);
  made.push(() => pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE]));

  console.log(`\n  subject ${emp.code} on ${DATE}, asking for ${IN} - ${OUT} IST\n`);

  // Drive the same statement the approval handler runs for a day with no row.
  await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours, late_minutes)
     VALUES ($1, $2,
       CASE WHEN $3::time IS NOT NULL THEN (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC') END,
       CASE WHEN $4::time IS NOT NULL THEN (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC') END,
       $5, $6, $7)`,
    [emp.id, DATE, IN, OUT, 'present', 8.61666667, 23]);

  const r = (await pool.query(
    `SELECT to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS ist_in,
            to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS ist_out,
            to_char(check_in,  'HH24:MI') AS raw_in,
            to_char(check_out, 'HH24:MI') AS raw_out,
            EXTRACT(EPOCH FROM (check_out - check_in))/3600.0 AS span
       FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE])).rows[0];

  console.log(`  stored raw   ${r.raw_in} - ${r.raw_out}   (UTC, as the column is meant to hold)`);
  console.log(`  reads back   ${r.ist_in} - ${r.ist_out}   (IST, as every report renders it)\n`);

  check('the arrival reads back as the time that was asked for',
    r.ist_in === `${DATE} 09:53`, r.ist_in);
  check('and the departure too — not midnight the next day',
    r.ist_out === `${DATE} 18:30`, r.ist_out);
  check('the raw column really is shifted to UTC, not left as IST',
    r.raw_in === '04:23', r.raw_in);
  check('the span is untouched by the conversion',
    Math.abs(Number(r.span) - 8.6167) < 0.001, Number(r.span));

  // The comparison branches matter too: LEAST/GREATEST put a regularized punch
  // against an existing real one, and an IST literal always loses that contest.
  await pool.query(`UPDATE attendance SET check_in=NULL, check_out=NULL WHERE employee_id=$1 AND date=$2`, [emp.id, DATE]);
  await pool.query(
    `UPDATE attendance SET check_in = (($2::date + $1::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC')
      WHERE employee_id=$3 AND date=$2`, ['14:00:00', DATE, emp.id]);
  await pool.query(
    `UPDATE attendance
        SET check_in = LEAST(check_in, (($2::date + $1::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'))
      WHERE employee_id=$3 AND date=$2`, [IN, DATE, emp.id]);
  const l = (await pool.query(
    `SELECT to_char(check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist
       FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE])).rows[0];
  check('an earlier regularized arrival wins against a later real one',
    l.ist === '09:53', l.ist);

  for (const fn of made) await fn().catch(() => {});
  const left = (await pool.query(
    `SELECT COUNT(*)::int n FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE])).rows[0].n;
  check('the probe row is cleaned up', left === 0, left);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  process.exit(1);
});
