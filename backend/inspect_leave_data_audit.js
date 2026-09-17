#!/usr/bin/env node
/* ── Every active employee's leave data, every type, checked against itself ──
 *  READ ONLY. This script writes nothing to any database, calls no Zoho write
 *  endpoint, and sends no mail. There is deliberately no --apply and no repair
 *  path: a leave balance is what somebody is paid against, so a wrong figure is
 *  REPORTED here and corrected only after the owner has decided what it should
 *  be.
 *
 *  It exists because leave in this system is spread over five stores that were
 *  never designed to agree with each other:
 *
 *      leaves              the row ledger — every application, every type
 *      leave_balances      per-employee overrides, written by Customize Balance
 *                          and by the Zoho import; whichever exists WINS over
 *                          the accrual engine (utils/leaveBalance.js)
 *      employees.casual_leave   the legacy column, still read as a fallback
 *      comp_offs           the FIFO credit ledger, the only truth for comp-off
 *      attendance          what the day actually looked like
 *
 *  Each check below answers one question that can only be asked by holding two
 *  of those stores up against each other. Nothing is inferred from a single
 *  number: a figure is called wrong only when a second store, or the policy
 *  engine, or the row's own dates contradict it.
 *
 *  SECTIONS
 *    A  Casual (days)      available / booked / granted, which store answered,
 *                          the accrual arithmetic written out, and the Zoho CSV
 *    B  Permission (hours) per-calendar-month cap against a yearly pot, and
 *                          every malformed hour on a permission row
 *    C  Comp-off (days)    the credit ledger, and comp-off taken but not earned
 *    D  LOP / unpaid       unpaid days, uncovered absence, and the reverse
 *    E  Cross-cutting      spans, duplicates, calendars, orphans, vocabulary
 *
 *  SEVERITY
 *    high    a balance or a pay-affecting number is wrong
 *    medium  two stores disagree, or a row cannot be true as written
 *    low     a missing optional field, or something only cosmetic
 *
 *    node inspect_leave_data_audit.js
 *    node inspect_leave_data_audit.js --year=2026
 *    node inspect_leave_data_audit.js --employee=ANXT220038
 *    node inspect_leave_data_audit.js --csv=/app/balances.csv --out=/app/uploads/audit.csv
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
const { availableFor, computedFor } = require('./utils/leaveBalance');
const { getLeavePolicies, getJoiningRule, accrualEvents, grantedToDate } = require('./utils/leavePolicy');
// The SAME function routes/leaves.js:459 uses to decide total_days on apply, so
// a span this script calls wrong is a span the app itself would have written
// differently — not a second opinion about the calendar.
const { countWorkingDays } = require('./utils/workingDays');
// The SAME functions Payroll Run and the Loss of Pay report use, reached the
// same way inspect_lop_discrepancy.js reaches them.
const { lopDaysForRange, absentDaysForRange, loadHolidaysAndRules } = require('./routes/payroll');

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
};
const YEAR = parseInt(arg('year'), 10) || new Date().getFullYear();
const CSV_IN = arg('csv');
const ONLY = arg('employee');
const OUT_ARG = arg('out');
const CUTOVER_ARG = arg('cutover');
// How close an imported leave's created_at has to be to its batch's manifest
// stamp. Same tolerance, same reason, as inspect_zoho_balance_plan.js.
const TOLERANCE_S = parseFloat(arg('tolerance')) || 5;

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '' : String(round2(n)));
const show = (n) => (n === null || n === undefined ? '-' : num(n));
const TODAY = new Date().toLocaleDateString('en-CA');

// leave_types.code spells compensatory off without the underscore; the leaves
// table and leaveBalance.js address it with one.
const canonical = (code) => (code === 'compoff' ? 'comp_off' : code);

/* The statuses a leaves row may hold. routes/leaves.js writes 'pending',
 * 'approved', 'rejected' and 'cancelled'; its own queries also read
 * 'pending_approval', so that spelling is tolerated here rather than reported
 * as junk — but anything else came from somewhere nobody is maintaining. */
const KNOWN_STATUSES = new Set(['pending', 'pending_approval', 'approved', 'rejected', 'cancelled']);
const LIVE_STATUSES = new Set(['approved', 'pending', 'pending_approval']);
// Attendance rows that mean "this person was not accounted for".
const ABSENT_LIKE = new Set(['absent', 'unmarked']);

