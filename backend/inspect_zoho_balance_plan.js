#!/usr/bin/env node
/* ── What every balance would become if Zoho's figure is the opening one ─────
 *  READ ONLY. This script writes nothing to any database and sends no mail.
 *  There is deliberately no --apply: a balance is what somebody is paid
 *  against, so the plan is printed, reviewed, and only then acted on.
 *
 *  The proposal it prices, per employee and leave type:
 *
 *      proposed available = Zoho available − days applied here Zoho never saw
 *      proposed booked    = Zoho booked    + days applied here Zoho never saw
 *
 *  Zoho's figure is the opening balance because it is what HR and every
 *  employee looked at for four years. What has to come off it is the leave
 *  taken in NxtPeople AFTER Zoho stopped being the system of record — those
 *  days are spent, and Zoho's export cannot know about them.
 *
 *  INPUT IS A CSV, not the API. zoho_balance_scope_check.js was run again
 *  before this was written and the token still carries only
 *  ZOHOPEOPLE.forms.READ and ZOHOPEOPLE.employee.READ: leave/getRecords and
 *  leave/getUserRecord 404, and forms/leaveusertransaction, forms/P_LeaveBalance
 *  and forms/leavetype all answer 200 with "Error occurred" and no result. No
 *  balance-shaped endpoint answers, so the only source is the same manual
 *  Customize Balance export import_zoho_balances.js takes — employees down the
 *  side, leave types across the top, yearly variants ("Casual Leave 2024")
 *  summed into the one type this system has. A column matching no leave type
 *  here is REPORTED AND SKIPPED, never guessed at.
 *
 *  Which of our leave rows Zoho never saw is the whole question, so it is
 *  decided by evidence rather than by feel, two ways, and both are printed:
 *
 *    MANIFEST  zoho_restage.js writes an import_backups `_manifest` row per
 *              employee in the same transaction as the leave rows it creates.
 *              NOW() is the transaction's start time, so every imported leave
 *              carries the manifest row's created_at to the second, and the
 *              manifest names the date range that was restaged. A leave inside
 *              a restaged range whose created_at matches that batch's stamp came
 *              from Zoho; everything else is ours. This is used when manifests
 *              exist, because it is a record of the import rather than an
 *              inference about it.
 *    CUTOVER   the fallback for a database with no manifests: a leave is ours
 *              if it starts after the cutover (Zoho cannot hold a leave for a
 *              date it was no longer running), or if it was created after the
 *              cutover and carries an approval chain, since routes/leaves.js
 *              rolls an application back rather than commit one without a
 *              chain. It is the weaker rule: zoho_restage.js builds a chain for
 *              every PENDING row it imports, so those look like ours to it.
 *
 *  Both are counted, and every row they disagree about is listed.
 *
 *    node inspect_zoho_balance_plan.js --csv=/app/balances.csv
 *    node inspect_zoho_balance_plan.js --csv=/app/balances.csv --cutover=2026-09-10 --year=2026
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
const path = require('path');
const pool = require('./db');
const { availableFor, computedFor } = require('./utils/leaveBalance');

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
};
const FILE = arg('csv') || process.argv.slice(2).find(a => !a.startsWith('--')) || null;
const YEAR = parseInt(arg('year'), 10) || new Date().getFullYear();
const CUTOVER_ARG = arg('cutover');
const OUT_ARG = arg('out');
// How close a leave's created_at has to be to its batch's manifest stamp to be
// called part of that import. They are written in one transaction, so they
// agree to the second; a few seconds of slack costs nothing and survives a
// restage that committed per employee.
const TOLERANCE_S = parseFloat(arg('tolerance')) || 5;

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? '' : String(round2(n)));

/* Zoho renames a leave type every year — "Casual Leave 2023", "Permission2025".
 * The same normaliser import_zoho_balances.js and the history import use, so
 * all three agree about which column is which type. */
const normalise = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '')
  .trim()
  .toLowerCase();

/** A CSV row, respecting quotes — a name can contain a comma. */
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

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** "ANXT220012 - Amarnath" or "ANXT220012" → the code. */
const codeOf = (cell) => (String(cell || '').match(/ANXT\w+/) || [])[0] || null;
/** Whatever is left of the first cell once the code and separators are gone. */
const nameOf = (cell) => String(cell || '')
  .replace(/ANXT\w+/, '').replace(/^[\s\-–—:|]+/, '').trim();

