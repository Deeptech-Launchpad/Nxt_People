/**
 * Demo seeding — fills sample bank / blood group / nationality / passport
 * data for the first 5 active employees so the Edit Employee modal shows
 * fully populated records during the demo walkthrough.
 *
 * Safe & idempotent: only fills NULLs (never overwrites real data). Re-run
 * any time. Doesn't touch employees beyond the first 5.
 *
 * Usage:
 *   cd backend
 *   npm run seed:demo-fields
 *
 * To clear it later (e.g. before going to production), run:
 *   npm run seed:demo-fields -- --clear
 */
require('dotenv').config();
const pool = require('../db');

const SAMPLE = [
  { bank: 'HDFC Bank',      ifsc: 'HDFC0001234', acct: '50100123456789', blood: 'B+',  nat: 'Indian', passport: 'M1234567', voter: 'ABC1234567', dl: 'TN1220210000001' },
  { bank: 'ICICI Bank',     ifsc: 'ICIC0002345', acct: '00191234567890', blood: 'O+',  nat: 'Indian', passport: 'N2345678', voter: 'DEF2345678', dl: 'TN0820200000002' },
  { bank: 'SBI',            ifsc: 'SBIN0003456', acct: '38123456789012', blood: 'A+',  nat: 'Indian', passport: 'P3456789', voter: 'GHI3456789', dl: 'KA0120190000003' },
  { bank: 'Axis Bank',      ifsc: 'UTIB0004567', acct: '91234567890123', blood: 'AB+', nat: 'Indian', passport: 'Q4567890', voter: 'JKL4567890', dl: 'MH0220200000004' },
  { bank: 'Kotak Mahindra', ifsc: 'KKBK0005678', acct: '12345678901234', blood: 'O-',  nat: 'Indian', passport: 'R5678901', voter: 'MNO5678901', dl: 'DL0120210000005' },
];

(async () => {
  const isClear = process.argv.includes('--clear');

  // Get the first 5 active employees (alphabetical, deterministic).
  const empRes = await pool.query(
    `SELECT id, first_name, last_name, employee_id
       FROM employees
      WHERE status = 'active'
        AND role <> 'super_admin'
      ORDER BY first_name, last_name
      LIMIT 5`
  );

  if (empRes.rows.length === 0) {
    console.log('No active employees to seed. Run Zoho sync first.');
    process.exit(0);
  }

  if (isClear) {
    console.log('🧹 Clearing demo sample data from these 5 employees:\n');
    for (const emp of empRes.rows) {
      await pool.query(
        `UPDATE employees
            SET bank_name = NULL, bank_ifsc = NULL, bank_account = NULL,
                blood_group = NULL, nationality = NULL,
                passport_number = NULL, voter_id = NULL, driving_license = NULL
          WHERE id = $1`,
        [emp.id]
      );
      console.log(`  ✅ ${emp.first_name} ${emp.last_name} (${emp.employee_id})`);
    }
    console.log('\nDone. Demo data cleared.');
    await pool.end();
    return;
  }

  console.log('🌱 Seeding demo data for these 5 employees (only fills NULLs):\n');
  for (let i = 0; i < empRes.rows.length; i++) {
    const emp = empRes.rows[i];
    const s   = SAMPLE[i];
    const r = await pool.query(
      `UPDATE employees
          SET bank_name        = COALESCE(bank_name,        $1),
              bank_ifsc        = COALESCE(bank_ifsc,        $2),
              bank_account     = COALESCE(bank_account,     $3),
              blood_group      = COALESCE(blood_group,      $4),
              nationality      = COALESCE(nationality,      $5),
              passport_number  = COALESCE(passport_number,  $6),
              voter_id         = COALESCE(voter_id,         $7),
              driving_license  = COALESCE(driving_license,  $8)
        WHERE id = $9
        RETURNING bank_name, blood_group, nationality`,
      [s.bank, s.ifsc, s.acct, s.blood, s.nat, s.passport, s.voter, s.dl, emp.id]
    );
    const row = r.rows[0];
    console.log(`  ✅ ${emp.first_name} ${emp.last_name} (${emp.employee_id}) → bank: ${row.bank_name}, blood: ${row.blood_group}, nat: ${row.nationality}`);
  }

  console.log('\nDone. These 5 employees now show fully populated Edit modals.');
  console.log('To clear later:  npm run seed:demo-fields -- --clear\n');
  await pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
