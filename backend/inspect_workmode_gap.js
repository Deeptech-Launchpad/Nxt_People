#!/usr/bin/env node
/* Who are the "earlier check-ins not counted" on Present/Absent Status'
 * Where People Are Working donut, and is that bucket telling the truth?
 *
 * READ ONLY. Nothing here writes.
 *
 * That donut only ever counts a checked-in row into Office or WFH when
 * attendance.work_mode is 'office' or 'wfh'. A row with work_mode NULL means
 * classification was never attempted at all (as opposed to 'unknown', which
 * means it WAS attempted and failed) — the frontend calls that "recorded
 * before location tracking was switched on". This prints every such row for
 * a date, with whatever location signal it actually has (GPS coords, IP,
 * work_mode_source), so "before tracking was on" can be checked against the
 * real data instead of taken on faith.
 *
 *   node inspect_workmode_gap.js            today
 *   node inspect_workmode_gap.js 2026-09-07 a specific date
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const DATE = process.argv[2] || new Date().toLocaleDateString('en-CA');

(async () => {
  console.log(`\n=== Where People Are Working — the uncounted bucket, ${DATE} ===\n`);

  const all = await pool.query(
    `SELECT e.employee_id AS code, e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
            a.check_in::text AS "checkIn", a.check_out::text AS "checkOut",
            a.work_mode AS "workMode", a.work_mode_source AS "workModeSource",
            a.check_in_ip AS "checkInIp",
            a.check_in_latitude AS lat, a.check_in_longitude AS lng,
            a.check_in_location AS "checkInLocation"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1::date AND a.check_in IS NOT NULL
      ORDER BY a.work_mode NULLS FIRST, e.employee_id`,
    [DATE]);

  const notClassified = all.rows.filter(r => !r.workMode);
  const office = all.rows.filter(r => r.workMode === 'office');
  const wfh = all.rows.filter(r => r.workMode === 'wfh');
  const unknown = all.rows.filter(r => r.workMode && r.workMode !== 'office' && r.workMode !== 'wfh');

  console.log(`Checked in today: ${all.rows.length}`);
  console.log(`  office=${office.length}  wfh=${wfh.length}  unknown(attempted, failed)=${unknown.length}  notClassified(never attempted)=${notClassified.length}\n`);

  if (unknown.length) {
    console.log('── "unknown" — classification WAS attempted and could not place them ──\n');
    for (const r of unknown) {
      console.log(`  ${r.code.padEnd(14)} ${r.name.padEnd(26)} in=${r.checkIn}  mode=${r.workMode}  source=${r.workModeSource || '-'}  ip=${r.checkInIp || '-'}  lat/lng=${r.lat ?? '-'}/${r.lng ?? '-'}`);
    }
    console.log('');
  }

  console.log('── "notClassified" — work_mode is NULL, nothing was ever attempted ──\n');
  for (const r of notClassified) {
    console.log(`  ${r.code.padEnd(14)} ${r.name.padEnd(26)} in=${r.checkIn}  out=${r.checkOut || '-'}  source=${r.workModeSource || 'NULL'}  ip=${r.checkInIp || 'NULL'}  lat/lng=${r.lat ?? 'NULL'}/${r.lng ?? 'NULL'}  location="${r.checkInLocation || ''}"`);
  }
  if (!notClassified.length) console.log('  none — every checked-in row today has a work_mode.');

  // If any of these DO carry GPS or an IP, "never attempted" is not actually
  // true for them — something is failing to classify a row it has enough
  // information to classify, which is a real gap, not old data.
  const hasSignalButNull = notClassified.filter(r => r.lat != null || r.checkInIp);
  console.log(`\n${hasSignalButNull.length} of those ${notClassified.length} DO have GPS and/or an IP recorded but still ended up with no work_mode.`);
  if (hasSignalButNull.length) {
    console.log('That is not "recorded before location tracking was switched on" — the signal is there and nothing used it:\n');
    for (const r of hasSignalButNull) {
      console.log(`  ${r.code.padEnd(14)} ${r.name.padEnd(26)} ip=${r.checkInIp || '-'}  lat/lng=${r.lat ?? '-'}/${r.lng ?? '-'}`);
    }
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
