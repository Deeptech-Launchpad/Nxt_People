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

/* Everything downstream — the classifier, the muster roll, payroll — reads
 * is_half_day, never total_days. A Zoho half day imported with total_days 0.5
 * and is_half_day false counts as a WHOLE day off against expected hours, so
 * the person is credited time they did not take. Reading the fraction back out
 * into the flag is the whole point of this. */
const shapeOfLeave = (r) => {
  const isHours = String(r.Unit || '').toLowerCase().startsWith('hour');
  const taken = Number(r.Daystaken) || 0;
  if (isHours) return { isHours, taken, halfDay: false, session: null, odd: false };

  const halfDay = taken > 0 && taken < 1;
  // Zoho names the session differently between accounts, so try what it might
  // be called rather than assuming one.
  const raw = String(r.Session || r.SessionType || r.Sessions || r.Half_Day_Type || '').toLowerCase();
  const session = /2|second|after/.test(raw) ? 'second_half'
    : /1|first|fore|morn/.test(raw) ? 'first_half'
    : halfDay ? 'first_half' : null;

  // 2.5 days cannot be said in this schema — one flag covers the whole record.
  // Report it rather than rounding it away where nobody would see.
  const odd = taken >= 1 && taken % 1 !== 0;
  return { isHours, taken, halfDay, session, odd };
};

async function zohoLeave(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const rec = Object.values(w)[0]?.[0]; if (rec) out.push(rec); }
    if (rows.length < 200) break;
  }
  return out;
}

/** Does the attendance module answer at all? Everything downstream turns on it. */
async function zohoAttendance(code, start, end) {
  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(start))}&edate=${encodeURIComponent(zohoDMY(end))}`);
  return json?.response?.result ?? json?.response ?? json;
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

  // ── Gather, per person, before anything is written ───────────────────────
  const plan = [];
  for (const token of CODES) {
    // A code or a name. Zoho is keyed by code, but nobody remembers two of
    // them, and a typo'd code that quietly matched nobody would be worse than
    // one that stops here.
    const matches = (await pool.query(
      `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name
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
    const attendanceReachable = attendance !== null
      && !(attendance && typeof attendance === 'object' && !Array.isArray(attendance) && 'errors' in attendance);

    const leave = await zohoLeave(code).catch(e => {
      console.log(`  ${code}: leave failed — ${String(e.message).slice(0, 120)}`); return [];
    });
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

    plan.push({ emp, leaveInRange, attendanceReachable, attendanceError, hereAtt, hereLeave });
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
      : '→ LEFT ALONE, Zoho cannot be read'}`);
    console.log(`    here: leave        ${p.hereLeave} record(s)  → backed up, then replaced\n`);

    if (!APPLY && p.leaveInRange.length) {
      console.log('    the leave that would arrive:\n');
      for (const r of p.leaveInRange) {
        const from = fromZohoDate(r.From), to = fromZohoDate(r.To) || from;
        const type = LEAVE_TYPES[String(r.Leavetype || '').trim().toLowerCase()];
        const s = shapeOfLeave(r);
        console.log(`      ${pad(from, 12)}${pad(to === from ? '' : `to ${to}`, 14)}`
          + `${pad(r.Leavetype, 18)}${pad(r.ApprovalStatus, 10)}`
          + `${pad(`${s.taken}${s.isHours ? 'h' : 'd'}`, 8)}`
          + `${s.halfDay ? `half day, ${s.session.replace('_', ' ')}` : ''}`
          + `${type ? '' : '   UNMAPPED → unpaid'}`
          + `${s.odd ? '   ODD FRACTION — imported as whole days, check this one' : ''}`);
      }
      console.log('');
    }
  }

  if (plan.every(p => !p.attendanceReachable)) {
    console.log('  Attendance is out of scope for this token, so attendance is not');
    console.log('  being touched for anybody. Leave is replaced; attendance stays as');
    console.log('  it is. Add ZohoPeople.attendance.READ and run this again to do the');
    console.log('  other half.\n');
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  // ── Apply — one transaction covering everybody ───────────────────────────
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const batch = `restage-${stamp}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('──────────────────────────────────────────────────────────');
    console.log(`  Backing up as ${batch}`);
    console.log('──────────────────────────────────────────────────────────\n');

    for (const p of plan) {
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
      console.log(`    ${pad(p.emp.name, 24)} leaves ${pad(bl, 5)}`
        + `attendance ${p.attendanceReachable ? ba : 'not touched'}`);
    }
    console.log('');

    console.log('──────────────────────────────────────────────────────────');
    console.log('  Replacing');
    console.log('──────────────────────────────────────────────────────────\n');

    let totalCreated = 0, totalUnmapped = 0;
    for (const p of plan) {
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
        const type = LEAVE_TYPES[String(r.Leavetype || '').trim().toLowerCase()];
        if (!type) unmapped++;
        const s = shapeOfLeave(r);
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
           // Zoho approved it on a date we are not reading here. Leaving this
           // null would read as "approved by nobody, ever"; the leave date is
           // the honest stand-in and keeps approval reports from going blank.
           status === 'approved' ? from : null]);
        created++;
      }
      totalCreated += created; totalUnmapped += unmapped;
      console.log(`    ${pad(p.emp.name, 24)} ${created} leave record(s) imported`
        + `${halves ? `, ${halves} half day(s)` : ''}`
        + `${unmapped ? `, ${unmapped} as unpaid` : ''}`);
    }

    await client.query('COMMIT');

    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ${totalCreated} leave record(s) imported across ${plan.length} people.`);
    if (totalUnmapped) console.log(`  ${totalUnmapped} had a leave type we do not have, imported as unpaid.`);
    console.log('');
    console.log(`  To undo:  node restore_import_backup.js ${batch} --apply`);
    console.log('══════════════════════════════════════════════════════════\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}`);
    console.log('  Nothing was deleted.\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
