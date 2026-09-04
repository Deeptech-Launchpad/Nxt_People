#!/usr/bin/env node
/* Why is today "Not placed"?
 *
 * READ ONLY. Nothing here writes.
 *
 * "Not placed" on the daily status report means the attendance row has no
 * work_mode. There are five different ways to arrive at that, and the report
 * cannot tell them apart because they all end in the same NULL:
 *
 *   1. classification is switched off      → nobody is ever placed
 *   2. no location has a fence turned on   → nothing to measure against
 *   3. the browser never gave a fix        → denied, or no GPS hardware
 *   4. a fix arrived but was too vague     → accuracy wider than the radius
 *   5. the fix arrived and the row was never patched
 *
 * They need completely different fixes, so this separates them.
 *
 *   node inspect_not_placed.js            today
 *   node inspect_not_placed.js 2026-09-03 a specific date
 */
const pool = require('./db');
const { config } = require('./utils/geofence');

const day = process.argv[2] || new Date().toLocaleDateString('en-CA');

(async () => {
  console.log(`\n=== Work-mode placement for ${day} ===\n`);

  const cfg = await config();
  console.log('Geofence config');
  console.log(`  classifyEnabled   ${cfg.classifyEnabled}${cfg.classifyEnabled ? '' : '   <-- OFF: nothing can ever be placed'}`);
  console.log(`  defaultRadius     ${cfg.defaultRadiusMeters} m`);
  console.log(`  requireAccuracy   ${cfg.requireAccuracy}`);
  console.log(`  unknownCountsAs   ${cfg.unknownCountsAs}`);
  console.log(`  blockOutsideFence ${cfg.blockOutsideFence}`);

  const fences = await pool.query(
    `SELECT name, is_active AS active, geofence_enabled AS fenced,
            latitude::float8 AS lat, longitude::float8 AS lng, radius_meters AS radius
       FROM work_locations ORDER BY name`);
  console.log(`\nLocations (${fences.rows.length})`);
  for (const f of fences.rows) {
    const usable = f.active && f.fenced && f.lat !== null && f.lng !== null;
    console.log(`  ${usable ? 'OK  ' : 'SKIP'} ${f.name.padEnd(26)} `
      + `active=${f.active} fenced=${f.fenced} `
      + `${f.lat === null ? 'NO COORDS' : `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`} `
      + `r=${f.radius || cfg.defaultRadiusMeters}m`);
  }
  const usableFences = fences.rows.filter(f => f.active && f.fenced && f.lat !== null);
  if (!usableFences.length) console.log('  <-- no usable fence: every punch resolves to unknown');

  /* The rows themselves. hasCoords is the fork in the road: with no
   * coordinates the server was never in a position to answer. */
  const att = await pool.query(
    `SELECT e.employee_id AS "empId", e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
            a.check_in, a.work_mode AS mode,
            a.check_in_latitude IS NOT NULL AS "hasCoords",
            a.location_accuracy_meters AS acc,
            a.location_distance_meters AS dist,
            a.check_in_location AS label,
            e.is_remote AS "isRemote"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1::date AND a.check_in IS NOT NULL
      ORDER BY e.employee_id`, [day]);

  const buckets = { office: [], wfh: [], noCoords: [], vague: [], patchedButNull: [] };
  for (const r of att.rows) {
    if (r.mode === 'office') buckets.office.push(r);
    else if (r.mode === 'wfh') buckets.wfh.push(r);
    else if (!r.hasCoords) buckets.noCoords.push(r);
    else if (r.acc !== null && r.acc > (usableFences[0]?.radius || cfg.defaultRadiusMeters)) buckets.vague.push(r);
    else buckets.patchedButNull.push(r);
  }

  console.log(`\nCheck-ins today: ${att.rows.length}`);
  console.log(`  Office                       ${buckets.office.length}`);
  console.log(`  WFH                          ${buckets.wfh.length}`);
  console.log(`  Not placed / no coordinates  ${buckets.noCoords.length}   <-- the browser never sent a fix`);
  console.log(`  Not placed / fix too vague   ${buckets.vague.length}   <-- accuracy wider than the fence`);
  console.log(`  Not placed / other           ${buckets.patchedButNull.length}`);

  /* Did a fix ever reach us for these people, by any route? The location log
   * is written alongside the patch, so its absence means the browser produced
   * nothing at all — consent refused, no hardware, or the capture timed out. */
  const logs = await pool.query(
    `SELECT l.employee_id, l.permission_status AS perm, l.accuracy::float8 AS acc,
            l.latitude IS NOT NULL AS "hasFix", l.created_at
       FROM attendance_location_logs l
      WHERE l.created_at::date = $1::date AND l.type = 'checkin'`, [day]);
  const byEmp = new Map();
  for (const l of logs.rows) byEmp.set(l.employee_id, l);

  console.log(`\nLocation captures logged today: ${logs.rows.length}`);
  const perms = {};
  for (const l of logs.rows) perms[l.perm || 'null'] = (perms[l.perm || 'null'] || 0) + 1;
  for (const [k, v] of Object.entries(perms)) console.log(`  ${k.padEnd(16)} ${v}`);

  const unplaced = [...buckets.noCoords, ...buckets.vague, ...buckets.patchedButNull];
  if (unplaced.length) {
    console.log(`\nUnplaced, one line each (${unplaced.length}):`);
    for (const r of unplaced) {
      /* The distance matters as much as the accuracy. A vague fix that lands
       * 80 m from the office is a correct answer we are refusing to trust; a
       * vague fix that lands 3 km away is one we are right to refuse. The two
       * call for opposite fixes, and the accuracy alone cannot separate them. */
      const why = !r.hasCoords ? 'no coordinates on the row'
        : r.acc !== null ? `fix accurate to ${Math.round(r.acc)} m`
          + (r.dist !== null ? `, landing ${Math.round(r.dist)} m from the office` : '')
        : 'coordinates present, mode still null';
      console.log(`  ${r.empId.padEnd(14)} ${r.name.trim().padEnd(26)} ${why}`);
    }
  }

  /* Accuracy is the number that decides case 4, so print its shape rather
   * than a single average — one 3 km outlier would hide fifty good fixes. */
  const accs = att.rows.map(r => r.acc).filter(a => a !== null).map(Number).sort((a, b) => a - b);
  if (accs.length) {
    const at = p => Math.round(accs[Math.floor((accs.length - 1) * p)]);
    console.log(`\nAccuracy of the fixes we did get (${accs.length} rows), metres:`);
    console.log(`  best ${at(0)}   median ${at(0.5)}   p90 ${at(0.9)}   worst ${at(1)}`);
    const radius = usableFences[0]?.radius || cfg.defaultRadiusMeters;
    console.log(`  wider than the ${radius} m fence: ${accs.filter(a => a > radius).length} of ${accs.length}`);
  } else {
    console.log('\nNo accuracy figures at all today — no fix ever reached the server.');
  }

  await pool.end();
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
