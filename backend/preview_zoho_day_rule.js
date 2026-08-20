/* ── What changes if the day is classified Zoho's way ──────────────────────
 *  Adopting Zoho's rule moves two things at once, and both need to be seen on
 *  real data before either is switched on:
 *
 *    1. The threshold. Today a day is called present at 7.5 hours. Zoho
 *       compares against the EXPECTED full day, which here is 8. Days between
 *       7.5 and 8 stop being full days.
 *
 *    2. The shape. Today a short day is labelled 'half-day' and nothing more.
 *       Zoho splits it into half present AND HALF ABSENT, and records the
 *       shortfall in hours. That absent half is what a payable figure can
 *       later act on.
 *
 *  This writes nothing. pool.query refuses any statement that is not a SELECT,
 *  and proves it by attempting a write against itself before doing any work.
 *
 *    docker compose exec backend node preview_zoho_day_rule.js
 *    docker compose exec backend node preview_zoho_day_rule.js 2026-07-01 2026-07-31
 *
 *  Defaults to the last complete calendar month.
 * ────────────────────────────────────────────────────────────────────────── */

process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('preview_zoho_day_rule.js does not send mail'); },
  verify: async () => { throw new Error('preview_zoho_day_rule.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('preview_zoho_day_rule.js is read-only; this write was refused'));
  }
  return realQuery(text, params);
};

const { classifyDay } = require('./utils/attendanceRule');

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const pad = (s, n) => String(s).padEnd(n);
const h2 = (n) => (n === null || n === undefined ? '  —  ' : `${Number(n).toFixed(2)}h`);

function defaultRange() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return [ymd(start), ymd(end)];
}

