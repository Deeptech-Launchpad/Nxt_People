#!/usr/bin/env node
/* ── One decision sheet, in plain English, for HR to fill in ───────────────
 *  READ ONLY. This script runs SELECT and nothing else. It writes no row to
 *  any database, calls no Zoho endpoint, and sends no mail. There is
 *  deliberately no --apply and no repair path anywhere in this file: every one
 *  of these cases changes either a leave balance or what somebody is paid, so
 *  the figure is REPORTED here and changed only after HR has said what it
 *  should be. The apply step is a separate script that does not exist yet.
 *
 *  inspect_leave_data_audit.js already finds all of this. What it produces is a
 *  findings list written for whoever maintains the code — check names, severity
 *  letters, store names, function names. This turns the four findings HR can
 *  actually decide about into one row per case, one sheet, with an empty
 *  decision column:
 *
 *    D2  Absence nobody accounted for      → LOP / add leave / fix attendance
 *    E2  Duplicate and overlapping leave   → which of the two rows to keep
 *    E1  Day count that does not match     → the charged figure or the dates
 *    E3  Leave charged on a shut day       → refund the day, or leave it
 *
 *  Everything else the audit reports (casual balances, permission hours,
 *  comp-off credits, orphan rows, the ghost table) is NOT here: those are
 *  decisions for whoever owns the policy or the code, not row-by-row HR calls.
 *
 *  THE QUERIES ARE COPIES, NOT IMPORTS. inspect_leave_data_audit.js is a single
 *  IIFE and exports nothing, so its queries cannot be required from here. Each
 *  one below is copied with the audit's file and check named above it, and
 *  where a column was added for HR's benefit that is said so explicitly. If a
 *  check changes there, change it here — the two cannot drift silently while
 *  nobody notices, but they CAN drift if somebody edits one and not the other.
 *
 *    node inspect_leave_review_sheet.js
 *    node inspect_leave_review_sheet.js --year=2026
 *    node inspect_leave_review_sheet.js --employee=ANXT220038
 *    node inspect_leave_review_sheet.js --out=/app/uploads/leave_review_2026.csv
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const fs = require('fs');
const path = require('path');
const pool = require('./db');
// The SAME functions the apply path and the audit use. countWorkingDays is what
// routes/leaves.js:479 calls to decide total_days, so a figure this script calls
// wrong is a figure the app itself would have written differently.
const { countWorkingDays, ruleMatchesDate, holidayClosesOffice } = require('./utils/workingDays');

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
};
const YEAR = parseInt(arg('year'), 10) || new Date().getFullYear();
const ONLY = arg('employee');
const OUT_ARG = arg('out');

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '' : String(round2(n)));
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Same tolerated status set as inspect_leave_data_audit.js:94-97. routes/leaves.js
// writes 'pending', but its own queries also read 'pending_approval'.
const LIVE_STATUSES = new Set(['approved', 'pending', 'pending_approval']);
// Attendance rows that mean "this person was not accounted for".
const ABSENT_LIKE = new Set(['absent', 'unmarked']);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* 'YYYY-MM-DD' → a local Date. new Date('2026-03-02') parses as UTC midnight,
 * which is the previous evening west of Greenwich, so the weekday name can come
 * back one day out. Built from the parts it cannot. */
