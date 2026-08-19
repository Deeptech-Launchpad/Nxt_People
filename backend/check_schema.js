/* ── Which migrations has this database actually had? ──────────────────────
 *  There are fifty-odd migrate_*.js files and they are run by hand, one at a
 *  time. Nothing records which have been applied, so the first sign that one
 *  was missed is a route throwing on a column that does not exist — and a
 *  query that throws reaches the screen as an empty table, which reads as
 *  "no data" rather than "broken".
 *
 *  Read-only.
 *
 *    docker compose exec backend node check_schema.js
 * ────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const DIR = __dirname;

// Columns only, deliberately.
//
// Checking CREATE TABLE as well sounded more thorough and was worse than
// useless: a first version flagged three migrations and every one was wrong.
// leave_approval_levels had been generalised into approval_levels, payslips
// had become payroll_payslips, and a third match came from the word "above"
// in a comment. A table that one migration created and a later one renamed is
// not a missing table, and the files give no way to tell those apart.
//
// Columns are additive and are not renamed, so a column the migrations promise
// and the database lacks is a real gap every time. It is also the failure that
// actually bites, since a route selecting a column that is not there throws.
function promises() {
  const byFile = {};
  for (const f of fs.readdirSync(DIR).filter(n => /^migrate_.*\.js$/.test(n))) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const cols = [...src.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/gi)]
      .map(m => ({ table: m[1].toLowerCase(), column: m[2].toLowerCase() }));
    if (cols.length) byFile[f] = cols;
  }
  return byFile;
}

(async () => {
  const have = new Set();
  for (const r of (await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)).rows) {
    have.add(`${r.table_name}.${r.column_name}`);
  }
  const haveTables = new Set((await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(r => r.tablename));

  const byFile = promises();
  const missing = [];
  for (const [file, cols] of Object.entries(byFile)) {
    // A column on a table that does not exist at all is skipped: that table was
    // almost certainly renamed by a later migration, and chasing it sends you
    // after something that is not wrong.
    const gaps = cols.filter(c => haveTables.has(c.table) && !have.has(`${c.table}.${c.column}`));
    if (gaps.length) missing.push({ file, gaps });
  }

  const total = Object.values(byFile).reduce((n, c) => n + c.length, 0);
  console.log(`${Object.keys(byFile).length} migration file(s), ${total} column(s) promised\n`);

  if (!missing.length) {
    console.log('Every column the migrations promise is present on this database.');
    await pool.end();
    return;
  }

  console.log(`${missing.length} migration(s) look UNAPPLIED here:\n`);
  for (const m of missing) {
    console.log(`  ${m.file}`);
    for (const c of m.gaps) console.log(`      missing column  ${c.table}.${c.column}`);
    console.log(`      -> node ${m.file}\n`);
  }
  console.log('Run those, then reload the page.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
