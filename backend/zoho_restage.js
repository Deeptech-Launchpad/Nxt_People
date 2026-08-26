/* ── Put employees' Zoho history in place of what we hold ───────────────────
 *  Everybody has been using both systems, so this system's record for anybody
 *  is partial. Testing against partial data produces partial bugs — and no way
 *  to tell which findings are real. So for the named people, Zoho's history
 *  replaces ours outright and the reports get judged against something true.
 *
 *  Replacing means deleting, so:
 *
 *    Everything removed is copied into import_backups first, whole rows as
 *    JSONB, under one batch name covering both people — one restage, one thing
 *    to undo. restore_import_backup.js puts it back.
 *
 *    The backup is COUNTED against what is about to go, and a mismatch aborts
 *    the whole transaction. A backup nobody checked is a hope, not a backup.
 *
 *    Attendance is not deleted unless Zoho's attendance actually answered.
 *    Deleting real rows and then discovering the module is out of scope would
 *    leave these people with nothing at all, which is worse than the partial
 *    record we started with.
 *
 *    Named employees only, never "everybody". Dry run by default.
 *
 *    docker compose exec backend node zoho_restage.js CODE1,CODE2 2026-01-01 2026-08-31
 *    docker compose exec backend node zoho_restage.js CODE1,CODE2 2026-01-01 2026-08-31 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_restage.js does not send mail'); },
  verify: async () => { throw new Error('zoho_restage.js does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');
const { classifyDay, resolvePolicy, expectedFor } = require('./utils/attendanceRule');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const START = process.argv[3];
const END = process.argv[4];
const APPLY = process.argv.includes('--apply');

const pad = (s, n) => String(s).padEnd(n);
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// "13/07/2026 10:42 AM" — when the approval actually happened. Worth reading
// rather than standing in the leave date, which can be months earlier.
const fromZohoDateTime = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[4]);
  const ampm = (m[6] || '').toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${m[3]}-${m[2]}-${m[1]} ${String(h).padStart(2, '0')}:${m[5]}:00`;
};

// Zoho's leave type names against ours. Anything unrecognised lands as unpaid
// and is reported, rather than dropped — a leave that vanishes in an import is
// worse than one that arrives under the wrong name and says so.
const LEAVE_TYPES = {
  'permission': 'permission', 'casual leave': 'casual', 'casual': 'casual',
  'sick leave': 'sick', 'sick': 'sick', 'earned leave': 'earned',
  'privilege leave': 'earned', 'loss of pay': 'unpaid', 'lop': 'unpaid',
  'unpaid leave': 'unpaid', 'leave without pay': 'unpaid', 'lwp': 'unpaid',
  'comp off': 'comp_off', 'compensatory off': 'comp_off',
  'maternity leave': 'maternity', 'paternity leave': 'paternity',
};
const STATUSES = { approved: 'approved', pending: 'pending', rejected: 'rejected', cancelled: 'cancelled' };

/* Zoho names a new leave type every year.
 *
 *     Casual Leave        Casual Leave 2023        Casual Leave2025
 *     Permission          Permission2022          Permission2025
 *
 * Matching the name exactly worked for one year of history and fails for four:
 * fifty of one person's seventy-three records fell through to unpaid, which is
 * Loss of Pay. Casual leave silently recorded as LOP, across four years, is a
 * pay-affecting error nobody would find by reading a report.
 *
 * So the year is stripped before the lookup, with or without the space. */
const normaliseLeaveType = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '')
  .trim()
  .toLowerCase();

/* Reaching Zoho's attendance and being able to replace ours with it are two
 * different things, and this script deletes only what it can put back. The gap
 * between them was real: the scope landed a while before anything here could
 * parse a punch, and treating reachable as good enough would have emptied both
 * people's attendance in exchange for nothing. Keep them separate. */
const ATTENDANCE_IMPORT_READY = true;

/* Everything downstream — the classifier, the muster roll, payroll — reads
 * is_half_day, never total_days. A Zoho half day imported with total_days 0.5
 * and is_half_day false counts as a WHOLE day off against expected hours, so
 * the person is credited time they did not take. Reading the fraction back out
 * into the flag is the whole point of this. */
const shapeOfLeave = (r, fromAttendance = null) => {
  const isHours = String(r.Unit || '').toLowerCase().startsWith('hour');
  const taken = Number(r.Daystaken) || 0;
  if (isHours) return { isHours, taken, halfDay: false, session: null, guessed: false, odd: false };

  const halfDay = taken > 0 && taken < 1;
  // Zoho names the session differently between accounts, so try what it might
  // be called rather than assuming one.
  const raw = String(r.Session || r.SessionType || r.Sessions || r.Half_Day_Type
    || r.Session_1 || r.DayType || r.Day_Type || '').toLowerCase();
  // The attendance report is the reliable source; the leave record has never
  // carried a session on this account.
  const read = fromAttendance
    || (/2|second|after/.test(raw) ? 'second_half'
      : /1|first|fore|morn/.test(raw) ? 'first_half' : null);
  // Which half was taken decides which half of the day is expected, so a guess
  // here is not a small one. When Zoho does not say, this says so.
  const session = read || (halfDay ? 'first_half' : null);
  const guessed = halfDay && !read;

  // 2.5 days cannot be said in this schema — one flag covers the whole record.
  // Report it rather than rounding it away where nobody would see.
  const odd = taken >= 1 && taken % 1 !== 0;
  return { isHours, taken, halfDay, session, guessed, odd };
};

