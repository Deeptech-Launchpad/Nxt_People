/* ── My Space → Dashboard: where a person's widget layout lives ─────────────
 *  The dashboard let you look at eight fixed cards in one fixed order. Zoho's
 *  equivalent lets you hide the cards you don't use and drag the rest into the
 *  order you read them in, and remembers that per person.
 *
 *  One JSONB column on employees rather than a table of (employee, widget,
 *  position) rows: the layout is only ever read and written whole, by one
 *  person, for one screen. A table would buy referential integrity over widget
 *  keys that are defined in the frontend anyway, at the cost of a join on every
 *  dashboard load.
 *
 *  Shape is { order: [key, …], hidden: [key, …] }. NULL means "never
 *  customised" and the frontend's default layout stands — which is also what a
 *  new hire gets, so there is no back-fill.
 *
 *  Unknown keys are rejected by the route, not by a constraint here: the set of
 *  widgets changes when the frontend changes, and a CHECK would need a
 *  migration every time a widget is added.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_dashboard_layout.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const steps = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS dashboard_layout JSONB`,
];

async function migrate() {
  console.log('\n  Migrating dashboard widget layout storage...\n');
  let failed = 0;

  for (const sql of steps) {
    const label = sql.trim().replace(/\s+/g, ' ').substring(0, 80);
    try {
      await pool.query(sql);
      console.log(`  ok   ${label}`);
    } catch (err) {
      console.error(`  FAIL ${label}`);
      console.error(`       ${err.message}`);
      failed++;
    }
  }

  try {
    const col = (await pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'employees' AND column_name = 'dashboard_layout'`)).rows[0];
    const saved = (await pool.query(
      `SELECT COUNT(*)::int n FROM employees WHERE dashboard_layout IS NOT NULL`)).rows[0].n;

    console.log(`\n  employees.dashboard_layout  ${col ? `ready (${col.data_type})` : 'MISSING'}`);
    console.log(`  customised layouts          ${saved}\n`);
  } catch (err) {
    console.error(`\n  Could not verify: ${err.message}\n`);
    failed++;
  }

  await pool.end();
  process.exitCode = failed > 0 ? 1 : 0;
}

migrate();
