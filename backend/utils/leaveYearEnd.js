/**
 * utils/leaveYearEnd.js
 *
 * What happens to an unused leave balance when the year turns over.
 *
 * Casual is not supposed to carry forward — leave_types.carry_forward has
 * said `false` for it since the column was seeded, but nothing ever read it.
 * The only thing resembling a year-end job (server.js's Jan 1 cron) zeroed
 * employees.casual_leave by hand, which did the right thing for that one
 * legacy column but never touched leave_balances at all — the table that 57
 * of the 59 active employees actually carry their casual balance in. For
 * them, nothing enforced "does not carry forward"; it simply never got
 * tested, because nothing has yet copied a leave_balances row from one year
 * into the next.
 *
 * This makes the decision explicit and auditable instead of implicit and
 * untested:
 *
 *   carryForward = false (casual, by default) — the outgoing year's row is
 *     left exactly as it is, a historical record. Nothing is written for the
 *     new year. Whatever unused days remain simply lapse, logged so there is
 *     a record of the decision rather than a number that quietly stopped
 *     being true. The new year's balance comes from the same computed path
 *     that already supplies it for anyone with no leave_balances row.
 *
 *   carryForward = true (opt-in, per type, per company preference) — the
 *     leftover moves into a new row for the incoming year, capped at
 *     max_days_per_year so switching this on can never mean "unlimited".
 *
 * Idempotent by construction: run twice for the same (fromYear, toYear) and
 * the second run finds nothing left to carry (the leftover already moved) and
 * nothing left to lapse (already logged, checked before writing again).
 */
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const { carryForwardAmount } = require('./leavePolicy');

/**
 * Roll every leave_balances row from `fromYear` into `toYear`.
 *
 * `apply: false` (the default) changes nothing — it returns exactly what
 * would happen, so this can be checked before it runs for real. The cron
 * calls it with `apply: true`.
 */
async function runYearEndRollover(pool, { fromYear, toYear, apply = false }) {
  const types = (await pool.query(
    `SELECT id, code, name, carry_forward AS "carryForward",
            max_days_per_year AS "maxDaysPerYear"
       FROM leave_types WHERE is_active = TRUE`
  )).rows;

  const rows = (await pool.query(
    `SELECT lb.id, lb.employee_id AS "employeeId", lb.leave_type_id AS "leaveTypeId",
            lb.available, lb.booked,
            e.first_name AS "firstName", e.last_name AS "lastName", e.employee_id AS "employeeCode"
       FROM leave_balances lb
       JOIN employees e ON e.id = lb.employee_id
      WHERE lb.year = $1 AND e.deleted_at IS NULL`,
    [fromYear]
  )).rows;

  const carried = [];
  const lapsed = [];

  for (const row of rows) {
    const type = types.find(t => t.id === row.leaveTypeId);
    if (!type) continue; // leave type since deactivated — nothing to roll

    const available = round2(parseFloat(row.available) || 0);
    const carry = carryForwardAmount(
      { carryForward: type.carryForward, maxDaysPerYear: type.maxDaysPerYear }, available
    );
    const name = `${row.firstName} ${row.lastName || ''}`.trim();
    const entry = { employeeId: row.employeeId, employeeCode: row.employeeCode, name,
      typeCode: type.code, typeName: type.name, available };

    if (carry > 0) {
      carried.push({ ...entry, carried: carry, capped: carry < available });
    } else if (available > 0) {
      lapsed.push({ ...entry, lapsed: available });
    }
  }

  if (!apply) return { fromYear, toYear, carried, lapsed, applied: false };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of carried) {
      // Idempotent: re-running finds the row already there, at the same
      // figure it would compute again, and updates it to itself.
      await client.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
         SELECT $1, lt.id, $2, $3, 0 FROM leave_types lt WHERE lt.code = $4
         ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET available = $3`,
        [c.employeeId, toYear, c.carried, c.typeCode]
      );
      // One log line per employee per (type, toYear) — a second run finds
      // this already written and does not write it again.
      const exists = await client.query(
        `SELECT 1 FROM leave_accrual_log
          WHERE employee_id = $1 AND leave_type = $2 AND reason = $3`,
        [c.employeeId, c.typeCode, `Carried forward into ${toYear}`]
      );
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, balance_after, reason)
           VALUES ($1, $2, $3, $3, $4)`,
          [c.employeeId, c.typeCode, c.carried, `Carried forward into ${toYear}`]
        );
      }
    }

    for (const l of lapsed) {
      const exists = await client.query(
        `SELECT 1 FROM leave_accrual_log
          WHERE employee_id = $1 AND leave_type = $2 AND reason = $3`,
        [l.employeeId, l.typeCode, `Lapsed at the end of ${fromYear} — does not carry forward`]
      );
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, balance_after, reason)
           VALUES ($1, $2, $3, 0, $4)`,
          [l.employeeId, l.typeCode, -l.lapsed, `Lapsed at the end of ${fromYear} — does not carry forward`]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { fromYear, toYear, carried, lapsed, applied: true };
}

module.exports = { runYearEndRollover };
