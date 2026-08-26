/* ── Departments and designations, from Zoho ────────────────────────────────
 *  These are reference rows the whole company shares, so this behaves
 *  differently from the imports that replace a person's history:
 *
 *    A name that is missing here is INSERTED.
 *    A name that already exists is NEVER renamed and never replaced. At most
 *      its empty fields are filled — a mail alias, a parent, a department head.
 *      Renaming a department that people, leaves and reports already point at
 *      by name is not an import, it is a reorganisation.
 *    Matching is on the trimmed, case-insensitive name, because "Engineering "
 *      and "engineering" are the same department to everyone except a database.
 *
 *  Parents and heads are linked in a second pass, once every name exists —
 *  a parent department is often created after its children in Zoho's own list.
 *
 *  Everything it creates is recorded so restore_import_backup.js can remove it
 *  again, and every row it edits is stored whole beforehand.
 *
 *    docker compose exec backend node zoho_org.js
 *    docker compose exec backend node zoho_org.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_org.js does not send mail'); },
  verify: async () => { throw new Error('zoho_org.js does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const APPLY = process.argv.includes('--apply');
const pad = (s, n) => String(s ?? '').padEnd(n);
const clean = v => {
  const s = String(v ?? '').trim();
  return (s === '' || s === '-' || s.toLowerCase() === 'null') ? null : s;
};
const key = s => String(s ?? '').trim().toLowerCase();

async function zohoRecords(form) {
  const out = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/${encodeURIComponent(form)}/getRecords?sIndex=${i}&limit=200`);
    const rows = json?.response?.result;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const r = Object.values(w)[0]?.[0]; if (r) out.push(r); }
    if (rows.length < 200) break;
  }
  return out;
}

/* Zoho names a person as "Firstname Lastname CODE" with their mail id beside
 * it. Same resolution as the profile import: email, then the embedded code. */
