/**
 * utils/automationConfig.js
 * Reads the configured email alerts and the absent scheduler, and resolves an
 * alert's recipients and rendered wording.
 *
 * The reminder crons used to hold all of this in code: 09:00, 18:00, every
 * active employee, wording inline. They now ask this module instead, so the
 * Automation screen changes what actually goes out.
 *
 * Every getter degrades to the old hardcoded behaviour if the tables are
 * missing — an install that has not run the migration must keep sending its
 * reminders, not stop.
 */
const pool = require('../db');

const TTL_MS = 60_000;
let cache = { at: 0, alerts: null, scheduler: null };

const invalidate = () => { cache = { at: 0, alerts: null, scheduler: null }; };

const FALLBACK_ALERTS = {
  check_in_reminder: { event: 'check_in_reminder', isActive: true, sendAt: '09:00', recipients: { allEmployees: true, departmentIds: [], locationIds: [] }, subject: 'Reminder to check in for the day', body: null },
  check_out_reminder: { event: 'check_out_reminder', isActive: true, sendAt: '18:00', recipients: { allEmployees: true, departmentIds: [], locationIds: [] }, subject: 'Reminder to check out', body: null },
};

async function alerts() {
  if (cache.alerts && Date.now() - cache.at < TTL_MS) return cache.alerts;
  let value = { ...FALLBACK_ALERTS };
  try {
    const r = await pool.query(
      `SELECT a.event, a.is_active AS "isActive", a.send_at AS "sendAt", a.recipients,
              t.subject, t.body
         FROM email_alerts a
         LEFT JOIN email_templates t ON t.id = a.template_id
        WHERE a.event IS NOT NULL`
    );
    // Only the rows that name an event are scheduled reminders. The ones
    // without an event are workflow actions and have no business here — an
    // unguarded loop would key them under `undefined` and, worse, a workflow
    // alert named like a reminder could overwrite one.
    for (const row of r.rows) value[row.event] = row;
  } catch {
    // Tables not there yet — the fallback keeps the reminders going.
  }
  cache = { ...cache, alerts: value, at: Date.now() };
  return value;
}

async function scheduler() {
  if (cache.scheduler && Date.now() - cache.at < TTL_MS) return cache.scheduler;
  let value = { enabled: false, runAt: '21:00', markAbsentWhenNoCheckIn: true };
  try {
    const r = await pool.query(`SELECT attendance_automation_config AS c FROM settings LIMIT 1`);
    if (r.rows[0]?.c?.absentScheduler) value = { ...value, ...r.rows[0].c.absentScheduler };
  } catch { /* fallback stands */ }
  cache = { ...cache, scheduler: value, at: Date.now() };
  return value;
}

/**
 * The employees an alert should reach.
 *
 * "All employees" means every active one. Otherwise the departments and
 * locations are OR-ed — the reference's own alert targets two departments and
 * two locations and expects anyone in either, not only people in both.
 */
async function recipientsFor(alert) {
  const rec = alert?.recipients || { allEmployees: true };
  const where = [
    `status = 'active'`,
    `deleted_at IS NULL`,
    `email IS NOT NULL`,
    `email <> ''`,
  ];
  const params = [];

  if (!rec.allEmployees) {
    const parts = [];
    if (rec.departmentIds?.length) { params.push(rec.departmentIds); parts.push(`department_id = ANY($${params.length}::uuid[])`); }
    if (rec.locationIds?.length) { params.push(rec.locationIds); parts.push(`work_location_id = ANY($${params.length}::uuid[])`); }
    // No scope at all would mean nobody; the route refuses to save that, and
    // this guard means an older row cannot reach here and quietly send to all.
    if (!parts.length) return [];
    where.push(`(${parts.join(' OR ')})`);
  }

  const r = await pool.query(
    `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email) AS name
       FROM employees WHERE ${where.join(' AND ')}`,
    params
  );
  return r.rows;
}

// Substitutes ${field} placeholders. An unknown field is left as written —
// visible in the email, rather than silently becoming "undefined".
const render = (text, values) =>
  String(text ?? '').replace(/\$\{(\w+)\}/g, (whole, key) =>
    (values[key] === undefined || values[key] === null ? whole : String(values[key])));

module.exports = { alerts, scheduler, recipientsFor, render, invalidate };
