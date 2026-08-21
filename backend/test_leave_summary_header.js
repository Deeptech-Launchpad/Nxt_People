// The two figures above the leave cards.
//
// They read "00211 day(s)" and "Absent : —" on a screen an employee opens.
//
// The first is not a formatting slip. total_days is `numeric`, and pg hands
// numerics back as STRINGS to avoid losing precision — so the browser's
// `reduce((s, l) => s + l.totalDays, 0)` concatenated instead of adding:
// 0 + '0' + '2' + '1' + '1'. Every leave made the number longer. The fix is to
// total it in SQL where the types are known, so this asserts the endpoint.
//
// The second was never wired to anything — a literal em dash in the JSX.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const http = require('http');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const get = (p, token) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method: 'GET',
    headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', () => resolve({ s: 0, j: null }));
  req.end();
});

const YEAR = 2098;
let EMP = null;
const clear = async () => {
  if (!EMP) return;
  await pool.query(`DELETE FROM leaves WHERE employee_id=$1 AND EXTRACT(YEAR FROM start_date)=$2`,
    [EMP.id, YEAR]).catch(() => {});
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND EXTRACT(YEAR FROM date)=$2`,
    [EMP.id, YEAR]).catch(() => {});
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  EMP = (await pool.query(
    `SELECT id, casual_leave FROM employees
      WHERE status='active' AND deleted_at IS NULL AND role='admin' LIMIT 1`)).rows[0];
  if (!EMP) { console.log('\n  No employee to test with.\n'); process.exit(1); }
  const token = jwt.sign({ id: EMP.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await clear();

  const leave = (type, from, to, days, hours, status) => pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, hours, reason, status)
     VALUES ($1,$2,$3::date,$4::date,$5,$6,'header test',$7)`,
    [EMP.id, type, from, to, days, hours, status]);

  console.log('\n════ The shape that produced "00211" ════\n');

  // Balaji's year exactly: three casual leaves and one permission, which is
  // four values that concatenated into a five-digit number.
  await leave('casual', `${YEAR}-03-27`, `${YEAR}-03-27`, 1, null, 'approved');
  await leave('casual', `${YEAR}-04-30`, `${YEAR}-04-30`, 1, null, 'approved');
  await leave('casual', `${YEAR}-07-13`, `${YEAR}-07-14`, 2, null, 'approved');
  await leave('permission', `${YEAR}-07-11`, `${YEAR}-07-11`, 0, 2, 'approved');

  let r = await get(`/leaves/balance?year=${YEAR}`, token);
  check('the balance endpoint answers', r.s === 200, { s: r.s, m: r.j?.message });
  check('it carries a summary for the header', !!r.j?.summary, Object.keys(r.j || {}));

  const sum = r.j.summary;
  check('booked days is the number 4, not the string "00211"',
    sum.bookedDays === 4, { got: sum.bookedDays, type: typeof sum.bookedDays });
  check('it is a number, so nothing downstream can concatenate it',
    typeof sum.bookedDays === 'number' && typeof sum.bookedHours === 'number', sum);
  check('the 2 hours of permission are reported as hours, not added to the days',
    sum.bookedHours === 2 && sum.bookedDays === 4, sum);

  console.log('\n════ A pending request is already reserved ════\n');

  await leave('casual', `${YEAR}-08-22`, `${YEAR}-08-22`, 1, null, 'pending');
  r = await get(`/leaves/balance?year=${YEAR}`, token);
  check('a pending day counts as booked, as the reference counts it',
    r.j.summary.bookedDays === 5, r.j.summary);

  const casual = r.j.data.find(c => c.code === 'casual');
  check('the casual card counts it too', casual.booked === 5, casual);
  check('and Available has come DOWN by what is booked',
    casual.available === Math.max(0, (parseFloat(EMP.casual_leave) || 0) - 5),
    { available: casual.available, entitlement: EMP.casual_leave, booked: casual.booked });

  // The failure this guards: an entitlement rendered as a balance never moves,
  // so somebody plans around days they do not have.
  check('Available is not simply the entitlement',
    casual.available !== (parseFloat(EMP.casual_leave) || 0)
      || (parseFloat(EMP.casual_leave) || 0) === 0,
    { available: casual.available, entitlement: EMP.casual_leave });

  console.log('\n════ Absent ════\n');

  check('absent is a number even when there is nothing to count',
    r.j.summary.absentDays === 0, r.j.summary);

  for (const d of [`${YEAR}-02-03`, `${YEAR}-02-04`, `${YEAR}-02-05`]) {
    await pool.query(
      `INSERT INTO attendance (employee_id, date, working_hours, status)
       VALUES ($1,$2::date,0,'absent')`, [EMP.id, d]);
  }
  r = await get(`/leaves/balance?year=${YEAR}`, token);
  check('and it counts the days recorded absent', r.j.summary.absentDays === 3, r.j.summary);

  console.log('\n════ Cancelled and rejected are not bookings ════\n');

  await leave('casual', `${YEAR}-09-01`, `${YEAR}-09-01`, 1, null, 'cancelled');
  await leave('casual', `${YEAR}-09-02`, `${YEAR}-09-02`, 1, null, 'rejected');
  r = await get(`/leaves/balance?year=${YEAR}`, token);
  check('neither is counted as booked', r.j.summary.bookedDays === 5, r.j.summary);

  console.log('\n════ Another year is another total ════\n');

  r = await get(`/leaves/balance?year=${YEAR - 1}`, token);
  check('a year with nothing in it reads zero, not blank',
    r.j.summary.bookedDays === 0 && r.j.summary.bookedHours === 0 && r.j.summary.absentDays === 0,
    r.j.summary);

  await clear();
  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await clear(); process.exit(1); });
