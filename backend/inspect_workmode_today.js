/* READ ONLY. Why each of today's check-ins was placed the way it was.
 *
 * "Not placed" has several causes and the report cannot tell them apart from
 * the number alone:
 *
 *   - no coordinates reached the server at all (permission refused, or the
 *     browser never answered)
 *   - coordinates arrived but the fix was vaguer than the fence, so the
 *     accuracy rule refused to guess
 *   - coordinates arrived, were good, and the person really was outside every
 *     fence
 *   - classification was switched on after the punch
 *
 * The row records enough to tell which, and this reads it back.
 *
 *     docker compose -f docker-compose.prod.yml exec backend node inspect_workmode_today.js
 *     DATE=2026-09-04 docker compose ... node inspect_workmode_today.js
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const pool = require('./db');

const DATE = process.env.DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

(async () => {
  const cfg = (await pool.query(`SELECT geofence_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
  const fences = (await pool.query(
    `SELECT name, latitude::float8 AS lat, longitude::float8 AS lng, radius_meters AS radius,
            is_active, geofence_enabled
       FROM work_locations ORDER BY name`)).rows;

  console.log(`\n  WORK MODE FOR ${DATE}   (read only)\n`);
  console.log('  Settings');
  console.log('  ' + '-'.repeat(76));
  console.log(`    classification enabled   ${cfg.classifyEnabled === true}`);
  console.log(`    default radius           ${cfg.defaultRadiusMeters ?? 300} m`);
  console.log(`    ignore vague fixes       ${cfg.requireAccuracy !== false}`);
  console.log(`    unplaceable counts as    ${cfg.unknownCountsAs || 'unknown'}`);
  console.log('\n  Locations');
  console.log('  ' + '-'.repeat(76));
  for (const f of fences) {
    const state = !f.is_active ? 'inactive' : !f.geofence_enabled ? 'geofence off'
      : f.lat === null ? 'NO COORDINATES' : 'active';
    console.log(`    ${String(f.name).slice(0, 34).padEnd(36)} ${state.padEnd(16)}` +
      (f.lat === null ? '' : `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}  ${f.radius || cfg.defaultRadiusMeters || 300} m`));
  }

  const rows = (await pool.query(
    `SELECT e.employee_id AS code, e.first_name AS "firstName", e.is_remote AS "isRemote",
            a.work_mode AS mode,
            a.location_distance_meters AS distance,
            a.location_accuracy_meters AS accuracy,
            a.check_in_latitude IS NOT NULL AS "hasCoords",
            w.name AS "atLocation",
            to_char(a.check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "in"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN work_locations w ON w.id = a.work_location_resolved_id
      WHERE a.date = $1::date AND a.check_in IS NOT NULL
      ORDER BY a.work_mode NULLS LAST, e.employee_id`, [DATE])).rows;

  console.log(`\n  ${rows.length} check-in(s) on ${DATE}`);
  console.log('  ' + '-'.repeat(94));

  const why = (r) => {
    if (r.isRemote) return 'marked remote';
    if (!r.mode) return 'punched before classification was switched on';
    if (r.mode === 'office') return `at ${r.atLocation || 'a location'}, ${r.distance} m away`;
    if (r.mode === 'wfh') return `outside every fence${r.distance !== null ? `, nearest ${r.distance} m` : ''}`;
    if (!r.hasCoords) return 'NO COORDINATES EVER REACHED THE SERVER (permission refused, or never answered)';
    if (r.accuracy !== null) return `fix accurate to only ${r.accuracy} m — wider than the fence, so it was refused`;
    return 'coordinates arrived but could not be placed';
  };

  const tally = {};
  for (const r of rows) {
    const label = r.mode || 'not classified';
    tally[label] = (tally[label] || 0) + 1;
    console.log(`    ${r['in']}  ${String(r.code).padEnd(14)} ${String(r.mode || 'none').padEnd(10)} ${why(r)}`);
  }

  console.log('\n  Summary');
  console.log('  ' + '-'.repeat(76));
  Object.entries(tally).forEach(([k, n]) => console.log(`    ${String(k).padEnd(18)} ${n}`));

  const noCoords = rows.filter(r => r.mode && r.mode !== 'office' && r.mode !== 'wfh' && !r.hasCoords).length;
  const vague = rows.filter(r => r.mode && r.mode !== 'office' && r.mode !== 'wfh' && r.hasCoords && r.accuracy !== null).length;
  if (noCoords || vague) {
    console.log('\n  Of the unplaced:');
    if (noCoords) console.log(`    ${noCoords} sent no coordinates at all — location was refused or never answered.`);
    if (vague) console.log(`    ${vague} sent a fix too vague for the fence — typically a desktop, which has no GPS.`);
  }
  console.log('');
  await pool.end();
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