/* Which half of the day a half-day leave took, recovered from the ATTENDANCE
 * report rather than the leave record.
 *
 * The leave form does not carry it — its full field list has no session
 * anywhere, so the importer had to fall back on "first half" and say it was
 * guessing. But the attendance day for the same date says it outright:
 *
 *     "Casual Leave(Second Half), 0.5 day Absent"
 *
 * and the first date this was checked against, Shivanie's 2026-06-01, was a
 * second half that the guess had called a first half. Three of them would have
 * gone in wrong. Zoho knew; we were asking the wrong endpoint. */
function sessionsByDate(report) {
  const out = new Map();
  if (!report || typeof report !== 'object') return out;
  for (const [iso, rec] of Object.entries(report)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const m = /\b(first|second)\s*half\b/i.exec(String(rec?.Status ?? ''));
    if (m) out.set(iso, m[1].toLowerCase() === 'second' ? 'second_half' : 'first_half');
  }
  return out;
}

/* What was already granted on each day, read from the Zoho leave that is about
 * to replace ours rather than from the rows still sitting here. Classifying a
 * day against leave we are in the middle of deleting would judge it on a record
 * that will not exist in a moment. */
function leaveFactsByDate(records, sessions = new Map()) {
  const byDate = new Map();
  const touch = d => {
    if (!byDate.has(d)) byDate.set(d, { leavePortion: 0, permissionHours: 0 });
    return byDate.get(d);
  };
  for (const r of records) {
    const from = fromZohoDate(r.From), to = fromZohoDate(r.To) || from;
    if (!from) continue;
    if (String(r.ApprovalStatus || '').trim().toLowerCase() !== 'approved') continue;
    const shape = shapeOfLeave(r, sessions.get(from));
    const isPermission = normaliseLeaveType(r.Leavetype) === 'permission';
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const f = touch(iso);
      if (isPermission) f.permissionHours += shape.taken;
      // A record of ZERO days is not a day off.
      //
      // Zoho holds comp-off records with Daystaken 0 — an entitlement granted
      // rather than time taken. `halfDay` is false for 0, so these were landing
      // as a WHOLE day of leave, and three of Stephen's days read as leave
      // where Zoho says Absent. The record exists; the absence from work does
      // not.
      else if (shape.taken > 0) {
        f.leavePortion = Math.max(f.leavePortion, shape.halfDay ? 0.5 : 1);
      }
    }
  }
  return byDate;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Zoho throttles, and this script deletes. The pre-flight already retried on a
 * 429 and reported it as UNKNOWN rather than empty; the destructive script did
 * not, which is the wrong way round. Every Zoho read here now goes through
 * this, and a call that never succeeds throws rather than returning nothing. */
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

/* Every leave record in the form, read once and grouped by employee code.
 *
 * Needed because Zoho answers a per-person search that matches NOTHING with
 * the same "Error occurred" envelope it uses for a real failure. The two are
 * indistinguishable from the answer alone, and guessing either way is a bug:
 * guess "empty" and a failed read wipes somebody's leave, guess "failed" and
 * thirteen people who genuinely took no leave can never be imported.
 *
 * A read that SUCCEEDS settles it. The unfiltered sweep reached all 6,213
 * records on live and confirmed those thirteen hold none. So a zero is only
 * ever believed when it comes from a read that worked. */
let sweepCache = null;
async function zohoLeaveSweep() {
  if (sweepCache) return sweepCache;
  const byCode = new Map();
  for (let i = 1; i <= 40000; i += 200) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200`));
    if (leaveEnvelope(json)) {
      throw new Error(`(000) Zoho refused the unfiltered leave read at record ${i}`);
    }
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (m) {
        if (!byCode.has(m[1])) byCode.set(m[1], []);
        byCode.get(m[1]).push(rec);
      }
    }
    if (rows.length < 200) break;
  }
  sweepCache = byCode;
  return byCode;
}

// A 200 carrying no `result` key is not an answer. Zoho uses it both for a
// genuine refusal and for a search that matched nothing.
const leaveEnvelope = (json) => {
  const resp = json?.response;
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return 'no response object';
  if ('result' in resp) return null;
  if ('errors' in resp || 'error' in resp || 'message' in resp) {
    return String(resp.message || JSON.stringify(resp.error || resp.errors || {})).slice(0, 80);
  }
  return 'no result and no error';
};

async function zohoLeave(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await patiently(() =>
      zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`));
    /* Zoho answers a refusal with HTTP 200 and an error envelope carrying no
     * `result` key at all. Reading `result || []` turned that refusal into
     * "this person has no leave", and the import then DELETED their leave and
     * replaced it with nothing — the same failure that once wiped 43 people,
     * arriving by a different door. An error is not an empty list; say so and
     * let the caller abort. */
    const why = leaveEnvelope(json);
    if (why) {
      /* Cannot tell a refusal from "nothing matched" here, so do not decide
       * here. Fall back to the sweep, which either produces this person's
       * records or proves there are none. */
      const swept = await zohoLeaveSweep();
      return swept.get(code) || [];
    }

    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const rec = Object.values(w)[0]?.[0]; if (rec) out.push(rec); }
    if (rows.length < 200) break;
  }
  return out;
}