/* Customize Balance can be exported one figure per type or as a pair —
 * "Casual Leave Available", "Casual Leave Booked". The facet is read off the
 * header so a Booked column is never added to an Available figure, and a column
 * with no facet word is taken as Available, which is what the single-figure
 * export holds. Every decision is printed under Columns below. */
const FACETS = [
  [/\b(available|availabale|balance|bal|remaining|closing)\b/i, 'available'],
  [/\b(booked|used|taken|availed|consumed|utilised|utilized)\b/i, 'booked'],
];
function facetOf(header) {
  for (const [re, facet] of FACETS) {
    if (re.test(header)) return { facet, bare: header.replace(re, ' ').replace(/\s+/g, ' ').trim() };
  }
  return { facet: 'available', bare: header, defaulted: true };
}

// leave_types.code spells compensatory off without the underscore; the leaves
// table and leaveBalance.js address it with one.
const canonical = (code) => (code === 'compoff' ? 'comp_off' : code);

async function tableExists(name) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`, [name]);
  return r.rows[0].n > 0;
}

(async () => {
  if (!FILE) {
    console.log(`
  usage: node inspect_zoho_balance_plan.js --csv=<file> [--cutover=YYYY-MM-DD]
                                           [--year=${YEAR}] [--out=<file>] [--tolerance=5]

  READ ONLY — nothing is written to the database and there is no --apply.

  <file> is Zoho's Customize Balance export (Leave -> Reports -> Customize
  Balance, all employees, all leave types, Export as CSV): employees down the
  side, leave types across the top, one figure per cell. Yearly variants
  ("Casual Leave 2024") are summed into the one type this system has.
