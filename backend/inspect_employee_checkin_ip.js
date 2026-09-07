#!/usr/bin/env node
/* What IP (and GPS, if any) did a specific employee's most recent check-in
 * actually record? Used to verify the Cloudflare trust-proxy fix is really
 * seeing the real client IP now, and to find the address a second-floor
 * connection should be registered under.
 *
 * READ ONLY. Nothing here writes.
 *
 *   node inspect_employee_checkin_ip.js Rajkumar
 *   node inspect_employee_checkin_ip.js ANXT220004
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const QUERY = process.argv[2];
if (!QUERY) {
  console.error('Usage: node inspect_employee_checkin_ip.js <name or employee code>');
  process.exit(1);
}

(async () => {
  const emps = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name
       FROM employees
      WHERE employee_id ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
         OR (first_name || ' ' || COALESCE(last_name,'')) ILIKE $1`,
    [`%${QUERY}%`])).rows;

  if (!emps.length) { console.log(`No employee matching "${QUERY}".`); await pool.end(); return; }

  for (const emp of emps) {
    console.log(`\n=== ${emp.name.trim()} (${emp.code}) — last 5 check-ins ===\n`);
    const rows = (await pool.query(
      `SELECT date::text AS date, check_in::text AS "checkIn",
              check_in_ip AS ip, work_mode AS "workMode", work_mode_source AS source,
              check_in_latitude AS lat, check_in_longitude AS lng,
              location_distance_meters AS dist, location_accuracy_meters AS acc,
              check_in_location AS location
         FROM attendance
        WHERE employee_id = $1 AND check_in IS NOT NULL
        ORDER BY date DESC LIMIT 5`,
      [emp.id])).rows;

    if (!rows.length) { console.log('  no check-ins on file'); continue; }
    for (const r of rows) {
      console.log(`  ${r.date}  in=${r.checkIn}  ip=${r.ip || 'NULL'}  mode=${r.workMode || 'NULL'}  source=${r.source || 'NULL'}`);
      console.log(`            lat/lng=${r.lat ?? '-'}/${r.lng ?? '-'}  distance=${r.dist ?? '-'}m  accuracy=${r.acc ?? '-'}m  location="${r.location || ''}"`);
    }
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
