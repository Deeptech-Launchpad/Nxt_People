// The preview reported "every finished day lands the same way under both rules"
// against a database of 1605 identical 8.5-hour days. That is a true statement
// about useless data, and it is indistinguishable from a preview whose
// detection is broken. These are the three days it has to catch.
require('dotenv').config();
const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Well before any real data, so the seeded rows are the only ones in range.
const DAY = ['2019-04-01', '2019-04-02', '2019-04-03'];
const made = [];

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];

  // 7.6h — a full present day under the old 7.5h threshold, a half day under
  // Zoho's 8h. This is the case the whole change exists for.
  // 5.0h — a half day under both, but Zoho also makes it half ABSENT.
  // 3.0h — absent under both. Must NOT be reported as a change.
  const seeds = [
    { d: DAY[0], hours: 7.6, status: 'present' },
    { d: DAY[1], hours: 5.0, status: 'half-day' },
    { d: DAY[2], hours: 3.0, status: 'absent' },
  ];

  for (const s of seeds) {
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, s.d]);
    const id = (await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours, late_minutes)
       VALUES ($1, $2, ($2::date + '09:30'::time), ($2::date + '18:00'::time), $3, $4, 0)
       RETURNING id`, [emp.id, s.d, s.status, s.hours])).rows[0].id;
    made.push(() => pool.query(`DELETE FROM attendance WHERE id=$1`, [id]));
  }

  console.log(`\n  seeded ${emp.code}: 7.6h present, 5.0h half-day, 3.0h absent\n`);

  const out = execFileSync('node', ['preview_zoho_day_rule.js', DAY[0], DAY[2]],
    { cwd: __dirname, encoding: 'utf8' });

  check('the preview finds exactly one changed day',
    /classification would change: 1\b/.test(out), out.match(/would change: \d+/)?.[0]);
  check('and it is the 7.6h day, which the old 7.5h threshold called present',
    new RegExp(`${DAY[0]}[^\\n]*7\\.60h`).test(out), out.split('\n').filter(l => l.includes(DAY[0])));
  check('reported as present becoming a half day',
    /present\s+->\s+half-day/.test(out), out.split('\n').find(l => l.includes('->')));
  check('with the absent half stated', /present 0\.5, absent 0\.5/.test(out));

  check('the 5h day is not reported as a change — it was already a half day',
    !new RegExp(`${DAY[1]}[^\\n]*->`).test(out));
  check('nor is the 3h day, absent under both rules',
    !new RegExp(`${DAY[2]}[^\\n]*->`).test(out));

  // Two days are half present under Zoho — the 7.6h one and the 5h one — so
  // the split creates one whole absent day between them.
  check('the split is counted: two half days create one absent day',
    /absent days created\s+1\.0/.test(out), out.split('\n').find(l => l.includes('absent days created')));

  // All three fall short of 8h, the 3h day included even though it stays absent.
  check('every day short of the expected hours is counted, absent ones included',
    /3 finished day\(s\) fell short/.test(out), out.split('\n').find(l => l.includes('fell short')));
  // 8 - 7.6 = 0.4, 8 - 5 = 3.0, and the 3h day is short by 5.0 as well.
  check('and comes to 8.4 hours', /8\.4 hour\(s\) of shortfall/.test(out),
    out.split('\n').find(l => l.includes('of shortfall')));

  check('the read-only guard proved itself', /a deliberate write attempt was refused/.test(out));
  check('and nothing was written', /Nothing was written/.test(out));

  const still = (await pool.query(
    `SELECT status, working_hours FROM attendance WHERE employee_id=$1 AND date=$2`,
    [emp.id, DAY[0]])).rows[0];
  check('the seeded row is untouched by the preview',
    still.status === 'present' && Number(still.working_hours) === 7.6, still);

  for (const fn of made) await fn().catch(() => {});
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  process.exit(1);
});
