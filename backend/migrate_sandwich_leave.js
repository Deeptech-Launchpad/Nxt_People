/**
 * Sandwich leave — the days a leave request bridged.
 *
 * The count alone would not be enough. Two people can close the same gap from
 * either side (leave on Thursday, then leave on Monday), and without knowing
 * WHICH days were bridged the second request charges for the weekend again.
 * Storing the dates makes double counting impossible and the figure auditable:
 * "why is this three days" has an answer on the row itself.
 */
const pool = require('./db');

const STEPS = [
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS sandwich_days NUMERIC(5,2) DEFAULT 0`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS sandwich_dates DATE[]`,
];

(async () => {
  let applied = 0;
  for (const sql of STEPS) {
    try { await pool.query(sql); applied++; }
    catch (err) { console.error(`  failed: ${sql.slice(0, 60)}…\n  ${err.message}`); }
  }
  console.log(`sandwich leave migration: ${applied}/${STEPS.length} statements applied`);

  const n = (await pool.query(
    `SELECT COUNT(*)::int c FROM leaves WHERE COALESCE(sandwich_days, 0) > 0`)).rows[0].c;
  console.log(`  ${n} leave record(s) currently carry bridged days`);
  console.log('  Existing leave is left exactly as it was — this policy applies from');
  console.log('  the day it is switched on, not backwards over balances already spent.');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
