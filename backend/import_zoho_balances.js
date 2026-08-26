/* ── Bring Zoho's leave balances across ─────────────────────────────────────
 *  Attendance, leave, profiles, departments and designations were migrated.
 *  Balances were not — Zoho's Customize Balance holds real per-person figures
 *  (Amarnath 4 casual, Satheesh -5.5 LWP, Lochana -49) and none of them came
 *  over. Computed fresh from our own policy they land somewhere else, because
 *  Zoho splits leave into a type per year — Casual Leave, Casual Leave 2023,
 *  Casual Leave 2024, Casual Leave2025 — and the import collapsed those into
 *  one `casual`.
 *
 *  Those figures are what HR and every employee have been looking at for four
 *  years, so they win. They are written as OVERRIDES into leave_balances, which
 *  is exactly what that table means: somebody decided this number, so stop
 *  calculating. Customize Balance shows them in amber with the calculation
 *  beside them, and Rerun Policy removes the override if one turns out wrong.
 *
 *  The file is Zoho's Customize Balance export. Employees down the side, leave
 *  types across the top, one figure per cell:
 *
 *      Employee,Casual Leave,Casual Leave 2023,Permission,Leave Without Pay
 *      ANXT220012 - Amarnath,4,-0.25,25,0
 *
 *  Yearly variants are summed into the type they belong to, because this system
 *  has one Casual Leave and Zoho has four. A column matching no leave type here
 *  is REPORTED AND SKIPPED, never guessed at — a balance written under the
 *  wrong type is a balance somebody spends.
 *
 *  Dry run by default.
 *
 *    docker compose exec backend node import_zoho_balances.js /app/balances.csv
 *    docker compose exec backend node import_zoho_balances.js /app/balances.csv --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const fs = require('fs');
const pool = require('./db');

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const YEAR = parseInt((process.argv.find(a => /^--year=/.test(a)) || '').split('=')[1], 10)
  || new Date().getFullYear();

const pad = (s, n) => String(s ?? '').padEnd(n);

/* Zoho renames a leave type every year — "Casual Leave 2023", "Permission2025".
 * The same normaliser the history import used, so the two agree about which
 * column is which type. */
const normalise = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '')
  .trim()
  .toLowerCase();

/** A CSV row, respecting quotes — a reason or a name can contain a comma. */
function splitCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

/** "ANXT220012 - Amarnath" or "ANXT220012" → the code. */
const codeOf = (cell) => (String(cell || '').match(/ANXT\w+/) || [])[0] || null;

