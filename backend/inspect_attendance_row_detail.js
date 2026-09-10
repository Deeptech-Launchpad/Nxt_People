#!/usr/bin/env node
/* Every stored column of one or more attendance rows, one date.
 *
 * READ ONLY. Nothing here writes.
 *
 * inspect_zoho_attendance_days.js found the day: 2026-09-09, Zoho shows a
 * check-in and no check-out and calls it Absent, while NxtPeople shows both
 * punches and Present. That could mean our system caught what Zoho's device
 * missed -- or it could mean the local check-out is not a real punch at all,
 * the way the ON CONFLICT branch in attendance.js was found today preserving
 * a stale verdict for Manoj Subramaniam. The only way to tell the two apart
 * is to look at check_in_ip, check_out_ip, source, work_mode and the
 * created_at/updated_at pair for the actual row, not at the summary status.
 *
 *   node inspect_attendance_row_detail.js ANXT2600157,ANXT2600158 2026-09-09
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const DATE = process.argv[3];

if (!CODES.length || !/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) {
  console.log('\n  usage: node inspect_attendance_row_detail.js <CODE[,CODE...]> <DATE>\n');
  process.exit(1);
}

const show = v => (v === null || v === undefined || v === '') ? '—'
  : (v instanceof Date ? v.toISOString() : String(v));

(async () => {
  console.log(`\n  Every stored column, ${DATE}, READ ONLY.\n`);

  const rows = (await pool.query(
    `SELECT a.*, e.employee_id AS code, TRIM(e.first_name||' '||COALESCE(e.last_name,'')) AS name
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE e.employee_id = ANY($1::text[]) AND a.date = $2::date`,
    [CODES, DATE])).rows;

  if (!rows.length) { console.log('  No row for anybody named, that date.\n'); await pool.end(); return; }

  for (const r of rows) {
    console.log('─'.repeat(76));
    console.log(`  ${r.name}  ${r.code}`);
    for (const [k, v] of Object.entries(r)) {
      if (k === 'name' || k === 'code') continue;
      console.log(`    ${k.padEnd(28)} ${show(v)}`);
    }

    const sessions = (await pool.query(
      `SELECT check_in::text, check_out::text, session_hours FROM attendance_sessions
        WHERE attendance_id = $1 ORDER BY check_in`, [r.id])).rows;
    if (sessions.length) {
      console.log('    sessions:');
      for (const s of sessions) console.log(`      ${JSON.stringify(s)}`);
    }

    const audits = (await pool.query(
      `SELECT action, actor_email, actor_role, changes, created_at
         FROM audit_log WHERE resource_id = $1 ORDER BY created_at`, [r.id])).rows;
    if (audits.length) {
      console.log('    audit trail:');
      for (const a of audits) {
        console.log(`      ${a.created_at.toISOString()}  ${a.action}  ${a.actor_email || '—'} (${a.actor_role || '—'})`);
        if (a.changes) console.log(`        ${JSON.stringify(a.changes)}`);
      }
    }
    console.log('');
  }

  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
