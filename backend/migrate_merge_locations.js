/* ── Collapse work locations back to the two that exist ───────────────────
 *  The org has two work locations: the office at Saibaba Colony, Coimbatore,
 *  and WFH. Live had six, because work_location was free text and people filled
 *  in where they sit rather than which site they work at:
 *
 *      Saibaba Colony, Coimbatore   134   the office
 *      WFH                           14   remote
 *      Floor 1 - IT Cabin             1   a room inside the office
 *      Second Floor - 3 Bay           1   a seat inside the office
 *      HR Department                  1   a department, in the location field
 *      Chennai                        1   not the office
 *
 *  The rule, from the org: if it is the office, it is Saibaba Colony; otherwise
 *  it is WFH. The three that name a room, a bay or a department are all inside
 *  the office. Chennai is not, so it is WFH.
 *
 *  The four decisions are written out below rather than inferred. A migration
 *  that guessed which strings mean "inside the building" would be wrong the
 *  first time someone typed a new one — so anything unrecognised is reported
 *  and left alone, not swept into WFH.
 *
 *  Both the foreign key and the text column move together: every report reads
 *  the text, and leaving it behind would show the old name for someone now
 *  linked to the new one.
 *
 *  Idempotent. Safe to re-run — after the first run there is nothing to merge.
 *      docker compose exec backend node migrate_merge_locations.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const OFFICE = 'Saibaba Colony, Coimbatore';
const REMOTE = 'WFH';

// Each stray, and which of the two it actually is.
const MERGE = [
  ['Floor 1 - IT Cabin', OFFICE],
  ['Second Floor - 3 Bay', OFFICE],
  ['HR Department', OFFICE],
  ['Chennai', REMOTE],
];

async function migrate() {
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT l.name, COUNT(e.id)::int AS employees
         FROM work_locations l
         LEFT JOIN employees e ON e.work_location_id = l.id AND e.deleted_at IS NULL
        GROUP BY l.name ORDER BY 2 DESC`
    );
    console.log('Before:');
    before.rows.forEach(r => console.log(`   ${String(r.employees).padStart(4)}  ${r.name}`));

    await client.query('BEGIN');

    // The two that survive must exist before anything is pointed at them.
    for (const name of [OFFICE, REMOTE]) {
      await client.query(
        `INSERT INTO work_locations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]
      );
    }
    await client.query(
      `UPDATE work_locations SET description = 'Work From Home'
        WHERE name = $1 AND description IS NULL`, [REMOTE]
    );

    let moved = 0;
    const notFound = [];
    for (const [from, to] of MERGE) {
      const src = await client.query(`SELECT id FROM work_locations WHERE name = $1`, [from]);
      if (!src.rows.length) { notFound.push(from); continue; }

      const dst = await client.query(`SELECT id FROM work_locations WHERE name = $1`, [to]);
      const who = await client.query(
        `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS name, employee_id AS code
           FROM employees WHERE work_location_id = $1 AND deleted_at IS NULL`,
        [src.rows[0].id]
      );

      const r = await client.query(
        `UPDATE employees SET work_location_id = $1, work_location = $2, updated_at = NOW()
          WHERE work_location_id = $3`,
        [dst.rows[0].id, to, src.rows[0].id]
      );
      moved += r.rowCount;
      who.rows.forEach(p => console.log(`   moved  ${p.name} (${p.code || 'no id'})  ${from} -> ${to}`));

      await client.query(`DELETE FROM work_locations WHERE id = $1`, [src.rows[0].id]);
    }

    // Anything still standing that is neither of the two is left for a human:
    // it may be a real third site, and merging it away would hide that.
    const strays = await client.query(
      `SELECT l.name, COUNT(e.id)::int AS employees
         FROM work_locations l
         LEFT JOIN employees e ON e.work_location_id = l.id AND e.deleted_at IS NULL
        WHERE l.name NOT IN ($1, $2)
        GROUP BY l.name ORDER BY 2 DESC`,
      [OFFICE, REMOTE]
    );

    await client.query('COMMIT');

    const after = await pool.query(
      `SELECT l.name, COUNT(e.id)::int AS employees
         FROM work_locations l
         LEFT JOIN employees e ON e.work_location_id = l.id AND e.deleted_at IS NULL
        GROUP BY l.name ORDER BY 2 DESC`
    );
    console.log('\nAfter:');
    after.rows.forEach(r => console.log(`   ${String(r.employees).padStart(4)}  ${r.name}`));

    console.log(`\n✅ ${moved} employee(s) moved.`);
    if (notFound.length) console.log(`   Already merged, nothing to do: ${notFound.join(', ')}`);
    if (strays.rows.length) {
      console.log('\n   ⚠ Still not one of the two — left alone rather than guessed at:');
      strays.rows.forEach(r => console.log(`     ${r.name} (${r.employees} employee(s))`));
      console.log('     Reassign those people, then delete the location in Manage Accounts.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Location merge failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
