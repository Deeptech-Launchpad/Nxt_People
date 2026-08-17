/* ── Approvals: the whole flow, not just the chain ────────────────────────
 *  The first pass gave each request type one rule holding an approver chain.
 *  The reference is considerably more than that, and the parts that were left
 *  out are the ones that make it a workflow rather than a setting:
 *
 *    • Several approvals per form, not one. Which applies is decided by
 *      criteria, so "regularization older than 5 days" can route differently
 *      from an ordinary one.
 *    • Criteria — conditions on the request's own fields.
 *    • Auto approve / auto reject instead of a chain.
 *    • Messages — who the approval email comes from, who it goes to, its
 *      subject, and which template supplies the body.
 *    • A follow-up reminder to whoever is sitting on it.
 *
 *  The UNIQUE constraint on request_type goes, because several approvals per
 *  form is the point. Ordering plus criteria decides which one runs: the first
 *  active rule whose criteria match, in sort order. A rule with no criteria
 *  matches everything, which is what the six seeded ones do — so behaviour is
 *  unchanged until someone adds a narrower rule above them.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_approval_flow.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

// Reproduces what the approval mailer already sends, so the Messages section
// starts by describing current behaviour rather than changing it.
const DEFAULT_MESSAGES = {
  from: 'default_address',
  to: ['current_approver'],
  cc: [],
  subject: 'New ${requestType} request',
  templateName: 'New approval request',
  onApproved: { enabled: true, templateName: 'Your request has been approved' },
  onRejected: { enabled: true, templateName: 'Your request has been rejected' },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const ddl of [
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS criteria JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS criteria_match VARCHAR(3) NOT NULL DEFAULT 'AND'`,
      // 'chain' runs the approver levels; the other two settle the request on
      // submission without anyone touching it.
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS decision VARCHAR(20) NOT NULL DEFAULT 'chain'`,
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS follow_up BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS messages JSONB`,
      `ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100`,
    ]) {
      await client.query(ddl);
    }

    // Several approvals per form is the whole point of the Add button.
    await client.query(`ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_request_type_key`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_approval_rules_type_order
         ON approval_rules (request_type, sort_order, created_at)`
    );

    await client.query(
      `UPDATE approval_rules SET messages = $1::jsonb WHERE messages IS NULL`,
      [JSON.stringify(DEFAULT_MESSAGES)]
    );

    // The seeded rules match everything, so they stay the fallback for their
    // form no matter what gets added above them.
    await client.query(`UPDATE approval_rules SET sort_order = 100 WHERE sort_order IS NULL`);

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT request_type AS "requestType", name, decision, sort_order AS "order",
              jsonb_array_length(criteria) AS conditions, is_active AS "isActive"
         FROM approval_rules ORDER BY request_type, sort_order`
    );
    console.log('✅ Approval flow ready.');
    console.log(`   ${r.rows.length} approval(s):`);
    r.rows.forEach(x => console.log(
      `     ${x.requestType.padEnd(16)} ${x.name}  [${x.decision}, ${x.conditions} condition(s), order ${x.order}]${x.isActive ? '' : ' — off'}`
    ));
    console.log('\n   Every one matches all requests, so routing is unchanged until a');
    console.log('   narrower approval is added above it.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Approval flow migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
