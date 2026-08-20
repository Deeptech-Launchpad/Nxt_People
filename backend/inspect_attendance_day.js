/* ── Everything known about one attendance day ─────────────────────────────
 *  For the handful of rows reconcile_live.js flags and cannot explain. It
 *  prints the attendance row, every session recorded against it, any
 *  regularization touching the day, and any audit entry — so the question
 *  "how did this row come to look like this" is answered by looking rather
 *  than by reasoning about what the code probably did.
 *
 *  Read-only. Any statement that is not a SELECT is refused, and the guard
 *  proves itself on startup exactly as reconcile_live.js does.
 *
 *    docker compose exec backend node inspect_attendance_day.js ANXT2600143 2026-07-07
 *    docker compose exec backend node inspect_attendance_day.js --flagged 2026-07-01 2026-07-31
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  if (/^\s*\(*\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/i.test(sql)) {
    refused++;
    return Promise.reject(new Error('inspect_attendance_day.js is read-only'));
  }
  return realQuery(text, params);
};

const TZ = 'Asia/Kolkata';
const t = (v) => {
  if (v === null || v === undefined) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { timeZone: TZ, hour12: false });
};
const hrs = (a, b) => (a && b ? ((new Date(b) - new Date(a)) / 3600000).toFixed(3) : '—');

async function inspect(code, date) {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name
       FROM employees WHERE employee_id = $1`, [code])).rows[0];
  if (!emp) { console.log(`  no employee with code ${code}`); return; }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  ${emp.code}  ${emp.name}  —  ${date}`);
  console.log(`──────────────────────────────────────────────────────────`);

  const a = (await pool.query(
    `SELECT id, check_in, check_out, working_hours, status, late_minutes, created_at, updated_at
       FROM attendance WHERE employee_id = $1 AND date = $2::date`, [emp.id, date])).rows[0];
  if (!a) { console.log('  no attendance row for that day'); return; }

  console.log(`\n  The attendance row`);
  console.log(`    check in      ${t(a.check_in)}`);
  console.log(`    check out     ${t(a.check_out)}`);
  console.log(`    span          ${hrs(a.check_in, a.check_out)} h`);
  console.log(`    stored hours  ${a.working_hours}`);
  console.log(`    status        ${a.status}    late ${a.late_minutes ?? '—'} min`);
  console.log(`    created       ${t(a.created_at)}`);
  console.log(`    last updated  ${t(a.updated_at)}`);

  const s = (await pool.query(
    `SELECT check_in, check_out, session_hours, created_at
       FROM attendance_sessions WHERE employee_id = $1 AND date = $2::date
      ORDER BY check_in`, [emp.id, date])).rows;
  console.log(`\n  Sessions recorded: ${s.length}`);
  if (!s.length) {
    console.log('    none — so the original arrival cannot be recovered from here.');
    console.log('    Either the row predates session recording, or it was written');
    console.log('    by a path that does not create sessions.');
  }
  let sum = 0;
  for (const x of s) {
    sum += Number(x.session_hours) || 0;
    console.log(`    ${t(x.check_in)}  ->  ${t(x.check_out)}   ${x.session_hours ?? '—'} h`);
  }
  if (s.length) {
    console.log(`    sessions total ${sum.toFixed(3)} h  vs stored ${a.working_hours} h`
              + `  ${Math.abs(sum - Number(a.working_hours)) < 0.02 ? '(agree)' : '(DISAGREE)'}`);
  }

  const r = (await pool.query(
    `SELECT check_in, check_out, status, reason, created_at, approved_at
       FROM attendance_regularizations WHERE employee_id = $1 AND date = $2::date
      ORDER BY created_at`, [emp.id, date])).rows;
  console.log(`\n  Regularizations: ${r.length}`);
  for (const x of r) {
    console.log(`    ${x.status.padEnd(9)} in ${x.check_in ?? '—'}  out ${x.check_out ?? '—'}`
              + `   raised ${t(x.created_at)}  ${x.reason ? `— ${String(x.reason).slice(0, 40)}` : ''}`);
  }

  const audit = await pool.query(
    `SELECT action, resource, actor_email, created_at FROM audit_log
      WHERE resource_id = $1 ORDER BY created_at LIMIT 10`, [a.id]).catch(() => ({ rows: [] }));
  console.log(`\n  Audit entries against this row: ${audit.rows.length}`);
  for (const x of audit.rows) {
    console.log(`    ${t(x.created_at)}  ${x.action} ${x.resource} by ${x.actor_email || '—'}`);
  }

  // The reading, stated rather than left to be inferred.
  console.log(`\n  Reading:`);
  const span = Number(hrs(a.check_in, a.check_out));
  const stored = Number(a.working_hours);
  if (!s.length && stored > 0.05 && span < 0.05) {
    console.log('    Hours are stored but the punches are moments apart, and there are no');
    console.log('    sessions to recover the real arrival from. The hours are almost');
    console.log('    certainly right and the punches are not, but the original times are');
    console.log('    gone rather than merely overwritten.');
  } else if (stored === 0 && span > 0.05) {
    console.log('    A full span recorded as zero hours. Whatever wrote the punches did');
    console.log('    not go through the check-out handler, which is the only thing that');
    console.log('    accumulates working_hours.');
  } else if (s.length >= 2) {
    console.log('    Several sessions, so hours being less than the span is correct —');
    console.log('    the gaps between sessions are not worked time.');
  } else {
    console.log('    Nothing obviously contradictory.');
  }
}

(async () => {
  let ok = false;
  try { await pool.query(`UPDATE employees SET first_name = first_name WHERE 1=0`); }
  catch (e) { ok = /read-only/.test(e.message); }
  console.log(`\n  Read-only guard: ${ok ? 'working' : 'NOT WORKING — stopping'}`);
  if (!ok) process.exit(1);

  const args = process.argv.slice(2);
  if (args[0] === '--flagged') {
    const [, start, end] = args;
    const rows = (await pool.query(
      `SELECT e.employee_id AS code, a.date::text AS d
         FROM attendance a JOIN employees e ON e.id = a.employee_id
        WHERE a.date BETWEEN $1::date AND $2::date
          AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
          AND ABS(COALESCE(a.working_hours,0) - EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0) > 0.05
          AND (SELECT COUNT(*) FROM attendance_sessions s
                WHERE s.employee_id = a.employee_id AND s.date = a.date) < 2
        ORDER BY a.date LIMIT 40`, [start, end])).rows;
    // Capped: this prints a full page per day, and a database with seeded
    // data can flag over a thousand. Forty is enough to see a pattern.
    console.log(`  ${rows.length} flagged day(s) shown in ${start}..${end} (capped at 40)`);
    for (const r of rows) await inspect(r.code, r.d);
  } else if (args.length >= 2) {
    await inspect(args[0], args[1]);
  } else {
    console.log('\n  usage: inspect_attendance_day.js <EMPLOYEE_CODE> <YYYY-MM-DD>');
    console.log('         inspect_attendance_day.js --flagged <START> <END>\n');
  }

  console.log(`\n  ${refused} write attempt(s) refused (1 of them the guard testing itself).\n`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
