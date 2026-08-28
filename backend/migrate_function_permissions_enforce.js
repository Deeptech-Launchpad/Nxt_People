/* ── Function Based Permissions become real ─────────────────────────────────
 *  Until now nothing read role_functions. The screen saved, the rows came back
 *  faithfully, and no code anywhere consulted them — so every switch on
 *  Settings → User Access Control → Function Based Permissions did nothing.
 *  utils/functionAccess.js now enforces ten of the sixteen.
 *
 *  Switching enforcement on over the existing rows changes behaviour, and this
 *  makes sure it changes it in exactly one direction: not at all.
 *
 *  Two things happen.
 *
 *  1. Every general role gets a row for every function in the catalogue. A role
 *     created before a function existed has no row for it. The code falls back
 *     to the catalogue default in that case, so this is belt and braces — but
 *     it means the screen and the database agree, which matters now that the
 *     screen's values are load-bearing.
 *
 *  2. Three switches are reset to what the application actually does today:
 *
 *        announcements.manage                   false → true
 *        work_anniversary                       false → true
 *        work_anniversary.showYearsOfExperience  false → true
 *
 *     These were seeded from the reference's screenshots, where they sit off.
 *     Ours has always let a full-access user post announcements, and has always
 *     shown the anniversaries widget with years on it. Enforcing the seeded
 *     values would have withdrawn three working features the moment this
 *     deployed, and nobody would have connected the two.
 *
 *     Resetting them is safe precisely because nothing has ever read them: a
 *     value in these columns cannot be somebody's decision, because no decision
 *     made here has ever had an effect. An administrator can switch them off
 *     deliberately afterwards, and that will now do something.
 *
 *  Dry run by default. Sends no mail. Touches only role_functions.
 *
 *    docker compose exec backend node migrate_function_permissions_enforce.js
 *    docker compose exec backend node migrate_function_permissions_enforce.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';

const pool = require('./db');
const { FUNCTIONS } = require('./utils/accessCatalog');

const APPLY = process.argv.includes('--apply');
const pad = (s, n) => String(s ?? '').padEnd(n);

// The switches the reference has off and this application does not.
// `allowed: null` means leave the row's allowed flag alone and set only the option.
const BEHAVIOUR_PRESERVING = [
  { key: 'announcements',    allowed: null, option: 'manage',                value: true },
  { key: 'work_anniversary', allowed: true, option: 'showYearsOfExperience', value: true },
];

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Function Based Permissions — enforcement groundwork');
  console.log(`  ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const roles = (await pool.query(
    `SELECT id, key, name FROM roles WHERE kind = 'general' ORDER BY rank`
  )).rows;

  if (!roles.length) {
    console.log('  No general roles exist. Run migrate_access_control.js first.\n');
    await pool.end();
    return;
  }
  console.log(`  ${roles.length} general role(s): ${roles.map(r => r.name).join(', ')}\n`);

  const existing = (await pool.query(
    `SELECT role_id, function_key, allowed, options FROM role_functions`
  )).rows;
  const have = new Map(existing.map(r => [`${r.role_id}|${r.function_key}`, r]));

  // ── 1. rows that were never seeded ─────────────────────────────────────────
  const missing = [];
  for (const role of roles) {
    for (const f of FUNCTIONS) {
      if (!have.has(`${role.id}|${f.key}`)) missing.push({ role, f });
    }
  }

  console.log(`  Missing rows          ${missing.length}`);
  if (missing.length) {
    const byRole = {};
    for (const m of missing) byRole[m.role.name] = (byRole[m.role.name] || 0) + 1;
    for (const [name, n] of Object.entries(byRole)) {
      console.log(`    ${pad(name, 18)}${n} function(s)`);
    }
  }

  // ── 2. the behaviour-preserving resets ─────────────────────────────────────
  const resets = [];
  for (const role of roles) {
    for (const spec of BEHAVIOUR_PRESERVING) {
      const row = have.get(`${role.id}|${spec.key}`);
      if (!row) continue;
      const opts = row.options || {};
      const needAllowed = spec.allowed !== null && row.allowed !== spec.allowed;
      const needOption = opts[spec.option] !== spec.value;
      if (needAllowed || needOption) {
        resets.push({ role, spec, from: { allowed: row.allowed, option: opts[spec.option] } });
      }
    }
  }

  console.log(`  Switches to reset     ${resets.length}\n`);
  for (const r of resets) {
    const bits = [];
    if (r.spec.allowed !== null && r.from.allowed !== r.spec.allowed) {
      bits.push(`allowed ${r.from.allowed} → ${r.spec.allowed}`);
    }
    if (r.from.option !== r.spec.value) {
      bits.push(`${r.spec.option} ${r.from.option} → ${r.spec.value}`);
    }
    console.log(`    ${pad(r.role.name, 16)}${pad(r.spec.key, 20)}${bits.join(', ')}`);
  }
  if (resets.length) console.log('');

  if (!missing.length && !resets.length) {
    console.log('  Nothing to do — every role already matches.\n');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const { role, f } of missing) {
      await client.query(
        `INSERT INTO role_functions (role_id, function_key, allowed, options)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
        [role.id, f.key, f.default, JSON.stringify(f.defaultOptions || {})]
      );
    }

    for (const { role, spec } of resets) {
      // jsonb_set rather than writing the whole object, so any other key
      // somebody has stored alongside this one survives.
      await client.query(
        `UPDATE role_functions
            SET allowed = COALESCE($3, allowed),
                options = jsonb_set(COALESCE(options, '{}'::jsonb), $4::text[], $5::jsonb, true)
          WHERE role_id = $1 AND function_key = $2`,
        [role.id, spec.key, spec.allowed, `{${spec.option}}`, JSON.stringify(spec.value)]
      );
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

  const total = (await pool.query('SELECT count(*)::int AS n FROM role_functions')).rows[0].n;
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Done. ${missing.length} row(s) added, ${resets.length} switch(es) reset.`);
  console.log(`  role_functions now holds ${total} row(s) — ${roles.length} role(s) × ${FUNCTIONS.length} function(s).`);
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
