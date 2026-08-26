/* ── A whole company, one employee at a time ────────────────────────────────
 *  zoho_restage.js takes a list and would happily accept all fifty-three. It
 *  would also do them in ONE transaction: twelve thousand rows, and a single
 *  bad record rolls back the other fifty-two with nothing to say which one it
 *  was. That is fine for two people and wrong for a company.
 *
 *  So this runs the restage once per person, in its own process and its own
 *  transaction, and:
 *
 *    they all share ONE batch name, so the whole migration is one thing to
 *      undo rather than fifty-three things to remember
 *    somebody who fails does not stop the rest — they are listed at the end
 *    a re-run SKIPS anybody already done in this batch, so a run that dies
 *      halfway is resumed rather than repeated
 *    it paces itself, because Zoho throttles and a throttled read looks
 *      exactly like an employee with no attendance
 *
 *  Nothing is imported by this file itself. It is a supervisor: the mapping,
 *  the backup, the counting and the refusal to delete what it cannot replace
 *  all still live in zoho_restage.js, and are not duplicated here.
 *
 *  Dry run by default — it reports the plan and runs each person's own dry run.
 *
 *    docker compose exec backend node zoho_restage_bulk.js CODE,CODE,... 2026-01-01 2026-08-31
 *    docker compose exec backend node zoho_restage_bulk.js CODE,CODE,... 2026-01-01 2026-08-31 --apply
 *    ... --apply --batch=migration-2026-08-26      (to resume a named run)
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const pool = require('./db');
const { execFile } = require('child_process');
const path = require('path');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const START = process.argv[3];
const END = process.argv[4];
const APPLY = process.argv.includes('--apply');
const GIVEN_BATCH = (process.argv.find(a => a.startsWith('--batch=')) || '').slice(8).trim();

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const runRestage = (args) => new Promise(resolve => {
  execFile(process.execPath, [path.join(__dirname, 'zoho_restage.js'), ...args],
    { cwd: __dirname, maxBuffer: 8 * 1024 * 1024 },
    (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }));
});

(async () => {
  if (!CODES.length || !START || !END) {
    console.log('\n  usage: node zoho_restage_bulk.js <CODE,CODE,...> <START> <END> [--apply] [--batch=NAME]\n');
    process.exit(1);
  }
  for (const [label, v] of [['start', START], ['end', END]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      console.log(`\n  The ${label} date "${v}" is not a full date (YYYY-MM-DD).\n`);
      process.exit(1);
    }
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const batch = GIVEN_BATCH || `migration-${stamp}`;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Bulk restage — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log(`  ${CODES.length} employee(s)   ${START} to ${END}`);
  console.log(`  batch: ${batch}`);
  console.log('══════════════════════════════════════════════════════════\n');

  /* Anybody already recorded under this batch is done. This is what makes a
   * run resumable: the manifest row is written inside the same transaction as
   * their import, so its presence means that person's work committed. */
  let alreadyDone = new Set();
  if ((await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t) {
    const rows = (await pool.query(
      `SELECT DISTINCT e.employee_id AS code
         FROM import_backups b JOIN employees e ON e.id = b.employee_id
        WHERE b.batch = $1 AND b.table_name = '_manifest'`, [batch])).rows;
    alreadyDone = new Set(rows.map(r => r.code));
  }
  if (alreadyDone.size) {
    console.log(`  ${alreadyDone.size} employee(s) are already done in this batch and will be skipped.`);
    console.log('  This run is resuming, not repeating.\n');
  }

  const todo = CODES.filter(c => !alreadyDone.has(c));
  const done = [], failed = [];
  let leaveTotal = 0, dayTotal = 0;

  for (const [i, code] of todo.entries()) {
    process.stdout.write(`  ${lpad(i + 1, 3)}/${todo.length}  ${pad(code, 14)}`);

    const args = [code, START, END, ...(APPLY ? ['--apply', `--batch=${batch}`] : [])];
    let r = await runRestage(args);

    // One retry, because the single most likely failure is Zoho throttling and
    // the second attempt usually lands. A person who fails twice is reported
    // rather than quietly dropped.
    if (!r.ok) { await sleep(5000); r = await runRestage(args); }

    if (!r.ok) {
      const why = (r.out.match(/Stopped and rolled back: (.+)/) || [])[1]
        || (r.out.match(/\n\s{2}(\S.*)/) || [])[1]
        || r.err.split('\n')[0] || 'unknown';
      console.log(`FAILED  ${why.slice(0, 60)}`);
      failed.push({ code, why: why.slice(0, 200) });
    } else {
      const leaves = Number((r.out.match(/(\d+) leave record\(s\) (?:imported|and)/) || [])[1] || 0);
      const days = Number((r.out.match(/(\d+) attendance day\(s\) imported/) || [])[1] || 0);
      leaveTotal += leaves; dayTotal += days;
      console.log(APPLY
        ? `ok      ${lpad(days, 4)} day(s), ${leaves} leave record(s)`
        : 'ok      dry run');
      done.push(code);
    }

    // Unhurried on purpose. A few hundred Zoho calls fired back to back is how
    // an account gets throttled, and a throttled read is indistinguishable from
    // an employee who simply has no attendance.
    await sleep(1200);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Result');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${done.length} succeeded${alreadyDone.size ? `, ${alreadyDone.size} already done` : ''}`);
  console.log(`    ${failed.length} failed`);
  if (APPLY) {
    console.log(`\n    ${dayTotal} attendance day(s) and ${leaveTotal} leave record(s) imported.`);
  }

  if (failed.length) {
    console.log('\n  These did not go in. Everybody else did — they are not rolled back:\n');
    for (const f of failed) console.log(`    ${pad(f.code, 14)}${f.why}`);
    console.log('\n  Re-running the same command with the same --batch will retry only');
    console.log('  these, because the rest are recorded as done.\n');
    console.log(`    --batch=${batch}\n`);
  }

  if (APPLY && done.length) {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`  To undo the whole migration:`);
    console.log(`    node restore_import_backup.js ${batch} --apply`);
    console.log('══════════════════════════════════════════════════════════\n');
  } else if (!APPLY) {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
  }

  await pool.end();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
