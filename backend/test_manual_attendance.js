/* ── Attendance for staff who cannot punch ──────────────────────────────────
 *  Housekeeping work three to four hours, on Saturdays, sometimes twice a day,
 *  and nobody logs in for them. What has to hold:
 *
 *    a 3.5 hour shift marked present comes back PRESENT
 *      — this is the whole thing. Expected hours is 8:00 and the short-day
 *        rule is `absent` with zero tolerance, so anything that let these days
 *        near classifyDay would return absent for every one of them, and the
 *        export would say the opposite of the button that was pressed
 *
 *    two shifts in one day produce two sessions on one attendance row
 *    an overnight shift is four hours, not minus twenty
 *    a fixed shift ignores typed hours; an actual shift honours them
 *    a Saturday shift runs on Saturday whatever the company weekend says
 *    removing every mark removes the day rather than leaving it absent
 *    a day with real punches on it is never overwritten
 *    an all-absent day still gets a row — "she did not come" is not the same
 *      fact as "nobody has looked"
 *    the presumption is never written to the database
 *
 *  The pool is stubbed through the require cache, so this needs no database.
 *  Sends no mail.
 *
 *    node test_manual_attendance.js
 * ────────────────────────────────────────────────────────────────────────── */
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 300)));
};

const dbPath = require.resolve('./db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };

const {
  clockMinutes, shiftSpanHours, runsOn, creditedHours, syncAttendanceDay,
} = require('./utils/manualAttendance');

/* A client that answers the four shapes syncAttendanceDay asks for and records
 * every write, so the assertions are about what it did rather than what it
 * returned. */
function fakeClient({ marks = [], existing = null }) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/FROM manual_attendance_marks m/.test(sql)) return { rows: marks };
      if (/SELECT id, source FROM attendance/.test(sql)) return { rows: existing ? [existing] : [] };
      if (/INSERT INTO attendance \(/.test(sql)) return { rows: [{ id: 'att-1' }] };
      return { rows: [] };
    },
  };
}

const shift = (o = {}) => ({
  state: 'present', hours: null, shift_id: o.id || 's1',
  start_time: o.start || '06:00:00', end_time: o.end || '09:30:00',
  pay_mode: o.payMode || 'fixed', shift_name: o.name || 'Morning',
  ...(o.state ? { state: o.state } : {}),
  ...(o.hours !== undefined ? { hours: o.hours } : {}),
});

