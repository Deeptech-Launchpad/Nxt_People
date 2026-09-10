#!/usr/bin/env node
/* The three rows the 2026-08-01..2026-09-10 pre-import check flagged as
 * dangerous, examined one at a time.
 *
 * READ ONLY. Nothing here writes.
 *
 * The summary line "status would change 13" hides the fact that the thirteen
 * are not alike. Eleven are pending here and approved in Zoho — the import
 * settles them, which is the whole point of running it. Three are not:
 *
 *   ANXT220007  2026-09-10  exists ONLY here — a restage deletes it
 *   ANXT2600160 2026-09-10  approved here, pending in Zoho — reverted
 *   ANXT220025  2026-08-29  CANCELLED here, approved in Zoho — resurrected
 *
 * The third is the one that needs a person to decide, and it is not a
 * technical question. A cancelled permission means the employee did not take
 * it. Letting Zoho's "approved" win would debit their balance and mark a
 * half-hour they did not use — a pay-affecting change made by a script that
 * nobody asked to make it. So this prints who did what and when, for each,
 * and stops. It recommends nothing.
 *
 *   node inspect_contested_leaves.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');

const CONTESTED = [
  { code: 'ANXT220007', date: '2026-09-10', why: 'exists only here — a restage DELETES it' },
  { code: 'ANXT2600160', date: '2026-09-10', why: 'approved here, pending in Zoho — import REVERTS it' },
  { code: 'ANXT220025', date: '2026-08-29', why: 'cancelled here, approved in Zoho — import RESURRECTS it' },
];

const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  console.log('\n  The three contested rows, with their history.');
  console.log('  READ ONLY — nothing is written.\n');

  for (const c of CONTESTED) {
    console.log('─'.repeat(76));
    console.log(`  ${c.code}  ${c.date}`);
    console.log(`  ${c.why}\n`);

    const rows = (await pool.query(
      `SELECT l.id, l.status, l.start_date::text, l.end_date::text, l.days,
              l.hours, l.start_time::text, l.end_time::text, l.reason,
              l.created_at, l.updated_at,
              lt.name AS type,
              TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name
         FROM leaves l
         JOIN employees e ON e.id = l.employee_id
         LEFT JOIN leave_types lt ON lt.id = l.leave_type_id
        WHERE e.employee_id = $1 AND l.start_date = $2::date`,
      [c.code, c.date])).rows;

    if (!rows.length) {
      console.log('    No leave row here on that date at all.\n');
      continue;
    }

    for (const r of rows) {
      console.log(`    ${r.name}  ${r.type || '?'}  ${r.status}`);
      console.log(`    ${r.start_date} → ${r.end_date}   days ${r.days}   hours ${r.hours ?? '—'}`
        + `   ${r.start_time || '—'}–${r.end_time || '—'}`);
      console.log(`    reason: ${r.reason || '—'}`);
      console.log(`    created ${r.created_at?.toISOString?.() || r.created_at}`);
      console.log(`    updated ${r.updated_at?.toISOString?.() || r.updated_at}`);

      /* created_at tells us whether a human filed it or the restage did.
       * The last import wrote twenty rows inside one second; a genuine
       * submission does not share its timestamp to the second with anyone. */
      const twins = (await pool.query(
        `SELECT COUNT(*)::int n FROM leaves WHERE created_at = $1`, [r.created_at])).rows[0].n;
      console.log(`    ${twins} leave row(s) in the whole table share that created_at`
        + `${twins > 1 ? '  ← written by an import, not by a person' : '  ← filed individually'}`);

      const levels = (await pool.query(
        `SELECT al.level, al.status, al.acted_at,
                TRIM(CONCAT(e.first_name,' ',e.last_name)) AS approver
           FROM approval_levels al
           LEFT JOIN employees e ON e.id = al.approver_id
          WHERE al.request_type = 'leave' AND al.request_id = $1
          ORDER BY al.level`, [r.id])).rows;
      if (levels.length) {
        console.log('    approval chain:');
        for (const l of levels) {
          console.log(`      L${l.level}  ${pad(l.approver || '—', 26)}${pad(l.status, 10)}`
            + `${l.acted_at ? l.acted_at.toISOString() : ''}`);
        }
      } else {
        console.log('    approval chain: none');
      }

      const audits = (await pool.query(
        `SELECT action, actor_email, actor_role, changes, created_at
           FROM audit_log
          WHERE resource_id = $1
          ORDER BY created_at`, [r.id])).rows;
      if (audits.length) {
        console.log('    audit trail:');
        for (const a of audits) {
          console.log(`      ${a.created_at.toISOString()}  ${pad(a.action, 22)}`
            + `${a.actor_email || '—'} (${a.actor_role || '—'})`);
          if (a.changes) console.log(`        ${JSON.stringify(a.changes)}`);
        }
      } else {
        console.log('    audit trail: nothing logged against this row');
      }
      console.log('');
    }
  }

  console.log('─'.repeat(76));
  console.log('\n  Nothing above decides anything. What to look for:\n');
  console.log('    ANXT220007  — if it was filed by a person, keeping it means ending');
  console.log('                  that one restage at 2026-09-09 instead of 09-10.');
  console.log('    ANXT2600160 — an approval given here that Zoho never saw. Importing');
  console.log('                  it un-approves the request under the approver.');
  console.log('    ANXT220025  — if a person cancelled it here AFTER the last import,');
  console.log('                  NxtPeople is the newer truth and Zoho must not win.');
  console.log('                  If it was cancelled by an import, the reverse.\n');

  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