async function resolvePerson(nameStr, mailId) {
  const email = clean(mailId);
  if (email) {
    const r = (await pool.query(
      `SELECT id FROM employees WHERE deleted_at IS NULL
         AND (LOWER(email) = LOWER($1) OR LOWER(official_email) = LOWER($1)) LIMIT 1`,
      [email])).rows[0];
    if (r) return r.id;
  }
  const code = (String(nameStr ?? '').match(/\b([A-Z]{2,}\d{4,})\b/) || [])[1];
  if (code) {
    const r = (await pool.query(
      `SELECT id FROM employees WHERE deleted_at IS NULL AND employee_id = $1 LIMIT 1`,
      [code])).rows[0];
    if (r) return r.id;
  }
  return null;
}

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Departments and designations — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (!(await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t) {
    console.log('  import_backups does not exist. Run migrate_import_backup.js first.\n');
    await pool.end();
    process.exit(1);
  }
  const hasTargetId = (await pool.query(
    `SELECT COUNT(*)::int n FROM information_schema.columns
      WHERE table_name = 'import_backups' AND column_name = 'target_id'`)).rows[0].n > 0;
  if (!hasTargetId) {
    console.log('  import_backups has no target_id column, so nothing here could be');
    console.log('  undone. Re-run: node migrate_import_backup.js\n');
    await pool.end();
    process.exit(1);
  }

  const [zDepts, zDesigs] = await Promise.all([
    zohoRecords('department').catch(e => { console.log(`  departments: ${e.message}`); return []; }),
    zohoRecords('designation').catch(e => { console.log(`  designations: ${e.message}`); return []; }),
  ]);

  const ourDepts = (await pool.query(
    `SELECT id, name, parent_id, head_id, mail_alias FROM departments`)).rows;
  const ourDesigs = (await pool.query(
    `SELECT id, name, mail_alias FROM designations`)).rows;
  const deptByName = new Map(ourDepts.map(d => [key(d.name), d]));
  const desigByName = new Map(ourDesigs.map(d => [key(d.name), d]));

  // ── What would happen ────────────────────────────────────────────────────
  const newDepts = [], fillDepts = [];
  for (const z of zDepts) {
    const name = clean(z.Department);
    if (!name) continue;
    const mine = deptByName.get(key(name));
    if (!mine) { newDepts.push({ name, z }); continue; }
    const fills = [];
    const alias = clean(z.MailAlias);
    if (alias && !mine.mail_alias) fills.push(['mail_alias', alias]);
    if (clean(z.Parent_Department) && !mine.parent_id) fills.push(['parent_id', '(second pass)']);
    if (clean(z.Department_Lead) && !mine.head_id) fills.push(['head_id', '(second pass)']);
    if (fills.length) fillDepts.push({ mine, z, fills });
  }
  const newDesigs = [], fillDesigs = [];
  for (const z of zDesigs) {
    const name = clean(z.Designation);
    if (!name) continue;
    const mine = desigByName.get(key(name));
    if (!mine) { newDesigs.push({ name, z }); continue; }
    const alias = clean(z.MailAlias);
    if (alias && !mine.mail_alias) fillDesigs.push({ mine, z, fills: [['mail_alias', alias]] });
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Departments — Zoho has ${zDepts.length}, this system has ${ourDepts.length}`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${newDepts.length} to create, ${fillDepts.length} with empty fields to fill,`
    + ` ${zDepts.length - newDepts.length - fillDepts.length} already complete\n`);
  for (const d of newDepts) console.log(`      create   ${d.name}`);
  for (const d of fillDepts) {
    console.log(`      fill     ${pad(d.mine.name, 28)}${d.fills.map(f => f[0]).join(', ')}`);
  }

  // Names here that Zoho does not have. Not an error — this system may simply
  // know about a department Zoho retired — but worth seeing before a bulk run.
  const zDeptNames = new Set(zDepts.map(z => key(z.Department)));
  const extraDepts = ourDepts.filter(d => !zDeptNames.has(key(d.name)));
  if (extraDepts.length) {
    console.log(`\n    ${extraDepts.length} here that Zoho does not have, left alone:`);
    console.log(`      ${extraDepts.map(d => d.name).join(', ')}`);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  Designations — Zoho has ${zDesigs.length}, this system has ${ourDesigs.length}`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    ${newDesigs.length} to create, ${fillDesigs.length} with empty fields to fill,`
    + ` ${zDesigs.length - newDesigs.length - fillDesigs.length} already complete\n`);
  for (const d of newDesigs) console.log(`      create   ${d.name}`);
  for (const d of fillDesigs) console.log(`      fill     ${pad(d.mine.name, 28)}mail_alias`);

  const zDesigNames = new Set(zDesigs.map(z => key(z.Designation)));
  const extraDesigs = ourDesigs.filter(d => !zDesigNames.has(key(d.name)));
  if (extraDesigs.length) {
    console.log(`\n    ${extraDesigs.length} here that Zoho does not have, left alone:`);
    console.log(`      ${extraDesigs.map(d => d.name).join(', ')}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const batch = `org-${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const remember = (table, id, created, fields) => client.query(
      `INSERT INTO import_backups (batch, table_name, target_id, created, row_data)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [batch, table, id, created, JSON.stringify({ fields: fields || [] })]);

    // ── First pass: every name exists ──────────────────────────────────────
    for (const d of newDepts) {
      const r = await client.query(
        `INSERT INTO departments (name, mail_alias, is_active) VALUES ($1,$2,TRUE) RETURNING id`,
        [d.name, clean(d.z.MailAlias)]);
      deptByName.set(key(d.name), { id: r.rows[0].id, name: d.name, parent_id: null, head_id: null, mail_alias: null });
      await remember('departments', r.rows[0].id, true);
    }
    for (const d of newDesigs) {
      const r = await client.query(
        `INSERT INTO designations (name, mail_alias, is_active) VALUES ($1,$2,TRUE) RETURNING id`,
        [d.name, clean(d.z.MailAlias)]);
      desigByName.set(key(d.name), { id: r.rows[0].id, name: d.name, mail_alias: null });
      await remember('designations', r.rows[0].id, true);
    }
    console.log(`    created ${newDepts.length} department(s), ${newDesigs.length} designation(s)`);

    // ── Second pass: link parents and heads, now that all names exist ──────
    let linked = 0, filled = 0;
    for (const z of zDepts) {
      const name = clean(z.Department);
      const mine = name && deptByName.get(key(name));
      if (!mine) continue;
      const sets = [], vals = [];
      const alias = clean(z.MailAlias);
      if (alias && !mine.mail_alias) { sets.push('mail_alias'); vals.push(alias); }

      const parentName = clean(z.Parent_Department);
      const parent = parentName && deptByName.get(key(parentName));
      // A department cannot be its own parent, however Zoho reports it.
      if (parent && parent.id !== mine.id && !mine.parent_id) { sets.push('parent_id'); vals.push(parent.id); }

      if (!mine.head_id) {
        const head = await resolvePerson(z.Department_Lead, z['Department_Lead.MailID']);
        if (head) { sets.push('head_id'); vals.push(head); }
      }
      if (!sets.length) continue;

      await client.query(
        `INSERT INTO import_backups (batch, table_name, target_id, created, row_data)
         SELECT $1, 'departments', $2, FALSE, jsonb_build_object('fields', $3::jsonb, 'row', to_jsonb(d))
           FROM departments d WHERE d.id = $2`,
        [batch, mine.id, JSON.stringify(sets)]);
      await client.query(
        `UPDATE departments SET ${sets.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW()
          WHERE id = $1`, [mine.id, ...vals]);
      if (sets.includes('parent_id') || sets.includes('head_id')) linked++;
      filled++;
    }
    for (const d of fillDesigs) {
      await client.query(
        `INSERT INTO import_backups (batch, table_name, target_id, created, row_data)
         SELECT $1, 'designations', $2, FALSE, jsonb_build_object('fields', $3::jsonb, 'row', to_jsonb(x))
           FROM designations x WHERE x.id = $2`,
        [batch, d.mine.id, JSON.stringify(['mail_alias'])]);
      await client.query(
        `UPDATE designations SET mail_alias = $2, updated_at = NOW() WHERE id = $1`,
        [d.mine.id, d.fills[0][1]]);
      filled++;
    }
    console.log(`    filled ${filled} existing row(s), of which ${linked} gained a parent or a head`);

    await client.query('COMMIT');
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Done. Nothing was renamed and nothing was removed.');
    console.log(`\n  To undo:  node restore_import_backup.js ${batch} --apply`);
    console.log('══════════════════════════════════════════════════════════\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}`);
    console.log('  Nothing was changed.\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