const run = async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Attendance marking');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── spans ────────────────────────────────────────────────────────────────
  console.log('  Shift spans\n');
  check('06:00–09:30 is 3.5 hours', shiftSpanHours({ start_time: '06:00', end_time: '09:30' }) === 3.5);
  check('06:00–10:00 is 4 hours', shiftSpanHours({ start_time: '06:00:00', end_time: '10:00:00' }) === 4);
  check('an overnight 22:00–02:00 is 4 hours, not negative',
    shiftSpanHours({ start_time: '22:00', end_time: '02:00' }) === 4);
  check('a shift with nonsense times is 0, not NaN',
    shiftSpanHours({ start_time: 'x', end_time: 'y' }) === 0);
  check('25:00 is rejected rather than accepted as an hour', clockMinutes('25:00') === null);
  check('a blank time is rejected', clockMinutes('') === null);

  // ── working days ─────────────────────────────────────────────────────────
  console.log('\n  Working days\n');
  const monSat = { days_of_week: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
  check('a Mon–Sat shift runs on Saturday, whatever the company weekend says',
    runsOn(monSat, '2026-08-29') === true);
  check('and not on Sunday', runsOn(monSat, '2026-08-30') === false);
  check('a shift with no days runs on no days', runsOn({ days_of_week: [] }, '2026-08-29') === false);
  check('an unparseable date does not throw', runsOn(monSat, 'not-a-date') === false);

  // ── pay mode ─────────────────────────────────────────────────────────────
  console.log('\n  Pay mode\n');
  const fixed = { start_time: '06:00', end_time: '10:00', pay_mode: 'fixed' };
  const actual = { start_time: '06:00', end_time: '10:00', pay_mode: 'actual' };
  check('fixed credits the whole shift and ignores typed hours',
    creditedHours(fixed, { hours: 99 }) === 4);
  check('actual honours what was typed', creditedHours(actual, { hours: 3.25 }) === 3.25);
  check('actual with nothing typed falls back to the span',
    creditedHours(actual, { hours: null }) === 4);
  check('a negative typed value falls back rather than subtracting',
    creditedHours(actual, { hours: -5 }) === 4);

  // ── THE HOURS TRAP ───────────────────────────────────────────────────────
  console.log('\n  A short shift is present, not absent\n');

  let c = fakeClient({ marks: [shift({ start: '06:00:00', end: '09:30:00' })] });
  let out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('a 3.5 hour shift marked present is written as PRESENT',
    out.status === 'present', out);
  check('and credited its real 3.5 hours', out.hours === 3.5, out);

  const insert = c.log.find(q => /INSERT INTO attendance \(/.test(q.sql));
  check('the status is asserted, never handed to the day classifier',
    insert && insert.params.includes('present'), insert && insert.params);
  check('the row is stamped as manual so nothing mistakes it for a punch',
    insert && /'manual'/.test(insert.sql));
  check('times are converted IST→UTC the same way every read converts back',
    insert && /AT TIME ZONE 'Asia\/Kolkata'\) AT TIME ZONE 'UTC'/.test(insert.sql));

  // ── two shifts ───────────────────────────────────────────────────────────
  console.log('\n  Two shifts in one day\n');

  c = fakeClient({ marks: [
    shift({ id: 's1', start: '06:00:00', end: '09:00:00' }),
    shift({ id: 's2', start: '17:00:00', end: '20:00:00' }),
  ]});
  out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('both shifts are credited — 3 + 3 = 6 hours', out.hours === 6, out);
  check('two sessions are written under the one attendance row', out.sessions === 2, out);
  const sessions = c.log.filter(q => /INSERT INTO attendance_sessions/.test(q.sql));
  check('one session insert per shift', sessions.length === 2, sessions.length);
  check('sessions are cleared before being rebuilt, so an edit cannot double them',
    c.log.some(q => /DELETE FROM attendance_sessions/.test(q.sql)));

  // ── absent, and unmarked ─────────────────────────────────────────────────
  console.log('\n  Absent is not the same as unmarked\n');

  c = fakeClient({ marks: [shift({ state: 'absent' })] });
  out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('a day marked absent is written as absent', out.status === 'absent', out);
  check('with no hours', out.hours === 0, out);
  const absIns = c.log.find(q => /INSERT INTO attendance \(/.test(q.sql));
  check('and no times, because nothing happened',
    absIns && absIns.params.includes(false), absIns && absIns.params);

  c = fakeClient({ marks: [], existing: { id: 'att-9', source: 'manual' } });
  out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('clearing every mark removes the day rather than leaving it absent',
    out.action === 'removed', out);
  check('and takes its sessions with it',
    c.log.some(q => /DELETE FROM attendance_sessions/.test(q.sql)));

  c = fakeClient({ marks: [] });
  out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('an unmarked day with nothing to remove writes nothing at all',
    out.action === 'none' && !c.log.some(q => /INSERT/.test(q.sql)), out);

  // ── a real punch always wins ─────────────────────────────────────────────
  console.log('\n  A real punch is never overwritten\n');

  c = fakeClient({ marks: [shift()], existing: { id: 'att-9', source: 'punch' } });
  out = await syncAttendanceDay(c, 'emp-1', '2026-08-28');
  check('a punched day is skipped, not clobbered', out.action === 'skipped', out);
  check('and nothing was written',
    !c.log.some(q => /INSERT|UPDATE|DELETE/.test(q.sql)), c.log.map(q => q.sql.slice(0, 40)));

  // ── the presumption is never stored ──────────────────────────────────────
  console.log('\n  The presumption stays out of the database\n');

  const routeSrc = fs.readFileSync(require.resolve('./routes/manual-attendance.js'), 'utf8');
  const utilSrc = fs.readFileSync(require.resolve('./utils/manualAttendance.js'), 'utf8');
  const migSrc = fs.readFileSync(require.resolve('./migrate_manual_attendance.js'), 'utf8');

  check('marks may only ever be present or absent — presumed is not a state',
    /CHECK \(state IN \('present','absent'\)\)/.test(migSrc));
  check('nothing inserts a presumed mark',
    !/INSERT INTO manual_attendance_marks[\s\S]{0,200}presumed/.test(routeSrc));
  check('the summary counts presumed days on read instead',
    /presumedPresent \+= 1/.test(routeSrc));
  check('confirmed and presumed are returned separately, never pre-added',
    /confirmedPresent:/.test(routeSrc) && /presumedPresent:/.test(routeSrc));

  console.log('\n  Payroll left deliberately unwired\n');
  check('the migration carries the marker for whoever wires payroll',
    /PAYROLL-DECISION/.test(migSrc));
  check('so does the route', /PAYROLL-DECISION/.test(routeSrc));
  check('so does the sync util', /PAYROLL-DECISION/.test(utilSrc));
  /* The word "payroll" appears all over these files, in comments saying that
   * payroll is not wired. What matters is that no SQL reaches a payroll table,
   * so that is what this asks — an earlier version matched the prose and
   * failed on its own documentation. */
  const touchesPayrollTable = /\b(FROM|JOIN|INTO|UPDATE)\s+(payroll_\w+|payslips|salary_\w+)\b/i;
  check('and no query here reaches a payroll table',
    !touchesPayrollTable.test(routeSrc) && !touchesPayrollTable.test(utilSrc));

  console.log('\n  Guard rails on the route\n');
  check('marking is full-access only', /authorize\(\.\.\.FULL\)/.test(routeSrc));
  check('a future date is refused', /has not happened yet/.test(routeSrc));
  check('a shift with marks against it cannot be deleted',
    /cannot be deleted/.test(routeSrc));
  check('hours above the shift span are refused',
    /Hours cannot exceed/.test(routeSrc));

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  process.exit(passed === checks.length ? 0 : 1);
};

run().catch(e => { console.error(e); process.exit(1); });