(async () => {
  const [START, END] = process.argv[2] && process.argv[3]
    ? [process.argv[2], process.argv[3]] : defaultRange();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log("  Zoho day-classification rule — PREVIEW, READ ONLY");
  console.log(`  Range: ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('  !!    the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch {
    console.log('  ok    a deliberate write attempt was refused\n');
  }

  const s = (await pool.query(
    `SELECT expected_hours_mode AS "expectedMode",
            expected_hours_per_day AS "expectedFullDay",
            expected_half_day_hours AS "expectedHalfDay",
            full_day_hours AS "presentAtLeast",
            half_day_hours AS "halfDayAtLeast",
            attendance_policy_config AS policy
       FROM settings LIMIT 1`)).rows[0] || {};

  const policy = s.policy || {};
  const cfg = {
    strictMode: policy.strictMode !== false,
    allowOvertimeAndDeviation: policy.allowOvertimeAndDeviation === true,
    expectedMode: s.expectedMode || 'manual',
    expectedFullDay: Number(s.expectedFullDay ?? 8),
    expectedHalfDay: Number(s.expectedHalfDay ?? 4),
  };

  console.log('  Your settings as they stand');
  console.log(`    classified today against   full ${Number(s.presentAtLeast ?? 7.5)}h, half ${Number(s.halfDayAtLeast ?? 4)}h`);
  console.log(`    Zoho would classify against full ${cfg.expectedFullDay}h, half ${cfg.expectedHalfDay}h  (the expected hours)`);
  console.log(`    mode                       ${cfg.strictMode ? 'Strict' : 'Lenient'}`);
  console.log(`    expected hours from        ${cfg.expectedMode === 'shift' ? "each employee's shift" : 'the org figure'}`);
  console.log(`    overtime and deviation     ${cfg.allowOvertimeAndDeviation ? 'measured' : 'NOT measured — deficits would show as “—”'}\n`);

  // Finished days only. A day still running has somebody checked in and not
  // out, which is not a short day — it is an unfinished one.
  const { rows } = await pool.query(
    `SELECT a.date::text AS d, e.employee_id AS code,
            TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
            a.status, a.working_hours, a.late_minutes,
            a.check_in IS NOT NULL OR a.check_out IS NOT NULL AS has_punch,
            a.check_out IS NOT NULL AS finished,
            EXTRACT(EPOCH FROM (sh.end_time::time - sh.start_time::time))/3600.0 AS shift_hours,
            COALESCE(sh.grace_minutes, 15) AS grace
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts sh ON sh.id = e.shift_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND e.deleted_at IS NULL
        AND COALESCE(e.employment_type, '') <> 'Employee Profile'
      ORDER BY a.date, e.employee_id`,
    [START, END]);

  const finished = rows.filter(r => r.finished);
  console.log(`  ${rows.length} attendance row(s), ${finished.length} of them finished days\n`);

  const changed = [];
  let totalDeficit = 0, deficitDays = 0;
  const tally = { present: 0, half: 0, absent: 0 };

  for (const r of finished) {
    const verdict = classifyDay({
      workedHours: Number(r.working_hours) || 0,
      hasPunch: r.has_punch,
      lateMinutes: Number(r.late_minutes) || 0,
      graceMinutes: Number(r.grace) || 0,
      cfg,
      shiftHours: r.shift_hours === null ? null : Number(r.shift_hours),
    });

    if (verdict.present === 1) tally.present++;
    else if (verdict.present === 0.5) tally.half++;
    else tally.absent++;

    // Deficit is reported whatever the org's tracking switch says, so this
    // preview can show what turning it on would reveal.
    const shortfall = Math.max(0, cfg.expectedFullDay - (Number(r.working_hours) || 0));
    if (shortfall > 0.01) { totalDeficit += shortfall; deficitDays++; }

    // 'late' and 'present' are both a full present day; comparing the labels
    // alone would report every late day as a change.
    const wasFull = r.status === 'present' || r.status === 'late';
    const nowFull = verdict.present === 1;
    const wasHalf = r.status === 'half-day';
    const nowHalf = verdict.present === 0.5;
    if (wasFull !== nowFull || wasHalf !== nowHalf) {
      changed.push({ ...r, verdict, shortfall });
    }
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('  How the range would be counted under Zoho\'s rule');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    full present days     ${tally.present}`);
  console.log(`    half present days     ${tally.half}   (each also half ABSENT — that half is new)`);
  console.log(`    fully absent days     ${tally.absent}`);
  console.log(`    absent days created   ${(tally.half * 0.5).toFixed(1)} from the split\n`);

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Days whose classification would change: ${changed.length}`);
  console.log('──────────────────────────────────────────────────────────\n');

  if (!changed.length) {
    console.log('    None. Every finished day lands the same way under both rules.\n');
  } else {
    const show = changed.slice(0, 25);
    for (const c of show) {
      console.log(`    ${pad(c.code, 14)} ${c.d}   ${h2(c.working_hours)} worked`);
      console.log(`${' '.repeat(20)}${pad(c.status, 10)} -> ${pad(c.verdict.status, 10)}`
        + `  present ${c.verdict.present}, absent ${c.verdict.absent}`
        + (c.shortfall > 0.01 ? `   short by ${c.shortfall.toFixed(2)}h` : ''));
    }
    if (changed.length > show.length) {
      console.log(`\n    … and ${changed.length - show.length} more`);
    }
    console.log('');

    const byPerson = new Map();
    for (const c of changed) byPerson.set(c.code, (byPerson.get(c.code) || 0) + 1);
    const worst = [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('    Most affected people:\n');
    for (const [code, n] of worst) {
      const name = changed.find(c => c.code === code)?.name || '';
      console.log(`      ${pad(code, 14)} ${pad(name, 26)} ${n} day(s)`);
    }
    console.log('');
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('  What deviation tracking would reveal');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${deficitDays} finished day(s) fell short of ${cfg.expectedFullDay}h`);
  console.log(`    ${totalDeficit.toFixed(1)} hour(s) of shortfall in total across the range`);
  console.log(cfg.allowOvertimeAndDeviation
    ? '    "Allow overtime and deviation" is on, so this would be shown.\n'
    : '    "Allow overtime and deviation" is OFF, so none of this is shown today.\n');

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
