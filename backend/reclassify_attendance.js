/* ── Re-run work-mode classification on already-punched rows ────────────────
 *  For check-ins that landed with no work_mode because the config that would
 *  have placed them (an office IP range, mainly) wasn't there yet at the
 *  moment they punched. Re-running classifyPunch() now, with whatever
 *  coordinates/IP the row already has saved, picks up anything added to
 *  Settings → Org → Locations since.
 *
 *  Only touches rows that:
 *    - are on the given date (default: today)
 *    - have check_in set (a real punch, not a manually-marked day)
 *    - have work_mode IS NULL (never classified — notClassified, not a prior
 *      'unknown'; see the protective CASE in routes/attendance.js for why a
 *      genuine 'unknown' is never downgraded further here either)
 *    - have SOMETHING to classify from: check_in_latitude/longitude, or
 *      check_in_ip
 *
 *  Dry-run by default — prints what WOULD change, writes nothing. Pass
 *  --apply to actually write the UPDATEs.
 *
 *    docker compose exec backend node reclassify_attendance.js
 *    docker compose exec backend node reclassify_attendance.js --date=2026-11-26
 *    docker compose exec backend node reclassify_attendance.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();

const pool = require('./db');
const { classifyPunch } = require('./utils/geofence');

const APPLY = process.argv.includes('--apply');
const dateArg = process.argv.find(a => a.startsWith('--date='));
const DATE = dateArg ? dateArg.split('=')[1] : new Date().toISOString().slice(0, 10);

async function main() {
  const { rows } = await pool.query(
    `SELECT a.id, a.employee_id AS "employeeId", a.check_in_latitude AS lat, a.check_in_longitude AS lng,
            a.location_accuracy_meters AS accuracy, a.check_in_ip AS ip, e.is_remote AS "isRemote",
            e.first_name AS "firstName", e.last_name AS "lastName", e.employee_id AS "employeeCode"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1::date
        AND a.check_in IS NOT NULL
        AND a.work_mode IS NULL
        AND (a.check_in_latitude IS NOT NULL OR a.check_in_ip IS NOT NULL)
      ORDER BY a.check_in`,
    [DATE]
  );

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} unclassified row(s) with a signal to retry, date ${DATE}`);
  if (!rows.length) { await pool.end(); return; }

  let changed = 0, stillUnplaced = 0;
  for (const r of rows) {
    const placement = await classifyPunch({
      latitude: r.lat, longitude: r.lng, accuracy: r.accuracy, ip: r.ip,
      employee: { id: r.employeeId, isRemote: r.isRemote === true },
      date: DATE,
    }).catch(err => ({ mode: null, reason: `classification threw: ${err.message}` }));

    const newMode = placement.mode || null;
    const who = `${r.employeeCode} ${r.firstName} ${r.lastName}`;
    if (!newMode) {
      stillUnplaced++;
      console.log(`  ${who}: still unplaced (${placement.reason || 'no reason given'})`);
      continue;
    }
    changed++;
    console.log(`  ${who}: -> ${newMode}${placement.source ? ` (${placement.source})` : ''}${placement.locationName ? `, ${placement.locationName}` : ''}`);

    if (APPLY) {
      await pool.query(
        `UPDATE attendance
            SET work_mode = $2, work_mode_source = $3, work_location_resolved_id = $4,
                location_distance_meters = COALESCE($5, location_distance_meters),
                location_accuracy_meters = COALESCE($6, location_accuracy_meters),
                updated_at = NOW()
          WHERE id = $1 AND work_mode IS NULL`, // re-check NULL at write time — never overwrite
                                                  // anything this script's own earlier row didn't see
        [r.id, newMode, placement.source || null, placement.locationId || null,
         placement.distance ?? null, placement.accuracy ?? null]
      );
    }
  }

  console.log(`\n${changed} row(s) ${APPLY ? 'updated' : 'would be updated'}, ${stillUnplaced} still unplaced.`);
  if (!APPLY && changed) console.log('Re-run with --apply to write these changes.');
  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
