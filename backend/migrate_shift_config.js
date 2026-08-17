/* ── Shifts → Configuration ───────────────────────────────────────────────
 *  Adds the settings blob behind Settings → Shifts → Configuration → General.
 *
 *  The one setting on that screen that already had a home is the default work
 *  shift: shifts.is_default. It has never done anything, though — nothing reads
 *  it. Every employee currently has a shift only because
 *  migrate_default_shift.js linked all 152 of them by hand; the next person
 *  created would have had none, and their expected hours and late marking
 *  would have quietly fallen back to org-wide values.
 *
 *  routes/employees.js now assigns the default shift on creation, which is what
 *  makes the picker on that screen mean something.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_shift_config.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const DEFAULTS = {
  // Who may see and change an employee's shift mapping. Stored now, applied
  // when shift mapping gets a screen of its own — there is no such screen yet,
  // and the configuration form says so on its face.
  mappingPermissions: {
    view: { manager: true, employee: false },
    edit: { manager: true, employee: false },
    editPastWithinPayPeriod: { manager: true, employee: false },
    editPastWithinCalendarYear: { manager: false, employee: false },
  },
  allowViewDepartmentSchedules: false,
  reasonMandatoryOnShiftChange: false,
  notifyOnShiftChange: { email: false, feeds: false },
  shiftAllowance: { enabled: false, minimumHours: '04:00' },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS shift_config JSONB`);
    await client.query(
      `UPDATE settings SET shift_config = $1::jsonb WHERE shift_config IS NULL`,
      [JSON.stringify(DEFAULTS)]
    );

    // Exactly one shift is the default. If none is flagged — or more than one
    // is, which nothing prevented before — settle on the oldest.
    const flagged = await client.query(`SELECT id FROM shifts WHERE is_default = TRUE ORDER BY created_at`);
    if (flagged.rows.length !== 1) {
      const first = await client.query(`SELECT id FROM shifts ORDER BY created_at LIMIT 1`);
      if (first.rows.length) {
        await client.query(`UPDATE shifts SET is_default = (id = $1)`, [first.rows[0].id]);
      }
    }

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT name, is_default AS "isDefault",
              (SELECT COUNT(*)::int FROM employees e WHERE e.shift_id = s.id AND e.deleted_at IS NULL) AS employees
         FROM shifts s ORDER BY is_default DESC, name`
    );
    const unassigned = await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE shift_id IS NULL AND deleted_at IS NULL`
    );

    console.log('✅ Shift configuration ready.');
    r.rows.forEach(x => console.log(`   ${x.isDefault ? '★' : ' '} ${x.name} — ${x.employees} employee(s)`));
    if (unassigned.rows[0].n) {
      console.log(`   ${unassigned.rows[0].n} employee(s) have no shift; they follow the org-wide expected hours.`);
    }
    console.log('   New employees now inherit the shift marked ★.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Shift configuration migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