/* A day, keyed by ISO date. dateFormat is not optional — without it Zoho
 * refuses the whole call over the organization's date format, which reads as a
 * permissions problem and is not one. */
/* Zoho refuses a long range outright — four and a half years came back NOT
 * REACHABLE while eight months answered fine. It fails rather than truncating,
 * which is the merciful version, but a migration that wants four years still
 * has to ask for them a year at a time and stitch the answers together.
 *
 * The days are keyed by ISO date, so merging is just merging. */
async function zohoAttendance(code, start, end) {
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  if (lastYear > firstYear) {
    const all = {};
    for (let y = firstYear; y <= lastYear; y++) {
      const from = y === firstYear ? start : `${y}-01-01`;
      const to = y === lastYear ? end : `${y}-12-31`;
      const part = await zohoAttendanceWindow(code, from, to);
      // One year refusing is not the same as that year being empty, and
      // stitching a hole into the middle of a history would look like an
      // employee who stopped coming in for twelve months.
      if (!part || typeof part !== 'object' || 'error' in part || 'errors' in part) {
        throw new Error(`(000) Zoho would not answer for ${y}`);
      }
      Object.assign(all, part);
    }
    return all;
  }
  return zohoAttendanceWindow(code, start, end);
}

async function zohoAttendanceWindow(code, start, end) {
  const json = await patiently(() => zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(start))}&edate=${encodeURIComponent(zohoDMY(end))}`
    + `&dateFormat=dd-MM-yyyy`));
  return json?.response?.result ?? json?.response ?? json;
}

const p2 = n => String(n).padStart(2, '0');

// "08:39" is eight hours thirty-nine minutes, not 8.39 of anything.
const hhmmToHours = (s) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};
const hhmmToMinutes = (s) => {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/* "27/07/2026 09:39 AM" in Asia/Kolkata → the UTC wall clock this column holds.
 *
 * check_in and check_out are `timestamp without time zone` storing UTC, and
 * every previous mistake in this codebase has been forgetting that: an IST
 * clock written straight in reads back five and a half hours late, which looks
 * like a real punch and quietly changes the hours worked. Zoho reports IST —
 * entryTimezone says so on every record — so the shift happens here, once. */
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

const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;

// "09:30 AM" or "06:00 PM" → minutes past midnight.
const clockMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
};

/* How late they were, computed here rather than taken from Zoho.
 *
 * Zoho's Late_In cannot be trusted across the whole history. In the older
 * years it holds the CLOCK TIME instead of the lateness: somebody arriving at
 * 09:05 against a 09:30 shift is reported as 545 minutes late, and 9x60+5 is
 * 545. Imported verbatim, that made almost every day of 2022 to 2024 "late" —
 * including days people arrived early.
 *
 * The same record carries ShiftStartTime and FirstIn, so the answer is right
 * there. Where the shift is missing there is nothing to be late against, and
 * zero is the honest answer rather than a number from a broken field. */
const latenessOf = (r) => {
  const shiftStart = clockMinutes(r.ShiftStartTime);
  const arrived = clockMinutes(String(notDash(r.FirstIn) ?? '').split(/\s+/).slice(1).join(' '));
  if (shiftStart === null || arrived === null) return 0;
  return Math.max(0, arrived - shiftStart);
};

/* A coordinate, or nothing.
 *
 * Number(null) is 0, and 0 is finite — so testing the cleaned value and then
 * converting the raw one let a "-" latitude through as NaN. It reads as null in
 * a JSON dump, which is exactly how it stayed hidden. Clean once, then decide. */
const num = (v) => {
  const clean = notDash(v);
  if (clean === null) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
};

/* What one Zoho day amounts to here.
 *
 * WorkingHours is NOT the hours worked — the weekend records carry
 * WorkingHours 08:00 on days nobody was in. It is the shift's length.
 * TotalHours is what was worked. Reading the friendlier-sounding name would
 * make every weekend a full day. */
const shapeOfDay = (iso, r) => {
  const checkIn = fromZohoStamp(notDash(r.FirstIn));
  const checkOut = fromZohoStamp(notDash(r.LastOut));
  return {
    date: iso,
    zohoStatus: String(r.Status ?? '').trim(),
    checkIn,
    checkOut,
    hasPunch: !!checkIn,
    hours: hhmmToHours(r.TotalHours) ?? 0,
    shiftHours: hhmmToHours(r.WorkingHours),
    lateMinutes: latenessOf(r),
    inLat: num(r.FirstIn_Latitude),
    inLng: num(r.FirstIn_Longitude),
    outLat: num(r.LastOut_Latitude),
    outLng: num(r.LastOut_Longitude),
    inLoc: notDash(r.FirstIn_Location),
    outLoc: notDash(r.LastOut_Location),
  };
};

/* Zoho's own verdict is deliberately NOT imported. The whole point of putting
 * real history in here is to run OUR rules over it and see where they disagree
 * — copying Zoho's answer across would hide exactly what we came to find. So
 * the punches and the hours are imported as facts, and the status is whatever
 * this system's engine makes of them. */
function ourVerdict(day, facts, cfg) {
  return classifyDay({
    workedHours: day.hours,
    hasPunch: day.hasPunch,
    leavePortion: facts.leavePortion,
    permissionHours: facts.permissionHours,
    onDuty: facts.onDuty,
    lateMinutes: day.lateMinutes,
    graceMinutes: facts.graceMinutes,
    cfg,
    shiftHours: day.shiftHours,
  });
}

/** Copy rows out before they are deleted, and prove the copy landed. */
async function backup(client, batch, table, empId, where, params) {
  const rows = (await client.query(
    `SELECT to_jsonb(t) AS row_data FROM ${table} t WHERE ${where}`, params)).rows;
  if (!rows.length) return 0;

  await client.query(
    `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
     SELECT $1, $2, $3, unnest($4::jsonb[])`,
    [batch, table, empId, rows.map(r => JSON.stringify(r.row_data))]);

  const stored = (await client.query(
    `SELECT COUNT(*)::int n FROM import_backups
      WHERE batch = $1 AND table_name = $2 AND employee_id = $3`,
    [batch, table, empId])).rows[0].n;

  // A backup nobody counted is a hope. If these disagree, nothing gets deleted.
  if (stored !== rows.length) {
    throw new Error(`backup of ${table} stored ${stored} of ${rows.length} rows — refusing to delete`);
  }
  return rows.length;
}

(async () => {
  if (!CODES.length || !START || !END) {
    console.log('\n  usage: node zoho_restage.js <CODE[,CODE...]> <START> <END> [--apply]\n');
    process.exit(1);
  }

  /* Full dates, checked here.
   *
   * "2026-01" reached Postgres and came back as a DateTimeParseError with a
   * stack trace, from a script whose whole job is deleting and replacing real
   * history. It failed safely — during the read, before any transaction — but
   * only by luck of ordering, and a stack trace is not an answer to a typo.
   * The companion checker takes YYYY-MM, which is exactly how the wrong shape
   * gets typed here. */
  for (const [label, v] of [['start', START], ['end', END]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      console.log(`\n  The ${label} date "${v}" is not a full date.\n`);
      console.log('  This takes YYYY-MM-DD. check_reports_against_rows.js takes YYYY-MM,');
      console.log('  which is the easy mix-up.\n');
      console.log(`  You probably meant:  ${/^\d{4}-\d{2}$/.test(v) ? `${v}-01` : 'YYYY-MM-DD'}\n`);
      process.exit(1);
    }
  }
  if (START > END) {
    console.log(`\n  The start date ${START} is after the end date ${END}.\n`);
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Restage onto Zoho history — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${CODES.join(', ')}   ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const backupTable = (await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t;
  if (!backupTable) {
    console.log('  import_backups does not exist, so nothing here could be undone.\n');
    console.log('  Run this first:\n');
    console.log('    docker compose exec backend node migrate_import_backup.js\n');
    await pool.end();
    process.exit(1);
  }

  // The policy this system would judge these days by. Zoho's own verdict is not
  // imported — running our rules over real history is the entire point.
  const cfg = (await pool.query(
    `SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};

  /* Every "owed" figure below comes out of these settings, so print them.
   * Reading that somebody was owed eight hours on a day they had half a day's
   * leave is alarming until you can see that this org has chosen not to let
   * leave reduce what is expected — at which point it is simply the policy
   * doing what it was told. The number is only checkable next to the rule. */
  const policy = resolvePolicy(cfg);
  const expected = expectedFor(cfg, null);
  console.log('──────────────────────────────────────────────────────────');
  console.log('  The rules these days are being judged by');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    mode                          ${policy.mode}`);
  console.log(`    a full day is                 ${expected.full} hours`);
  console.log(`    a half day is                 ${expected.half} hours`);
  console.log(`    a punch alone is enough       ${policy.punchIsEnough ? 'yes' : 'no'}`);
  console.log(`    a short day becomes           ${policy.shortDayBecomes.replace('_', ' ')}`);
  console.log(`    tolerance                     ${policy.toleranceMinutes} minutes`);
  console.log(`    leave reduces what is owed    ${policy.leaveReducesExpected ? 'yes' : 'NO'}`);
  console.log(`    permission reduces it         ${policy.permissionReducesExpected ? 'yes' : 'NO'}`);
  console.log(`    on-duty is exempt             ${policy.exemptOnDuty ? 'yes' : 'no'}\n`);

  // ── Gather, per person, before anything is written ───────────────────────
  const plan = [];
  for (const token of CODES) {
    // A code or a name. Zoho is keyed by code, but nobody remembers two of
    // them, and a typo'd code that quietly matched nobody would be worse than
    // one that stops here.
    const matches = (await pool.query(
      `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
              joining_date::date::text AS joined, exit_date::date::text AS exited
         FROM employees
        WHERE deleted_at IS NULL
          AND (employee_id = $1 OR CONCAT(first_name,' ',last_name) ILIKE '%' || $1 || '%')
        ORDER BY employee_id`, [token])).rows;

    if (!matches.length) {
      console.log(`  Nobody here matches "${token}" — stopping before anything is touched.\n`);
      await pool.end();
      process.exit(1);
    }
    if (matches.length > 1) {
      console.log(`  "${token}" matches ${matches.length} people. Name one of them by code:\n`);
      for (const m of matches) console.log(`    ${pad(m.code, 16)}${m.name}`);
      console.log('');
      await pool.end();
      process.exit(1);
    }
    const emp = matches[0];
    const code = emp.code;

    let attendance = null, attendanceError = null;
    try { attendance = await zohoAttendance(code, START, END); }
    catch (err) { attendanceError = String(err.message); }
    const reached = attendance !== null
      && !(attendance && typeof attendance === 'object' && !Array.isArray(attendance)
           && ('errors' in attendance || 'error' in attendance));
    // Reaching it is not the same as being able to replace it.
    const attendanceReachable = reached && ATTENDANCE_IMPORT_READY;

    /* A read that FAILED is not a person with no leave.
     *
     * This used to catch the error and carry on with an empty list, and the
     * apply then deleted their leave and imported nothing in its place. Zoho
     * throttled partway through a fifty-three person run and forty-three people
     * lost their leave records to a call that never got an answer.
     *
     * Attendance already had this rule — it refuses to delete what it could not
     * fetch. Leave did not, and leave is the half that had no guard. Now
     * neither proceeds on silence. */
    let leave;
    try {
      leave = await zohoLeave(code);
    } catch (e) {
      console.log(`\n  ${code}: could not read leave from Zoho — ${String(e.message).slice(0, 120)}`);
      console.log('  Nothing has been written for this person. A failed read is not');
      console.log('  an empty result, and deleting their leave to import nothing is');
      console.log('  exactly the mistake this refuses to make.\n');
      await pool.end();
      process.exit(1);
    }
    const leaveInRange = leave.filter(r => {
      const f = fromZohoDate(r.From);
      return f && f >= START && f <= END;
    });

    const hereAtt = (await pool.query(
      `SELECT COUNT(*)::int n, MIN(date)::text AS first, MAX(date)::text AS last
         FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [emp.id, START, END])).rows[0];
    const hereLeave = (await pool.query(
      `SELECT COUNT(*)::int n FROM leaves
        WHERE employee_id = $1 AND start_date BETWEEN $2::date AND $3::date`,
      [emp.id, START, END])).rows[0].n;

    /* Zoho's report is keyed by ISO date, but not every day it returns should
     * become a row here.
     *
     * A weekend or a holiday should not — the work calendar says what those
     * are, and six invented weekend rows a month would show up in a muster
     * roll that never had them. Nor should a day covered by leave: the leaves
     * table carries that, and the report reads it from there.
     *
     * An ABSENCE should. This system does not represent absence as a missing
     * row — reports.js counts rows with status 'absent' for the muster roll's
     * A code and for the absent balance. Skipping them would have made
     * Balaji's twenty-one absences disappear entirely and his absent count
     * read zero, which is the most flattering possible way to be wrong. */
    const sessions = sessionsByDate(reached ? attendance : null);
    const dayFacts = leaveFactsByDate(leaveInRange, sessions);
    const grace = (await pool.query(
      `SELECT COALESCE(sh.grace_minutes, 15) AS g
         FROM employees e LEFT JOIN shifts sh ON sh.id = e.shift_id WHERE e.id = $1`,
      [emp.id])).rows[0]?.g ?? 15;

    const allDays = reached && attendance && typeof attendance === 'object'
      ? Object.entries(attendance)
          .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
          .filter(([k]) => k >= START && k <= END)
          .map(([iso, rec]) => shapeOfDay(iso, rec))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const isAbsence = d => !d.hasPunch && /\babsent\b/i.test(d.zohoStatus);

    /* Zoho reports days before somebody joined, and calls them Absent. Balaji's
     * first punch is 29 January and Zoho hands back seventeen absences for the
     * weeks before it. Those are not absences — he was not employed yet — and
     * importing them puts seventeen A codes on his muster roll and seventeen
     * days into every figure that counts absence.
     *
     * The reports already refuse to judge days outside joining..exit, so a row
     * out there has nothing judging it. It must not be written at all. */
    const onRolls = d =>
      !(emp.joined && d.date < emp.joined) && !(emp.exited && d.date > emp.exited);
    const offRolls = allDays.filter(d => !onRolls(d) && (d.hasPunch || isAbsence(d)));
    const days = allDays.filter(d => onRolls(d) && (d.hasPunch || isAbsence(d)));
    const skipped = allDays.filter(d => onRolls(d) && !(d.hasPunch || isAbsence(d)));

    for (const d of days) {
      const f = dayFacts.get(d.date) || { leavePortion: 0, permissionHours: 0 };
      d.verdict = ourVerdict(d, { ...f, onDuty: false, graceMinutes: Number(grace) }, cfg);
    }

    plan.push({ emp, leaveInRange, reached, attendanceReachable, attendanceError,
                hereAtt, hereLeave, days, skipped, allDays, offRolls, sessions });
  }

  // ── Say plainly what would happen to each person ─────────────────────────
  for (const p of plan) {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${p.emp.name}   ${p.emp.code}`);
    console.log('──────────────────────────────────────────────────────────\n');

    const code = (p.attendanceError?.match(/\((\d{3})\)/) || [])[1];
    console.log(`    Zoho leave         ${p.leaveInRange.length} record(s) in range`);
    console.log(`    Zoho attendance    ${p.attendanceReachable ? 'reachable' : `NOT REACHABLE${code ? ` (${code})` : ''}`}\n`);

    console.log(`    here: attendance   ${p.hereAtt.n} row(s)`
      + `${p.hereAtt.n ? `, ${p.hereAtt.first} to ${p.hereAtt.last}` : ''}`);
    console.log(`                       ${p.attendanceReachable
      ? '→ backed up, then replaced'
      : '→ LEFT ALONE'}`);
    console.log(`    here: leave        ${p.hereLeave} record(s)  → backed up, then replaced\n`);

    if (!APPLY && p.leaveInRange.length) {
      console.log('    the leave that would arrive:\n');
      for (const r of p.leaveInRange) {
        const from = fromZohoDate(r.From), to = fromZohoDate(r.To) || from;
        const type = LEAVE_TYPES[normaliseLeaveType(r.Leavetype)];
        const s = shapeOfLeave(r, p.sessions.get(from));
        console.log(`      ${pad(from, 12)}${pad(to === from ? '' : `to ${to}`, 14)}`
          + `${pad(r.Leavetype, 18)}${pad(r.ApprovalStatus, 10)}`
          + `${pad(`${s.taken}${s.isHours ? 'h' : 'd'}`, 8)}`
          + `${s.halfDay ? `half day, ${s.session.replace('_', ' ')}${s.guessed ? ' (GUESSED)' : ''}` : ''}`
          + `${type ? '' : '   UNMAPPED → unpaid'}`
          + `${s.odd ? '   ODD FRACTION — imported as whole days, check this one' : ''}`);
      }
      console.log('');

      // A guessed session is a real guess: it decides which half of the day is
      // expected. If Zoho did name it under some field we have not tried, this
      // is where we find out what to call it.
      const guessed = p.leaveInRange.filter(
        r => shapeOfLeave(r, p.sessions.get(fromZohoDate(r.From))).guessed);
      if (guessed.length) {
        console.log(`    ${guessed.length} half day(s) above have a GUESSED session — Zoho sent no`);
        console.log('    field we recognise. These are the fields it did send:\n');
        console.log(`      ${Object.keys(guessed[0]).join(', ')}\n`);
      }
    }
  }

  // ── What our rules make of Zoho's days ───────────────────────────────────
  // The reason for importing real history at all. Where Zoho called a day
  // Present and this system would not, that gap is the finding — so it is
  // printed before anything is written, not discovered afterwards in a report.
  if (!APPLY) {
    for (const p of plan) {
      if (!p.days?.length) continue;
      console.log('──────────────────────────────────────────────────────────');
      console.log(`  ${p.emp.name} — ${p.days.length} day(s) with a punch`);
      console.log('──────────────────────────────────────────────────────────\n');

      const bySkipped = new Map();
      for (const d of p.skipped) bySkipped.set(d.zohoStatus, (bySkipped.get(d.zohoStatus) || 0) + 1);
      if (bySkipped.size) {
        console.log('    no punch, so no row is created:\n');
        for (const [st, n] of [...bySkipped].sort((a, b) => b[1] - a[1])) {
          console.log(`      ${pad(st || '(none)', 34)}${n} day(s)`);
        }
        console.log('');
      }

      if (p.offRolls.length) {
        const first = p.offRolls[0].date, last = p.offRolls[p.offRolls.length - 1].date;
        console.log(`    ${p.offRolls.length} day(s) Zoho reported from outside this person's`);
        console.log(`    employment (${first} to ${last}) — joined ${p.emp.joined || 'unknown'}`
          + `${p.emp.exited ? `, exited ${p.emp.exited}` : ''}. Not imported.\n`);
      }

      const ours = new Map();
      for (const d of p.days) ours.set(d.verdict.status, (ours.get(d.verdict.status) || 0) + 1);
      console.log('    what this system would call them:\n');
      for (const [st, n] of [...ours].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${pad(st, 34)}${n} day(s)`);
      }

      /* Zoho writes a day's verdict at the END of the status, after whatever
       * was granted on it:
       *
       *     "Present"
       *     "Casual Leave(Second Half), 0.5 day Absent"
       *     "Permission(02:00 hours), 0.75 day Present"
       *
       * Reading the front of that string is what produced a false
       * disagreement on 2026-06-01: it contains the word "Half", so a
       * contains-check expected our "half-day", when Zoho was in fact saying
       * half a day of leave plus half a day absent — which is exactly what
       * this system recorded. The verdict is the tail, and the fraction in
       * front of it says whether it covers the whole day.
       *
       * Zoho has no separate word for lateness, so its "Present" covers our
       * "present" and "late" both. */
      const agrees = (zoho, our) => {
        const tail = zoho.split(',').pop().trim().toLowerCase();
        const m = /^(?:([\d.]+)\s*day\s+)?(present|absent)$/.exec(tail);
        if (!m) return null;
        const whole = !m[1] || Number(m[1]) >= 1;
        if (m[2] === 'present') {
          return whole ? (our === 'present' || our === 'late')
            : (our === 'half-day' || our === 'present' || our === 'late');
        }
        return whole ? our === 'absent' : (our === 'absent' || our === 'half-day' || our === 'leave');
      };
      const clashes = p.days.filter(d => agrees(d.zohoStatus, d.verdict.status) === false);
      console.log(`\n    disagreements with Zoho: ${clashes.length} of ${p.days.length}\n`);
      for (const d of clashes.slice(0, 25)) {
        // owed, not expected: `expected` is the full day before leave and
        // permission come off it, so printing it under the word "owed" showed
        // 8h on a day half covered by leave and read as a bug that was not one.
        console.log(`      ${d.date}  ${pad(d.hours.toFixed(2) + 'h', 8)}`
          + `${pad(`owed ${d.verdict.owed}h`, 12)}`
          + `Zoho ${pad(d.zohoStatus, 34)}  we say ${d.verdict.status}`);
      }
      if (clashes.length > 25) console.log(`      … and ${clashes.length - 25} more`);
      console.log('');

      // A punched day, not simply the first — the first is now often an
      // absence, and null/null/0.00 shows nothing about the conversion.
      const first = p.days.find(d => d.hasPunch) || p.days[0];
      console.log('    first day with a punch, as it would be stored:\n');
      console.log(`      ${first.date}   check_in ${first.checkIn} UTC   check_out ${first.checkOut} UTC`);
      console.log(`      that is ${first.hours.toFixed(2)} hours, late ${first.lateMinutes} min,`
        + ` status ${first.verdict.status}\n`);
    }
  }

  if (plan.every(p => !p.attendanceReachable)) {
    console.log('  Attendance is out of scope for this token, so attendance is not');
    console.log('  being touched for anybody. Leave is replaced; attendance stays as');
    console.log('  it is. Add ZohoPeople.attendance.READ and run this again to do the');
    console.log('  other half.\n');
  }

  /* A leave type we cannot name lands as unpaid, and unpaid is Loss of Pay.
   *
   * That is the one mapping failure that changes what somebody is paid, so an
   * apply will not do it quietly. Zoho renaming its types every year is exactly
   * how a new unknown name appears without anybody touching this code — and the
   * dry run showing "UNMAPPED → unpaid" in a list of seventy records is easy to
   * read past. Refusing is not.
   *
   * --allow-unmapped is the deliberate second decision, for when somebody has
   * looked at the names and is content for them to be unpaid. */
  const unknownTypes = new Map();
  for (const p of plan) {
    for (const r of p.leaveInRange) {
      const name = normaliseLeaveType(r.Leavetype);
      if (!LEAVE_TYPES[name]) {
        const label = name || '(blank)';
        unknownTypes.set(label, (unknownTypes.get(label) || 0) + 1);
      }
    }
  }
  if (unknownTypes.size) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Leave types with no equivalent here');
    console.log('──────────────────────────────────────────────────────────\n');
    for (const [name, n] of [...unknownTypes].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pad(name, 34)}${n} record(s)`);
    }
    console.log('\n  These would be imported as UNPAID, which is Loss of Pay.\n');
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  if (unknownTypes.size && !process.argv.includes('--allow-unmapped')) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Refusing to import — nothing was written.');
    console.log('══════════════════════════════════════════════════════════\n');
    console.log('  Recording those as Loss of Pay changes what people are paid,');
    console.log('  and this will not do it on a guess. Either add the names to');
    console.log('  LEAVE_TYPES in this file, or say so explicitly:\n');
    console.log('    --allow-unmapped\n');
    await pool.end();
    process.exit(1);
  }

  // ── Apply — one transaction covering everybody ───────────────────────────
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  /* A caller may supply the batch, so a bulk run across many people lands in
   * ONE batch and is therefore one thing to undo. Without it each employee
   * would get their own, and reversing a company-wide import would mean
   * running the restore fifty-three times and hoping none of them was missed. */
  const supplied = (process.argv.find(a => a.startsWith('--batch=')) || '').slice(8).trim();
  if (supplied && !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(supplied)) {
    console.log(`
  "${supplied}" is not a usable batch name.
`);
    process.exit(1);
  }
  const batch = supplied || `restage-${stamp}`;
  /* One transaction PER EMPLOYEE, all inside this one process.
   *
   * It used to be a single transaction around everybody: twelve thousand rows,
   * where one bad record rolls back the other fifty-two and says nothing about
   * which. The bulk runner solved that by spawning a process per person — and
   * every process mints a fresh Zoho access token, which Zoho caps. Exactly ten
   * people went through and the rest were refused, which is how forty-three
   * people nearly lost their leave to a call that never got an answer.
   *
   * So: one process, one token, and a transaction each. A person who fails
   * rolls back alone and is named at the end; everybody else is already
   * committed and stays that way. */
  let totalCreated = 0, totalUnmapped = 0, totalDays = 0;
  const succeeded = [], failures = [];

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Importing under ${batch}`);
  console.log('──────────────────────────────────────────────────────────\n');

  for (const p of plan) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // What the restore has to undo, written down rather than inferred. A
      // person who had no leave at all backs up zero rows, and without this the
      // restore would have no way to know the imported ones should go.
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         VALUES ($1, '_manifest', $2, $3::jsonb)`,
        [batch, p.emp.id, JSON.stringify({
          code: p.emp.code, name: p.emp.name, start: START, end: END,
          tables: p.attendanceReachable ? ['leaves', 'attendance'] : ['leaves'],
        })]);

      const bl = await backup(client, batch, 'leaves', p.emp.id,
        't.employee_id = $1 AND t.start_date BETWEEN $2::date AND $3::date',
        [p.emp.id, START, END]);
      let ba = 0;
      if (p.attendanceReachable) {
        ba = await backup(client, batch, 'attendance', p.emp.id,
          't.employee_id = $1 AND t.date BETWEEN $2::date AND $3::date',
          [p.emp.id, START, END]);
      }

      await client.query(
        `DELETE FROM leaves WHERE employee_id = $1 AND start_date BETWEEN $2::date AND $3::date`,
        [p.emp.id, START, END]);
      if (p.attendanceReachable) {
        await client.query(
          `DELETE FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
          [p.emp.id, START, END]);
      }

      let created = 0, unmapped = 0, halves = 0;
      for (const r of p.leaveInRange) {
        const from = fromZohoDate(r.From), to = fromZohoDate(r.To) || from;
        const type = LEAVE_TYPES[normaliseLeaveType(r.Leavetype)];
        if (!type) unmapped++;
        const s = shapeOfLeave(r, p.sessions.get(from));
        if (s.halfDay) halves++;
        const status = STATUSES[String(r.ApprovalStatus || '').trim().toLowerCase()] || 'pending';
        await client.query(
          `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, hours,
                               is_half_day, half_day_type, reason, status, approved_at, created_at)
           VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [p.emp.id, type || 'unpaid', from, to,
           s.isHours ? 0 : s.taken, s.isHours ? s.taken : null,
           s.halfDay, s.halfDay ? s.session : null,
           String(r.Reasonforleave || '').slice(0, 500) || 'Imported from Zoho',
           status,
           // Zoho records when it was approved. Null here reads as "approved by
           // nobody, ever" and blanks the approval reports; the leave date is
           // only the fallback for a record that carries no approval time.
           status === 'approved' ? (fromZohoDateTime(r.ApprovalTime) || from) : null]);
        created++;
      }

      // Attendance last, because the day facts it was classified against come
      // from the leave that has just been written.
      let rows = 0;
      if (p.attendanceReachable) {
        for (const d of p.days) {
          await client.query(
            `INSERT INTO attendance
               (employee_id, date, check_in, check_out, working_hours, status, late_minutes,
                check_in_location, check_out_location,
                check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude,
                created_at)
             VALUES ($1,$2::date,$3::timestamp,$4::timestamp,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                     (NOW() AT TIME ZONE 'UTC'))`,
            [p.emp.id, d.date, d.checkIn, d.checkOut,
             Number(d.hours.toFixed(2)), d.verdict.status, d.lateMinutes,
             d.inLoc, d.outLoc, d.inLat, d.inLng, d.outLat, d.outLng]);
          rows++;
        }
      }

      await client.query('COMMIT');
      totalCreated += created; totalUnmapped += unmapped; totalDays += rows;
      succeeded.push(p.emp.code);
      console.log(`    ${pad(p.emp.code, 14)}${pad(p.emp.name.slice(0, 22), 24)}`
        + `${String(rows).padStart(4)} day(s), ${created} leave`
        + `${halves ? `, ${halves} half day(s)` : ''}`
        + `${unmapped ? `, ${unmapped} as unpaid` : ''}`
        + `   (backed up ${ba} + ${bl})`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      failures.push({ code: p.emp.code, why: String(err.message).slice(0, 140) });
      console.log(`    ${pad(p.emp.code, 14)}${pad(p.emp.name.slice(0, 22), 24)}FAILED — rolled back, nothing changed for them`);
    } finally { client.release(); }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${succeeded.length} of ${plan.length} imported — ${totalCreated} leave record(s), ${totalDays} attendance day(s).`);
  if (totalUnmapped) console.log(`  ${totalUnmapped} had a leave type we do not have, imported as unpaid.`);
  if (failures.length) {
    console.log(`
  ${failures.length} failed. They were rolled back individually; everybody`);
    console.log('  else is committed and is NOT affected:\n');
    for (const f of failures) console.log(`    ${pad(f.code, 14)}${f.why}`);
    console.log(`
  Re-run with --batch=${batch} to retry only these.`);
    process.exitCode = 1;
  }
  console.log('');
  console.log(`  To undo:  node restore_import_backup.js ${batch} --apply`);
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