(async () => {
  if (!FILE) {
    console.log('\n  usage: node import_zoho_balances.js <csv> [--apply] [--year=2026]\n');
    console.log('  The file is Zoho\'s Customize Balance export: employees down the');
    console.log('  side, leave types across the top, one figure per cell.\n');
    await pool.end();
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) {
    console.log(`\n  ${FILE} is not there.\n`);
    await pool.end();
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Zoho leave balances → ${YEAR}${APPLY ? '   APPLYING' : '   DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { console.log('  The file has no rows.\n'); await pool.end(); process.exit(1); }

  /* Zoho exports the grid with a TWO-ROW header: the Paid / Unpaid banner sits
   * above the leave type names, with blanks under it for the columns it spans.
   * Reading the first row gets you "Paid", ten blanks and "Unpaid" — and
   * "Unpaid" happens to match a leave type here, so the wrong column's figures
   * would have been written under Leave Without Pay.
   *
   * So the header is whichever of the first few rows names the most leave
   * types, and the data starts after it. Chosen rather than assumed, and
   * printed below, because an export format is not something to hard-code
   * against one file. */
  const headerRows = lines.slice(0, 4).map(splitCsvLine);
  const [types, people] = await Promise.all([
    pool.query(`SELECT id, name, code FROM leave_types WHERE is_active = true`),
    pool.query(`SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name
                  FROM employees WHERE deleted_at IS NULL`),
  ]);

  // Zoho's column name against our leave type, by normalised name then by code.
  const byName = new Map(types.rows.map(t => [normalise(t.name), t]));
  const byCode = new Map(types.rows.map(t => [normalise(t.code), t]));
  const matchColumn = (h, i) => {
    if (i === 0) return null;
    const n = normalise(h);
    if (!n) return null;
    return byName.get(n) || byCode.get(n) || null;
  };
  const scored = headerRows.map((row, idx) => ({
    idx, row, matches: row.filter((h, i) => matchColumn(h, i)).length,
  }));
  const best = scored.reduce((a, b) => (b.matches > a.matches ? b : a), scored[0]);
  const header = best.row;
  const headerIndex = best.idx;
  const columnType = header.map(matchColumn);

  console.log('──────────────────────────────────────────────────────────');
  console.log('  Which row is the header');
  console.log('──────────────────────────────────────────────────────────\n');
  for (const c of scored) {
    console.log(`    row ${c.idx + 1}${c.idx === headerIndex ? '  ← used' : '        '}   `
      + `${c.matches} leave type(s) matched   ${c.row.slice(0, 4).map(x => x || '(blank)').join(' | ').slice(0, 70)}`);
  }
  console.log('');
  if (!best.matches) {
    console.log('  No row names a leave type this system has. Nothing can be imported');
    console.log('  from this file without knowing which column is which.\n');
    await pool.end();
    process.exit(1);
  }

  const unmatched = header.filter((h, i) => i > 0 && !columnType[i]);
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Columns');
  console.log('──────────────────────────────────────────────────────────\n');
  header.forEach((h, i) => {
    if (i === 0) return;
    console.log(`    ${pad(h, 26)}${columnType[i] ? '→ ' + columnType[i].name : 'NO MATCHING LEAVE TYPE — skipped'}`);
  });
  console.log('');

  const byPersonCode = new Map(people.rows.map(p => [p.code, p]));

  /* Several Zoho columns can land on one of our types — Casual Leave plus its
   * yearly variants. They are summed, because they are the same entitlement
   * split by the year it was granted in. */
  const totals = new Map();   // `${empId}|${typeId}` → number
  const missing = [];
  let cells = 0;

  for (const line of lines.slice(headerIndex + 1)) {
    const cols = splitCsvLine(line);
    const code = codeOf(cols[0]);
    if (!code) continue;
    const person = byPersonCode.get(code);
    if (!person) { missing.push(cols[0]); continue; }

    cols.forEach((raw, i) => {
      const type = columnType[i];
      if (!type) return;
      const v = String(raw).replace(/[^0-9.-]/g, '');
      if (v === '' || v === '-') return;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return;
      const key = `${person.id}|${type.id}`;
      totals.set(key, (totals.get(key) || 0) + n);
      cells++;
    });
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('  What would be written');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${pad(lines.length - headerIndex - 1, 6)}data row(s), after the header`);
  console.log(`    ${pad(missing.length, 6)}employee(s) in the file this system does not have`);
  console.log(`    ${pad(cells, 6)}figure(s) read`);
  console.log(`    ${pad(totals.size, 6)}balance(s) to write`);
  console.log(`    ${pad(unmatched.length, 6)}column(s) skipped for having no leave type here\n`);

  if (missing.length) {
    console.log('  Not found here — their balances are skipped, nothing is invented:\n');
    for (const m of missing.slice(0, 20)) console.log(`    ${m}`);
    if (missing.length > 20) console.log(`    … and ${missing.length - 20} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (const [key, value] of totals) {
      const [employeeId, leaveTypeId] = key.split('|');
      await client.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
         VALUES ($1,$2,$3,$4,0)
         ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET available = $4`,
        [employeeId, leaveTypeId, YEAR, Math.round(value * 100) / 100]);
      written++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Nothing was written — ${e.message}\n`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${written} balance(s) written for ${YEAR}.`);
  console.log('  Customize Balance shows these in amber, as overrides, with the');
  console.log('  policy calculation beside them. Rerun Policy removes one.');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
