/**
 * migrate_compoff_holiday_config.js
 *
 * Compensatory Off configuration, and holiday classifications.
 *
 * Both are stored as JSONB on the single settings row rather than as a dozen
 * scalar columns. The settings PUT is one positional query with 23 parameters;
 * adding a column to it means renumbering, and each of these screens saves as
 * a whole object anyway. `leave_policy JSONB` on the same table set the
 * precedent.
 *
 * The comp-off defaults are what the existing code already does — manual
 * requests only, full and half day, a 1:1 credit for weekend and holiday work
 * — so applying this migration changes no behaviour until someone edits the
 * screen. comp_off_expiry_months is carried into the new expiry block so the
 * value already configured is not silently reset.
 *
 * Holiday classifications name the types the holidays table already stores.
 * 'working_day' is deliberately absent: it is a working day, not a holiday
 * classification, and the reference product does not list it either.
 */
const pool = require('./db');

const COMP_OFF_DEFAULT = {
  requestModes: { manual: true, scheduler: false },
  raisableFor: { full_day: true, half_day: true, quarter_day: false, hourly: false },
  allowFutureDates: false,
  includeTimeInput: false,
  reasonMandatory: true,
  entitlement: { weekend: 1.0, holiday: 1.0 },
  expiry: { mode: 'after', amount: 2, unit: 'months' },
};

// Seeded from the holiday types that are actually in use, not a fixed list —
// a classification nobody uses is noise, and a type with no classification
// leaves real holidays unclassified. 'working_day' is excluded: it marks a day
// the office stays open, which is the opposite of a holiday classification.
// 'restricted' is always included because the working-day rules reference it
// by name whether or not any holiday carries it yet.
const HOLIDAY_LABELS = {
  national: 'Holiday',
  restricted: 'Restricted holiday',
  company: 'Company holiday',
  optional: 'Optional holiday',
};
const labelFor = key => HOLIDAY_LABELS[key]
  || key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const migrations = [
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS comp_off_config JSONB`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS holiday_config JSONB`,

  // Seed only where unset, so a re-run never overwrites a real configuration.
  [`UPDATE settings SET comp_off_config = $1::jsonb WHERE comp_off_config IS NULL`,
   [JSON.stringify(COMP_OFF_DEFAULT)]],
  [`UPDATE settings SET holiday_config = $1::jsonb WHERE holiday_config IS NULL`,
   [JSON.stringify({ reminderTemplate: '', classifications: [] })]],

  // Carry the expiry value that already exists rather than resetting it to the
  // seeded default.
  `UPDATE settings
      SET comp_off_config = jsonb_set(
            comp_off_config, '{expiry,amount}', to_jsonb(comp_off_expiry_months))
    WHERE comp_off_expiry_months IS NOT NULL
      AND comp_off_expiry_months > 0
      AND comp_off_config -> 'expiry' ->> 'unit' = 'months'`,
];

(async () => {
  let ok = 0;
  for (const entry of migrations) {
    // A migration is either a bare SQL string or a [sql, params] pair.
    const [sql, params] = Array.isArray(entry) ? entry : [entry, []];
    try { await pool.query(sql, params); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  // Append any holiday type in use that has no classification yet. Appending
  // rather than replacing keeps a re-run from discarding renames someone made
  // on the screen, and self-corrects a config seeded before a new type existed.
  try {
    const cur = (await pool.query('SELECT holiday_config AS c FROM settings LIMIT 1')).rows[0]?.c || {};
    const have = new Set((cur.classifications || []).map(x => x.key));
    const used = (await pool.query(
      `SELECT DISTINCT type FROM holidays WHERE type IS NOT NULL AND type <> 'working_day'`
    )).rows.map(r => r.type);
    const missing = [...new Set([...used, 'restricted'])].filter(k => !have.has(k));
    if (missing.length) {
      const next = {
        reminderTemplate: cur.reminderTemplate || '',
        classifications: [...(cur.classifications || []), ...missing.map(k => ({ key: k, label: labelFor(k) }))],
      };
      await pool.query(
        `UPDATE settings SET holiday_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
        [JSON.stringify(next)]
      );
      console.log('added holiday classifications:', missing.join(', '));
    }
    ok++;
  } catch (err) { console.error('FAILED: holiday classification backfill\n  ', err.message); }

  console.log(`comp-off / holiday config migration: ${ok}/${migrations.length + 1} statements applied`);
  const r = await pool.query('SELECT comp_off_config, holiday_config FROM settings LIMIT 1');
  console.log(JSON.stringify(r.rows[0], null, 2));
  await pool.end();
})();