const ymdToDate = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayOfWeek = (ymd) => DAY_NAMES[ymdToDate(ymd).getDay()];
// en-CA is YYYY-MM-DD in local time, so it compares directly against a
// date::text out of Postgres. Same idiom as inspect_leave_data_audit.js:84.
const TODAY = new Date().toLocaleDateString('en-CA');
const shiftDays = (ymd, n) => {
  const d = ymdToDate(ymd);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* countWorkingDays hits the database twice per call and the same span recurs
 * constantly across a year of leave. Asked once and remembered — still the
 * app's own function, just not re-asked for an answer it has already given.
 * Same cache, same reason, as inspect_leave_data_audit.js:139. */
const spanCache = new Map();
async function workingDaysFor(start, end) {
  const key = `${start}|${end}`;
  if (!spanCache.has(key)) spanCache.set(key, await countWorkingDays(start, end));
  return spanCache.get(key);
}

// ── The sheet ──────────────────────────────────────────────────────────────
/* One wide sheet rather than four, because HR opens one file and filters column
 * A. A section leaves blank every column that does not apply to it; which
 * columns those are is spelled out in the header block written at the top of
 * the CSV. */
const COLUMNS = [
  'section', 'case_id', 'employee_code', 'employee_name', 'department',
  'kind', 'date', 'day_of_week',
  'leave_id', 'leave_type', 'start', 'end', 'status',
  'days_charged', 'days_expected', 'difference',
  'leave_A', 'leave_B', 'overlapping_days', 'why_the_office_was_shut',
  'what_we_see', 'suggestion', 'decision',
];
const rows = [];
const counters = {};
/* "1 - Zoho ANXT HR" is the account the Zoho migration ran under, not a person.
 * Its 50 overlapping leave pairs were test and import residue; asking HR to
 * adjudicate them buried the six real pairs underneath. Every real employee
 * code here starts ANXT, so anything else is set aside and counted, never
 * silently dropped. */
const isPerson = (code) => /^ANXT/i.test(String(code || ''));
const setAside = {};
function addCase(prefix, fields) {
  if (!isPerson(fields.employee_code)) {
    setAside[prefix] = (setAside[prefix] || 0) + 1;
    return null;
  }
  counters[prefix] = (counters[prefix] || 0) + 1;
  const case_id = `${prefix}-${String(counters[prefix]).padStart(3, '0')}`;
  const row = { section: prefix, case_id, decision: '' };
  for (const c of COLUMNS) if (fields[c] !== undefined) row[c] = fields[c];
  rows.push(row);
  return row;
}

const SECTION_TITLES = {
  D2: 'Absence nobody accounted for',
  E2: 'Duplicate and overlapping leave',
  E1: 'Day count that does not match the dates',
  E3: 'Leave charged on a day the office was shut',
};
const ALLOWED = {
  D2: ['LOP', 'add leave (type)', 'present - fix attendance', 'ignore', 'not tracked - ignore all'],
  E2: ['keep A', 'keep B', 'keep both', 'HR to check'],
  E1: ['set to expected', 'keep as is', 'HR to check'],
  E3: ['refund the day', 'keep as is', 'HR to check'],
};

function heading(prefix, why) {
  console.log('\n──────────────────────────────────────────────────────────────────────────');
  console.log(`  ${prefix}. ${SECTION_TITLES[prefix]}`);
  console.log('──────────────────────────────────────────────────────────────────────────');
  console.log(`  ${why}`);
  console.log(`  HR writes one of: ${ALLOWED[prefix].join('  |  ')}`);
  console.log('');
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log(`  Leave review sheet — ${YEAR}${ONLY ? `  (only ${ONLY})` : ''}`);
  console.log('  READ ONLY. Nothing is written to the database and no mail is sent.');
  console.log('  Four things to decide, one row per case, one empty decision column.');
  console.log('══════════════════════════════════════════════════════════════════════════');

  // ── Load ─────────────────────────────────────────────────────────────────
  /* Employees, exactly the way inspect_leave_data_audit.js:193-197 loads them,
   * plus department — which the audit does not need and HR does, because a
   * sheet sorted by department is a sheet each manager can be handed a slice of. */
  const everyone = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',COALESCE(last_name,''))) AS name,
            COALESCE(NULLIF(TRIM(department), ''), '(none recorded)') AS department,
            joining_date::date::text AS joined,
            (deleted_at IS NULL AND (status IS NULL OR LOWER(status) = 'active')) AS active
       FROM employees ORDER BY employee_id`)).rows;
  const byId = new Map(everyone.map(p => [p.id, p]));
  let active = everyone.filter(p => p.active);
  if (ONLY) active = active.filter(p => p.code === ONLY);
  if (ONLY && !active.length) {
    console.log(`\n  No ACTIVE employee has the code ${ONLY}. Nothing to review.\n`);
    await pool.end();
    process.exit(1);
  }
  const activeIds = new Set(active.map(p => p.id));

  /* The approval-chain test, copied from inspect_leave_data_audit.js:215-219.
   * Two tables have held the chain over this app's life and only one exists on
   * any given database, so the presence of the legacy one decides the SQL. It
   * matters here because "approved with no approver AND no chain" is the whole
   * of how an imported leave is told apart from one applied in this system. */
  const haveLegacyChain = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'leave_approval_levels'`)).rows[0].n > 0;
  const chainSql = haveLegacyChain
    ? `(EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)
        OR EXISTS (SELECT 1 FROM leave_approval_levels b WHERE b.leave_id = l.id))`
    : `EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)`;

  /* Every leaves row dated in the year, every status, every employee — copied
   * from inspect_leave_data_audit.js:225-235. Filtering to active people
   * happens below, on the same activeIds test the audit uses, so the three
   * leave sections see exactly the rows the audit's E1/E2/E3 saw. */
  const allLeaves = (await pool.query(
    `SELECT l.id, l.employee_id, l.leave_type, l.status,
            l.start_date::date::text AS start_date, l.end_date::date::text AS end_date,
            l.total_days::float AS total_days, l.hours::float AS hours,
            l.is_half_day, l.half_day_type, COALESCE(l.sandwich_days, 0)::float AS sandwich_days,
            l.approved_by, l.approved_at, l.created_at, l.split_from, l.reason,
            ${chainSql} AS has_chain
       FROM leaves l
      WHERE EXTRACT(YEAR FROM l.start_date) = $1
      ORDER BY l.employee_id, l.start_date`, [YEAR])).rows;
  const yearLeaves = allLeaves.filter(l => activeIds.has(l.employee_id));
  const byEmpLeaves = new Map();
  for (const l of yearLeaves) {
    if (!byEmpLeaves.has(l.employee_id)) byEmpLeaves.set(l.employee_id, []);
    byEmpLeaves.get(l.employee_id).push(l);
  }

  /* The work calendar, read for its NAMES. The audit only ever needs to know
   * whether a day is working; a sheet for HR has to say WHY the office was
   * shut, because "non-working day" is not something anybody can check. Same
   * two tables, and the same precedence utils/workingDays.js:237-243 applies:
   * a closing holiday beats everything, a 'working_day' row is a positive
   * override, otherwise an active weekend rule decides. 'restricted' is an
   * optional holiday and does NOT close the office. */
  const holidays = new Map();
  for (const h of (await pool.query(
    `SELECT date::text AS ymd, name, type FROM holidays
      WHERE EXTRACT(YEAR FROM date) = $1`, [YEAR])).rows) {
    if (!holidays.has(h.ymd)) holidays.set(h.ymd, []);
    holidays.get(h.ymd).push(h);
  }
  const weekendRules = (await pool.query(
    `SELECT name, days_of_week, weeks_of_month, interval_weeks,
            start_date, end_type, end_date, end_count, is_active
       FROM weekend_rules WHERE is_active = TRUE`)).rows;

  /** Why this date is not a working day, named — or null if it is one. */
  function whyShut(ymd) {
    const hols = holidays.get(ymd) || [];
    const closing = hols.find(h => holidayClosesOffice(h.type));
    if (closing) return `${closing.name} (${closing.type} holiday)`;
    if (hols.some(h => h.type === 'working_day')) return null;
    const d = ymdToDate(ymd);
    const rule = weekendRules.find(r => ruleMatchesDate(r, d));
    if (rule) return `${DAY_NAMES[d.getDay()]} — weekend rule "${rule.name}"`;
    const optional = hols.find(h => h.type === 'restricted');
    if (optional) {
      return `${optional.name} is an OPTIONAL (restricted) holiday, so the office was open`;
    }
    return null;
  }

  console.log(`\n  ${active.length} active employee(s)`
    + `${ONLY ? '' : ` of ${everyone.length} on the books`}`
    + `,  ${yearLeaves.length} leave row(s) dated in ${YEAR}`
    + `,  ${holidays.size} holiday date(s)`
    + `,  ${weekendRules.length} active weekend rule(s).`);

  // ═══════════════════════════════════════════════════════════════════════
  // 1. D2 — ABSENCE NOBODY ACCOUNTED FOR
  // ═══════════════════════════════════════════════════════════════════════
  heading('D2',
    'Attendance says this person was not there, and no leave and no on-duty covers the\n'
    + '  day. Payroll would deduct it. Nothing has been deducted yet.');

  /* COPIED from inspect_leave_data_audit.js check D2 (its `uncovered` query).
   * The WHERE clause is character-for-character the audit's — same active test,
   * same absent-like statuses, same two NOT EXISTS, same exclusion of
   * permission from what counts as covering a day (permission is hours out of a
   * day somebody did attend, so it cannot account for an absence).
   * ADDED to the SELECT only: a.employee_id and e.department, both needed to
   * build a row a human can read. Nothing was added to the WHERE. */
  const uncovered = (await pool.query(
    `SELECT a.employee_id, e.employee_id AS code,
            TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
            COALESCE(NULLIF(TRIM(e.department), ''), '(none recorded)') AS department,
            a.date::text AS date, a.status,
            a.check_in IS NOT NULL AS has_in, a.check_out IS NOT NULL AS has_out
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE e.deleted_at IS NULL AND (e.status IS NULL OR LOWER(e.status) = 'active')
        AND EXTRACT(YEAR FROM a.date) = $1
        AND (LOWER(COALESCE(a.status,'')) = ANY($2::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM leaves l
           WHERE l.employee_id = a.employee_id AND l.status = 'approved'
             AND l.leave_type <> 'permission'
             AND a.date BETWEEN l.start_date AND l.end_date)
        AND NOT EXISTS (
          SELECT 1 FROM on_duty_requests o
           WHERE o.employee_id = a.employee_id AND o.status = 'approved'
             AND a.date BETWEEN o.start_date AND o.end_date)
        ${ONLY ? 'AND e.employee_id = $3' : ''}
      ORDER BY e.employee_id, a.date`,
    ONLY ? [YEAR, [...ABSENT_LIKE], ONLY] : [YEAR, [...ABSENT_LIKE]])).rows;

  /* The three things that make one of these days explainable, each fetched for
   * the whole year in one query rather than per row.
   *   1  an approved leave the day before AND the day after — the shape of a
   *      leave that was applied for in two pieces with the middle missed
   *   2  a regularization on the day — somebody already said "I was there"
   *   3  a check-in with no check-out — they were at work; the punch is what
   *      is missing, not the person */
  const approvedSpans = new Map();      // employee_id → [{start,end,type}]
  for (const l of allLeaves.filter(l => l.status === 'approved' && l.leave_type !== 'permission')) {
    if (!approvedSpans.has(l.employee_id)) approvedSpans.set(l.employee_id, []);
    approvedSpans.get(l.employee_id).push(l);
  }
  const coveredBy = (empId, ymd) => (approvedSpans.get(empId) || [])
    .find(l => ymd >= l.start_date && ymd <= l.end_date) || null;

  const regs = new Map();               // `${employee_id}|${date}` → status
  for (const r of (await pool.query(
    `SELECT employee_id, date::text AS date, status FROM attendance_regularizations
      WHERE EXTRACT(YEAR FROM date) = $1`, [YEAR])).rows) {
    regs.set(`${r.employee_id}|${r.date}`, r.status);
  }

  /* Only what payroll would actually deduct is a question for HR.
   * absentDaysForRange (routes/payroll.js:463) counts past WORKING days only, so
   * a Saturday the office was shut or a date still to come can never cost
   * anybody pay. They were listed as cases, which is how 55 people became 1,357
   * rows. They are counted and said out loud instead. */
  let skippedShut = 0, skippedFuture = 0;
  const payable = [];
  for (const r of uncovered) {
    if (r.date > TODAY) { skippedFuture++; continue; }
    if (whyShut(r.date)) { skippedShut++; continue; }
    payable.push(r);
  }

  /* Somebody with a punch missing on most working days of the year is not
   * absent 180 times — they are somebody the attendance system does not track
   * (housekeeping marked by hand, a director who never badges). One row asking
   * that question is what HR can answer; 180 rows is not. */
  /* "Not tracked" is a share, not a count. 46 missed days out of 170 is somebody
   * who punches and often forgets; 179 out of 180 is somebody who never punches.
   * A fixed threshold of 20 called both of them untracked. */
  const BULK = 20;
  const UNTRACKED_SHARE = 0.6;
  const yesterday = shiftDays(TODAY, -1);
  const perEmployee = new Map();
  for (const r of payable) {
    if (!perEmployee.has(r.employee_id)) perEmployee.set(r.employee_id, []);
    perEmployee.get(r.employee_id).push(r);
  }
  const bulkEmployees = new Set();
  const handledDays = new Set();
  for (const [empId, days] of perEmployee) {
    if (days.length <= BULK) continue;
    const joined = byId.get(empId)?.joined;
    const from = joined && joined > `${YEAR}-01-01` ? joined : `${YEAR}-01-01`;
    const possible = from <= yesterday ? await workingDaysFor(from, yesterday) : 0;
    if (!possible || days.length < possible * UNTRACKED_SHARE) continue;
    bulkEmployees.add(empId);
    const first = days[0], last = days[days.length - 1];
    const withIn = days.filter(d => d.has_in).length;
    addCase('D2', {
      employee_code: first.code, employee_name: first.name, department: first.department,
      date: `${first.date}..${last.date}`, day_of_week: `${days.length} working days`,
      what_we_see: `${days.length} past working days between ${first.date} and ${last.date} with no `
        + 'complete punch and no leave or on-duty covering them'
        + (withIn ? ` (${withIn} of them have a check-in but no check-out)` : '')
        + '. Payroll would deduct every one of them.',
      suggestion: 'this looks like somebody the attendance system does not track, not somebody absent '
        + `${days.length} times — confirm whether they punch at all before deciding any single day`,
    });
  }

  /* Several people with no punch on exactly the same dates did not all stay away
   * together. Balaji D and Sanjana V share every working day from 5 to 28
   * January; half the company shares 28 February and 12 May. That is a gap in
   * the record — an induction, a closure the calendar does not know about, a day
   * no attendance was imported — and it has one answer, not one per person.
   * Dates are grouped by the exact set of people missing on them, so a cohort
   * that shares a run of dates becomes a single row. */
  const COHORT_MIN = 3;
  const noPunchByDate = new Map();
  for (const r of payable) {
    if (bulkEmployees.has(r.employee_id) || r.has_in) continue;
    if (!noPunchByDate.has(r.date)) noPunchByDate.set(r.date, []);
    noPunchByDate.get(r.date).push(r);
  }
  const cohorts = new Map();
  for (const [date, people] of noPunchByDate) {
    if (people.length < COHORT_MIN) continue;
    const key = people.map(p => p.employee_id).sort().join(',');
    if (!cohorts.has(key)) cohorts.set(key, { people, dates: [] });
    cohorts.get(key).dates.push(date);
  }
  let cohortDays = 0;
  for (const { people, dates } of cohorts.values()) {
    dates.sort();
    for (const p of people) for (const d of dates) { handledDays.add(`${p.employee_id}|${d}`); cohortDays++; }
    const names = people.map(p => `${p.code} ${p.name}`).join('; ');
    addCase('D2', {
      employee_code: people[0].code,
      employee_name: `${people.length} people: ${names}`,
      department: [...new Set(people.map(p => p.department))].join(', '),
      date: dates.join(' '), day_of_week: `${dates.length} date(s)`,
      what_we_see: `${people.length} people have no punch and no leave on the same ${dates.length} working `
        + 'date(s). Payroll would deduct each of them for each date.',
      suggestion: 'the same dates for several people is a gap in the record, not a group staying away — '
        + 'check whether these were an induction or training period, an office closure or holiday the '
        + 'calendar is missing, or days no attendance was recorded. One answer covers everybody on this row',
    });
  }

  /* A check-in with no check-out is the same mistake repeated, and it has one
   * answer for all of its days: the person was here, the punch is missing. One
   * row per person asks it once. Payroll still counts these days as absent
   * (routes/payroll.js:484 needs both punches), so they cannot be dropped. */
  for (const [empId, days] of perEmployee) {
    if (bulkEmployees.has(empId)) continue;
    const forgot = days.filter(d => d.has_in && !d.has_out);
    if (forgot.length < 2) continue;
    for (const d of forgot) handledDays.add(`${empId}|${d.date}`);
    const first = forgot[0];
    addCase('D2', {
      employee_code: first.code, employee_name: first.name, department: first.department,
      date: forgot.map(d => d.date).join(' '), day_of_week: `${forgot.length} days`,
      what_we_see: `${forgot.length} working days with a check-in but no check-out. Payroll counts a day `
        + 'as attended only with both punches, so every one of these would be deducted.',
      suggestion: 'the person was at work on these days and forgot to check out — "present - fix attendance" '
        + 'covers all of them at once, unless HR knows otherwise for a particular date',
    });
  }

  for (const r of payable) {
    if (bulkEmployees.has(r.employee_id)) continue;
    if (handledDays.has(`${r.employee_id}|${r.date}`)) continue;
    const before = coveredBy(r.employee_id, shiftDays(r.date, -1));
    const after = coveredBy(r.employee_id, shiftDays(r.date, 1));
    const reg = regs.get(`${r.employee_id}|${r.date}`);
    const shut = whyShut(r.date);

    /* Two things that make a day unfit to ask HR about, both said on the row
     * rather than filtered out — filtering would make this section quietly
     * smaller than the audit's D2 and the two counts would stop agreeing.
     *   FUTURE  absentDaysForRange (routes/payroll.js) only ever counts days
     *           already past, so a future-dated absent row deducts nothing yet
     *           and there is nothing to decide about it today.
     *   UNMARKED 'unmarked' can mean nobody punched, or it can mean the
     *           attendance table has no real data for that stretch at all —
     *           the coverage caveat the audit prints under D1. A run of them on
     *           the same dates across many people is the second thing. */
    const isFuture = r.date > TODAY;
    const what = `Attendance says ${r.status}. No leave, no on-duty. `
      + (isFuture
        ? 'This date is still in the future, so nothing has been deducted and there may yet be '
          + 'nothing to decide.'
        : shut
          ? `Note: ${shut} — payroll should not be deducting this day at all.`
          : 'Payroll would deduct this day.')
      + (r.status === 'unmarked'
        ? ' "Unmarked" can also mean the attendance table simply has no data for this stretch '
          + 'rather than that somebody did not turn up — check whether the same dates are '
          + 'unmarked for many people before treating it as one person\'s absence.'
        : '');

    let suggestion;
    if (isFuture) {
      suggestion = 'this date has not happened yet — leave it until it has';
    } else if (before && after) {
      suggestion = `possibly part of the surrounding leave — approved ${before.leave_type} `
        + `${before.start_date}..${before.end_date} ends the day before and approved `
        + `${after.leave_type} ${after.start_date}..${after.end_date} starts the day after`;
    } else if (reg) {
      suggestion = `a regularization for this date already exists and is ${reg}`
        + (reg === 'approved'
          ? ' — the person was at work, so the attendance row is what is wrong'
          : ' — decide that request and this day answers itself');
    } else if (r.has_in && !r.has_out) {
      suggestion = 'there is a check-in on this day but no check-out, so somebody was here '
        + 'and the punch is what is missing, not the person';
    } else if (shut) {
      suggestion = 'the office was shut on this day, so this is an attendance row that should '
        + 'never have been marked absent';
    } else {
      suggestion = 'looks like unpaid absence';
    }

    addCase('D2', {
      employee_code: r.code, employee_name: r.name, department: r.department,
      date: r.date, day_of_week: dayOfWeek(r.date),
      what_we_see: what, suggestion,
    });
  }

  const d2 = rows.filter(r => r.section === 'D2');
  const d2emp = new Set(d2.map(r => r.employee_code));
  console.log(`  ${d2.length} case(s) across ${d2emp.size} employee(s)`
    + (bulkEmployees.size ? ` — ${bulkEmployees.size} a single row for somebody missing a punch on most working days` : '')
    + '.');
  console.log(`  Not listed, because payroll never deducts them: ${skippedShut} day(s) the office was shut, `
    + `${skippedFuture} date(s) still to come.`);
  console.log(`  Grouped: ${cohortDays} person-day(s) where ${COHORT_MIN}+ people share the same missing dates `
    + `became ${cohorts.size} row(s).`);
  if (d2.length) {
    console.log('');
    for (const r of d2.slice(0, 8)) {
      console.log(`  ${pad(r.case_id, 8)}${pad(r.employee_code, 13)}${pad((r.employee_name || '').slice(0, 18), 20)}`
        + `${pad(r.date, 12)}${pad(r.day_of_week, 10)}${String(r.suggestion).slice(0, 60)}`);
    }
    if (d2.length > 8) console.log(`  … and ${d2.length - 8} more in the CSV.`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // 2. E2 — DUPLICATE AND OVERLAPPING LEAVE (one row per PAIR)
  // ═══════════════════════════════════════════════════════════════════════
  heading('E2',
    'Two leave rows covering the same day. Both count, so the same day comes off a\n'
    + '  balance twice. The apply screen refuses this, so a pair that exists was imported\n'
    + '  or edited in directly.');

  /* How a leave row came to exist, on the audit's own fingerprint
   * (inspect_leave_data_audit.js check E4): APPROVED with no approved_by AND no
   * approval_levels row is a shape nothing in this app can produce —
   * zoho_restage.js:1092 writes exactly it. Anything else went through the
   * apply path, which always records either an approver or a chain.
   * This is the only test used; the reason text "Imported from Zoho" is quoted
   * as corroboration when it is there but is never the test on its own,
   * because a reason is free text anybody can type. */
  const isImported = (l) => l.status === 'approved' && !l.approved_by && !l.has_chain;
  const approverName = (id) => (byId.get(id)?.name || 'somebody no longer on the books');
  const howMade = (l) => {
    if (isImported(l)) {
      return 'imported from Zoho (approved with no approver and no approval chain'
        + (String(l.reason || '').trim() === 'Imported from Zoho' ? ', and it says so' : '')
        + ')';
    }
    if (l.status === 'approved') {
      return `applied here and approved${l.approved_by ? ` by ${approverName(l.approved_by)}` : ''}`
        + `${l.has_chain ? ', with an approval chain' : ''}`;
    }
    return `applied here, still ${l.status}${l.has_chain ? ', with an approval chain' : ''}`;
  };
  const describe = (l) => `#${String(l.id).slice(0, 8)} ${l.leave_type} `
    + `${l.start_date}..${l.end_date}, ${num(l.total_days)}d, ${l.status}, ${howMade(l)}`;

  /* COPIED from inspect_leave_data_audit.js check E2. Same pairing, same three
   * exclusions, and they are the reason this does not drown in false pairs:
   *   two permissions on one day are legitimate — different hours of it
   *   a leave split by an extension or a partial cancellation shares a parent
   *   only live statuses count; a rejected or cancelled row charges nothing */
  /* A split day is not a double charge. Zoho records a day that was half casual
   * and half unpaid — or half leave and an hour's permission — as two rows of
   * different types that each carry only part of the day, so they overlap on
   * that date by construction. Deepa's 24 June is 0.5 casual + 0.5 unpaid: one
   * day, charged once. Only a pair where at least one row takes a WHOLE day is a
   * day that can have come off twice. */
  const partOfDay = (l) => l.leave_type === 'permission' || l.is_half_day
    || Math.abs(Number(l.total_days) % 1) > 0.001;
  const splitIds = new Set();
  let splitDays = 0;
  const e2pairs = [];
  for (const p of active) {
    const rowsOf = (byEmpLeaves.get(p.id) || []).filter(l => LIVE_STATUSES.has(l.status));
    for (let i = 0; i < rowsOf.length; i++) {
      for (let j = i + 1; j < rowsOf.length; j++) {
        const a = rowsOf[i], b = rowsOf[j];
        if (a.start_date > b.end_date || b.start_date > a.end_date) continue;
        if (a.leave_type === 'permission' && b.leave_type === 'permission') continue;
        const exact = a.leave_type === b.leave_type && a.start_date === b.start_date && a.end_date === b.end_date;
        const related = (a.split_from && String(a.split_from) === String(b.id))
          || (b.split_from && String(b.split_from) === String(a.id))
          || (a.split_from && b.split_from && String(a.split_from) === String(b.split_from));
        if (related) continue;
        if (!exact && a.leave_type !== b.leave_type && partOfDay(a) && partOfDay(b)) {
          splitIds.add(a.id); splitIds.add(b.id); splitDays++;
          continue;
        }
        e2pairs.push({ p, a, b, exact });
      }
    }
  }

  for (const { p, a, b, exact } of e2pairs) {
    const oStart = a.start_date > b.start_date ? a.start_date : b.start_date;
    const oEnd = a.end_date < b.end_date ? a.end_date : b.end_date;
    const overlapWorking = await workingDaysFor(oStart, oEnd);
    const overlapCalendar = Math.round((ymdToDate(oEnd) - ymdToDate(oStart)) / 86400000) + 1;

    const aImp = isImported(a), bImp = isImported(b);
    /* "The odd shape" is not a feeling. A row is the odd one when its own
     * total_days disagrees with the working days in its own range — i.e. it is
     * also an E1 case below. Keeping that row and deleting a correct one would
     * carry the wrong figure forward, so where the applied-here row is the odd
     * one the suggestion reverses. */
    const oddShape = async (l) => {
      if (l.leave_type === 'permission') return false;
      if (l.total_days === null) return true;
      const wd = await workingDaysFor(l.start_date, l.end_date);
      const expect = l.is_half_day ? 0.5 : round2(wd + (l.sandwich_days || 0));
      return Math.abs(round2(l.total_days) - expect) > 0.01;
    };

    let suggestion;
    if (aImp && bImp && a.leave_type !== b.leave_type) {
      suggestion = `two different Zoho leaves on the same day — ${a.leave_type} (A) and ${b.leave_type} (B). `
        + 'They are not copies of each other, so HR has to say which one the person actually took';
    } else if (aImp && bImp) {
      const later = new Date(a.created_at) >= new Date(b.created_at) ? a : b;
      suggestion = 'two copies of the same Zoho leave, keep one — the later-created copy is '
        + `#${String(later.id).slice(0, 8)} (${later === a ? 'A' : 'B'})`;
    } else if (aImp !== bImp) {
      const imported = aImp ? a : b;
      const applied = aImp ? b : a;
      const impLetter = aImp ? 'A' : 'B';
      const appLetter = aImp ? 'B' : 'A';
      if (await oddShape(applied)) {
        suggestion = `keep the import (${impLetter}, #${String(imported.id).slice(0, 8)}) and remove the row `
          + `applied here (${appLetter}, #${String(applied.id).slice(0, 8)}) — the applied row is the odd `
          + 'shape: its own day count does not match its dates';
      } else {
        suggestion = `keep the one applied here (${appLetter}, #${String(applied.id).slice(0, 8)}), remove the `
          + `import (${impLetter}, #${String(imported.id).slice(0, 8)})`;
      }
    } else {
      suggestion = 'both rows went through the apply screen, which refuses an overlap — so one of '
        + 'them was edited afterwards. HR to check which dates are the real ones';
    }

    const what = exact
      ? `Two leave rows with the same type and exactly the same dates. ${num(a.total_days)} day(s) `
        + `and ${num(b.total_days)} day(s) are both charged for the same ${overlapWorking} working day(s).`
      : `Two leave rows share ${oStart}${oEnd === oStart ? '' : `..${oEnd}`} `
        + `(${overlapWorking} working day(s) of ${overlapCalendar} calendar day(s)). `
        + 'Those days come off a balance twice.';

    addCase('E2', {
      employee_code: p.code, employee_name: p.name, department: p.department,
      kind: exact ? 'exact duplicate' : 'overlap',
      leave_A: describe(a), leave_B: describe(b),
      overlapping_days: overlapWorking,
      what_we_see: what, suggestion,
    });
  }

  const e2 = rows.filter(r => r.section === 'E2');
  const e2emp = new Set(e2.map(r => r.employee_code));
  console.log(`  ${e2.length} pair(s) across ${e2emp.size} employee(s)`
    + ` — ${e2.filter(r => r.kind === 'exact duplicate').length} exact duplicate(s),`
    + ` ${e2.filter(r => r.kind === 'overlap').length} overlap(s).`);
  console.log(`  Not listed: ${splitDays} split day(s) — two part-day rows of different types sharing a date, `
    + 'which is how a day that was half one kind and half another is recorded.');
  if (e2.length) {
    console.log('');
    for (const r of e2.slice(0, 6)) {
      console.log(`  ${pad(r.case_id, 8)}${pad(r.employee_code, 13)}${pad((r.employee_name || '').slice(0, 18), 20)}`
        + `${pad(r.kind, 18)}${lpad(r.overlapping_days, 3)} day(s) twice`);
      console.log(`  ${pad('', 8)}A: ${r.leave_A}`);
      console.log(`  ${pad('', 8)}B: ${r.leave_B}`);
      console.log(`  ${pad('', 8)}→  ${r.suggestion}`);
    }
    if (e2.length > 6) console.log(`  … and ${e2.length - 6} more in the CSV.`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // 3. E1 — DAY COUNT THAT DOES NOT MATCH THE DATES
  // ═══════════════════════════════════════════════════════════════════════
  heading('E1',
    'The number of days charged for a leave is not the number of working days between\n'
    + '  its dates. Every balance and every payroll deduction is computed from the charged\n'
    + '  figure, so whichever of the two is wrong, something downstream is wrong with it.');

  /* COPIED from inspect_leave_data_audit.js check E1. Same expectation
   * routes/leaves.js:479 writes on apply: half-day ? 0.5 : workingDays +
   * sandwichDays. Permission is skipped because days are not its unit, and
   * non-live statuses are skipped because they charge nothing.
   *
   * THE AUDIT'S WARNING APPLIES HERE AND IS CARRIED ONTO EVERY ROW: the
   * calendar is read AS IT IS TODAY. A leave applied before a holiday or a
   * weekend rule was added is re-judged against the new calendar, so a whole
   * cohort differing by the same amount on the same dates is a calendar
   * change, not a wrong row. That is why the cohort is counted below and said
   * out loud in the suggestion rather than left for somebody to notice. */
  const e1cases = [];
  for (const l of yearLeaves) {
    if (l.leave_type === 'permission') continue;
    if (!LIVE_STATUSES.has(l.status)) continue;
    const wd = await workingDaysFor(l.start_date, l.end_date);
    const expect = l.is_half_day ? 0.5 : round2(wd + (l.sandwich_days || 0));
    const got = l.total_days === null ? null : round2(l.total_days);
    // A range with no working day in it at all is E3's case, asked once there.
    if (wd === 0 && !l.is_half_day) continue;
    // Half a day short on a row that shares its edge day with another type is
    // that split day's other half, not a miscount.
    if (splitIds.has(l.id) && l.total_days !== null
        && Math.abs(Math.abs(round2(l.total_days) - (wd + (l.sandwich_days || 0))) - 0.5) < 0.01) continue;
    if (got !== null && Math.abs(got - expect) > 0.01) e1cases.push({ l, wd, expect, got });
    else if (got === null) e1cases.push({ l, wd, expect, got: null });
  }
  // How many people differ the SAME way on the SAME dates.
  const cohort = new Map();
  for (const c of e1cases) {
    const key = `${c.l.start_date}|${c.l.end_date}|${c.got === null ? 'null' : round2(c.got - c.expect)}`;
    cohort.set(key, (cohort.get(key) || 0) + 1);
  }

  for (const { l, wd, expect, got } of e1cases) {
    const p = byId.get(l.employee_id) || {};
    const spanDays = Math.round((ymdToDate(l.end_date) - ymdToDate(l.start_date)) / 86400000) + 1;
    const key = `${l.start_date}|${l.end_date}|${got === null ? 'null' : round2(got - expect)}`;
    const sameWay = cohort.get(key);

    const what = got === null
      ? 'This leave carries no day count at all, so it counts as zero days everywhere — '
        + 'on the balance and in payroll.'
      : `${spanDays} calendar day(s) from ${l.start_date} to ${l.end_date}, of which ${wd} `
        + `${wd === 1 ? 'is a working day' : 'are working days'}`
        + `${l.sandwich_days ? `, plus ${num(l.sandwich_days)} sandwich day(s)` : ''}`
        + `${l.is_half_day ? ', and it is flagged as a half day' : ''}. `
        + `${num(got)} day(s) were charged.`;

    let suggestion;
    if (got === null) {
      suggestion = `${num(expect)} should be charged — ${wd} working day(s) in the range`
        + `${l.sandwich_days ? ` plus ${num(l.sandwich_days)} sandwich` : ''}`
        + '. A blank is not zero days off; it is a day off nobody is counting.';
    } else if (l.is_half_day) {
      suggestion = `it is flagged as a half day, so 0.5 is the figure; ${num(got)} was charged`;
    } else {
      suggestion = `${wd} working day(s) in the range`
        + `${l.sandwich_days ? ` plus ${num(l.sandwich_days)} sandwich day(s)` : ''}`
        + `, so ${num(expect)}; charged ${num(got)}. The dates are what the person actually took, `
        + 'so the charged figure is the one that looks wrong';
    }
    if (sameWay > 1) {
      suggestion += `. CAUTION: ${sameWay} people differ the same way on these same dates — that is `
        + 'the signature of a holiday or weekend rule added after the leave was applied, not of '
        + 'wrong rows. Check the calendar before changing any of them';
    }

    addCase('E1', {
      employee_code: p.code, employee_name: p.name, department: p.department,
      leave_id: l.id, leave_type: l.leave_type,
      start: l.start_date, end: l.end_date, status: l.status,
      days_charged: got === null ? '(blank)' : num(got),
      days_expected: num(expect),
      difference: got === null ? '' : num(round2(got - expect)),
      what_we_see: what, suggestion,
    });
  }

  const e1 = rows.filter(r => r.section === 'E1');
  console.log(`  ${e1.length} leave row(s) across ${new Set(e1.map(r => r.employee_code)).size} employee(s).`);
  if (e1.length) {
    console.log('');
    for (const r of e1.slice(0, 8)) {
      console.log(`  ${pad(r.case_id, 8)}${pad(r.employee_code, 13)}${pad((r.employee_name || '').slice(0, 16), 18)}`
        + `${pad(`${r.start}..${r.end}`, 24)}${pad(r.leave_type, 10)}`
        + `charged ${lpad(r.days_charged, 6)}   expected ${lpad(r.days_expected, 5)}`);
    }
    if (e1.length > 8) console.log(`  … and ${e1.length - 8} more in the CSV.`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // 4. E3 — LEAVE CHARGED ON A DAY THE OFFICE WAS SHUT
  // ═══════════════════════════════════════════════════════════════════════
  heading('E3',
    'A leave whose whole range falls on weekends or holidays, yet days were taken off a\n'
    + '  balance for it. The office was shut; nobody spent leave to be away.');

  /* COPIED from inspect_leave_data_audit.js check E3 — a live, non-permission
   * leave with zero working days in its range. ADDED here: the reason each day
   * is non-working, by name, because "non-working day" is not a thing HR can
   * verify and "Republic Day" is. */
  for (const l of yearLeaves) {
    if (l.leave_type === 'permission') continue;
    if (!LIVE_STATUSES.has(l.status)) continue;
    const wd = await workingDaysFor(l.start_date, l.end_date);
    if (wd > 0) continue;
    const p = byId.get(l.employee_id) || {};

    const reasons = [];
    for (let d = l.start_date; d <= l.end_date; d = shiftDays(d, 1)) {
      reasons.push(`${d}: ${whyShut(d) || 'a working day per the calendar (unexpected here)'}`);
    }
    const spanDays = reasons.length;

    addCase('E3', {
      employee_code: p.code, employee_name: p.name, department: p.department,
      leave_id: l.id, leave_type: l.leave_type,
      start: l.start_date, end: l.end_date, status: l.status,
      days_charged: num(l.total_days), days_expected: '0',
      difference: num(l.total_days),
      why_the_office_was_shut: reasons.join(' | '),
      what_we_see: `${num(l.total_days)} day(s) of ${l.leave_type} charged for `
        + `${l.start_date}${l.end_date === l.start_date ? '' : `..${l.end_date}`}, `
        + `and ${spanDays === 1 ? 'that day is' : `all ${spanDays} of those days are`} non-working.`,
      suggestion: 'the office was shut, so this day should not come off a balance',
    });
  }

  const e3 = rows.filter(r => r.section === 'E3');
  console.log(`  ${e3.length} leave row(s) across ${new Set(e3.map(r => r.employee_code)).size} employee(s).`);
  /* When every one of these lands on the same one or two dates it is rarely six
   * people making the same mistake. It is the calendar: Zoho charged a day this
   * system now calls a weekend. The rule's own start date answers which. */
  if (e3.length) {
    console.log('  Active weekend rules and when each starts — a rule starting AFTER these dates, or');
    console.log('  one Zoho never had, means the day was a working day when the leave was taken:');
    for (const w of weekendRules) {
      console.log(`    "${w.name}"  starts ${w.start_date ? String(w.start_date).slice(0, 10) : '(no start date)'}`);
    }
  }
  if (e3.length) {
    console.log('');
    for (const r of e3.slice(0, 8)) {
      console.log(`  ${pad(r.case_id, 8)}${pad(r.employee_code, 13)}${pad((r.employee_name || '').slice(0, 16), 18)}`
        + `${pad(`${r.start}..${r.end}`, 24)}${pad(r.leave_type, 10)}${lpad(r.days_charged, 5)}d   `
        + String(r.why_the_office_was_shut).slice(0, 48));
    }
    if (e3.length > 8) console.log(`  … and ${e3.length - 8} more in the CSV.`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // THE SHEET
  // ═══════════════════════════════════════════════════════════════════════
  const writable = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch (_) { return false; } };
  let outPath = OUT_ARG;
  let outWhy = 'given with --out';
  if (!outPath) {
    /* backend/uploads first: the app already writes there, and these scripts
     * have hit EACCES writing into /app. Same ladder, same reason, as
     * inspect_leave_data_audit.js:1365. */
    const candidates = [
      [path.join(__dirname, 'uploads'), 'backend/uploads, which the app already writes to'],
      [__dirname, 'the backend directory'],
      [process.cwd(), 'the working directory, because nothing else was writable'],
    ];
    const [dir, why] = candidates.find(([d]) => writable(d)) || [process.cwd(), 'the working directory'];
    outPath = path.join(dir, `leave_review_${YEAR}.csv`);
    outWhy = why;
  }

  const note = [
    `# LEAVE REVIEW SHEET — ${YEAR}${ONLY ? `  (only ${ONLY})` : ''}`,
    '# Filter column A (section) to take one kind of case at a time. Fill in the LAST',
    '# column (decision) on every row. Leave every other column alone.',
    '# Nothing changes until a decision is entered here and somebody applies this sheet.',
    '#',
    '# D2  Absence nobody accounted for      decision: LOP | add leave (type) | present - fix attendance | ignore',
    '#       LOP                       dock the day',
    '#       add leave (type)          it was leave — write which type, e.g. "add leave (casual)"',
    '#       present - fix attendance  they were here; the attendance row is wrong',
    '#       ignore                    do nothing and do not ask again',
    '# E2  Duplicate and overlapping leave   decision: keep A | keep B | keep both | HR to check',
    '#       one row per PAIR. Read leave_A and leave_B, then say which survives.',
    '# E1  Day count does not match dates    decision: set to expected | keep as is | HR to check',
    '#       set to expected           charge days_expected instead of days_charged',
    '# E3  Leave charged on a shut day       decision: refund the day | keep as is | HR to check',
    '#       refund the day            put the day back on the balance',
    '#',
    '# Columns a section does not use are left blank:',
    '#   D2 uses  date, day_of_week',
    '#   E2 uses  kind, leave_A, leave_B, overlapping_days',
    '#   E1 uses  leave_id, leave_type, start, end, status, days_charged, days_expected, difference',
    '#   E3 uses  the E1 columns plus why_the_office_was_shut',
    '#',
    '# Written by inspect_leave_review_sheet.js, which only reads the database.',
    '#',
  ];
  const out = [
    ...note,
    COLUMNS.join(','),
    ...rows.map(r => COLUMNS.map(c => csvCell(r[c] ?? '')).join(',')),
  ].join('\n') + '\n';

  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log('  HOW BIG IS THE JOB');
  console.log('══════════════════════════════════════════════════════════════════════════\n');
  const perEmp = new Map();
  for (const r of rows) {
    if (!r.employee_code) continue;
    if (!perEmp.has(r.employee_code)) perEmp.set(r.employee_code, { name: r.employee_name, n: 0, by: {} });
    const e = perEmp.get(r.employee_code);
    e.n++;
    e.by[r.section] = (e.by[r.section] || 0) + 1;
  }
  for (const s of ['D2', 'E2', 'E1', 'E3']) {
    const n = rows.filter(r => r.section === s).length;
    console.log(`  ${pad(s, 5)}${pad(SECTION_TITLES[s], 44)}${lpad(n, 6)} case(s)`);
  }
  console.log('  ' + '─'.repeat(60));
  console.log(`  ${pad('', 5)}${pad('TOTAL cases to decide', 44)}${lpad(rows.length, 6)}`);
  console.log(`  ${pad('', 5)}${pad('employees they touch', 44)}${lpad(perEmp.size, 6)}\n`);
  const asideTotal = Object.values(setAside).reduce((s, n) => s + n, 0);
  if (asideTotal) {
    console.log(`  Set aside, not asked: ${asideTotal} case(s) on accounts that are not people `
      + `(employee code not starting ANXT, e.g. the Zoho migration account) — `
      + Object.entries(setAside).map(([k, n]) => `${k}×${n}`).join('  ') + '\n');
  }
  if (perEmp.size) {
    const top = [...perEmp].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 10);
    console.log('  Most cases first — start here:\n');
    console.log(`  ${pad('code', 14)}${pad('name', 24)}${lpad('cases', 7)}   breakdown`);
    console.log('  ' + '─'.repeat(70));
    for (const [code, e] of top) {
      console.log(`  ${pad(code, 14)}${pad((e.name || '').slice(0, 22), 24)}${lpad(e.n, 7)}   `
        + ['D2', 'E2', 'E1', 'E3'].filter(s => e.by[s]).map(s => `${s}×${e.by[s]}`).join('  '));
    }
    if (perEmp.size > 10) console.log(`  … and ${perEmp.size - 10} more employee(s) with at least one case.`);
    console.log('');
  }
  if (!rows.length) {
    console.log('  Nothing in any of the four sections. The CSV holds its header block and');
    console.log('  its column names and no case rows.\n');
  }

  try {
    // The byte-order mark is what makes Excel read this as UTF-8; without it
    // every dash and rupee sign in the sheet opens as three garbage characters.
    fs.writeFileSync(outPath, '﻿' + out);
    console.log(`  ${rows.length} case(s) written to ${outPath}`);
    console.log(`  (${outWhy})\n`);
  } catch (e) {
    console.log(`  The CSV could not be written to ${outPath} — ${e.message}`);
    console.log('  Pass --out=<a writable path>. Everything above is complete without it.\n');
  }

  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log('  Nothing was written to the database and no mail was sent. This script has');
  console.log('  no --apply. Fill in the decision column, then say what to change and the');
  console.log('  apply step will be written against the decisions in this sheet.');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
