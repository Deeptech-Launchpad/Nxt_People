/* ── SUPERSEDED — do not use for a migration ────────────────────────────────
 *  This ran the restage once per person, in its own process, so that one bad
 *  record could not roll back everybody else. The isolation was right; the
 *  mechanism was wrong.
 *
 *  Every process mints a fresh Zoho access token on startup, and Zoho caps how
 *  many can be minted from one refresh token in a short window. Exactly ten
 *  people went through and the remaining forty-three were refused — which,
 *  before the restage learned that a failed read is not an empty result,
 *  deleted their leave and imported nothing.
 *
 *  zoho_restage.js now does the same isolation properly: one process, one
 *  token, and a transaction per employee. Give it the whole list directly.
 *
 *    docker compose exec backend node zoho_restage.js CODE,CODE,... START END --apply
 *
 *  Kept only so the reason is written down where somebody would look for it.
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
  console.log('\n  This script is superseded. It spawned a process per employee,');
  console.log('  and every process mints a Zoho access token — Zoho caps those, so');
  console.log('  exactly ten people went through and the rest were refused.\n');
  console.log('  zoho_restage.js now does per-employee transactions in ONE process.');
  console.log('  Use it directly with the whole list:\n');
  console.log('    node zoho_restage.js CODE,CODE,... START END --apply\n');
  process.exit(1);

  /* eslint-disable no-unreachable */
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
    /* Five seconds, not one.
     *
     * A 1.2s gap across fifty-three people was enough to get throttled after
     * ten, and the restage then had no retry — forty-three people had their
     * leave deleted against a call that never got an answer. The restage
     * retries now, and this leaves more room besides. A migration that takes
     * five minutes instead of one is not a cost worth optimising. */
    await sleep(5000);
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
