/* ── Preview or run the year-end leave rollover by hand ──────────────────────
 *  The cron in server.js fires this once, on Jan 1st at 00:05, for the year
 *  that just ended. This is the same function, runnable any time — to check
 *  what it would do before the 1st arrives, to see what it did after, or to
 *  backfill a year the cron missed (the box was down, the container hadn't
 *  been deployed yet).
 *
 *  Dry run by default. Nothing is written until --apply is passed.
 *
 *    docker compose exec backend node leave_year_end.js --from 2026 --to 2027
 *    docker compose exec backend node leave_year_end.js --from 2026 --to 2027 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const pool = require('./db');
const { runYearEndRollover } = require('./utils/leaveYearEnd');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const APPLY = process.argv.includes('--apply');
const nowYear = new Date().getFullYear();
const fromYear = parseInt(arg('--from', nowYear - 1), 10);
const toYear = parseInt(arg('--to', nowYear), 10);

(async () => {
  const result = await runYearEndRollover(pool, { fromYear, toYear, apply: APPLY });

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Leave year end — ${fromYear} → ${toYear}${APPLY ? '  (APPLIED)' : '  (dry run — nothing written)'}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (result.carried.length) {
    console.log(`  ${result.carried.length} balance(s) carried forward:\n`);
    for (const c of result.carried) {
      const cap = c.capped ? `  (capped from ${c.available})` : '';
      console.log(`    ${c.name.padEnd(24)} ${c.typeName.padEnd(16)} ${c.carried}${cap}`);
    }
    console.log('');
  }

  if (result.lapsed.length) {
    console.log(`  ${result.lapsed.length} balance(s) lapsed — did not carry forward:\n`);
    for (const l of result.lapsed) {
      console.log(`    ${l.name.padEnd(24)} ${l.typeName.padEnd(16)} ${l.lapsed}`);
    }
    console.log('');
  }

  if (!result.carried.length && !result.lapsed.length) {
    console.log(`  Nothing to do — no ${fromYear} balances found, or everyone's is zero.\n`);
  }

  if (!APPLY && (result.carried.length || result.lapsed.length)) {
    console.log('  Add --apply to write this.\n');
  }

  console.log('══════════════════════════════════════════════════════════════════════\n');
  await pool.end();
})().catch(async e => {
  console.error('\n  failed —', e.message, '\n');
  try { await pool.end(); } catch {}
  process.exit(1);
});
