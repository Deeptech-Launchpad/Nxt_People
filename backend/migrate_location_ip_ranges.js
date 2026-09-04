/* ── An office is also a network ──────────────────────────────────────────
 *  GPS cannot place a desk machine, and on 04/09/2026 that cost 27 of 43
 *  check-ins their work mode. Sixteen of them reported a fix accurate to
 *  1021 m landing 995 m from the building — the same figures to the metre for
 *  all sixteen, because that is not sixteen readings. It is one answer: the
 *  office Wi-Fi's mapped position, which the network databases place about a
 *  kilometre off. Measured against a 400 m fence it cannot say which side of
 *  the wall anybody is on, so the classifier correctly refused to guess. The
 *  other eleven produced no fix at all — a desktop has no GPS chip.
 *
 *  Loosening the accuracy rule would not have helped. 995 m is OUTSIDE the
 *  400 m fence, so those sixteen would have been recorded working from home
 *  while sitting at their desks. Widening the radius to swallow 995 m would
 *  cover most of the neighbourhood and place anybody in it at work.
 *
 *  The signal that does work is the one the packet already carries. A punch
 *  arriving from the office's own network came from the office, with no
 *  uncertainty to reason about. This is what Zoho calls "Allowed IP
 *  addresses", and it is the reason their desktop check-ins resolve where
 *  ours do not.
 *
 *  Ships INERT. The column is added empty, and a location with no ranges
 *  behaves exactly as it does today.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_location_ip_ranges.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* TEXT[] rather than the cidr/inet types on purpose: a rule may be a
     * single address or a network, the screen shows people back exactly what
     * they typed, and validation lives in utils/ipMatch.js where the check-in
     * path can share it. A cidr column would silently rewrite 203.0.113.7/24
     * into 203.0.113.0/24 and the admin would wonder what happened. */
    await client.query(`
      ALTER TABLE work_locations
        ADD COLUMN IF NOT EXISTS ip_ranges TEXT[] NOT NULL DEFAULT '{}'`);

    /* Which network placed a punch, kept beside which fence placed it. An
     * attendance row that says "office" without saying how it knows is not
     * answerable six months later when somebody disputes the day. */
    await client.query(`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS work_mode_source TEXT`);

    await client.query(`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS check_in_ip TEXT`);

    const cols = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name='work_locations' AND column_name='ip_ranges')
          OR (table_name='attendance' AND column_name IN ('work_mode_source','check_in_ip'))`);
    const have = new Set(cols.rows.map(r => `${r.table_name}.${r.column_name}`));
    for (const c of ['work_locations.ip_ranges', 'attendance.work_mode_source', 'attendance.check_in_ip']) {
      if (!have.has(c)) throw new Error(`${c} was not created`);
    }

    await client.query('COMMIT');

    const locs = await pool.query(
      `SELECT name, is_active AS active, geofence_enabled AS fenced,
              latitude IS NOT NULL AS "hasCoords", ip_ranges AS ips
         FROM work_locations ORDER BY name`);
    console.log('\nDone. Locations as they stand:\n');
    for (const l of locs.rows) {
      console.log(`  ${l.name.padEnd(28)} active=${l.active} fenced=${l.fenced} `
        + `coords=${l.hasCoords} ipRanges=${l.ips.length}`);
    }
    console.log('\nNothing is placed by IP until a location is given a range.');
    console.log('Set them in Operations > Organisation > Locations.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (err) => { console.error('\nFAILED:', err.message); try { await pool.end(); } catch {} process.exit(1); });
