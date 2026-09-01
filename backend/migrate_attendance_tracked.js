/* ── Untracked employees ──────────────────────────────────────────────────
 *  is_user has been doing two jobs at once: "can this person sign in" and
 *  "does attendance apply to them". Employee Profiles (is_user = FALSE) get
 *  neither — no login, and excluded from Yet to check-in and every attendance
 *  report. That was fine until the Founder and a Super Admin needed the
 *  opposite combination: a login, but no expectation that they punch in or
 *  out, and no place chasing them for a missing check-in.
 *
 *  There was no way to say that. Making them Employee Profiles to escape
 *  attendance tracking took their login with it — is_user gates sign-in at
 *  every entry point (routes/auth.js). The only other lever, Attendance
 *  Marking, requires HR to mark a status for them every day, which is not
 *  what an untracked login means either.
 *
 *  employees.attendance_tracked splits the two meanings apart. It is
 *  per-person, not tied to role or designation — a title is not a promise
 *  about whether someone punches a clock, and a role rule would silently
 *  mis-set the next Director who does. Defaults to TRUE, so nobody's
 *  behaviour changes until somebody switches it off for them by name.
 *
 *  Deliberately not the same flag as manual_attendance_assignments. Staff on
 *  that list are still tracked — HR marks a status for them daily, so
 *  Present/Absent still means something and they are excluded from Yet to
 *  check-in only because they cannot self-punch, not because attendance
 *  doesn't apply to them. attendance_tracked = FALSE means the opposite:
 *  nothing is expected of the day at all, marked or not.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_attendance_tracked.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS attendance_tracked BOOLEAN NOT NULL DEFAULT TRUE`
    );

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE attendance_tracked = FALSE)::int AS untracked
         FROM employees WHERE deleted_at IS NULL`
    );
    console.log('✅ attendance_tracked ready.');
    console.log(`   ${r.rows[0].total} employee(s), ${r.rows[0].untracked} untracked (new column defaults everyone to tracked)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ attendance_tracked migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