`);
    await pool.end();
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) { console.log(`\n  ${FILE} is not there.\n`); await pool.end(); process.exit(1); }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Zoho balance as the opening figure → ${YEAR}`);
  console.log('  DRY RUN. READ ONLY. Nothing is written and no mail is sent.');
  console.log('══════════════════════════════════════════════════════════\n');

  const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { console.log('  The file has no rows.\n'); await pool.end(); process.exit(1); }

  const [types, everyone] = await Promise.all([
    pool.query(`SELECT id, name, code, unit FROM leave_types WHERE is_active = true`),
    pool.query(`SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
                       joining_date::date::text AS joining, status, deleted_at,
                       (deleted_at IS NULL AND (status IS NULL OR LOWER(status) = 'active')) AS active
                  FROM employees`),
  ]);
  const active = everyone.rows.filter(p => p.active);

  /* Zoho exports the grid with a TWO-ROW header: a Paid / Unpaid banner above
   * the leave type names. "Unpaid" matches a leave type here, so reading the
   * first row lands the wrong column's figures under Leave Without Pay. The
   * header is therefore whichever of the first few rows names the most leave
   * types — chosen and printed, not assumed. Same rule as
   * import_zoho_balances.js, so the two read one file the same way. */
  const headerRows = lines.slice(0, 4).map(splitCsvLine);
  const byName = new Map(types.rows.map(t => [normalise(t.name), t]));
  const byCode = new Map(types.rows.map(t => [normalise(t.code), t]));
  const matchColumn = (h, i) => {
    if (i === 0) return null;
    const { facet, bare, defaulted } = facetOf(h);
    const n = normalise(bare);
    if (!n) return null;
    const type = byName.get(n) || byCode.get(n) || null;
    return type ? { type, facet, defaulted: !!defaulted } : null;
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
      + `${c.matches} leave type(s) matched   `
      + `${c.row.slice(0, 4).map(x => x || '(blank)').join(' | ').slice(0, 70)}`);
  }
  console.log('');
  if (!best.matches) {
    console.log('  No row names a leave type this system has. Nothing can be planned');
    console.log('  from this file without knowing which column is which.\n');
    await pool.end();
    process.exit(1);
  }

  const unmatchedColumns = [];
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Columns');
  console.log('──────────────────────────────────────────────────────────\n');
  header.forEach((h, i) => {
    if (i === 0) return;
    const m = columnType[i];
    if (!m) { unmatchedColumns.push(h); console.log(`    ${pad(h || '(blank)', 30)}NO MATCHING LEAVE TYPE — skipped`); return; }
    console.log(`    ${pad(h, 30)}→ ${pad(m.type.name, 20)}${m.facet}`
      + (m.defaulted ? '   (no facet word in the header; read as available)' : ''));
  });
  console.log('');

  // ── Zoho's figures ───────────────────────────────────────────────────────
  const byPersonCode = new Map(active.map(p => [p.code, p]));
  const byPersonName = new Map(active.map(p => [normalise(p.name), p]));
  const inactiveByCode = new Map(everyone.rows.filter(p => !p.active).map(p => [p.code, p]));
  const inactiveByName = new Map(everyone.rows.filter(p => !p.active).map(p => [normalise(p.name), p]));

  const zoho = new Map();        // `${empId}|${typeId}` → { available, booked, hasBooked }
  const inZohoNotHere = [];
  const matchedByName = [];
  const seenPeople = new Set();
  let cells = 0, dataRows = 0;

  for (const line of lines.slice(headerIndex + 1)) {
    const cols = splitCsvLine(line);
    if (!cols[0]) continue;
    dataRows++;
    const code = codeOf(cols[0]);
    let person = code ? byPersonCode.get(code) : null;
    if (!person) {
      const byname = byPersonName.get(normalise(nameOf(cols[0]) || cols[0]));
      if (byname) { person = byname; matchedByName.push(`${cols[0]}  →  ${person.code} ${person.name}`); }
    }
    if (!person) {
      const gone = (code && inactiveByCode.get(code))
        || inactiveByName.get(normalise(nameOf(cols[0]) || cols[0]));
      inZohoNotHere.push({
        cell: cols[0],
        note: gone
          ? `matches ${gone.code} ${gone.name}, who is ${gone.deleted_at ? 'deleted' : (gone.status || 'not active')} here`
          : 'no employee here, active or not',
      });
      continue;
    }
    seenPeople.add(person.id);

    cols.forEach((raw, i) => {
      const m = columnType[i];
      if (!m) return;
      const v = String(raw).replace(/[^0-9.-]/g, '');
      if (v === '' || v === '-') return;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return;
      const key = `${person.id}|${m.type.id}`;
      const cur = zoho.get(key) || { available: 0, booked: 0, hasBooked: false };
      // Several Zoho columns land on one of our types — Casual Leave and its
      // yearly variants. They are summed: the same entitlement, split by the
      // year it was granted in.
      cur[m.facet] += n;
      if (m.facet === 'booked') cur.hasBooked = true;
      zoho.set(key, cur);
      cells++;
    });
  }

  // ── Which of our leave rows Zoho never saw ───────────────────────────────
  const haveManifest = await tableExists('import_backups');
  const manifests = haveManifest ? (await pool.query(
    `SELECT employee_id, batch, created_at,
            row_data->>'start' AS range_start, row_data->>'end' AS range_end
       FROM import_backups
      WHERE table_name = '_manifest' AND row_data ? 'start' AND row_data ? 'end'`)).rows : [];
  const manifestByEmp = new Map();
  for (const m of manifests) {
    if (!manifestByEmp.has(m.employee_id)) manifestByEmp.set(m.employee_id, []);
    manifestByEmp.get(m.employee_id).push(m);
  }

  const haveLegacyChain = await tableExists('leave_approval_levels');
  const chainSql = haveLegacyChain
    ? `(EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)
        OR EXISTS (SELECT 1 FROM leave_approval_levels b WHERE b.leave_id = l.id))`
    : `EXISTS (SELECT 1 FROM approval_levels a WHERE a.request_type = 'leave' AND a.request_id = l.id)`;

  /* Pending counts. availableFor()/computedFor() already treat a request in
   * flight as spoken for — this system reserves the days at apply time — so a
   * plan that ignored pending would hand somebody a balance they have already
   * asked to spend. The approved-only figure is carried alongside in its own
   * column so the choice stays the owner's. */
  const leaves = (await pool.query(
    `SELECT l.id, l.employee_id, l.leave_type, l.status, l.start_date::date::text AS start_date,
            COALESCE(l.total_days, 0)::float AS total_days, COALESCE(l.hours, 0)::float AS hours,
            l.created_at, l.approved_by, l.split_from, l.reason,
            ${chainSql} AS has_chain
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
      WHERE e.deleted_at IS NULL AND (e.status IS NULL OR LOWER(e.status) = 'active')
        AND l.status IN ('approved','pending')
        AND EXTRACT(YEAR FROM l.start_date) = $1`, [YEAR])).rows;

  /* The cutover: the last date Zoho was the system of record. Anything starting
   * after it cannot be in a Zoho export. Derived rather than assumed, and how
   * is printed, because every our-only figure below hangs off it. */
  let cutover = CUTOVER_ARG, cutoverHow = 'given on the command line';
  if (!cutover && manifests.length) {
    cutover = manifests.map(m => m.range_end).filter(Boolean).sort().pop();
    cutoverHow = `the latest end date any zoho_restage.js batch covered (${manifests.length} manifest row(s))`;
  }
  if (!cutover) {
    // No manifest to read. The import fingerprint is an approved leave with no
    // approver and no chain — zoho_restage.js and zoho_import.js write
    // approved_at without approved_by and build no chain for a decided row,
    // which nothing in the app can produce.
    const fp = leaves.filter(l => l.status === 'approved' && !l.approved_by && !l.has_chain);
    if (fp.length) {
      cutover = fp.map(l => l.start_date).sort().pop();
      cutoverHow = `the latest start date among ${fp.length} row(s) carrying the import fingerprint `
        + '(approved, no approver, no approval chain) — no import manifest exists here';
    }
  }
  if (!cutover) {
    console.log('  The cutover date cannot be derived: there is no import manifest and no');
    console.log('  row carries the import fingerprint. Re-run with --cutover=YYYY-MM-DD.\n');
    await pool.end();
    process.exit(1);
  }

  const inManifestRange = (l) => (manifestByEmp.get(l.employee_id) || []).some(m =>
    l.start_date >= String(m.range_start).slice(0, 10)
    && l.start_date <= String(m.range_end).slice(0, 10)
    && Math.abs(new Date(l.created_at) - new Date(m.created_at)) / 1000 <= TOLERANCE_S);

  const ourOnlyManifest = (l) => !inManifestRange(l);
  const ourOnlyCutover = (l) => (l.start_date > cutover)
    || (String(l.created_at.toISOString ? l.created_at.toISOString().slice(0, 10) : l.created_at).slice(0, 10) > cutover
        && l.has_chain);
  const fingerprintImported = (l) =>
    (l.status === 'approved' && !l.approved_by && !l.has_chain)
    || String(l.reason || '').trim() === 'Imported from Zoho';

  const RULE = manifests.length ? 'MANIFEST' : 'CUTOVER';
  const ourOnly = RULE === 'MANIFEST' ? ourOnlyManifest : ourOnlyCutover;

  const countM = leaves.filter(ourOnlyManifest).length;
  const countC = leaves.filter(ourOnlyCutover).length;
  const countF = leaves.filter(l => !fingerprintImported(l)).length;
  const disagree = leaves.filter(l => ourOnlyManifest(l) !== ourOnlyCutover(l));

  console.log('──────────────────────────────────────────────────────────');
  console.log('  Which leave Zoho never saw');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    cutover              ${cutover}`);
  console.log(`                         ${cutoverHow}`);
  console.log(`    rule used            ${RULE}`);
  console.log(`    ${lpad(leaves.length, 6)} approved/pending leave row(s) in ${YEAR} for active employees`);
  console.log(`    ${lpad(countM, 6)} of them are ours by MANIFEST  (${manifests.length} manifest row(s) available`
    + `${manifests.length ? '' : ' — so this rule classifies everything as ours and is NOT used'})`);
  console.log(`    ${lpad(countC, 6)} of them are ours by CUTOVER   (starts after ${cutover}, or created after it with an approval chain)`);
  console.log(`    ${lpad(countF, 6)} of them are ours by FINGERPRINT (corroboration only, never used for the arithmetic)`);
  console.log(`    ${lpad(disagree.length, 6)} row(s) the two rules disagree about\n`);
  if (disagree.length) {
    const nameById = new Map(everyone.rows.map(p => [p.id, `${p.code} ${p.name}`]));
    console.log('  Disagreements — each one is a day that does or does not come off a balance:\n');
    console.log(`    ${pad('employee', 40)}${pad('type', 12)}${pad('start', 12)}${pad('status', 10)}`
      + `${pad('manifest', 10)}${pad('cutover', 10)}chain`);
    for (const l of disagree.slice(0, 40)) {
      console.log(`    ${pad(String(nameById.get(l.employee_id) || '').slice(0, 38), 40)}${pad(l.leave_type, 12)}${pad(l.start_date, 12)}`
        + `${pad(l.status, 10)}${pad(ourOnlyManifest(l) ? 'ours' : 'zoho', 10)}`
        + `${pad(ourOnlyCutover(l) ? 'ours' : 'zoho', 10)}${l.has_chain ? 'yes' : 'no'}`);
    }
    if (disagree.length > 40) console.log(`    … and ${disagree.length - 40} more`);
    console.log('');
  }

  // ── Our-only days per employee and type ──────────────────────────────────
  const unitByCanonical = new Map(types.rows.map(t => [canonical(t.code), t.unit]));
  const daysOf = (l) => (unitByCanonical.get(l.leave_type) === 'hours' ? l.hours : l.total_days);

  const ours = new Map();  // `${empId}|${canonicalCode}` → { all, approved }
  for (const l of leaves) {
    if (!ourOnly(l)) continue;
    const key = `${l.employee_id}|${l.leave_type}`;
    const cur = ours.get(key) || { all: 0, approved: 0 };
    const d = daysOf(l) || 0;
    cur.all += d;
    if (l.status === 'approved') cur.approved += d;
    ours.set(key, cur);
  }

  // ── The table ────────────────────────────────────────────────────────────
  const typeById = new Map(types.rows.map(t => [t.id, t]));
  const rows = [];
  for (const [key, z] of zoho) {
    const [empId, typeId] = key.split('|');
    const person = active.find(p => p.id === empId);
    const type = typeById.get(typeId);
    if (!person || !type) continue;
    const code = canonical(type.code);
    const o = ours.get(`${empId}|${code}`) || { all: 0, approved: 0 };
    rows.push({ person, type, code, z, o });
  }

  /* Today's figures come from the code the API calls, not from arithmetic
   * repeated here: availableFor() picks the store — leave_balances, the
   * comp-off ledger, or the policy computation — and computedFor() is what it
   * falls back to. Today's booked is then read out of whichever store answered.
   * Each row is wrapped on its own so one failure cannot blank the rest. */
  for (const r of rows) {
    let todayAvailable = null, store = 'none', todayBooked = null;
    try {
      const a = await availableFor(pool, r.person.id, r.code, YEAR);
      todayAvailable = a.available; store = a.store;
      if (store === 'leave_balances') {
        const lb = await pool.query(
          `SELECT booked::float AS booked FROM leave_balances
            WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
          [r.person.id, r.type.id, YEAR]);
        todayBooked = lb.rows[0] ? lb.rows[0].booked : null;
      } else if (store === 'computed') {
        todayBooked = (await computedFor(pool, r.person.id, r.code, YEAR)).taken;
      }
    } catch (e) {
      store = `error: ${e.message.slice(0, 40)}`;
    }
    r.todayAvailable = todayAvailable;
    r.todayBooked = todayBooked;
    r.store = store;
    r.proposedAvailable = r.z.available === null ? null : round2(r.z.available - r.o.all);
    r.proposedBooked = round2(r.z.booked + r.o.all);
    r.delta = (todayAvailable === null || r.proposedAvailable === null)
      ? null : round2(r.proposedAvailable - todayAvailable);
  }
  rows.sort((a, b) => (a.person.code + a.type.name).localeCompare(b.person.code + b.type.name));

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Per employee and leave type — ${YEAR}`);
  console.log('──────────────────────────────────────────────────────────\n');
  const head = `  ${pad('code', 14)}${pad('name', 26)}${pad('joined', 12)}${pad('type', 18)}`
    + `${lpad('zAvail', 8)}${lpad('zBook', 8)}${lpad('oursAll', 9)}${lpad('oursApr', 9)}`
    + `${lpad('pAvail', 8)}${lpad('pBook', 8)}${lpad('tAvail', 8)}${lpad('tBook', 8)}${lpad('delta', 8)}   store`;
  console.log(head);
  console.log('  ' + '─'.repeat(head.length - 2));
  for (const r of rows) {
    console.log(`  ${pad(r.person.code, 14)}${pad((r.person.name || '').slice(0, 24), 26)}`
      + `${pad((r.person.joining || '').slice(0, 10), 12)}${pad(r.type.name.slice(0, 16), 18)}`
      + `${lpad(num(r.z.available), 8)}${lpad(r.z.hasBooked ? num(r.z.booked) : '-', 8)}`
      + `${lpad(num(r.o.all), 9)}${lpad(num(r.o.approved), 9)}`
      + `${lpad(num(r.proposedAvailable), 8)}${lpad(num(r.proposedBooked), 8)}`
      + `${lpad(r.todayAvailable === null ? '-' : num(r.todayAvailable), 8)}`
      + `${lpad(r.todayBooked === null ? '-' : num(r.todayBooked), 8)}`
      + `${lpad(r.delta === null ? '-' : num(r.delta), 8)}   ${r.store}`);
  }
  if (!rows.length) console.log('  No employee in the file matches an active employee here.');
  console.log('');

  // ── NEGATIVE ─────────────────────────────────────────────────────────────
  const negative = rows.filter(r => r.proposedAvailable !== null && r.proposedAvailable < 0);
  console.log('──────────────────────────────────────────────────────────');
  console.log('  NEGATIVE — proposed available below zero');
  console.log('──────────────────────────────────────────────────────────\n');
  if (!negative.length) console.log('  None.\n');
  else {
    console.log('  More was taken here than Zoho\'s opening figure covers. Writing these');
    console.log('  as they stand puts somebody in debt to their own balance — a decision,');
    console.log('  not a calculation.\n');
    console.log(`  ${pad('code', 14)}${pad('name', 26)}${pad('type', 18)}${lpad('zAvail', 8)}${lpad('oursAll', 9)}${lpad('proposed', 10)}${lpad('short by', 10)}`);
    for (const r of negative) {
      console.log(`  ${pad(r.person.code, 14)}${pad((r.person.name || '').slice(0, 24), 26)}${pad(r.type.name.slice(0, 16), 18)}`
        + `${lpad(num(r.z.available), 8)}${lpad(num(r.o.all), 9)}${lpad(num(r.proposedAvailable), 10)}${lpad(num(-r.proposedAvailable), 10)}`);
    }
    console.log('');
  }

  // ── NOT IN ZOHO ──────────────────────────────────────────────────────────
  const notInZoho = active.filter(p => !seenPeople.has(p.id));
  console.log('──────────────────────────────────────────────────────────');
  console.log('  NOT IN ZOHO — active here, no row in the file');
  console.log('──────────────────────────────────────────────────────────\n');
  if (!notInZoho.length) console.log('  None.\n');
  else {
    console.log('  Nothing is proposed for these people: with no Zoho opening figure there');
    console.log('  is nothing to open from, so they keep exactly what they have today.');
    console.log('  Most will be joiners after the cutover.\n');
    console.log(`  ${pad('code', 14)}${pad('name', 26)}${pad('joined', 12)}${pad('type', 18)}${lpad('tAvail', 8)}${lpad('tBook', 8)}   store`);
    for (const p of notInZoho) {
      for (const t of types.rows) {
        const code = canonical(t.code);
        let a = { available: null, store: 'none' };
        try { a = await availableFor(pool, p.id, code, YEAR); } catch (_) { /* reported as none */ }
        if (a.available === null) continue;
        let booked = null;
        if (a.store === 'leave_balances') {
          const lb = await pool.query(
            `SELECT booked::float AS booked FROM leave_balances
              WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`, [p.id, t.id, YEAR]);
          booked = lb.rows[0] ? lb.rows[0].booked : null;
        } else if (a.store === 'computed') {
          booked = (await computedFor(pool, p.id, code, YEAR)).taken;
        }
        console.log(`  ${pad(p.code, 14)}${pad((p.name || '').slice(0, 24), 26)}${pad((p.joining || '').slice(0, 10), 12)}`
          + `${pad(t.name.slice(0, 16), 18)}${lpad(num(a.available), 8)}${lpad(booked === null ? '-' : num(booked), 8)}   ${a.store}`);
      }
    }
    console.log('');
  }

  // ── IN ZOHO, NOT HERE ────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  IN ZOHO, NOT HERE — a row in the file matching no active employee');
  console.log('──────────────────────────────────────────────────────────\n');
  if (!inZohoNotHere.length) console.log('  None.\n');
  else {
    for (const m of inZohoNotHere) console.log(`    ${pad(m.cell.slice(0, 44), 46)}${m.note}`);
    console.log('\n  Their figures are ignored. Nothing is invented and nothing is guessed');
    console.log('  onto a similar name.\n');
  }
  if (matchedByName.length) {
    console.log('  Matched by NAME rather than by code — check each one is the right person:\n');
    for (const m of matchedByName) console.log(`    ${m}`);
    console.log('');
  }

  // ── UNMATCHED COLUMNS ────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  UNMATCHED COLUMNS — a leave type the file has and this system does not');
  console.log('──────────────────────────────────────────────────────────\n');
  if (!unmatchedColumns.length) console.log('  None.\n');
  else {
    for (const h of unmatchedColumns) console.log(`    ${h || '(blank)'}`);
    console.log('\n  Reported, never guessed at: a balance written under the wrong type is a');
    console.log('  balance somebody spends.\n');
  }

  // ── Counts ───────────────────────────────────────────────────────────────
  const up = rows.filter(r => r.delta !== null && r.delta > 0).length;
  const down = rows.filter(r => r.delta !== null && r.delta < 0).length;
  const same = rows.filter(r => r.delta !== null && r.delta === 0).length;
  const unknown = rows.filter(r => r.delta === null).length;
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Counts');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${lpad(dataRows, 6)} data row(s) in the file, after the header`);
  console.log(`    ${lpad(cells, 6)} figure(s) read from matched columns`);
  console.log(`    ${lpad(rows.length, 6)} employee/type pair(s) matched and planned`);
  console.log(`    ${lpad(new Set(rows.map(r => r.person.id)).size, 6)} employee(s) affected`);
  console.log(`    ${lpad(up, 6)} would go UP`);
  console.log(`    ${lpad(down, 6)} would go DOWN`);
  console.log(`    ${lpad(same, 6)} unchanged`);
  console.log(`    ${lpad(unknown, 6)} not comparable (the type has no balance here — Permission is hours`);
  console.log(`           against a monthly cap, Leave Without Pay has no ceiling at all)`);
  console.log(`    ${lpad(negative.length, 6)} would go negative`);
  console.log(`    ${lpad(notInZoho.length, 6)} active employee(s) with no row in the file`);
  console.log(`    ${lpad(inZohoNotHere.length, 6)} file row(s) matching nobody active here`);
  console.log(`    ${lpad(unmatchedColumns.length, 6)} column(s) with no leave type here\n`);

  // ── The same table as a CSV ──────────────────────────────────────────────
  const writable = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch (_) { return false; } };
  let outPath = OUT_ARG;
  let outWhy = 'given with --out';
  if (!outPath) {
    // Next to the input first, which is what the owner asked for; the scripts
    // here have hit EACCES writing into /app, so uploads/ (which the app
    // already writes to) and then the working directory are the fallbacks.
    const candidates = [
      [path.dirname(path.resolve(FILE)), 'beside the input CSV'],
      [path.join(__dirname, 'uploads'), 'backend/uploads, because the input folder is not writable'],
      [process.cwd(), 'the working directory, because nothing else was writable'],
    ];
    const [dir, why] = candidates.find(([d]) => writable(d)) || [process.cwd(), 'the working directory'];
    outPath = path.join(dir, `zoho_balance_plan_${YEAR}.csv`);
    outWhy = why;
  }
  const out = [
    ['code', 'name', 'joining_date', 'leave_type', 'zoho_available', 'zoho_booked',
      'ours_approved_and_pending', 'ours_approved_only', 'proposed_available', 'proposed_booked',
      'today_available', 'today_booked', 'delta', 'store', 'negative'].join(','),
    ...rows.map(r => [
      r.person.code, r.person.name, (r.person.joining || '').slice(0, 10), r.type.name,
      num(r.z.available), r.z.hasBooked ? num(r.z.booked) : '',
      num(r.o.all), num(r.o.approved), num(r.proposedAvailable), num(r.proposedBooked),
      r.todayAvailable === null ? '' : num(r.todayAvailable),
      r.todayBooked === null ? '' : num(r.todayBooked),
      r.delta === null ? '' : num(r.delta), r.store,
      (r.proposedAvailable !== null && r.proposedAvailable < 0) ? 'NEGATIVE' : '',
    ].map(csvCell).join(',')),
  ].join('\n') + '\n';
  try {
    fs.writeFileSync(outPath, out);
    console.log(`  The same table is in ${outPath}`);
    console.log(`  (${outWhy})\n`);
  } catch (e) {
    console.log(`  The CSV could not be written to ${outPath} — ${e.message}`);
    console.log('  Pass --out=<a writable path>. The table above is complete without it.\n');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log('  Nothing was written to the database. There is no --apply:');
  console.log('  read the plan, decide the negatives, then say what to write.');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
