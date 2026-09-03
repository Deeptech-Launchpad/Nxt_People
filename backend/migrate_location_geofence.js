/* ── A location becomes the geofence ──────────────────────────────────────
 *  Today nothing is geofenced at all. The check-in handler guards on
 *  `settings.office_latitude && settings.office_longitude`, and both are
 *  NULL on live, so the distance is never computed. The "Work Mode" label on
 *  the check-in screen reverse-geocodes the punch to a place name and string
 *  matches it against settings.office_area_name — also NULL. Nobody has ever
 *  been classified, and attendance_location_logs holds zero rows.
 *
 *  So this is a build, not a migration of behaviour. It ships INERT:
 *  classification is off until switched on, and a location with no
 *  coordinates classifies nothing.
 *
 *  The model:
 *
 *    work_locations gains the point and its own radius. The company's real
 *    coordinates are a property of the place, not of the whole instance —
 *    an org with two offices cannot have one office_latitude.
 *
 *    employees gains is_remote, for people who genuinely work from home. A
 *    remote employee visiting the office should not silently become Office
 *    for the day and lose whatever their arrangement carries.
 *
 *    attendance records the ANSWER: the mode, which location matched, how far
 *    away, and how accurate the fix was. Stored rather than recomputed, so a
 *    report does not have to re-derive months of history, and so a later
 *    change to a radius does not silently rewrite the past.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_location_geofence.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

/* Off until an administrator turns it on, and 300 m as the default fence.
 * unknownCountsAs is deliberately 'unknown' rather than 'wfh': a punch with
 * no usable fix is a punch we cannot place, and calling it working-from-home
 * would put a guess into somebody's record. */
const DEFAULT_CONFIG = {
  classifyEnabled: false,
  defaultRadiusMeters: 300,
  unknownCountsAs: 'unknown',
  requireAccuracy: true,
  blockOutsideFence: false,
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── The location's point and its own fence ────────────────────────────
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS latitude  NUMERIC(10, 7)`);
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7)`);
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS radius_meters INTEGER`);
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS coordinates_set_at TIMESTAMP`);
    await client.query(`ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS coordinates_set_by UUID REFERENCES employees(id) ON DELETE SET NULL`);

    /* Guard rails on the values themselves. A longitude of 200 is not a
     * place, and a fence of 50 km is not a fence — both are the shape of a
     * typo, and refusing them at the column means no screen can let one
     * through. Applied only when absent, because a CHECK cannot be added
     * twice. */
    const addCheck = async (name, expr) => {
      const exists = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
      if (!exists.rows.length) {
        await client.query(`ALTER TABLE work_locations ADD CONSTRAINT ${name} CHECK (${expr})`);
      }
    };
    await addCheck('work_locations_lat_range', 'latitude IS NULL OR (latitude >= -90 AND latitude <= 90)');
    await addCheck('work_locations_lng_range', 'longitude IS NULL OR (longitude >= -180 AND longitude <= 180)');
    await addCheck('work_locations_radius_range', 'radius_meters IS NULL OR (radius_meters >= 20 AND radius_meters <= 5000)');
    /* A half-set point is worse than none: it would place the office on the
     * equator. Both or neither. */
    await addCheck('work_locations_point_complete',
      '(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)');

    // ── People who are not expected at an office ──────────────────────────
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_remote BOOLEAN NOT NULL DEFAULT FALSE`);

    // ── What a punch resolved to ──────────────────────────────────────────
    await client.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS work_mode VARCHAR(20)`);
    await client.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS work_location_resolved_id UUID REFERENCES work_locations(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_distance_meters INTEGER`);
    await client.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_accuracy_meters INTEGER`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_attendance_work_mode ON attendance (work_mode) WHERE work_mode IS NOT NULL`);

    // ── The org's defaults ────────────────────────────────────────────────
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS geofence_config JSONB`);
    await client.query(
      `UPDATE settings SET geofence_config = $1::jsonb WHERE geofence_config IS NULL`,
      [JSON.stringify(DEFAULT_CONFIG)]);

    /* If the old single-point setting was ever filled in, move it onto the
     * location with the most people rather than leaving it stranded. On live
     * both are NULL, so this does nothing — it is here for any environment
     * where somebody did set them. */
    const legacy = await client.query(
      `SELECT office_latitude AS lat, office_longitude AS lng, gps_radius_meters AS radius
         FROM settings LIMIT 1`);
    const L = legacy.rows[0] || {};
    let carried = null;
    if (L.lat !== null && L.lat !== undefined && L.lng !== null && L.lng !== undefined) {
      const target = await client.query(
        `SELECT l.id, l.name FROM work_locations l
          WHERE l.is_active AND l.latitude IS NULL
          ORDER BY (SELECT COUNT(*) FROM employees e WHERE e.work_location_id = l.id) DESC
          LIMIT 1`);
      if (target.rows.length) {
        await client.query(
          `UPDATE work_locations SET latitude=$1, longitude=$2, radius_meters=$3,
                  coordinates_set_at=NOW(), updated_at=NOW() WHERE id=$4`,
          [L.lat, L.lng, L.radius || DEFAULT_CONFIG.defaultRadiusMeters, target.rows[0].id]);
        carried = target.rows[0].name;
      }
    }

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM work_locations WHERE is_active) AS locations,
             (SELECT COUNT(*)::int FROM work_locations WHERE latitude IS NOT NULL) AS placed,
             (SELECT COUNT(*)::int FROM employees WHERE is_remote) AS remote,
             (SELECT geofence_config->>'classifyEnabled' FROM settings LIMIT 1) AS enabled,
             (SELECT geofence_config->>'defaultRadiusMeters' FROM settings LIMIT 1) AS radius`);
    const c = r.rows[0];

    console.log('\n  Location geofencing ready');
    console.log('  ----------------------------------------------------');
    console.log(`  active locations            ${c.locations}`);
    console.log(`  with coordinates set        ${c.placed}`);
    console.log(`  employees marked remote     ${c.remote}`);
    console.log(`  default radius              ${c.radius} m`);
    console.log(`  classification enabled      ${c.enabled}`);
    /* The closing note has to match what was actually found. It used to say
     * "no location has coordinates yet" unconditionally, and then printed
     * that directly under a line reporting one that had — which is the kind
     * of contradiction that teaches people to stop reading output. */
    if (carried) {
      console.log(`\n  Carried the old single office point onto "${carried}".`);
      console.log('  VERIFY IT BEFORE SWITCHING CLASSIFICATION ON. That point came from a');
      console.log('  setting nothing was reading, so nobody has ever checked it is right.');
      console.log('  Open the location, press "Test from where I am" while standing at the');
      console.log('  office, and re-capture it if the distance looks wrong.');
    }
    console.log(`\n  Classification is ${c.enabled === 'true' ? 'ON' : 'OFF'}.`);
    if (c.enabled !== 'true') {
      console.log('  Nothing about check-in changes until an administrator switches it on');
      console.log('  under Settings -> Attendance -> Geo Restriction.');
    }
    if (Number(c.placed) === 0) {
      console.log('  No location has coordinates yet, so there is nothing to switch on.');
    }
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('  Location geofence migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
