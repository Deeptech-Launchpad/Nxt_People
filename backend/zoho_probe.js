/* ── What will Zoho actually give us? ──────────────────────────────────────
 *  Before building anything that compares two systems, find out what the other
 *  one returns. Zoho's People API is inconsistent between forms and modules —
 *  some endpoints answer with { response: { result: [...] } }, some with a
 *  bare array, some 404 on a plan that does not include the module.
 *
 *  So this asks, rather than assumes. It tries the endpoints that could carry
 *  attendance, leave and loss of pay for ONE employee over a short range, and
 *  reports which answered and what shape came back.
 *
 *  Read-only in both directions. Every Zoho call is a GET, the mail transport
 *  is replaced with one that cannot connect, and our own database is only
 *  read from — proved on startup by a write that is refused.
 *
 *    docker compose exec backend node zoho_probe.js ANXT2600149 2026-07-01 2026-07-31
 *
 *  Nothing is imported. This only reports what is reachable.
 * ────────────────────────────────────────────────────────────────────────── */
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_probe.js does not send mail'); },
  verify: async () => { throw new Error('zoho_probe.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('zoho_probe.js is read-only; this write was refused'));
  }
  return realQuery(text, params);
};

const { zohoApi } = require('./utils/zoho');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];

// Zoho's date parameters are dd-MM-yyyy in most of the People API, which is
// not the format anything else here uses.
const zohoDate = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

const shapeOf = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? `[${v.length} × ${shapeOf(v[0], depth + 1)}]` : '[]';
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `{${keys.length} keys}`;
    return `{ ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? `, +${keys.length - 8}` : ''} }`;
  }
  return typeof v;
};

async function attempt(label, endpoint) {
  process.stdout.write(`  ${label.padEnd(34)}`);
  try {
    const json = await zohoApi(endpoint);
    const body = json?.response?.result ?? json?.response ?? json;
    console.log(`ok    ${shapeOf(body)}`);
    return { label, endpoint, ok: true, body };
  } catch (err) {
    console.log(`—     ${String(err.message).split('\n')[0].slice(0, 90)}`);
    return { label, endpoint, ok: false };
  }
}

(async () => {
  if (!CODE || !START || !END) {
    console.log('\n  usage: node zoho_probe.js <EMPLOYEE_CODE> <START> <END>');
    console.log('  e.g.   node zoho_probe.js ANXT2600149 2026-07-01 2026-07-31\n');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  What Zoho will give us — READ ONLY, nothing imported');
  console.log(`  ${CODE}, ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('  !!    the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch {
    console.log('  ok    a deliberate write attempt was refused\n');
  }

  // Our own side first, so the two can be lined up afterwards.
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name, email
       FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [CODE])).rows[0];
  if (!emp) {
    console.log(`  ${CODE} is not in this database. Check the code.\n`);
    await pool.end();
    return;
  }
  const ours = (await pool.query(
    `SELECT COUNT(*)::int n FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [emp.id, START, END])).rows[0].n;
  console.log(`  Here:  ${emp.name} (${emp.email || 'no email'}) — ${ours} attendance row(s) in range\n`);

  console.log('──────────────────────────────────────────────────────────');
  console.log('  Zoho endpoints');
  console.log('──────────────────────────────────────────────────────────\n');

  const enc = encodeURIComponent;
  const results = [];

  // Attendance. Zoho exposes this several ways depending on the plan, and the
  // parameter names differ between them — hence trying rather than picking.
  results.push(await attempt('attendance/getAttendanceEntries',
    `attendance/getAttendanceEntries?empId=${enc(CODE)}&date=${enc(zohoDate(START))}`));
  results.push(await attempt('attendance/getUserReport',
    `attendance/getUserReport?empId=${enc(CODE)}&sdate=${enc(zohoDate(START))}&edate=${enc(zohoDate(END))}`));
  results.push(await attempt('attendance/getAttendanceReport',
    `attendance/getAttendanceReport?empId=${enc(CODE)}&fromDate=${enc(zohoDate(START))}&toDate=${enc(zohoDate(END))}`));

  // Leave, and whatever the loss-of-pay figure hangs off.
  results.push(await attempt('leave/getRecords',
    `leave/getRecords?empId=${enc(CODE)}&from=${enc(zohoDate(START))}&to=${enc(zohoDate(END))}`));
  results.push(await attempt('forms/leave/getRecords',
    `forms/leave/getRecords?sIndex=1&limit=50`));
  results.push(await attempt('leave/getLeaveTypeDetails',
    `leave/getLeaveTypeDetails?empId=${enc(CODE)}`));
  results.push(await attempt('leave/getBalanceReport',
    `leave/getBalanceReport?empId=${enc(CODE)}`));

  // The employee form, which is known to work — a control, so a wall of
  // failures above can be told apart from broken credentials.
  results.push(await attempt('forms/employee/getRecords (control)',
    `forms/employee/getRecords?sIndex=1&limit=1`));

  const ok = results.filter(r => r.ok);
  console.log(`\n  ${ok.length} of ${results.length} endpoint(s) answered.\n`);

  if (!ok.length) {
    console.log('  None answered. Either the credentials are wrong or this Zoho');
    console.log('  plan does not expose these modules over the API.\n');
  } else {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  A sample of what came back');
    console.log('──────────────────────────────────────────────────────────\n');
    for (const r of ok) {
      console.log(`  ── ${r.label}`);
      const sample = Array.isArray(r.body) ? r.body[0] : r.body;
      console.log(JSON.stringify(sample, null, 1).split('\n').slice(0, 22).map(l => `     ${l}`).join('\n'));
      console.log('');
    }
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
