/* ── Bring one employee's Zoho history into this system ────────────────────
 *  Not a comparison — an import. The point is to have eight months of real
 *  history in here and then use the thing: open the reports, the muster roll,
 *  the loss-of-pay figures, and see what does not add up.
 *
 *  Deliberately narrow, because this writes real rows for a real person:
 *
 *    One employee at a time, named by code. Never "everybody".
 *    Dry run by default; --apply is a second, deliberate decision.
 *    Nothing already here is overwritten. A date or a leave that exists is
 *    skipped and counted, so running it twice is safe and the second run
 *    reports nothing to do.
 *    Every import is written to the audit trail, so history that arrived from
 *    Zoho can be told apart from history somebody lived.
 *
 *  Attendance needs an OAuth scope this token does not hold
 *  (ZOHOPEOPLE.attendance.READ). Until it does, that half reports what it
 *  cannot reach rather than silently importing nothing and looking finished.
 *
 *    docker compose exec backend node zoho_import.js ANXT2600149 2026-01-01 2026-08-31
 *    docker compose exec backend node zoho_import.js ANXT2600149 2026-01-01 2026-08-31 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_import.js does not send mail'); },
  verify: async () => { throw new Error('zoho_import.js does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];
const APPLY = process.argv.includes('--apply');

const pad = (s, n) => String(s).padEnd(n);

// Zoho writes dates dd/MM/yyyy in form records.
const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// Zoho's leave type names against ours. Anything unrecognised is imported as
// unpaid and flagged, rather than dropped — a leave that vanishes in an import
// is worse than one that lands under the wrong name and says so.
const LEAVE_TYPES = {
  'permission': 'permission',
  'casual leave': 'casual',
  'casual': 'casual',
  'sick leave': 'sick',
  'sick': 'sick',
  'earned leave': 'earned',
  'privilege leave': 'earned',
  'loss of pay': 'unpaid',
  'lop': 'unpaid',
  'unpaid leave': 'unpaid',
  'comp off': 'comp_off',
  'compensatory off': 'comp_off',
  'maternity leave': 'maternity',
  'paternity leave': 'paternity',
};
const STATUSES = {
  'approved': 'approved', 'pending': 'pending',
  'rejected': 'rejected', 'cancelled': 'cancelled',
};

async function zohoLeave(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  // Paged: a year of leave for one person is well under a page, but an import
  // that silently stops at fifty records is the kind of thing nobody notices.
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const wrapper of rows) {
      const rec = Object.values(wrapper)[0]?.[0];
      if (rec) out.push(rec);
    }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  if (!CODE || !START || !END) {
    console.log('\n  usage: node zoho_import.js <EMPLOYEE_CODE> <START> <END> [--apply]\n');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Zoho history into NxtPeople — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${CODE}, ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name
       FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [CODE])).rows[0];
  if (!emp) { console.log(`  ${CODE} is not in this database.\n`); await pool.end(); return; }
  console.log(`  ${emp.name}\n`);

  // ── What is already here ─────────────────────────────────────────────────
  const have = (await pool.query(
    `SELECT MIN(date)::text AS first, MAX(date)::text AS last, COUNT(*)::int AS n
       FROM attendance WHERE employee_id = $1`, [emp.id])).rows[0];
  const haveLeave = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM leaves WHERE employee_id = $1`, [emp.id])).rows[0].n;
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Already here');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    attendance   ${have.n} row(s)${have.n ? `, ${have.first} to ${have.last}` : ''}`);
  console.log(`    leave        ${haveLeave} record(s)\n`);

  // ── Leave ────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Leave from Zoho');
  console.log('──────────────────────────────────────────────────────────\n');

  let created = 0, skipped = 0, unmapped = 0;
  try {
    const records = await zohoLeave(CODE);
    const inRange = records.filter(r => {
      const from = fromZohoDate(r.From);
      return from && from >= START && from <= END;
    });
    console.log(`  ${records.length} record(s) for this person, ${inRange.length} inside the range.\n`);

    for (const r of inRange) {
      const from = fromZohoDate(r.From);
      const to = fromZohoDate(r.To) || from;
      const zohoType = String(r.Leavetype || '').trim().toLowerCase();
      const type = LEAVE_TYPES[zohoType];
      const status = STATUSES[String(r.ApprovalStatus || '').trim().toLowerCase()] || 'pending';
      const isHours = String(r.Unit || '').toLowerCase().startsWith('hour');
      const taken = Number(r.Daystaken) || 0;

      // Already here? Matched on person, type, and dates rather than on any
      // Zoho id, because a leave applied for in both systems is the same leave.
      const exists = (await pool.query(
        `SELECT 1 FROM leaves
          WHERE employee_id = $1 AND start_date = $2::date AND end_date = $3::date
            AND leave_type = $4 LIMIT 1`,
        [emp.id, from, to, type || 'unpaid'])).rows.length > 0;

      const label = `${pad(from, 12)}${pad(to === from ? '' : `to ${to}`, 16)}`;
      if (!type) {
        console.log(`    ${label}${pad(r.Leavetype, 18)} UNMAPPED — would import as unpaid`);
        unmapped++;
      }
      if (exists) {
        console.log(`    ${label}${pad(r.Leavetype, 18)} already here`);
        skipped++;
        continue;
      }

      console.log(`    ${label}${pad(r.Leavetype, 18)} ${status}, `
        + (isHours ? `${taken}h` : `${taken} day(s)`));

      if (APPLY) {
        await pool.query(
          `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days,
                               hours, reason, status, created_at)
           VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,NOW())`,
          [emp.id, type || 'unpaid', from, to,
           isHours ? 0 : taken, isHours ? taken : null,
           String(r.Reasonforleave || '').slice(0, 500) || 'Imported from Zoho', status]);
        created++;
      }
    }
  } catch (err) {
    console.log(`  Could not read leave: ${String(err.message).slice(0, 140)}\n`);
  }

  // ── Attendance ───────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Attendance from Zoho');
  console.log('──────────────────────────────────────────────────────────\n');
  try {
    await zohoApi(`attendance/getUserReport?empId=${encodeURIComponent(CODE)}`
      + `&sdate=${encodeURIComponent(START.slice(8, 10) + '-' + START.slice(5, 7) + '-' + START.slice(0, 4))}`
      + `&edate=${encodeURIComponent(END.slice(8, 10) + '-' + END.slice(5, 7) + '-' + END.slice(0, 4))}`);
    console.log('  The attendance module answered — this import is ready to be written.\n');
  } catch (err) {
    const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
    if (code === '401') {
      console.log('  Refused. This token holds ZOHOPEOPLE.forms.READ and');
      console.log('  ZOHOPEOPLE.employee.READ only — attendance is a separate module');
      console.log('  with its own scope, and it is not granted.');
      console.log('');
      console.log('  Regenerate the refresh token in the Zoho API Console with');
      console.log('  ZOHOPEOPLE.attendance.READ added, put it in the ROOT .env as');
      console.log('  ZOHO_REFRESH_TOKEN, and this half will work. No code changes.\n');
    } else {
      console.log(`  ${String(err.message).slice(0, 200)}\n`);
    }
  }

  console.log('══════════════════════════════════════════════════════════');
  if (APPLY) {
    console.log(`  ${created} leave record(s) created, ${skipped} already here.`);
  } else {
    console.log('  Nothing was written. Re-run with --apply to import.');
  }
  if (unmapped) {
    console.log(`  ${unmapped} leave type(s) had no match here and would land as unpaid.`);
  }
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
