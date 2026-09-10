#!/usr/bin/env node
/* Gives an approval chain to pending requests that never got one.
 *
 * The Zoho import inserted into `leaves` directly and never built the chain an
 * application through the app would have. The result is a request that is
 * genuinely pending, invisible to every manager, showing an empty approval
 * timeline, and actionable only by somebody with full access who happens to
 * notice it. The import now builds chains as it goes; this is for the rows that
 * arrived before it did.
 *
 * The chain is derived from the employee's reporting line exactly as it would
 * be for a fresh application, and the request STAYS PENDING — nothing here
 * approves, rejects or alters a request. It only says who should decide it.
 *
 *   node backfill_approval_chains.js              dry run, lists what it would do
 *   node backfill_approval_chains.js --apply      writes the chains
 *   node backfill_approval_chains.js --apply --type=leave,comp_off
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');
const { createLevels } = require('./utils/leaveApproval');

const APPLY = process.argv.includes('--apply');
const typeArg = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1];
const TYPES = typeArg ? typeArg.split(',').map(s => s.trim()).filter(Boolean) : ['leave'];

/* Where each request type lives. Only tables whose pending rows are meant to
 * carry a chain are listed; anything absent is left alone rather than guessed
 * at. */
const SOURCES = {
  leave: {
    table: 'leaves',
    label: r => `${r.leave_type} ${r.start_date}`,
    // Permission and leave share the table and both need a chain.
    select: `SELECT l.id, l.employee_id, l.leave_type, l.start_date::text AS start_date,
                    l.created_at::date::text AS created,
                    e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
                    e.reporting_manager_id IS NULL AS no_manager
               FROM leaves l JOIN employees e ON e.id = l.employee_id
              WHERE l.status = 'pending'
                AND e.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM approval_levels x
                                 WHERE x.request_type = 'leave' AND x.request_id = l.id)
              ORDER BY l.created_at`,
  },
  comp_off: {
    table: 'comp_offs',
    label: r => `comp-off ${r.start_date}`,
    select: `SELECT c.id, c.employee_id, c.worked_date::text AS start_date,
                    c.created_at::date::text AS created,
                    e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
                    e.reporting_manager_id IS NULL AS no_manager
               FROM comp_offs c JOIN employees e ON e.id = c.employee_id
              WHERE c.status = 'pending'
                AND e.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM approval_levels x
                                 WHERE x.request_type = 'comp_off' AND x.request_id = c.id)
              ORDER BY c.created_at`,
  },
};

const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  console.log(`\n  ${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}`);
  console.log(`  types: ${TYPES.join(', ')}\n`);

  let totalFound = 0, totalFixed = 0;
  const stuck = [];

  for (const type of TYPES) {
    const src = SOURCES[type];
    if (!src) { console.log(`  Unknown type "${type}" — skipped.`); continue; }

    const rows = (await pool.query(src.select)).rows;
    console.log(`══ ${type} ${'═'.repeat(Math.max(0, 62 - type.length))}`);
    console.log(`  ${rows.length} pending request(s) with no approval chain\n`);
    totalFound += rows.length;

    for (const r of rows) {
      const who = `${pad(r.code, 14)}${pad(String(r.name).slice(0, 26), 28)}`;
      const what = pad(src.label(r), 24);

      if (!APPLY) {
        console.log(`  ${who}${what}${r.no_manager ? 'NO REPORTING MANAGER — cannot build a chain' : 'would build a chain'}`);
        continue;
      }

      /* One transaction per request. A reporting line that is not set up yet is
       * one person's problem, not a reason to abandon everybody else's. */
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const levels = await createLevels(client, type, r.id, r.employee_id, {});
        await client.query('COMMIT');
        totalFixed++;
        console.log(`  ${who}${what}${levels.length} level(s)`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        stuck.push({ code: r.code, name: r.name, what: src.label(r), why: e.message });
        console.log(`  ${who}${what}SKIPPED — ${e.message}`);
      } finally {
        client.release();
      }
    }
    console.log('');
  }

  console.log('──────────────────────────────────────────────────────────');
  if (!APPLY) {
    console.log(`  ${totalFound} request(s) would get a chain. Re-run with --apply to write them.`);
  } else {
    console.log(`  ${totalFixed} of ${totalFound} now have an approval chain.`);
    if (stuck.length) {
      console.log(`\n  ${stuck.length} could not be given one:\n`);
      for (const s of stuck) console.log(`    ${pad(s.code, 14)}${pad(s.what, 24)}${s.why}`);
      console.log('\n  Set their reporting manager in the Employee Tree, then run this again.');
    }
  }
  console.log('');

  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
