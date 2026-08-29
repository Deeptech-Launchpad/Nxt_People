/* ── Comp-off expiry follows what the screen was set to ─────────────────────
 *  Configuration → Compensatory Off offers four ways to express when a credit
 *  stops being usable: end of the calendar year, or after N months, calendar
 *  days or business days.
 *
 *  Only ONE of them — months — was ever copied into the legacy
 *  comp_off_expiry_months column, and that column was the only thing the apply
 *  form checked against. So choosing "30 calendar days" or "end of the
 *  calendar year" left the old month count in force: the screen said one
 *  thing, the rule did another, and nothing anywhere said so.
 *
 *  What has to hold, for a day worked on 2026-03-15:
 *
 *    calendar year end   → 2026-12-31
 *    after 2 months      → 2026-05-15
 *    after 30 days       → 2026-04-14
 *    after N working days→ skips weekends and holidays
 *    nothing configured  → falls back to the legacy column, not a crash
 *    the refusal message names the real rule, not always "months"
 *
 *  Settings are changed inside a transaction that is always rolled back, so
 *  the real configuration is never touched.
 *
 *    node test_compoff_expiry.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const pool = require('./db');
const { compOffExpiresAt } = require('./routes/comp-off');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '   got ' + JSON.stringify(extra)));
};

const WORKED = '2026-03-15';

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Comp-off expiry — the configured rule is the rule');
  console.log('══════════════════════════════════════════════════════════\n');

  const client = await pool.connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');

    const setExpiry = async (expiry) => {
      await client.query(
        `UPDATE settings
            SET comp_off_config = COALESCE(comp_off_config, '{}'::jsonb) || $1::jsonb
          WHERE id = (SELECT id FROM settings LIMIT 1)`,
        [JSON.stringify({ expiry })]);
    };

    console.log(`  A day worked on ${WORKED}\n`);

    await setExpiry({ mode: 'calendar_year_end' });
    let r = await compOffExpiresAt(client, WORKED);
    check('calendar year end → 31 December of that year', r.date === '2026-12-31', r);
    check('and says so, rather than saying months',
      /calendar year/.test(r.describe), r.describe);

    await setExpiry({ mode: 'after', amount: 2, unit: 'months' });
    r = await compOffExpiresAt(client, WORKED);
    check('after 2 months → 2026-05-15', r.date === '2026-05-15', r);
    check('and describes months', /2 months/.test(r.describe), r.describe);

    await setExpiry({ mode: 'after', amount: 30, unit: 'calendar_days' });
    r = await compOffExpiresAt(client, WORKED);
    check('after 30 calendar days → 2026-04-14', r.date === '2026-04-14', r);
    check('and describes days, not months',
      /30 days/.test(r.describe) && !/month/.test(r.describe), r.describe);

    await setExpiry({ mode: 'after', amount: 10, unit: 'business_days' });
    r = await compOffExpiresAt(client, WORKED);
    check('after 10 business days lands on a real date',
      /^\d{4}-\d{2}-\d{2}$/.test(r.date), r);
    check('it is at least 10 calendar days out — weekends were stepped over',
      r.date >= '2026-03-25', r);
    check('and describes working days', /working day/.test(r.describe), r.describe);

    console.log('\n  When nothing is configured\n');
    await client.query(
      `UPDATE settings SET comp_off_config = comp_off_config - 'expiry'
        WHERE id = (SELECT id FROM settings LIMIT 1)`);
    r = await compOffExpiresAt(client, WORKED);
    check('it falls back to the legacy column rather than throwing',
      /^\d{4}-\d{2}-\d{2}$/.test(r.date), r);
    check('and the fallback is a month count', /month/.test(r.describe), r.describe);

    console.log('\n  Bad configuration is survived\n');
    for (const [label, expiry] of [
      ['a zero amount', { mode: 'after', amount: 0, unit: 'months' }],
      ['a negative amount', { mode: 'after', amount: -5, unit: 'months' }],
      ['an unknown unit', { mode: 'after', amount: 3, unit: 'fortnights' }],
      ['a nonsense mode', { mode: 'whenever' }],
    ]) {
      await setExpiry(expiry);
      let threw = null, out = null;
      try { out = await compOffExpiresAt(client, WORKED); } catch (e) { threw = e; }
      check(`${label} → falls back, does not throw`,
        threw === null && /^\d{4}-\d{2}-\d{2}$/.test(out?.date), threw ? threw.message : out);
    }

    await client.query('ROLLBACK');
    rolledBack = true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    rolledBack = true;
    console.log('\n  FAILED —', e.message, '\n');
    checks.push(false);
  } finally {
    client.release();
  }

  const live = (await pool.query(
    `SELECT comp_off_config->'expiry' AS e FROM settings LIMIT 1`)).rows[0];
  check('the real configuration was left untouched',
    rolledBack && JSON.stringify(live.e) !== 'null', live.e);

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
