/* Quarantines the legacy hash-named files in backend/uploads/ that
 * inspect_uploads_inventory.js reports as ORPHANED — no row in
 * employee_documents references them at all (not even a dangling one; this
 * is the flat pre-migration layout, so there's no folder/stored_name to
 * match against either).
 *
 * MOVES, NEVER DELETES. Every file keeps its original name and lands in
 * backend/uploads/_quarantine_legacy_orphans/ — fully reversible by moving
 * it back. Nothing in employee_documents, employees, or any other table is
 * touched.
 *
 * Also produces a best-effort, clearly-unconfirmed correlation against the
 * employees table by timestamp proximity, and a separate check for any
 * soft-deleted ('deleted_at') or audit-logged employee removal whose timing
 * might explain an orphan with no current owner. This is a correlation, not
 * an identification — nothing here reads file content.
 *
 *   docker compose exec backend node quarantine_orphan_documents.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const ROOT = path.join(__dirname, 'uploads');
const QUARANTINE = path.join(ROOT, '_quarantine_legacy_orphans');
const HEX32 = /^[0-9a-f]{32}(\.\w+)?$/i;

const human = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
};
const dayOf = (d) => d.toISOString().slice(0, 10);
const fmt = (d) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

(async () => {
  console.log('\n=== Quarantining orphaned legacy documents ===\n');

  // ── Step 1: re-derive the orphan list (same logic as
  //    inspect_uploads_inventory.js) — don't trust a hardcoded list, the
  //    directory may have changed since that was last run. ─────────────
  const looseFiles = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(e => e.isFile()).map(e => e.name);
  const hashNamed = looseFiles.filter(n => HEX32.test(n));

  const orphans = [];
  for (const file of hashNamed) {
    const base = file.replace(/\.\w+$/, '');
    const r = await pool.query(
      `SELECT 1 FROM employee_documents WHERE file_url LIKE '%' || $1 || '%'`, [base]
    ).catch(() => ({ rows: [] }));
    if (!r.rows.length) orphans.push(file);
  }

  console.log(`  ${hashNamed.length} legacy hash-named file(s) found, ${orphans.length} orphaned (no DB row).`);
  if (!orphans.length) { console.log('  Nothing to quarantine.\n'); await pool.end(); return; }

  // ── Step 2: move them, preserving filenames, collecting stats first ──
  fs.mkdirSync(QUARANTINE, { recursive: true });
  const moved = [];
  for (const file of orphans) {
    const src = path.join(ROOT, file);
    const stat = fs.statSync(src);
    const dest = path.join(QUARANTINE, file);
    if (fs.existsSync(dest)) {
      console.log(`  SKIPPED  ${file} — already in quarantine from a previous run`);
      continue;
    }
    fs.renameSync(src, dest);
    moved.push({
      file, ext: path.extname(file).toLowerCase() || '(none)', size: stat.size,
      mtime: stat.mtime, birthtime: stat.birthtimeMs > 0 ? stat.birthtime : null,
    });
  }
  console.log(`  ${moved.length} file(s) moved into uploads/_quarantine_legacy_orphans/\n`);

  // ── Step 3: deleted-employee trail ────────────────────────────────────
  // This app only ever soft-deletes (routes/employees.js DELETE /:id does
  // UPDATE ... SET deleted_at = NOW(), never a real DELETE), so a removed
  // employee's row still exists unless someone bypassed the app entirely.
  const softDeleted = (await pool.query(
    `SELECT id, employee_id AS "employeeId", first_name AS "firstName", last_name AS "lastName",
            created_at AS "createdAt", deleted_at AS "deletedAt"
       FROM employees WHERE deleted_at IS NOT NULL ORDER BY deleted_at`
  ).catch(() => ({ rows: [] }))).rows;

  const deletionAudits = (await pool.query(
    `SELECT resource_id AS "resourceId", actor_email AS "actorEmail", created_at AS "createdAt"
       FROM audit_log WHERE resource ILIKE 'employee%' AND action ILIKE '%DELETE%' ORDER BY created_at`
  ).catch(() => ({ rows: [] }))).rows;

  // Audit entries whose employee no longer exists in the table at all —
  // would mean a hard delete happened outside the app's own soft-delete path.
  const stillExist = new Set((await pool.query(`SELECT id FROM employees`)).rows.map(r => String(r.id)));
  const trulyGone = deletionAudits.filter(a => !stillExist.has(String(a.resourceId)));

  console.log('--- Deleted-employee trail ---');
  console.log(`  Soft-deleted employees (row still present, deleted_at set): ${softDeleted.length}`);
  softDeleted.forEach(e => console.log(
    `    ${e.firstName || '?'} ${e.lastName || ''} (${e.employeeId || e.id}) — created ${fmt(e.createdAt)}, deleted ${fmt(e.deletedAt)}`));
  console.log(`  audit_log deletion entries: ${deletionAudits.length}`);
  console.log(`  Of those, referencing an employee id with NO row left at all (possible hard delete outside the app): ${trulyGone.length}`);
  trulyGone.forEach(a => console.log(`    employee id ${a.resourceId} — deleted by ${a.actorEmail || 'unknown'} at ${fmt(a.createdAt)}`));
  console.log('');

  // ── Step 4: timestamp correlation against employees.created_at /
  //    date_of_joining — grouped by same-day clusters. Explicitly a guess. ─
  const allEmployees = (await pool.query(
    `SELECT id, employee_id AS "employeeId", first_name AS "firstName", last_name AS "lastName",
            created_at AS "createdAt", date_of_joining AS "dateOfJoining", joining_date AS "joiningDate",
            deleted_at AS "deletedAt"
       FROM employees`
  )).rows;

  const candidatesNear = (fileDate) => {
    const target = dayOf(fileDate);
    const near = [];
    for (const e of allEmployees) {
      for (const [label, raw] of [['created', e.createdAt], ['joined', e.dateOfJoining || e.joiningDate]]) {
        if (!raw) continue;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) continue;
        const diffDays = Math.abs((d - fileDate) / 86400000);
        if (diffDays <= 3) {
          near.push({
            label, diffDays: Math.round(diffDays * 10) / 10,
            name: `${e.firstName || '?'} ${e.lastName || ''}`.trim(),
            employeeId: e.employeeId || e.id, archived: !!e.deletedAt,
          });
        }
      }
    }
    // Closest match first; same person can appear via both created/joined —
    // keep only their closest hit.
    const best = new Map();
    for (const c of near) {
      const prev = best.get(c.employeeId);
      if (!prev || c.diffDays < prev.diffDays) best.set(c.employeeId, c);
    }
    return [...best.values()].sort((a, b) => a.diffDays - b.diffDays);
  };

  // Group moved files by calendar day (mtime — the more reliable of the two
  // on a Docker overlay filesystem; birthtime is reported too where available).
  const groups = new Map();
  for (const m of moved) {
    const key = dayOf(m.mtime);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const sortedDays = [...groups.keys()].sort();

  console.log(`--- File-by-file report, grouped by day (${moved.length} files, ${sortedDays.length} day-cluster(s)) ---\n`);
  for (const day of sortedDays) {
    const files = groups.get(day);
    const candidates = candidatesNear(files[0].mtime);
    console.log(`  ${day}  —  ${files.length} file(s)`);
    if (candidates.length) {
      console.log('    Possible match (by onboarding-date proximity — NOT confirmed, file content was not read):');
      candidates.slice(0, 5).forEach(c => console.log(
        `      ${c.name} (${c.employeeId})  — ${c.label} ${c.diffDays === 0 ? 'same day' : `${c.diffDays}d away`}${c.archived ? '  [now deleted/archived]' : ''}`));
    } else {
      console.log('    No employee record within 3 days of this date — no guess available.');
    }
    files.forEach(f => console.log(
      `      ${f.file}  type=${f.ext}  ${human(f.size).padStart(9)}  modified ${fmt(f.mtime)}${f.birthtime ? `  created ${fmt(f.birthtime)}` : ''}`));
    console.log('');
  }

  await pool.end();
  console.log('=== done — files moved, nothing deleted, nothing in the database touched ===\n');
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
