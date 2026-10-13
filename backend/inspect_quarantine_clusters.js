/* Read-only follow-up on the quarantined orphan documents
 * (quarantine_orphan_documents.js). Does three things, none of which touch
 * a file or a row:
 *
 *   1. Looks up specific people by name/email in `employees`, and whether
 *      they already have proper rows in `employee_documents` — the
 *      question that decides "safe to delete as a duplicate" vs "this may
 *      be the only copy."
 *   2. Re-groups one day-cluster inside the quarantine folder by
 *      (extension, exact byte size) — same size strongly suggests an
 *      identical duplicate; a unique size is likely genuinely different
 *      content. This is a mechanical grouping, not an identification —
 *      it doesn't open or read any file.
 *   3. Nothing here infers WHO a file belongs to beyond what's passed in
 *      via --person. Matching a specific filename to a specific person is
 *      exactly the manual, read-the-document step already done for
 *      Logasundar and Balaji — this script only checks the database side
 *      of that question.
 *
 *   docker compose exec backend node inspect_quarantine_clusters.js \
 *     --person="Logasundar" \
 *     --person="Balaji" --email="balajidhanasekar2004@gmail.com" \
 *     --cluster-date=2026-08-28
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const QUARANTINE = path.join(__dirname, 'uploads', '_quarantine_legacy_orphans');

const args = process.argv.slice(2);
const getAll = (flag) => args.filter(a => a.startsWith(`--${flag}=`)).map(a => a.slice(flag.length + 3));
const getOne = (flag) => getAll(flag)[0];

const people = getAll('person');
const emails = getAll('email');
const clusterDate = getOne('cluster-date');

const human = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
};
const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const dayOf = (d) => d.toISOString().slice(0, 10);

async function lookupPerson(label, { name, email } = {}) {
  console.log(`\n--- ${label} ---`);
  const clauses = [];
  const params = [];
  if (name) {
    params.push(`%${name}%`);
    clauses.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length})`);
  }
  if (email) {
    params.push(email);
    clauses.push(`(email = $${params.length} OR personal_email = $${params.length})`);
  }
  if (!clauses.length) { console.log('  No name or email given — skipped.'); return; }

  const emp = await pool.query(
    `SELECT id, employee_id AS "employeeId", first_name AS "firstName", last_name AS "lastName",
            email, personal_email AS "personalEmail", status, deleted_at AS "deletedAt",
            created_at AS "createdAt", date_of_joining AS "dateOfJoining", joining_date AS "joiningDate",
            onboarding_status AS "onboardingStatus"
       FROM employees WHERE ${clauses.join(' OR ')}`,
    params
  );

  if (!emp.rows.length) {
    console.log(`  NO MATCH in employees table for name="${name || ''}" email="${email || ''}".`);
    console.log('  Either never a candidate/employee in this system, or under a different name/email on file.');
    return;
  }

  for (const e of emp.rows) {
    console.log(`  MATCH: ${e.firstName} ${e.lastName}  (${e.employeeId || e.id})`);
    console.log(`    email: ${e.email || '—'}   personal_email: ${e.personalEmail || '—'}`);
    console.log(`    status: ${e.status}${e.deletedAt ? `  [deleted_at: ${fmt(e.deletedAt)}]` : ''}   onboarding_status: ${e.onboardingStatus || '—'}`);
    console.log(`    created: ${fmt(e.createdAt)}   joined: ${fmt(e.dateOfJoining || e.joiningDate || e.createdAt)}`);

    const docs = await pool.query(
      `SELECT id, name, type, is_encrypted AS "isEncrypted", stored_name AS "storedName",
              file_missing AS "fileMissing", created_at AS "createdAt"
         FROM employee_documents WHERE employee_id = $1 ORDER BY created_at`,
      [e.id]
    );
    if (!docs.rows.length) {
      console.log('    employee_documents: NONE. No properly stored document exists for this person anywhere in the system.');
    } else {
      console.log(`    employee_documents: ${docs.rows.length} row(s)`);
      docs.rows.forEach(d => console.log(
        `      "${d.name}"  type=${d.type}  encrypted=${d.isEncrypted === true}  ` +
        `stored=${!!d.storedName}  missing=${d.fileMissing === true}  uploaded ${fmt(d.createdAt)}`));
    }
  }
}

(async () => {
  console.log('\n=== Quarantine cluster follow-up (read-only — nothing moved, nothing deleted) ===');

  // ── People lookups ────────────────────────────────────────────────────
  for (const name of people) await lookupPerson(`Name search: "${name}"`, { name });
  for (const email of emails) await lookupPerson(`Email search: "${email}"`, { email });

  // ── Re-group one cluster by (extension, size) ─────────────────────────
  if (clusterDate) {
    if (!fs.existsSync(QUARANTINE)) {
      console.log('\nQuarantine folder does not exist — run quarantine_orphan_documents.js first.');
    } else {
      const all = fs.readdirSync(QUARANTINE, { withFileTypes: true }).filter(e => e.isFile());
      const inCluster = all
        .map(e => ({ name: e.name, ...fs.statSync(path.join(QUARANTINE, e.name)) }))
        .filter(f => dayOf(f.mtime) === clusterDate);

      console.log(`\n--- Cluster ${clusterDate}: ${inCluster.length} file(s), re-grouped by (extension, exact size) ---`);
      const bySig = new Map();
      for (const f of inCluster) {
        const ext = path.extname(f.name).toLowerCase() || '(none)';
        const key = `${ext}|${f.size}`;
        if (!bySig.has(key)) bySig.set(key, { ext, size: f.size, files: [] });
        bySig.get(key).files.push(f.name);
      }
      const groups = [...bySig.values()].sort((a, b) => b.files.length - a.files.length);
      groups.forEach((g, i) => {
        const likely = g.files.length > 1 ? 'likely IDENTICAL duplicates (same size)' : 'UNIQUE size — likely distinct content';
        console.log(`\n  Group ${i + 1}: ${g.files.length} file(s), ${g.ext}, ${human(g.size)} each  —  ${likely}`);
        g.files.forEach(n => console.log(`      ${n}`));
      });
      console.log(`\n  ${groups.length} distinct (extension, size) group(s) found in this cluster.`);
      console.log('  This is a mechanical grouping only — matching a group to a specific person still needs the');
      console.log('  manual, read-the-file step already done for the two already identified. Tell me which group');
      console.log('  number is the placeholder graphic and which is Balaji\'s resume and I\'ll fold that into the');
      console.log('  decision table; any group left over after that is "needs further manual check."');
    }
  }

  await pool.end();
  console.log('\n=== done — read-only, nothing changed ===\n');
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
