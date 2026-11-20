/**
 * Announcement image — an optional illustration on a posted announcement.
 *
 * One column, same shape as cover_image_url: NULL means "no image", a value
 * is always a served path (/uploads/announcements/…). Nothing else about an
 * announcement's existing fields changes.
 */
const pool = require('./db');

const STEPS = [
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,
];

(async () => {
  let applied = 0;
  for (const sql of STEPS) {
    try { await pool.query(sql); applied++; }
    catch (err) { console.error(`  failed: ${sql.slice(0, 60)}…\n  ${err.message}`); }
  }
  console.log(`announcement image migration: ${applied}/${STEPS.length} statements applied`);

  const n = (await pool.query(
    `SELECT COUNT(*)::int c FROM announcements WHERE image_url IS NOT NULL`)).rows[0].c;
  console.log(`  ${n} announcement(s) currently have an image`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
