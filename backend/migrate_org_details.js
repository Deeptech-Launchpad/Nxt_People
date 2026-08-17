/* ── Manage Accounts → Organization Setup ─────────────────────────────────
 *  Organization Details and Organization Policy, which the settings row could
 *  hold almost none of: it had company_name, company_email and timezone, while
 *  the reference's Basic Details asks for a logo, website, type of
 *  organization, a contact person and number, and a primary address.
 *
 *  Organization Policy is a blob rather than columns because it is a page of
 *  switches that will keep growing, and because its two halves save
 *  independently — the reference puts a Save on Alert & Chat and another on
 *  Locale & Display format.
 *
 *  Defaults are read off the reference org's own screens so a fresh install
 *  starts where they are.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_org_details.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const ORG_COLUMNS = [
  ['org_logo_url', 'VARCHAR(500)'],
  ['org_website', 'VARCHAR(255)'],
  ['org_type', 'VARCHAR(60)'],
  ['org_contact_person', 'VARCHAR(150)'],
  ['org_contact_number', 'VARCHAR(40)'],
  ['org_address_line1', 'VARCHAR(255)'],
  ['org_address_line2', 'VARCHAR(255)'],
  ['org_city', 'VARCHAR(120)'],
  ['org_state', 'VARCHAR(120)'],
  ['org_country', 'VARCHAR(120)'],
  ['org_postal_code', 'VARCHAR(20)'],
];

const POLICY = {
  // Both of these gate features we actually have, so they do something.
  alertAndChat: { notifications: true, chat: true },

  // Whether an employee may hide these from colleagues.
  personalInformation: { birthday: false, workAnniversary: false, mobileNumber: true },
  employeeSearch: { byMobileNumber: false },

  profilePicture: { updatableBy: 'employee', mandateApproval: false, approver: null },
  coverImage: { allowSystemOptions: false, allowCustomUpload: false },

  // The half that every screen reads: how a date, a time and a name are
  // written. Seeded to what the application already does.
  locale: {
    country: 'India',
    timezone: 'Asia/Kolkata',
    timeFormat: '12',
    nameFormat: 'first_name',
    dateFormat: 'dd/MM/yyyy',
  },

  recycleBin: { retentionMonths: 1 },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [name, type] of ORG_COLUMNS) {
      await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS organization_policy_config JSONB`);
    await client.query(
      `UPDATE settings SET organization_policy_config = $1::jsonb WHERE organization_policy_config IS NULL`,
      [JSON.stringify(POLICY)]
    );

    // The timezone the application already runs on is the one the policy should
    // report, rather than a default that disagrees with every cron job.
    await client.query(
      `UPDATE settings
          SET organization_policy_config =
                jsonb_set(organization_policy_config, '{locale,timezone}', to_jsonb(COALESCE(timezone, 'Asia/Kolkata')))
        WHERE timezone IS NOT NULL`
    );
    await client.query(`UPDATE settings SET org_country = 'India' WHERE org_country IS NULL`);

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT company_name AS "name", org_website AS "website", org_country AS "country",
              organization_policy_config->'locale' AS locale
         FROM settings LIMIT 1`
    );
    const s = r.rows[0] || {};
    console.log('✅ Organization details and policy ready.');
    console.log(`   ${ORG_COLUMNS.length} detail columns added`);
    console.log(`   name=${s.name || '(unset)'}  website=${s.website || '(unset)'}  country=${s.country}`);
    console.log(`   locale=${JSON.stringify(s.locale)}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Organization details migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
