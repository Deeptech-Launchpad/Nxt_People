/* ── Who filed this comp-off ────────────────────────────────────────────────
 *  HR can now raise a comp-off for another employee, the way Zoho's
 *  Operations → Leave Tracker → Compensatory Request does. Once that is
 *  possible, "whose request is this" and "who typed it in" stop being the same
 *  question, and a row that cannot tell them apart is a row that lets an
 *  administrator grant somebody a day off with no trace of having done it.
 *
 *  employee_id stays the person the credit belongs to. applied_by is whoever
 *  filed it — NULL when they filed it themselves, which is every existing row.
 *
 *    docker compose exec backend node migrate_comp_off_on_behalf.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this migration does not send mail'); },
  verify: async () => { throw new Error('this migration does not send mail'); },
});

const pool = require('./db');

const STEPS = [
  `ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS applied_by UUID REFERENCES employees(id)`,
  `CREATE INDEX IF NOT EXISTS idx_comp_offs_applied_by ON comp_offs(applied_by)`,
];

(async () => {
  console.log('');
  for (const sql of STEPS) {
    await pool.query(sql);
    console.log(`  ok   ${sql.slice(0, 76)}`);
  }

  const n = (await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'comp_offs' AND column_name = 'applied_by'`)).rows[0].n;
  console.log(`\n  applied_by ${n ? 'exists' : 'IS MISSING — something went wrong'}\n`);

  await pool.end();
  process.exit(n ? 0 : 1);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
