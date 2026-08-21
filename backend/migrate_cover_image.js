/**
 * Cover image — the banner on My Space.
 *
 * Organization Policy has offered two switches over this since it was built:
 * whether employees may choose from system-provided options, and whether they
 * may upload their own. There was nothing for them to govern, because there
 * was nowhere to set a cover at all — and the banner itself was hardcoded to
 * an image fetched from a third-party host on every dashboard load.
 *
 * One column. It holds either an uploaded path (/uploads/covers/…) or a
 * built-in key (preset:…), and NULL means "use whatever the organization
 * chose" — which is not the same as having chosen nothing, so the fallback
 * lives in the read rather than being written into everybody's row.
 */
const pool = require('./db');

const STEPS = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500)`,
];

(async () => {
  let applied = 0;
  for (const sql of STEPS) {
    try { await pool.query(sql); applied++; }
    catch (err) { console.error(`  failed: ${sql.slice(0, 60)}…\n  ${err.message}`); }
  }
  console.log(`cover image migration: ${applied}/${STEPS.length} statements applied`);

  const n = (await pool.query(
    `SELECT COUNT(*)::int c FROM employees WHERE cover_image_url IS NOT NULL`)).rows[0].c;
  console.log(`  ${n} employee(s) have chosen their own cover`);
  console.log('  Everyone else falls back to the organization cover at read time.');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
