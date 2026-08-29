/* ── The joining month rule ────────────────────────────────────────────────
 *  Casual leave was granted whole to anybody, whenever they arrived. Someone
 *  starting on 20 December received the same twelve days as someone who had
 *  been there since January, and could book them. This makes casual accrue by
 *  the month, the way permission already does, and adds the rule that decides
 *  whether the month somebody joined in counts at all.
 *
 *  THE RULE. A month counts only if enough of it is left on the joining date.
 *  "Enough" is a number of days, held in settings so HR can move it without a
 *  deploy; 7 means the last week of the month does not accrue. It is expressed
 *  as days remaining rather than a day of the month on purpose — "after the
 *  24th" is seven days in August but only four in February, and the rule would
 *  quietly change width through the year.
 *
 *    joined 24 Aug -> 8 days remain -> August accrues
 *    joined 25 Aug -> 7 days remain -> it does not; accrual starts in September
 *
 *  WHO IT APPLIES TO. Only people joining on or after appliesToJoinersFrom.
 *  Everyone already on the books keeps the balance they have been told they
 *  have. The date is seeded to the earliest joining date that is already being
 *  treated this way by hand, so no existing figure moves.
 *
 *  WHY CASUAL BECOMES MONTHLY. It was `annual`, which grants the whole amount
 *  on the entitlement date and cannot express "one day per month from when you
 *  arrived". Twelve months of one day is the same twelve for anybody who was
 *  here all year, so a full-year employee's entitlement is unchanged.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_leave_joining_rule.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

/* Seeded from the data rather than picked: the earliest joining date already
 * being handled by this rule by hand. Everyone before it is grandfathered. If
 * no such employee exists, nobody is affected until HR moves the date, which
 * is the safe direction to be wrong in. */
const DEFAULT_FROM = '2026-08-25';

const DEFAULTS = {
  joiningMonth: {
    // Off would mean the joining month always counts, which is what happened
    // before this migration. On is the rule that was asked for.
    skipWhenShortMonth: true,
    // 7 = the final week of the month does not accrue.
    minDaysRemaining: 7,
    appliesToJoinersFrom: DEFAULT_FROM,
  },
  /* Casual was an annual twelve granted whole, so anybody already on the books
   * keeps the whole twelve for their joining year rather than dropping to the
   * months they were actually here — they have been told they have it and may
   * have booked against it. Permission is deliberately absent: it has always
   * accrued monthly, so nothing about it changes. */
  grandfatherFullYear: ['casual'],
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_accrual_config JSONB`);
    /* Defaults underneath, whatever is already stored on top — so a re-run
     * adds keys introduced since the last one without reverting anything HR
     * has changed. Filling only a NULL would have left an early config missing
     * every key added later, which is how this migration shipped a rule the
     * engine then could not find. */
    await client.query(
      `UPDATE settings
          SET leave_accrual_config = $1::jsonb || COALESCE(leave_accrual_config, '{}'::jsonb)`,
      [JSON.stringify(DEFAULTS)]);

    /* Casual moves from a lump on the entitlement date to one day a month.
     * Only touched when it is still on the old setting, so an HR edit made
     * after this migration is not reverted by a later re-run. */
    const moved = await client.query(
      `UPDATE leave_types
          SET accrual_mode = 'monthly', accrual_amount = 1
        WHERE code = 'casual' AND accrual_mode = 'annual' AND accrual_amount = 12
        RETURNING code`);

    await client.query('COMMIT');

    const cfg = (await pool.query(
      `SELECT leave_accrual_config AS c FROM settings LIMIT 1`)).rows[0]?.c;
    const jm = cfg?.joiningMonth || {};
    const lt = (await pool.query(
      `SELECT accrual_mode AS m, accrual_amount AS a FROM leave_types WHERE code='casual'`)).rows[0];

    console.log('✅ Joining month rule ready.');
    console.log(`   Casual accrues ${lt?.a} day(s) ${lt?.m}${moved.rowCount ? ' (changed from 12 annual)' : ' (already set)'}`);
    console.log(`   A month counts only if ${jm.minDaysRemaining} or more days remain on the joining date`);
    console.log(`   Applies to employees joining on or after ${jm.appliesToJoinersFrom}`);
    console.log('   Everyone who joined earlier keeps the balance they have.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Joining month rule migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
