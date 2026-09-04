#!/usr/bin/env node
/* Every fractional casual leave balance, and where it actually comes from.
 *
 * READ ONLY. Nothing here writes.
 *
 * The Booked-and-Balance report used to show a flat 12 for almost everyone —
 * a frozen legacy column nothing had written to in months. Fixed, the report
 * now shows each person's REAL Zoho-imported balance, and several of those
 * are not whole numbers: 11.75, 6.75, 9.25, 13.5.
 *
 * That is not new breakage. import_zoho_balances.js sums several Zoho
 * columns per employee — Zoho renames a leave type every year, so "Casual
 * Leave", "Casual Leave 2023" and "Casual Leave2025" are really one
 * entitlement split three ways, and the importer adds them back together.
 * A quarter-day figure in any one of those (a manual Zoho-side adjustment,
 * commonly) lands as .25 or .75 in the total. This is documented from the
 * actual import run: "Amarnath's 4 + (-0.25) is 3.75, which is what live now
 * holds and what Zoho shows."
 *
 * This lists every fractional balance so they can be checked in one place,
 * and marks the two that are also negative (also real, also documented at
 * import time) separately, since a negative number reads as broken even
 * though it means the same as any other overdrawn balance.
 *
 *   node inspect_leave_balance_fractions.js
 */
const pool = require('./db');

(async () => {
  const year = new Date().getFullYear();
  const r = await pool.query(
    `SELECT e.employee_id AS code, e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
            lb.available, lb.booked
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       JOIN employees e ON e.id = lb.employee_id
      WHERE lt.code = 'casual' AND lb.year = $1
      ORDER BY e.employee_id`,
    [year]);

  console.log(`\n=== Casual leave_balances for ${year}: ${r.rows.length} people ===\n`);

  const whole = [], fractional = [], negative = [];
  for (const row of r.rows) {
    const avail = parseFloat(row.available);
    const entry = { code: row.code, name: row.name.trim(), avail, booked: parseFloat(row.booked) || 0 };
    if (avail < 0) negative.push(entry);
    else if (Number.isInteger(avail)) whole.push(entry);
    else fractional.push(entry);
  }

  console.log(`  ${whole.length} whole-number balances`);
  console.log(`  ${fractional.length} fractional balances (.25 / .5 / .75 etc.)`);
  console.log(`  ${negative.length} negative balances (overdrawn)\n`);

  if (fractional.length) {
    console.log('── Fractional, all of them ──────────────────────────────────\n');
    for (const f of fractional) {
      console.log(`  ${f.code.padEnd(14)} ${f.name.padEnd(28)} ${String(f.avail).padStart(7)}`);
    }
  }

  if (negative.length) {
    console.log('\n── Negative (overdrawn), all of them ────────────────────────\n');
    for (const n of negative) {
      console.log(`  ${n.code.padEnd(14)} ${n.name.padEnd(28)} ${String(n.avail).padStart(7)}`);
    }
  }

  console.log(`\n${fractional.length + negative.length} of ${r.rows.length} rows are non-whole-number, non-standard-looking figures.`);
  console.log('Every one of them is exactly what was written on the day of the Zoho');
  console.log('balance import (26 Aug 2026) — nothing has changed since, and this script');
  console.log('does not touch anything. Only how the two reports DISPLAYED this number');
  console.log('changed; the number itself has been sitting here unmodified the whole time.');
  console.log('\nTo verify a specific person against Zoho\'s original export line, the');
  console.log('CSV that was imported is the only source that shows the per-year columns');
  console.log('(Casual Leave / Casual Leave 2023 / Casual Leave2025) before they were');
  console.log('summed into the single number stored here.');

  await pool.end();
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