// ── Findings ───────────────────────────────────────────────────────────────
const findings = [];
/** One row in the CSV and one line under a section heading. */
function flag(person, type, check, severity, detail, ours = null, other = null) {
  findings.push({
    code: person?.code || '', name: person?.name || '', type: type || '',
    check, severity, detail, ours, other,
  });
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

let sectionCount = 0;
function section(title, why) {
  console.log('\n──────────────────────────────────────────────────────────────────────────');
  console.log(`  ${title}`);
  console.log('──────────────────────────────────────────────────────────────────────────');
  if (why) console.log(`  Why it matters: ${why}`);
  console.log('');
}
function check(title, why) {
  sectionCount++;
  console.log(`  ${title}`);
  console.log(`     ${why}`);
}
function none(what = 'None.') { console.log(`     ${what}\n`); }

async function tableExists(name) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`, [name]);
  return r.rows[0].n > 0;
}

/* countWorkingDays hits the database twice per call. The same span recurs
 * constantly across a year of leave, so it is asked once and remembered —
 * still the app's own function, just not re-asked for an answer it has
 * already given. */
const spanCache = new Map();
async function workingDaysFor(start, end) {
  const key = `${start}|${end}`;
  if (!spanCache.has(key)) spanCache.set(key, await countWorkingDays(start, end));
  return spanCache.get(key);
}

/* Zoho renames a leave type every year — "Casual Leave 2023", "Permission2025".
 * Same normaliser import_zoho_balances.js and inspect_zoho_balance_plan.js use,
 * so all three read one file the same way. */
const YEAR_SUFFIX = /\s*((?:19|20)\d{2})\s*$/;
const normalise = (raw) => String(raw ?? '').replace(YEAR_SUFFIX, '').trim().toLowerCase();
const yearOf = (header) => (String(header ?? '').match(YEAR_SUFFIX) || [])[1] || null;

function splitCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
const codeOf = (cell) => (String(cell || '').match(/ANXT\w+/) || [])[0] || null;
const nameOf = (cell) => String(cell || '').replace(/ANXT\w+/, '').replace(/^[\s\-–—:|]+/, '').trim();
const FACETS = [
  [/\b(available|availabale|balance|bal|remaining|closing)\b/i, 'available'],
  [/\b(booked|used|taken|availed|consumed|utilised|utilized)\b/i, 'booked'],
];
function facetOf(header) {
  for (const [re, facet] of FACETS) {
    if (re.test(header)) return { facet, bare: header.replace(re, ' ').replace(/\s+/g, ' ').trim() };
  }
  return { facet: 'available', bare: header, defaulted: true };
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log(`  Leave data audit — ${YEAR}${ONLY ? `  (only ${ONLY})` : ''}`);
  console.log('  READ ONLY. Nothing is written to the database and no mail is sent.');
  console.log('══════════════════════════════════════════════════════════════════════════');

  // ── Load ─────────────────────────────────────────────────────────────────
  const [typesRes, everyoneRes] = await Promise.all([
    pool.query(`SELECT id, name, code, unit, pay_type, accrual_mode, accrual_amount,
                       carry_forward, max_days_per_year, is_active
                  FROM leave_types ORDER BY code`),
    pool.query(`SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',COALESCE(last_name,''))) AS name,
                       joining_date::date::text AS joining, status, deleted_at,
                       COALESCE(casual_leave, 0)::float AS legacy_casual,
                       (deleted_at IS NULL AND (status IS NULL OR LOWER(status) = 'active')) AS active
                  FROM employees ORDER BY employee_id`),
  ]);
  const types = typesRes.rows;
  const everyone = everyoneRes.rows;
  const byId = new Map(everyone.map(p => [p.id, p]));
  let active = everyone.filter(p => p.active);
  if (ONLY) active = active.filter(p => p.code === ONLY);
  if (ONLY && !active.length) {
    console.log(`\n  No ACTIVE employee has the code ${ONLY}. Nothing to audit.\n`);
    await pool.end();
    process.exit(1);
  }
  const activeIds = new Set(active.map(p => p.id));

  const [policies, joiningRule] = await Promise.all([getLeavePolicies(), getJoiningRule()]);
  const typeByCanonical = new Map(types.map(t => [canonical(t.code), t]));
  const knownTypeCodes = new Set(types.map(t => canonical(t.code)));

  const haveLegacyChain = await tableExists('leave_approval_levels');
  const chainSql = haveLegacyChain
    ? `(EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)
        OR EXISTS (SELECT 1 FROM leave_approval_levels b WHERE b.leave_id = l.id))`
    : `EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)`;

  /* EVERY leaves row for the year, every status, every employee — active or
   * not. The section that needs only active people filters; the section that
   * exists to find rows belonging to people who have left would see nothing if
   * the query had filtered for it. */
  const leaves = (await pool.query(
    `SELECT l.id, l.employee_id, l.leave_type, l.status,
            l.start_date::date::text AS start_date, l.end_date::date::text AS end_date,
            l.total_days::float AS total_days, l.hours::float AS hours,
            l.is_half_day, l.half_day_type, l.start_time::text AS start_time,
            l.end_time::text AS end_time, COALESCE(l.sandwich_days, 0)::float AS sandwich_days,
            l.approved_by, l.approved_at, l.created_at, l.split_from, l.reason,
            l.balance_source, ${chainSql} AS has_chain
       FROM leaves l
      WHERE EXTRACT(YEAR FROM l.start_date) = $1
      ORDER BY l.employee_id, l.start_date`, [YEAR])).rows;
  const mine = (l) => activeIds.has(l.employee_id);
  const yearLeaves = leaves.filter(mine);
  const byEmpLeaves = new Map();
  for (const l of yearLeaves) {
    if (!byEmpLeaves.has(l.employee_id)) byEmpLeaves.set(l.employee_id, []);
    byEmpLeaves.get(l.employee_id).push(l);
  }

  const balances = (await pool.query(
    `SELECT lb.id, lb.employee_id, lb.leave_type_id, lb.year,
            lb.available::float AS available, lb.booked::float AS booked,
            lt.code AS type_code, lt.name AS type_name, lt.is_active AS type_active
       FROM leave_balances lb
       LEFT JOIN leave_types lt ON lt.id = lb.leave_type_id
      ORDER BY lb.year, lb.employee_id`)).rows;

  const compOffs = (await pool.query(
    `SELECT c.id, c.employee_id, c.worked_date::date::text AS worked_date,
            c.comp_off_date::date::text AS comp_off_date,
            c.days_earned::float AS days_earned, c.days_used::float AS days_used,
            c.status, c.expires_at::date::text AS expires_at, c.approved_by,
            c.created_at,
            EXISTS (SELECT 1 FROM attendance a
                     WHERE a.employee_id = c.employee_id AND a.date = c.worked_date) AS has_attendance,
            EXISTS (SELECT 1 FROM attendance a
                     WHERE a.employee_id = c.employee_id AND a.date = c.worked_date
                       AND a.check_in IS NOT NULL) AS has_checkin
       FROM comp_offs c
      ORDER BY c.employee_id, c.worked_date`)).rows;

  console.log(`\n  ${active.length} active employee(s)`
    + `${ONLY ? '' : ` of ${everyone.length} on the books`}`
    + `,  ${yearLeaves.length} leave row(s) dated in ${YEAR}`
    + `,  ${balances.length} leave_balances row(s)`
    + `,  ${compOffs.length} comp-off credit(s).`);

  /* The work calendar for the whole year, loaded the way routes/payroll.js
   * loads it — month by month, holiday scopes included — because
   * absentDaysForRange and lopDaysForRange take exactly that shape. */
  const holMap = new Map();
  let rules = [];
  for (let m = 1; m <= 12; m++) {
    const md = await loadHolidaysAndRules(m, YEAR);
    md.holMap.forEach((v, k) => holMap.set(k, v));
    rules = md.rules;
  }
  const yearStart = new Date(`${YEAR}-01-01`);
  const yearEndYmd = `${YEAR}-12-31`;
  const yearEnd = new Date(yearEndYmd);

  // ═══════════════════════════════════════════════════════════════════════
  // A. CASUAL (days)
  // ═══════════════════════════════════════════════════════════════════════
  section('A. CASUAL LEAVE (days)',
    'this is the one type with a real ceiling that people spend, so a wrong figure\n'
    + '  is either leave somebody cannot take or leave they were never entitled to.');

  const casualType = typeByCanonical.get('casual');
  const casualPolicy = policies.get('casual');
  const casualRows = [];

  for (const p of active) {
    const store = await availableFor(pool, p.id, 'casual', YEAR);
    const computed = await computedFor(pool, p.id, 'casual', YEAR);
    // The accrual, spelled out event by event, so a figure can be traced
    // rather than argued about.
    const events = accrualEvents(casualPolicy, {
      year: YEAR, joiningDate: p.joining, joiningRule,
      annualAmount: casualPolicy.accrualMode === 'annual' ? p.legacy_casual || null : null,
    });
    const joinedThisYear = String(p.joining || '').slice(0, 4) === String(YEAR);
    const subjectToRule = joinedThisYear && joiningRule.appliesToJoinersFrom
      && String(p.joining).slice(0, 10) >= joiningRule.appliesToJoinersFrom;
    const grandfathered = joinedThisYear && !subjectToRule
      && (joiningRule.grandfatherFullYear || []).includes('casual');

    const stored = casualType
      ? balances.find(b => b.employee_id === p.id && b.leave_type_id === casualType.id && b.year === YEAR)
      : null;
    const rowsOf = (byEmpLeaves.get(p.id) || []).filter(l => l.leave_type === 'casual');
    const approvedDays = round2(rowsOf.filter(l => l.status === 'approved')
      .reduce((s, l) => s + (l.total_days || 0), 0));
    const pendingDays = round2(rowsOf.filter(l => l.status === 'pending' || l.status === 'pending_approval')
      .reduce((s, l) => s + (l.total_days || 0), 0));

    casualRows.push({
      p, store, computed, events, stored, approvedDays, pendingDays,
      joinedThisYear, subjectToRule, grandfathered,
      booked: stored ? stored.booked : computed.taken,
    });
  }

  check('A1. What each person\'s casual balance is, and which store said so',
    'a stored leave_balances row WINS over the accrual engine (utils/leaveBalance.js:76),\n'
    + '     so the store that answered decides whether the accrual arithmetic is even read.');
  const headA = `     ${pad('code', 14)}${pad('name', 22)}${pad('joined', 12)}`
    + `${lpad('avail', 7)}${lpad('booked', 8)}${lpad('granted', 8)}`
    + `${lpad('appr', 6)}${lpad('pend', 6)}   ${pad('store', 15)}accrual`;
  console.log(headA);
  console.log('     ' + '─'.repeat(headA.length - 5));
  for (const r of casualRows) {
    const months = r.events.length;
    const per = r.events.length ? r.events[0].amount : 0;
    const maths = casualPolicy.accrualMode === 'monthly'
      ? `${months} month(s) × ${num(per)} = ${num(r.computed.granted)}`
        + `${r.joinedThisYear ? (r.grandfathered ? '  [joiner: grandfathered to a full year]'
          : r.subjectToRule ? `  [joiner: rule from ${joiningRule.appliesToJoinersFrom}, `
            + `${joiningRule.minDaysRemaining}d min, joining month ${r.events[0] && Number(r.events[0].month) === Number(String(r.p.joining).slice(5, 7)) ? 'counted' : 'SKIPPED'}]`
            : '  [joiner: pre-dates the joining rule, full months]') : ''}`
      : `${casualPolicy.accrualMode} ${num(casualPolicy.accrualAmount)} → ${num(r.computed.granted)}`;
    console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 20), 22)}${pad((r.p.joining || '').slice(0, 10), 12)}`
      + `${lpad(show(r.store.available), 7)}${lpad(show(r.booked), 8)}`
      + `${lpad(show(r.stored ? round2((r.stored.available || 0) + (r.stored.booked || 0)) : r.computed.granted), 8)}`
      + `${lpad(num(r.approvedDays), 6)}${lpad(num(r.pendingDays), 6)}   ${pad(r.store.store, 15)}${maths}`);
  }
  console.log('');
  console.log('     granted = the year\'s entitlement. For a stored row it is available + booked,');
  console.log('     which is how routes/leaves.js:1690 reconstructs it — every write to that store');
  console.log('     preserves the sum. For a computed row it is the accrual total.\n');

  check('A2. Stored rows where available + booked does not equal the year\'s grant',
    'the balance card reconstructs "22 of 24" from available + booked, so when that sum\n'
    + '     is not the grant the card quotes an entitlement nobody was ever given.');
  let a2 = 0;
  for (const r of casualRows) {
    if (!r.stored) continue;
    const sum = round2((r.stored.available || 0) + (r.stored.booked || 0));
    const grant = r.computed.granted;
    if (grant === null) continue;
    if (Math.abs(sum - grant) > 0.01) {
      a2++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `available ${num(r.stored.available)} + booked ${num(r.stored.booked)} = ${num(sum)}`
        + `   policy grant ${num(grant)}   off by ${num(round2(sum - grant))}`);
      flag(r.p, 'casual', 'A2 stored grant does not reconstruct', 'high',
        `leave_balances available ${num(r.stored.available)} + booked ${num(r.stored.booked)} = ${num(sum)}, `
        + `policy grants ${num(grant)} for ${YEAR}`, num(sum), num(grant));
    }
  }
  if (!a2) none(); else console.log('');

  check('A3. Stored rows whose booked undercounts the leave actually approved',
    'PUT /leave-types/balances/:employeeId (Customize Balance) hard-codes booked to 0 on\n'
    + '     insert and never updates it — the fingerprint inspect_leave_balance_audit.js\n'
    + '     documented. From that moment the person\'s own leave stops counting against them.');
  let a3 = 0;
  for (const r of casualRows) {
    if (!r.stored) continue;
    const gap = round2(r.approvedDays - (r.stored.booked || 0));
    if (gap > 0.01) {
      a3++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `booked ${num(r.stored.booked)}   actually approved ${num(r.approvedDays)}   invisible ${num(gap)}d`);
      flag(r.p, 'casual', 'A3 booked undercounts approved leave', 'high',
        `${num(gap)} day(s) of approved casual leave are invisible to this balance`,
        num(r.stored.booked), num(r.approvedDays));
    }
  }
  if (!a3) none(); else console.log('');

  check('A4. Negative or impossible casual figures',
    'available below zero is leave already spent that nothing stops being spent again;\n'
    + '     available above the grant is leave that was never granted.');
  let a4 = 0;
  for (const r of casualRows) {
    const avail = r.store.available;
    if (avail === null) continue;
    const grant = r.stored ? round2((r.stored.available || 0) + (r.stored.booked || 0)) : r.computed.granted;
    if (r.stored && (r.stored.available < -0.01 || r.stored.booked < -0.01)) {
      a4++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `NEGATIVE stored figure: available ${num(r.stored.available)} booked ${num(r.stored.booked)}`);
      flag(r.p, 'casual', 'A4 negative stored balance', 'high',
        `leave_balances holds a negative figure`, `available ${num(r.stored.available)} booked ${num(r.stored.booked)}`, '>= 0');
    }
    if (grant !== null && avail - grant > 0.01) {
      a4++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `available ${num(avail)} exceeds the year's grant ${num(grant)}`);
      flag(r.p, 'casual', 'A4 available exceeds grant', 'high',
        `available is ${num(round2(avail - grant))} day(s) more than the year grants`, num(avail), num(grant));
    }
  }
  if (!a4) none(); else console.log('');

  check('A5. Where the card and the apply-time check would quote different numbers',
    'availableFor() is what refuses an application. For anyone with no stored row and no\n'
    + '     computed policy the two used to read different columns; this proves they agree now.');
  let a5 = 0;
  for (const r of casualRows) {
    if (r.store.store === 'computed' && r.store.available !== r.computed.available) {
      a5++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `availableFor ${num(r.store.available)}   computedFor ${num(r.computed.available)}`);
      flag(r.p, 'casual', 'A5 card and apply-check disagree', 'high',
        'availableFor() and computedFor() return different numbers for the same person',
        num(r.store.available), num(r.computed.available));
    }
    if (r.store.store === 'none') {
      a5++;
      console.log(`     ${pad(r.p.code, 14)}${pad((r.p.name || '').slice(0, 22), 24)}`
        + `no store answers for casual — the balance is UNKNOWN, not zero`);
      flag(r.p, 'casual', 'A5 no store answers', 'medium',
        'neither leave_balances nor the accrual engine produced a casual balance', 'null', 'a number');
    }
  }
  if (!a5) none('None. Every active employee\'s casual balance comes from one agreed store.\n'); else console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // B. PERMISSION (hours)
  // ═══════════════════════════════════════════════════════════════════════
  section('B. PERMISSION (hours)',
    'our model is a per-CALENDAR-MONTH cap with no carry-forward; Zoho\'s is a yearly\n'
    + '  pot. The two can never be compared as one number, so both are printed: the month\n'
    + '  that matters for an application, and the year total that matters for a comparison.');

  const permPolicy = policies.get('permission');
  const permCap = ['monthly', 'annual'].includes(permPolicy.accrualMode) ? permPolicy.accrualAmount : 0;
  const permGrantedYear = (p) => grantedToDate(permPolicy, { year: YEAR, joiningDate: p.joining, joiningRule });
  const thisMonth = new Date().getMonth() + 1;
  const monthOf = (ymd) => parseInt(String(ymd).slice(5, 7), 10);

  console.log(`     Policy: ${permPolicy.accrualMode} ${num(permPolicy.accrualAmount)} ${permPolicy.unit}`
    + `  → monthly cap ${num(permCap)}h (routes/leaves.js:389 reads the same figure).\n`);

  check('B1. Hours used per month, months over the cap, and the year total',
    'the apply path counts approved + PENDING hours in the calendar month (leaves.js:408);\n'
    + '     the balance card counts approved only (leaves.js:1620). Where they differ the card\n'
    + '     promises hours an application would refuse, so both are shown.');
  const headB = `     ${pad('code', 14)}${pad('name', 20)}`
    + Array.from({ length: 12 }, (_, i) => lpad(String(i + 1), 5)).join('')
    + `${lpad('year', 8)}${lpad('grant', 7)}${lpad('card', 6)}${lpad('apply', 7)}`;
  console.log(headB);
  console.log('     ' + '─'.repeat(headB.length - 5));
  let b1 = 0, b1rows = 0;
  for (const p of active) {
    const rowsOf = (byEmpLeaves.get(p.id) || []).filter(l => l.leave_type === 'permission');
    if (!rowsOf.length) continue;
    b1rows++;
    const perMonthLive = Array(13).fill(0);
    const perMonthApproved = Array(13).fill(0);
    for (const l of rowsOf) {
      if (!LIVE_STATUSES.has(l.status)) continue;
      const m = monthOf(l.start_date);
      perMonthLive[m] = round2(perMonthLive[m] + (l.hours || 0));
      if (l.status === 'approved') perMonthApproved[m] = round2(perMonthApproved[m] + (l.hours || 0));
    }
    const yearTotal = round2(perMonthLive.reduce((s, x) => s + x, 0));
    const grant = permGrantedYear(p);
    const cardAvail = round2(Math.max(0, permCap - perMonthApproved[thisMonth]));
    const applyAvail = round2(Math.max(0, permCap - perMonthLive[thisMonth]));
    console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 18), 20)}`
      + perMonthLive.slice(1).map(h => lpad(h ? num(h) : '·', 5)).join('')
      + `${lpad(num(yearTotal), 8)}${lpad(show(grant), 7)}${lpad(num(cardAvail), 6)}${lpad(num(applyAvail), 7)}`);
    for (let m = 1; m <= 12; m++) {
      if (permCap > 0 && perMonthLive[m] - permCap > 0.01) {
        b1++;
        flag(p, 'permission', 'B1 month over the cap', 'high',
          `${YEAR}-${String(m).padStart(2, '0')} holds ${num(perMonthLive[m])}h of approved+pending permission `
          + `against a ${num(permCap)}h monthly cap`, num(perMonthLive[m]), num(permCap));
      }
    }
    if (cardAvail !== applyAvail) {
      b1++;
      flag(p, 'permission', 'B1 card promises more than apply allows', 'medium',
        `this month the balance card shows ${num(cardAvail)}h available (approved only) while an `
        + `application is checked against ${num(applyAvail)}h (approved + pending)`, num(cardAvail), num(applyAvail));
    }
    if (grant !== null && yearTotal - grant > 0.01) {
      flag(p, 'permission', 'B1 year total exceeds the yearly grant', 'medium',
        `${num(yearTotal)}h used across ${YEAR} against ${num(grant)}h granted — legitimate under a `
        + `monthly cap only if the cap moved; worth reading against Zoho's yearly pot`,
        num(yearTotal), num(grant));
    }
  }
  console.log('');
  if (!b1rows) {
    console.log(`     No active employee has a permission row dated in ${YEAR} at all. On a database`);
    console.log('     where permission IS used that is itself worth a second look — the type is');
    console.log('     active and has an allowance, so nobody using it means nobody can.\n');
  }
  console.log('     · = no permission that month.  card = available now per routes/leaves.js:1622.');
  console.log(`     apply = available now per the apply-time check. grant = the whole ${YEAR} accrual,`);
  console.log('     which is the figure to hold against Zoho\'s yearly pot.\n');
  if (!b1) console.log('     No month over the cap and no card/apply disagreement.\n');

  check('B2. Permission rows whose hours cannot be right',
    'hours IS the permission balance — total_days is 0 for this type — so a null, a zero,\n'
    + '     or an hours figure that disagrees with its own time window is a balance nobody\n'
    + '     can reconcile, and a multi-day permission is not a thing this system can create.');
  let b2 = 0;
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  for (const l of yearLeaves) {
    if (l.leave_type !== 'permission') continue;
    const p = byId.get(l.employee_id);
    const issues = [];
    if (l.hours === null || l.hours === undefined) issues.push(['hours is null', 'high', 'null', '> 0']);
    else if (l.hours <= 0) issues.push([`hours is ${num(l.hours)}`, 'high', num(l.hours), '> 0']);
    if (!l.start_time || !l.end_time) {
      issues.push([`the time window is incomplete (start ${l.start_time || 'null'}, end ${l.end_time || 'null'})`,
        'medium', `${l.start_time || 'null'}..${l.end_time || 'null'}`, 'both set']);
    } else {
      const a = toMin(l.start_time), b = toMin(l.end_time);
      if (a !== null && b !== null) {
        const expect = round2((b - a) / 60);
        if (l.hours !== null && Math.abs((l.hours || 0) - expect) > 0.01) {
          issues.push([`hours ${num(l.hours)} does not match ${l.start_time}–${l.end_time} (${num(expect)}h)`,
            'high', num(l.hours), num(expect)]);
        }
        if (expect <= 0) issues.push([`end time is not after the start time`, 'medium', `${l.start_time}–${l.end_time}`, 'end > start']);
      }
    }
    if (l.end_date !== l.start_date) {
      issues.push([`spans ${l.start_date} to ${l.end_date} — permission is single-day by construction`,
        'medium', `${l.start_date}..${l.end_date}`, 'one day']);
    }
    if ((l.total_days || 0) !== 0) {
      issues.push([`total_days is ${num(l.total_days)}; permission must carry 0 so it cannot be counted as days`,
        'medium', num(l.total_days), '0']);
    }
    for (const [detail, sev, ours, other] of issues) {
      b2++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(l.start_date, 12)}`
        + `${pad(l.status, 11)}${detail}`);
      flag(p, 'permission', 'B2 malformed permission row', sev, `${l.start_date}: ${detail}`, ours, other);
    }
  }
  if (!b2) none('None. Every permission row\'s hours agree with its own time window.\n'); else console.log('');

  // ═══════════════════════════════════════════════════════════════════════
  // C. COMP-OFF (days)
  // ═══════════════════════════════════════════════════════════════════════
  section('C. COMP-OFF (days)',
    'comp_offs is the ONLY store for comp-off — leave_balances holds nothing for it — so\n'
    + '  a wrong credit is a paid day off that was never earned, or an earned one that\n'
    + '  cannot be taken.');

  const coByEmp = new Map();
  for (const c of compOffs) {
    if (!coByEmp.has(c.employee_id)) coByEmp.set(c.employee_id, []);
    coByEmp.get(c.employee_id).push(c);
  }

  check('C1. The credit ledger per employee: earned, used, still valid, lapsed',
    'availableFor() counts approved credits whose expires_at has not passed, minus used\n'
    + '     (utils/leaveBalance.js:63). This is that sum broken into its parts.');
  const headC = `     ${pad('code', 14)}${pad('name', 22)}${lpad('credits', 8)}${lpad('earned', 8)}`
    + `${lpad('used', 7)}${lpad('valid', 7)}${lpad('lapsed', 8)}${lpad('pend', 6)}${lpad('rej', 5)}${lpad('avail', 7)}`;
  let anyCo = false;
  console.log(headC);
  console.log('     ' + '─'.repeat(headC.length - 5));
  for (const p of active) {
    const rowsOf = coByEmp.get(p.id) || [];
    if (!rowsOf.length) continue;
    anyCo = true;
    const appr = rowsOf.filter(c => c.status === 'approved');
    const earned = round2(appr.reduce((s, c) => s + (c.days_earned || 0), 0));
    const used = round2(appr.reduce((s, c) => s + (c.days_used || 0), 0));
    const valid = round2(appr.filter(c => !c.expires_at || c.expires_at >= TODAY)
      .reduce((s, c) => s + ((c.days_earned || 0) - (c.days_used || 0)), 0));
    const lapsed = round2(appr.filter(c => c.expires_at && c.expires_at < TODAY)
      .reduce((s, c) => s + Math.max(0, (c.days_earned || 0) - (c.days_used || 0)), 0));
    const store = await availableFor(pool, p.id, 'comp_off', YEAR);
    console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 20), 22)}${lpad(rowsOf.length, 8)}`
      + `${lpad(num(earned), 8)}${lpad(num(used), 7)}${lpad(num(valid), 7)}${lpad(num(lapsed), 8)}`
      + `${lpad(rowsOf.filter(c => c.status === 'pending').length, 6)}`
      + `${lpad(rowsOf.filter(c => c.status === 'rejected').length, 5)}${lpad(show(store.available), 7)}`);
    if (Math.abs(Math.max(0, valid) - (store.available ?? 0)) > 0.01) {
      flag(p, 'comp_off', 'C1 ledger total disagrees with availableFor', 'high',
        'the credit rows do not add up to the balance the app quotes', num(Math.max(0, valid)), show(store.available));
    }
  }
  if (!anyCo) none('No comp-off credits exist for any active employee.\n'); else console.log('');

  check('C2. Credit rows that cannot be true as written',
    'days_used above days_earned, or a negative on either, means the FIFO draw-down in\n'
    + '     utils/leaveBalance.js:160 has been run against a row it should never have touched.');
  let c2 = 0;
  for (const c of compOffs) {
    const p = byId.get(c.employee_id);
    const label = `${c.worked_date} (${c.status})`;
    if ((c.days_used || 0) - (c.days_earned || 0) > 0.001) {
      c2++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(label, 24)}`
        + `used ${num(c.days_used)} > earned ${num(c.days_earned)}`);
      flag(p, 'comp_off', 'C2 days_used exceeds days_earned', 'high',
        `credit for ${label} has ${num(c.days_used)} used against ${num(c.days_earned)} earned`,
        num(c.days_used), `<= ${num(c.days_earned)}`);
    }
    if ((c.days_earned || 0) < 0 || (c.days_used || 0) < 0) {
      c2++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(label, 24)}`
        + `negative: earned ${num(c.days_earned)} used ${num(c.days_used)}`);
      flag(p, 'comp_off', 'C2 negative credit figures', 'high',
        `credit for ${label} holds a negative value`, `earned ${num(c.days_earned)} used ${num(c.days_used)}`, '>= 0');
    }
    if (!c.worked_date) {
      c2++;
      flag(p, 'comp_off', 'C2 credit with no worked date', 'high',
        'a comp-off credit with no worked date cannot be checked against attendance or expired', 'null', 'a date');
    }
  }
  if (!c2) none(); else console.log('');

  check('C3. Credits whose worked day has no attendance behind it',
    'routes/comp-off.js:348 refuses a credit without a recorded check-in on the worked day.\n'
    + '     A credit that has one anyway was written by something other than that route — an\n'
    + '     import, a direct edit — and it is a paid day off with no evidence of the work.');
  let c3 = 0;
  for (const c of compOffs) {
    if (c.status === 'rejected') continue;
    const p = byId.get(c.employee_id);
    if (!c.has_attendance) {
      c3++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(c.worked_date, 12)}`
        + `${pad(c.status, 11)}no attendance row at all for that date`);
      flag(p, 'comp_off', 'C3 credit worked date has no attendance row', 'high',
        `credit for ${c.worked_date} (${c.status}) has no attendance row`, 'no row', 'an attendance row with a check-in');
    } else if (!c.has_checkin) {
      c3++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(c.worked_date, 12)}`
        + `${pad(c.status, 11)}attendance row exists but holds no check-in`);
      flag(p, 'comp_off', 'C3 credit worked date has no check-in', 'medium',
        `credit for ${c.worked_date} (${c.status}) has an attendance row with no check_in`, 'no check_in', 'a check-in');
    }
  }
  if (!c3) none(); else console.log('');

  check('C4. Credits with no expiry, and credits that have quietly lapsed',
    'expires_at NULL is counted FOREVER by availableFor(); a credit already past its\n'
    + '     expiry is counted by nothing, so unused days in it are simply gone. Neither is\n'
    + '     visible on any screen as a number, which is why they are listed here.');
  let c4a = 0, c4b = 0;
  for (const c of compOffs) {
    if (c.status !== 'approved') continue;
    const spare = round2((c.days_earned || 0) - (c.days_used || 0));
    const p = byId.get(c.employee_id);
    if (!c.expires_at && spare > 0.001) {
      c4a++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 20), 22)}${pad(c.worked_date, 12)}`
        + `NO EXPIRY — ${num(spare)}d counted indefinitely`);
      flag(p, 'comp_off', 'C4 credit has no expiry', 'medium',
        `credit for ${c.worked_date} has expires_at NULL, so ${num(spare)} day(s) never lapse`,
        'null', 'worked_date + the configured window');
    }
    if (c.expires_at && c.expires_at < TODAY && spare > 0.001) {
      c4b++;
      flag(p, 'comp_off', 'C4 credit lapsed unused', 'low',
        `credit for ${c.worked_date} expired ${c.expires_at} with ${num(spare)} day(s) unused`,
        num(spare), '0 remaining by the expiry date');
    }
  }
  console.log(`     ${c4a} credit(s) with no expiry at all.`);
  console.log(`     ${c4b} approved credit(s) already past expires_at with days left — these are NOT`);
  console.log('     counted by availableFor(), so nothing is over-stated; they are days lost.\n');

  check('C5. Comp-off LEAVE taken beyond the credits valid at the time',
    'a comp_off leave is approved against the ledger, and debitOnApproval only WARNS when\n'
    + '     the ledger is short (utils/leaveBalance.js:167) — it does not refuse. So a day off\n'
    + '     nobody had earned commits silently and only a walk through the dates finds it.');
  let c5 = 0;
  for (const p of active) {
    const credits = (coByEmp.get(p.id) || []).filter(c => c.status === 'approved');
    const taken = (byEmpLeaves.get(p.id) || [])
      .filter(l => l.leave_type === 'comp_off' && LIVE_STATUSES.has(l.status))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    let spent = 0;
    for (const l of taken) {
      spent = round2(spent + (l.total_days || 0));
      // What the ledger could have covered on the day this leave starts: credits
      // already earned by then and not yet expired by then.
      const capacity = round2(credits
        .filter(c => c.worked_date <= l.start_date && (!c.expires_at || c.expires_at >= l.start_date))
        .reduce((s, c) => s + (c.days_earned || 0), 0));
      if (spent - capacity > 0.01) {
        c5++;
        console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 20), 22)}${pad(l.start_date, 12)}`
          + `${pad(l.status, 11)}${num(l.total_days)}d taken; ${num(spent)}d spent to date against `
          + `${num(capacity)}d ever earned and valid`);
        flag(p, 'comp_off', 'C5 comp-off taken but not earned', 'high',
          `by ${l.start_date} this employee had taken ${num(spent)} day(s) of comp-off against `
          + `${num(capacity)} day(s) of valid credit`, num(spent), num(capacity));
      }
    }
    // The two stores that both claim to know how much comp-off was spent.
    const approvedTaken = round2(taken.filter(l => l.status === 'approved')
      .reduce((s, l) => s + (l.total_days || 0), 0));
    const ledgerUsed = round2(credits.reduce((s, c) => s + (c.days_used || 0), 0));
    if (approvedTaken > 0 || ledgerUsed > 0) {
      if (Math.abs(approvedTaken - ledgerUsed) > 0.01) {
        c5++;
        console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 20), 22)}`
          + `${pad('cross-store', 12)}${pad('', 11)}approved comp_off leave ${num(approvedTaken)}d `
          + `vs ledger days_used ${num(ledgerUsed)}d`);
        flag(p, 'comp_off', 'C5 leaves and ledger disagree on days used', 'high',
          `approved comp_off leave totals ${num(approvedTaken)} day(s) in ${YEAR} while the comp_offs `
          + `ledger records ${num(ledgerUsed)} day(s) used in total — a debit or a refund went missing`,
          num(approvedTaken), num(ledgerUsed));
      }
    }
  }
  if (!c5) none(); else console.log('');

  check('C6. The ghost table: comp_off_requests',
    'migrate_all.js:64 creates comp_off_requests; migrate_fixes.js:20 renames it to\n'
    + '     comp_offs ONLY when comp_offs does not already exist. Run in the other order and\n'
    + '     both tables exist, one of them empty — and four places in the app still address\n'
    + '     the empty one by name.');
  const ghostExists = await tableExists('comp_off_requests');
  if (!ghostExists) {
    console.log('     comp_off_requests does not exist here. Nothing to report.\n');
  } else {
    const ghost = (await pool.query('SELECT COUNT(*)::int AS n FROM comp_off_requests')).rows[0].n;
    console.log(`     comp_off_requests EXISTS and holds ${ghost} row(s); comp_offs holds ${compOffs.length}.`);
    console.log('     These four call sites read or write comp_off_requests, NOT comp_offs:');
    console.log('       utils/leaveApproval.js:112     REQUEST_TABLES — an Auto Approve / Auto Reject');
    console.log('                                      rule writes the decision here, so it updates 0 rows');
    console.log('                                      and the real request stays pending forever');
    console.log('       utils/approvalFollowups.js:22  SOURCES — follow-up reminders never find a');
    console.log('                                      pending comp-off, so none is ever chased');
    console.log('       utils/workflowEngine.js:202    the record loader — a comp_off workflow can never');
    console.log('                                      resolve its own record, so no rule fires');
    console.log('       utils/workflowCatalog.js:169   the catalog entry those two read the table name from');
    console.log('     NOTHING WAS CHANGED. This is reported for a decision, not repaired here.\n');
    flag(null, 'comp_off', 'C6 ghost comp_off_requests table is still addressed by code', 'high',
      `comp_off_requests holds ${ghost} row(s) while comp_offs holds ${compOffs.length}; `
      + 'leaveApproval.js:112, approvalFollowups.js:22, workflowEngine.js:202 and workflowCatalog.js:169 '
      + 'all name the empty table',
      `comp_off_requests: ${ghost} rows`, `comp_offs: ${compOffs.length} rows`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // D. LOP / UNPAID (days)
  // ═══════════════════════════════════════════════════════════════════════
  section('D. LOSS OF PAY / UNPAID (days)',
    'this is the only leave type that changes what somebody is paid, and it has no\n'
    + '  balance at all — availableFor() returns null for it on purpose. So the only\n'
    + '  checks possible are "does the day count", asked from both ends.');

  check('D1. Unpaid days per employee, and the absence payroll would also deduct',
    'lopDaysForRange() counts approved unpaid leave; absentDaysForRange() counts past\n'
    + '     working days with no punches, no leave and no on-duty. The Loss of Pay screen adds\n'
    + '     them into one column under Zoho\'s wording, which hides which of the two moved.');
  const headD = `     ${pad('code', 14)}${pad('name', 22)}${lpad('unpaid', 8)}${lpad('pending', 9)}`
    + `${lpad('lopFn', 8)}${lpad('absent', 8)}${lpad('total', 8)}`;
  console.log(headD);
  console.log('     ' + '─'.repeat(headD.length - 5));
  const lopByEmp = new Map();
  for (const p of active) {
    const rowsOf = (byEmpLeaves.get(p.id) || []).filter(l => l.leave_type === 'unpaid');
    const approved = round2(rowsOf.filter(l => l.status === 'approved').reduce((s, l) => s + (l.total_days || 0), 0));
    const pending = round2(rowsOf.filter(l => l.status === 'pending' || l.status === 'pending_approval')
      .reduce((s, l) => s + (l.total_days || 0), 0));
    let lopFn = null, absentFn = null;
    try {
      lopFn = round2(await lopDaysForRange(p.id, yearStart, yearEnd, holMap, rules, pool));
      absentFn = round2(await absentDaysForRange(p.id, yearStart, yearEnd, holMap, rules, pool));
    } catch (e) {
      flag(p, 'unpaid', 'D1 payroll helper failed', 'medium',
        `lopDaysForRange/absentDaysForRange threw: ${e.message.slice(0, 80)}`, null, null);
    }
    lopByEmp.set(p.id, { approved, pending, lopFn, absentFn });
    if (!approved && !pending && !lopFn && !absentFn) continue;
    console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 20), 22)}${lpad(num(approved), 8)}`
      + `${lpad(num(pending), 9)}${lpad(show(lopFn), 8)}${lpad(show(absentFn), 8)}`
      + `${lpad(show(lopFn === null || absentFn === null ? null : round2(lopFn + absentFn)), 8)}`);
    /* lopDaysForRange only counts days that are already past, and it clips a
     * leave that runs into today, so it is legitimately below the raw total.
     * Above it is not legitimate: nothing can charge more unpaid days than
     * were applied for. */
    if (lopFn !== null && lopFn - approved > 0.01) {
      flag(p, 'unpaid', 'D1 payroll charges more unpaid days than exist', 'high',
        `lopDaysForRange returns ${num(lopFn)} for ${YEAR} against ${num(approved)} day(s) of approved `
        + 'unpaid leave on file', num(lopFn), num(approved));
    }
  }
  console.log('');
  console.log('     unpaid/pending = the leaves rows. lopFn/absent = the functions Payroll Run and');
  console.log('     the Loss of Pay report actually call, over the whole year. lopFn below unpaid is');
  console.log('     expected — it judges only days already past.');
  console.log('     An absent figure close to the number of working days in the year means the');
  console.log('     attendance table has no rows for those days at all, not that somebody did not');
  console.log('     turn up — check attendance coverage before reading it as unpaid absence.\n');

  if (CSV_IN) console.log('     Zoho\'s LWP column is compared in section A6 below, with its caveats.\n');

  check('D2. Absence nothing accounts for',
    'an attendance row marked absent or unmarked with no leave covering it is either a\n'
    + '     missing leave application or an unpaid day nobody has decided about. Either way it\n'
    + '     is money, and it is invisible until somebody runs payroll.');
  const uncovered = (await pool.query(
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
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
  const uncByEmp = new Map();
  for (const r of uncovered) {
    if (!uncByEmp.has(r.code)) uncByEmp.set(r.code, []);
    uncByEmp.get(r.code).push(r);
  }
  for (const [code, rs] of uncByEmp) {
    const p = active.find(x => x.code === code) || { code, name: rs[0].name };
    console.log(`     ${pad(code, 14)}${pad((rs[0].name || '').slice(0, 20), 22)}${lpad(rs.length, 4)} day(s): `
      + rs.slice(0, 12).map(r => r.date).join(' ') + (rs.length > 12 ? ` … +${rs.length - 12}` : ''));
    flag(p, 'unpaid', 'D2 absent with no leave covering it', 'high',
      `${rs.length} attendance row(s) marked ${[...new Set(rs.map(r => r.status))].join('/')} in ${YEAR} with no `
      + `approved leave and no on-duty: ${rs.slice(0, 20).map(r => r.date).join(' ')}`
      + (rs.length > 20 ? ' …' : ''), `${rs.length} day(s)`, '0, or a leave row');
  }
  if (!uncovered.length) none(); else console.log(`\n     ${uncovered.length} day(s) across ${uncByEmp.size} employee(s).\n`);

  check('D3. The reverse: approved leave whose attendance row still says absent',
    'the attendance row is what the muster roll and every absence report read. A day\n'
    + '     approved as leave but still recorded absent is counted twice against the person —\n'
    + '     once as leave, once as an absence — and refreshAttendanceFor() should have fixed it.');
  const contradicted = (await pool.query(
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
            a.date::text AS date, a.status, l.leave_type, l.start_date::text AS s, l.end_date::text AS e
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       JOIN leaves l ON l.employee_id = a.employee_id AND l.status = 'approved'
                    AND l.leave_type <> 'permission'
                    AND a.date BETWEEN l.start_date AND l.end_date
      WHERE e.deleted_at IS NULL AND (e.status IS NULL OR LOWER(e.status) = 'active')
        AND EXTRACT(YEAR FROM a.date) = $1
        AND LOWER(COALESCE(a.status,'')) = ANY($2::text[])
        ${ONLY ? 'AND e.employee_id = $3' : ''}
      ORDER BY e.employee_id, a.date`,
    ONLY ? [YEAR, [...ABSENT_LIKE], ONLY] : [YEAR, [...ABSENT_LIKE]])).rows;
  for (const r of contradicted) {
    const p = active.find(x => x.code === r.code) || { code: r.code, name: r.name };
    console.log(`     ${pad(r.code, 14)}${pad((r.name || '').slice(0, 20), 22)}${pad(r.date, 12)}`
      + `attendance says ${pad(r.status, 10)}approved ${r.leave_type} ${r.s}..${r.e}`);
    flag(p, r.leave_type, 'D3 attendance says absent on an approved leave day', 'medium',
      `${r.date} is inside an approved ${r.leave_type} leave (${r.s}..${r.e}) but the attendance row `
      + `says ${r.status}`, r.status, 'a leave-aware status');
  }
  if (!contradicted.length) none(); else console.log(`\n     ${contradicted.length} day(s).\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // E. CROSS-CUTTING DATA INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════
  section('E. CROSS-CUTTING DATA INTEGRITY (all types)',
    'these do not belong to one leave type. Each is a row that cannot be true as written,\n'
    + '  and every balance computed from the leaves table inherits the error.');

  check('E1. total_days that does not match the dates and the half-day flag',
    'routes/leaves.js:479 writes total_days = half-day ? 0.5 : workingDays + sandwichDays.\n'
    + '     Anything else was not written by the apply path, and total_days is what every\n'
    + '     balance and every payroll deduction is computed from.\n'
    + '     READ THIS BEFORE ACTING: the calendar is read AS IT IS TODAY. A leave applied\n'
    + '     before a weekend rule or a holiday was added is re-judged against the new\n'
    + '     calendar here, so a whole cohort differing by the same amount on the same dates\n'
    + '     is a calendar change, not a wrong row. One person differing alone is the row.');
  let e1 = 0;
  for (const l of yearLeaves) {
    if (l.leave_type === 'permission') continue;         // days are not its unit
    if (!LIVE_STATUSES.has(l.status)) continue;
    const p = byId.get(l.employee_id);
    const wd = await workingDaysFor(l.start_date, l.end_date);
    const expect = l.is_half_day ? 0.5 : round2(wd + (l.sandwich_days || 0));
    const got = l.total_days === null ? null : round2(l.total_days);
    if (got === null) {
      e1++;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 18), 20)}`
        + `${pad(`${l.start_date}..${l.end_date}`, 24)}${pad(l.leave_type, 11)}total_days is NULL`);
      flag(p, l.leave_type, 'E1 total_days is null', 'high',
        `${l.start_date}..${l.end_date} carries no total_days, so it counts as 0 everywhere`, 'null', num(expect));
      continue;
    }
    if (Math.abs(got - expect) > 0.01) {
      e1++;
      const spanDays = Math.round((new Date(l.end_date) - new Date(l.start_date)) / 86400000) + 1;
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 18), 20)}`
        + `${pad(`${l.start_date}..${l.end_date}`, 24)}${pad(l.leave_type, 11)}`
        + `total_days ${lpad(num(got), 5)}   ${spanDays} calendar day(s), ${wd} working`
        + `${l.sandwich_days ? ` + ${num(l.sandwich_days)} sandwich` : ''}`
        + `${l.is_half_day ? '   HALF DAY' : ''}   expected ${num(expect)}`);
      flag(p, l.leave_type, 'E1 total_days does not match the span', 'high',
        `${l.start_date}..${l.end_date} (${spanDays} calendar day(s), ${wd} working`
        + `${l.sandwich_days ? `, ${num(l.sandwich_days)} sandwich` : ''}`
        + `${l.is_half_day ? ', flagged half day' : ''}) carries total_days ${num(got)}`,
        num(got), num(expect));
    }
  }
  if (!e1) none(); else console.log('');

  check('E2. Overlaps and exact duplicates',
    'the apply path refuses an overlap (routes/leaves.js:443), so one that exists was\n'
    + '     imported or edited in. Both rows count, so the same day is charged twice.');
  let e2 = 0;
  for (const p of active) {
    const rowsOf = (byEmpLeaves.get(p.id) || []).filter(l => LIVE_STATUSES.has(l.status));
    for (let i = 0; i < rowsOf.length; i++) {
      for (let j = i + 1; j < rowsOf.length; j++) {
        const a = rowsOf[i], b = rowsOf[j];
        if (a.start_date > b.end_date || b.start_date > a.end_date) continue;
        // Two permissions on one day are legitimate — different hours of it.
        if (a.leave_type === 'permission' && b.leave_type === 'permission') continue;
        const exact = a.leave_type === b.leave_type && a.start_date === b.start_date && a.end_date === b.end_date;
        // A leave split by an extension or a partial cancellation legitimately
        // shares a parent; it is not a duplicate.
        const related = (a.split_from && String(a.split_from) === String(b.id))
          || (b.split_from && String(b.split_from) === String(a.id))
          || (a.split_from && b.split_from && String(a.split_from) === String(b.split_from));
        if (related) continue;
        e2++;
        const what = exact ? 'EXACT DUPLICATE' : 'overlap';
        console.log(`     ${pad(p.code, 14)}${pad((p.name || '').slice(0, 18), 20)}${pad(what, 17)}`
          + `${a.leave_type} ${a.start_date}..${a.end_date} (${a.status}, ${num(a.total_days)}d)`
          + `  ×  ${b.leave_type} ${b.start_date}..${b.end_date} (${b.status}, ${num(b.total_days)}d)`);
        flag(p, a.leave_type === b.leave_type ? a.leave_type : `${a.leave_type}/${b.leave_type}`,
          exact ? 'E2 exact duplicate leave' : 'E2 overlapping leave', 'high',
          `${a.leave_type} ${a.start_date}..${a.end_date} (${a.status}) overlaps `
          + `${b.leave_type} ${b.start_date}..${b.end_date} (${b.status})`,
          `${num(a.total_days)} + ${num(b.total_days)} days charged`, 'one row per day');
      }
    }
  }
  if (!e2) none(); else console.log('');

  check('E3. Leave dated entirely on non-working days',
    'the apply path refuses a range with no working days in it. A leave that has none is\n'
    + '     a day off charged against a balance for a day the office was shut anyway.');
  let e3 = 0;
  for (const l of yearLeaves) {
    if (l.leave_type === 'permission') continue;
    if (!LIVE_STATUSES.has(l.status)) continue;
    const wd = await workingDaysFor(l.start_date, l.end_date);
    if (wd > 0) continue;
    const p = byId.get(l.employee_id);
    e3++;
    console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 18), 20)}`
      + `${pad(`${l.start_date}..${l.end_date}`, 24)}${pad(l.leave_type, 11)}${pad(l.status, 11)}`
      + `${num(l.total_days)}d charged, 0 working days in the range`);
    flag(p, l.leave_type, 'E3 leave on a weekend or holiday', 'medium',
      `${l.start_date}..${l.end_date} contains no working day per the work calendar, yet carries `
      + `total_days ${num(l.total_days)}`, num(l.total_days), '0 (or no leave row at all)');
  }
  if (!e3) none(); else console.log('');

  check('E4. Approvals with nobody behind them, and requests stuck in a queue',
    'an approved row with no approver AND no approval chain is the import fingerprint —\n'
    + '     nothing in the app can produce one. A pending row older than 30 days is a request\n'
    + '     somebody is still waiting on, and an unbuilt chain is why nobody can see it.');
  const fingerprint = yearLeaves.filter(l => l.status === 'approved' && !l.approved_by && !l.has_chain);
  const importReason = fingerprint.filter(l => String(l.reason || '').trim() === 'Imported from Zoho').length;
  console.log(`     ${fingerprint.length} approved row(s) with no approver and no chain`
    + `${fingerprint.length ? ` (${importReason} of them also say "Imported from Zoho")` : ''}.`);
  console.log('     Expected for migrated history — zoho_restage.js:1092 writes exactly this shape —');
  console.log('     and reported as low so the count can be sanity-checked against the migration.');
  for (const l of fingerprint) {
    const p = byId.get(l.employee_id);
    flag(p, l.leave_type, 'E4 approved with no approver and no chain', 'low',
      `${l.start_date}..${l.end_date} is approved with approved_by NULL and no approval_levels row `
      + `(reason: ${String(l.reason || '').slice(0, 40)})`, 'no approver', 'an approver or an import record');
  }
  const stale = yearLeaves.filter(l => (l.status === 'pending' || l.status === 'pending_approval')
    && (Date.now() - new Date(l.created_at).getTime()) / 86400000 > 30);
  console.log('');
  if (!stale.length) console.log('     No pending request older than 30 days.\n');
  else {
    console.log(`     ${stale.length} pending request(s) older than 30 days:\n`);
    for (const l of stale) {
      const p = byId.get(l.employee_id);
      const age = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
      console.log(`     ${pad(p?.code || '?', 14)}${pad((p?.name || '').slice(0, 18), 20)}`
        + `${pad(`${l.start_date}..${l.end_date}`, 24)}${pad(l.leave_type, 11)}`
        + `raised ${String(l.created_at).slice(0, 10)}, ${age}d ago`
        + `${l.has_chain ? '' : '   NO APPROVAL CHAIN — invisible to every manager'}`);
      flag(p, l.leave_type, l.has_chain ? 'E4 pending over 30 days' : 'E4 pending with no approval chain',
        l.has_chain ? 'medium' : 'high',
        `${l.start_date}..${l.end_date} has been pending for ${age} days`
        + (l.has_chain ? '' : ' and has no approval_levels rows, so no manager can see it'),
        `${age} days pending`, 'decided');
    }
    console.log('');
  }

  check('E5. Rows attached to people who are not active, and types nothing knows',
    'a leave row for a departed employee still counts in every org-wide total; a leave_type\n'
    + '     with no leave_types row has no policy, no unit and no balance, so it silently\n'
    + '     computes as nothing.');
  let e5 = 0;
  const orphanEmp = leaves.filter(l => !activeIds.has(l.employee_id) && !ONLY);
  const byOrphan = new Map();
  for (const l of orphanEmp) {
    const p = byId.get(l.employee_id);
    const key = p ? `${p.code}|${p.name}|${p.deleted_at ? 'deleted' : (p.status || 'no status')}`
      : `(no employee row)|${l.employee_id}|missing`;
    byOrphan.set(key, (byOrphan.get(key) || 0) + 1);
  }
  for (const [key, n] of byOrphan) {
    const [code, name, state] = key.split('|');
    e5++;
    console.log(`     ${pad(code, 14)}${pad((name || '').slice(0, 20), 22)}${pad(state, 12)}${n} leave row(s) in ${YEAR}`);
    flag({ code, name }, '', 'E5 leave rows for a non-active employee', 'medium',
      `${n} leave row(s) dated in ${YEAR} belong to an employee who is ${state}`, `${n} rows`, '0');
  }
  if (!orphanEmp.length) console.log('     Every leave row in the year belongs to an active employee.');
  const badType = new Map();
  for (const l of leaves) {
    if (knownTypeCodes.has(l.leave_type)) continue;
    badType.set(l.leave_type, (badType.get(l.leave_type) || 0) + 1);
  }
  console.log('');
  if (!badType.size) console.log('     Every leave_type has a leave_types row.\n');
  else {
    for (const [t, n] of badType) {
      e5++;
      console.log(`     leave_type "${t}" has no leave_types row — ${n} row(s) in ${YEAR}`);
      flag(null, t, 'E5 leave type not in leave_types', 'high',
        `${n} leave row(s) dated in ${YEAR} use leave_type "${t}", which has no leave_types record, so it `
        + 'has no unit, no policy and no balance', t, 'a seeded leave type');
    }
    console.log('     zoho_restage.js:104 maps Zoho names onto sick/earned/maternity/paternity as well as');
    console.log('     the four this app supports, so migrated history can hold a type the app cannot show.\n');
  }
  const badStatus = new Map();
  for (const l of leaves) {
    if (KNOWN_STATUSES.has(l.status)) continue;
    badStatus.set(l.status, (badStatus.get(l.status) || 0) + 1);
  }
  if (!badStatus.size) console.log('     Every status is one of pending / pending_approval / approved / rejected / cancelled.\n');
  else {
    for (const [s, n] of badStatus) {
      e5++;
      console.log(`     status "${s}" is outside the expected set — ${n} row(s) in ${YEAR}`);
      flag(null, '', 'E5 unexpected leave status', 'high',
        `${n} leave row(s) dated in ${YEAR} hold status "${s}", which no route writes and no balance query reads`,
        s, 'pending / approved / rejected / cancelled');
    }
    console.log('');
  }

  check('E6. leave_balances rows nothing can use',
    'a stored row WINS over the accrual engine, so one pointing at a deleted type, a year\n'
    + '     nobody is in, or somebody who has left is an override that either does nothing or\n'
    + '     overrides the wrong thing.');
  let e6 = 0;
  const years = new Set(balances.map(b => b.year));
  for (const b of balances) {
    const p = byId.get(b.employee_id);
    const problems = [];
    if (!b.type_code) problems.push(['points at a leave_type that no longer exists', 'high']);
    else if (b.type_active === false) problems.push([`points at "${b.type_name}", which is not an active leave type`, 'medium']);
    if (!p) problems.push(['belongs to an employee row that no longer exists', 'medium']);
    else if (!p.active) problems.push([`belongs to ${p.deleted_at ? 'a deleted' : `a ${p.status || 'non-active'}`} employee`, 'medium']);
    if (ONLY && p && p.code !== ONLY) continue;
    for (const [detail, sev] of problems) {
      e6++;
      console.log(`     ${pad(p?.code || '(unknown)', 14)}${pad((p?.name || '').slice(0, 20), 22)}`
        + `${pad(b.type_name || '(no type)', 20)}${pad(b.year, 6)}`
        + `available ${lpad(num(b.available), 7)} booked ${lpad(num(b.booked), 7)}   ${detail}`);
      flag(p || { code: '(unknown)', name: '' }, b.type_code || '(none)',
        'E6 unusable leave_balances row', sev,
        `the ${b.year} row (available ${num(b.available)}, booked ${num(b.booked)}) ${detail}`,
        `available ${num(b.available)}`, 'no row, or a live type and employee');
    }
  }
  if (!e6) none(`None. All ${balances.length} row(s) point at a live type, year and employee.\n`);
  else console.log(`\n     Years present in leave_balances: ${[...years].sort().join(', ') || '(none)'}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // A6. THE ZOHO CSV (printed last because it is optional)
  // ═══════════════════════════════════════════════════════════════════════
  if (!CSV_IN) {
    section('A6. ZOHO CSV COMPARISON — not run',
      'no --csv was given, so every figure above is this system checked against itself.\n'
      + '  Pass Zoho\'s Customize Balance export (Leave → Reports → Customize Balance, all\n'
      + '  employees, all leave types, Export as CSV) to add the comparison.');
  } else if (!fs.existsSync(CSV_IN)) {
    section('A6. ZOHO CSV COMPARISON — file not found', `${CSV_IN} is not there.`);
    console.log(`     ${CSV_IN} does not exist. Everything above is unaffected.\n`);
  } else {
    section('A6. ZOHO CSV COMPARISON',
      'Zoho\'s figure is what HR and every employee looked at for four years, so a\n'
      + '  difference here is either leave taken after the cutover (expected) or a balance\n'
      + '  one of the two systems has wrong (not).');

    const lines = fs.readFileSync(CSV_IN, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const headerRows = lines.slice(0, 4).map(splitCsvLine);
    const byName = new Map(types.map(t => [normalise(t.name), t]));
    const byCode = new Map(types.map(t => [normalise(t.code), t]));
    const matchColumn = (h, i) => {
      if (i === 0) return null;
      const { facet, bare, defaulted } = facetOf(h);
      const n = normalise(bare);
      if (!n) return null;
      const type = byName.get(n) || byCode.get(n) || null;
      return type ? { type, facet, defaulted: !!defaulted, year: yearOf(bare) } : null;
    };
    /* Zoho exports a TWO-ROW header — a Paid / Unpaid banner above the type
     * names — and "Unpaid" matches a leave type here, so reading row 1 lands
     * the wrong column's figures under Leave Without Pay. The header is
     * whichever of the first few rows names the most leave types. Same rule as
     * import_zoho_balances.js and inspect_zoho_balance_plan.js. */
    const scored = headerRows.map((row, idx) => ({ idx, row, matches: row.filter(matchColumn).length }));
    const best = scored.reduce((a, b) => (b.matches > a.matches ? b : a), scored[0] || { idx: 0, row: [], matches: 0 });
    const header = best.row;
    const columnType = header.map(matchColumn);
    console.log(`     Header row ${best.idx + 1} of the file, naming ${best.matches} leave type(s).`);
    if (!best.matches) {
      console.log('     No row names a leave type this system has — nothing can be compared.\n');
    } else {
      const unmatched = [];
      const historical = [];
      for (let i = 1; i < header.length; i++) {
        const m = columnType[i];
        if (!m) { if (header[i]) unmatched.push(header[i]); continue; }
        console.log(`       ${pad(header[i], 28)}→ ${pad(m.type.name, 20)}${pad(m.facet, 11)}`
          + (m.year ? `IGNORED — ${m.year} is a closed historical bucket` : 'used as the figure'));
      }
      if (unmatched.length) console.log(`       no leave type here: ${unmatched.join(', ')}`);
      console.log('');

      const byPersonCode = new Map(active.map(p => [p.code, p]));
      const byPersonName = new Map(active.map(p => [normalise(p.name), p]));
      const zoho = new Map();      // `${empId}|${typeId}` → { available, booked, hasBooked }
      const notHere = [];
      const seen = new Set();
      for (const line of lines.slice(best.idx + 1)) {
        const cols = splitCsvLine(line);
        if (!cols[0]) continue;
        const code = codeOf(cols[0]);
        let person = code ? byPersonCode.get(code) : null;
        if (!person) person = byPersonName.get(normalise(nameOf(cols[0]) || cols[0])) || null;
        if (!person) { if (!ONLY) notHere.push(cols[0]); continue; }
        seen.add(person.id);
        cols.forEach((raw, i) => {
          const m = columnType[i];
          if (!m) return;
          const v = String(raw).replace(/[^0-9.-]/g, '');
          if (v === '' || v === '-') return;
          const n = parseFloat(v);
          if (!Number.isFinite(n)) return;
          /* NOT SUMMED. Zoho's screen quotes the unsuffixed column; the
           * year-suffixed ones are closed prior-year buckets, and adding them
           * in invents balances nobody has been quoted. Same rule, and the
           * same reason, as the fix in inspect_zoho_balance_plan.js. */
          if (m.year) { historical.push({ person, type: m.type, header: header[i], value: n }); return; }
          const key = `${person.id}|${m.type.id}`;
          const cur = zoho.get(key) || { available: 0, booked: 0, hasBooked: false };
          cur[m.facet] += n;
          if (m.facet === 'booked') cur.hasBooked = true;
          zoho.set(key, cur);
        });
      }

      /* Which of OUR leave rows Zoho never saw. Two rules, both from
       * inspect_zoho_balance_plan.js — kept textually the same so the two
       * scripts cannot quote different answers. If one changes, change both.
       *   MANIFEST  a leave inside a restaged range whose created_at matches
       *             that batch's stamp came from Zoho; everything else is ours.
       *   CUTOVER   the fallback with no manifests: ours if it starts after the
       *             cutover, or was created after it and carries a chain. */
      const haveManifest = await tableExists('import_backups');
      const manifests = haveManifest ? (await pool.query(
        `SELECT employee_id, batch, created_at,
                row_data->>'start' AS range_start, row_data->>'end' AS range_end
           FROM import_backups
          WHERE table_name = '_manifest' AND row_data ? 'start' AND row_data ? 'end'`)).rows : [];
      const manifestByEmp = new Map();
      for (const m of manifests) {
        if (!manifestByEmp.has(m.employee_id)) manifestByEmp.set(m.employee_id, []);
        manifestByEmp.get(m.employee_id).push(m);
      }
      let cutover = CUTOVER_ARG, cutoverHow = 'given on the command line';
      if (!cutover && manifests.length) {
        cutover = manifests.map(m => m.range_end).filter(Boolean).sort().pop();
        cutoverHow = `the latest end date any zoho_restage.js batch covered (${manifests.length} manifest row(s))`;
      }
      if (!cutover) {
        const fp = yearLeaves.filter(l => l.status === 'approved' && !l.approved_by && !l.has_chain);
        if (fp.length) {
          cutover = fp.map(l => l.start_date).sort().pop();
          cutoverHow = `the latest start date among ${fp.length} row(s) carrying the import fingerprint `
            + '(approved, no approver, no chain) — no import manifest exists here';
        }
      }
      const inManifestRange = (l) => (manifestByEmp.get(l.employee_id) || []).some(m =>
        l.start_date >= String(m.range_start).slice(0, 10)
        && l.start_date <= String(m.range_end).slice(0, 10)
        && Math.abs(new Date(l.created_at) - new Date(m.created_at)) / 1000 <= TOLERANCE_S);
      const ourOnly = (l) => {
        if (manifests.length) return !inManifestRange(l);
        if (!cutover) return false;
        return (l.start_date > cutover)
          || (String(l.created_at.toISOString ? l.created_at.toISOString().slice(0, 10) : l.created_at).slice(0, 10) > cutover
              && l.has_chain);
      };
      console.log(`     cutover ${cutover || '(not derivable)'} — ${cutoverHow}`);
      console.log(`     rule    ${manifests.length ? 'MANIFEST' : (cutover ? 'CUTOVER' : 'NONE — no our-only days can be identified')}\n`);

      const unitByCanonical = new Map(types.map(t => [canonical(t.code), t.unit]));
      const ours = new Map();
      for (const l of yearLeaves) {
        if (!LIVE_STATUSES.has(l.status)) continue;
        if (!ourOnly(l)) continue;
        const key = `${l.employee_id}|${l.leave_type}`;
        const d = (unitByCanonical.get(l.leave_type) === 'hours' ? l.hours : l.total_days) || 0;
        const cur = ours.get(key) || { all: 0, approved: 0 };
        cur.all = round2(cur.all + d);
        if (l.status === 'approved') cur.approved = round2(cur.approved + d);
        ours.set(key, cur);
      }

      const headZ = `     ${pad('code', 14)}${pad('name', 20)}${pad('type', 18)}`
        + `${lpad('zoho', 8)}${lpad('ours', 8)}${lpad('diff', 8)}${lpad('ourOnly', 9)}${lpad('left', 8)}   verdict`;
      console.log(headZ);
      console.log('     ' + '─'.repeat(headZ.length - 5));
      const typeById = new Map(types.map(t => [t.id, t]));
      let z = 0;
      for (const [key, zf] of [...zoho].sort()) {
        const [empId, typeId] = key.split('|');
        const person = active.find(p => p.id === empId);
        const type = typeById.get(typeId);
        if (!person || !type) continue;
        const code = canonical(type.code);
        const o = ours.get(`${empId}|${code}`) || { all: 0, approved: 0 };
        const store = await availableFor(pool, person.id, code, YEAR);
        const oursAvail = store.available;
        const diff = oursAvail === null ? null : round2(oursAvail - zf.available);
        const residual = oursAvail === null ? null : round2(zf.available - o.all - oursAvail);
        const verdict = oursAvail === null
          ? `no balance here (${code === 'unpaid' ? 'LWP has no ceiling' : code === 'permission' ? 'hours against a monthly cap' : store.store})`
          : Math.abs(residual) <= 0.01
            ? 'explained by leave applied here after the cutover'
            : `UNEXPLAINED by ${num(residual)}`;
        console.log(`     ${pad(person.code, 14)}${pad((person.name || '').slice(0, 18), 20)}${pad(type.name.slice(0, 16), 18)}`
          + `${lpad(num(zf.available), 8)}${lpad(show(oursAvail), 8)}${lpad(show(diff), 8)}`
          + `${lpad(num(o.all), 9)}${lpad(show(residual), 8)}   ${verdict}`);
        if (oursAvail !== null && Math.abs(residual) > 0.01) {
          z++;
          flag(person, code, 'A6 balance differs from Zoho and nothing explains it', 'high',
            `Zoho says ${num(zf.available)}, we say ${num(oursAvail)} (store: ${store.store}); `
            + `${num(o.all)} day(s) of leave applied here after the cutover accounts for part of it, `
            + `leaving ${num(residual)} unexplained`, num(oursAvail), num(zf.available));
        }
        if (code === 'unpaid') {
          const l = lopByEmp.get(person.id);
          flag(person, 'unpaid', 'A6 Zoho LWP figure for review', 'low',
            `Zoho's LWP column reads ${num(zf.available)}. It is a COUNT OF DAYS TAKEN, not a `
            + `balance — this type has no ceiling here — and an earlier export of it disagreed with `
            + `Zoho's own screen, so it is not evidence on its own. Ours: ${num(l?.approved)} approved `
            + `unpaid day(s) in ${YEAR}, plus ${num(l?.absentFn)} unmarked absent day(s)`,
            num(l?.approved), num(zf.available));
        }
      }
      console.log('');
      console.log('     left = Zoho − ourOnly − ours. Zero means the whole difference is leave applied');
      console.log('     here after Zoho stopped being the system of record, which is expected and');
      console.log('     needs no action. Anything else is a figure one of the two has wrong.\n');
      if (historical.length) {
        console.log(`     ${historical.length} year-suffixed figure(s) in the file were LISTED AND IGNORED, not summed`);
        console.log('     into the current column — the bug fixed in inspect_zoho_balance_plan.js. Run');
        console.log('     that script for the itemised list.\n');
      }
      const missing = active.filter(p => !seen.has(p.id));
      console.log(`     ${missing.length} active employee(s) have no row in the file`
        + `${missing.length ? `: ${missing.slice(0, 15).map(p => p.code).join(' ')}${missing.length > 15 ? ' …' : ''}` : ''}`);
      console.log('     (most will be joiners after the cutover; nothing is proposed for them).');
      console.log(`     ${notHere.length} file row(s) match nobody active here`
        + `${notHere.length ? `: ${notHere.slice(0, 8).join(' | ')}${notHere.length > 8 ? ' …' : ''}` : ''}\n`);
      if (!z) console.log('     No unexplained balance difference against Zoho.\n');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════════════\n');
  const byCheck = new Map();
  for (const f of findings) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, { n: 0, sev: f.severity });
    byCheck.get(f.check).n++;
  }
  console.log(`  ${pad('check', 58)}${pad('severity', 10)}findings`);
  console.log('  ' + '─'.repeat(76));
  for (const [name, v] of [...byCheck].sort()) {
    console.log(`  ${pad(name.slice(0, 56), 58)}${pad(v.sev, 10)}${lpad(v.n, 8)}`);
  }
  if (!findings.length) console.log('  Nothing was found by any check.');
  console.log('');
  const bySev = (s) => findings.filter(f => f.severity === s).length;
  console.log(`  ${lpad(bySev('high'), 6)} high    a balance or pay-affecting number is wrong`);
  console.log(`  ${lpad(bySev('medium'), 6)} medium  two stores disagree, or a row cannot be true as written`);
  console.log(`  ${lpad(bySev('low'), 6)} low     a missing optional field, or expected migration residue`);
  console.log(`  ${lpad(findings.length, 6)} total findings\n`);

  /* "N of 57 active employee(s)" used to count every code any finding carried,
   * and E5/E6 deliberately report people who are NOT in the active set —
   * leavers, deleted rows, an employee row that no longer exists at all. So the
   * numerator counted people the denominator excluded and could read "81 of 57".
   * The active line now counts only active codes; the rest are reported on
   * their own line, the way org-wide findings already are. */
  const activeCodes = new Set(active.map(p => p.code));
  const withCode = findings.filter(f => f.code);
  const affected = new Set(withCode.filter(f => activeCodes.has(f.code)).map(f => f.code));
  const affectedHigh = new Set(withCode
    .filter(f => activeCodes.has(f.code) && f.severity === 'high').map(f => f.code));
  console.log(`  ${lpad(affected.size, 6)} of ${active.length} active employee(s) have at least one finding`);
  console.log(`  ${lpad(affectedHigh.size, 6)} of ${active.length} have at least one HIGH finding`);
  if (affectedHigh.size) {
    console.log(`\n  With a high finding: ${[...affectedHigh].sort().join(' ')}`);
  }
  const leaverCodes = new Set(withCode.filter(f => !activeCodes.has(f.code)).map(f => f.code));
  const leaverFindings = withCode.filter(f => !activeCodes.has(f.code)).length;
  if (leaverFindings) {
    console.log(`\n  ${lpad(leaverFindings, 6)} finding(s) belong to ${leaverCodes.size} person/people who are NOT in`);
    console.log('         the active set — leavers, deleted rows, or an employee row that no longer');
    console.log('         exists. E5 and E6 exist to find exactly these, so they are counted here');
    console.log('         rather than against the active headcount above.');
    console.log(`         ${[...leaverCodes].sort().join(' ')}`);
  }
  const orgWide = findings.filter(f => !f.code).length;
  if (orgWide) console.log(`\n  ${orgWide} finding(s) are org-wide rather than about one person.`);
  console.log('');

  // ── CSV ──────────────────────────────────────────────────────────────────
  const writable = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch (_) { return false; } };
  let outPath = OUT_ARG;
  let outWhy = 'given with --out';
  if (!outPath) {
    // backend/uploads first: the app already writes there, and these scripts
    // have hit EACCES writing into /app.
    const candidates = [
      [path.join(__dirname, 'uploads'), 'backend/uploads, which the app already writes to'],
      [__dirname, 'the backend directory'],
      [process.cwd(), 'the working directory, because nothing else was writable'],
    ];
    const [dir, why] = candidates.find(([d]) => writable(d)) || [process.cwd(), 'the working directory'];
    outPath = path.join(dir, `leave_data_audit_${YEAR}.csv`);
    outWhy = why;
  }
  const out = [
    ['employee_code', 'employee_name', 'leave_type', 'check', 'severity', 'detail',
      'our_value', 'expected_or_other_value'].join(','),
    ...findings.map(f => [f.code, f.name, f.type, f.check, f.severity, f.detail,
      f.ours === null || f.ours === undefined ? '' : f.ours,
      f.other === null || f.other === undefined ? '' : f.other].map(csvCell).join(',')),
  ].join('\n') + '\n';
  try {
    fs.writeFileSync(outPath, out);
    console.log(`  ${findings.length} finding(s) written to ${outPath}`);
    console.log(`  (${outWhy})\n`);
  } catch (e) {
    console.log(`  The CSV could not be written to ${outPath} — ${e.message}`);
    console.log('  Pass --out=<a writable path>. Everything above is complete without it.\n');
  }

  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log('  Nothing was written to the database, no Zoho write was called, and no');
  console.log('  mail was sent. Read the findings, decide what each figure should be, then');
  console.log('  say what to change.');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
