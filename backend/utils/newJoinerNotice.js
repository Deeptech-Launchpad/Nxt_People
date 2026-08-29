/* ── Telling everyone somebody has joined ───────────────────────────────────
 *  When a new employee is onboarded, every colleague gets a notification —
 *  the bell, and a live push to anyone with the app open.
 *
 *  Deliberately IN-APP ONLY. Nothing here sends email. A joiner announcement
 *  going out as mail to a hundred and fifty people is a decision somebody
 *  should make on purpose, not something a helper does quietly on their
 *  behalf, and this installation has neither EMAIL_DISABLED nor an allowlist
 *  set — so anything sent here would reach real inboxes immediately.
 *
 *  Who does NOT get one:
 *    · the new joiner — they do not need telling about themselves
 *    · Employee Profiles (is_user = false), who can never sign in to read it
 *    · anyone inactive or soft-deleted
 *
 *  Best-effort throughout. Onboarding somebody must not fail because a
 *  notification could not be written, so every path here swallows its own
 *  errors and reports what it managed rather than throwing.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');
const { createNotification } = require('../routes/notifications');

/**
 * Notify every colleague that `employeeId` has joined.
 * @returns {Promise<{sent:number, skipped:string|null}>}
 */
async function announceNewJoiner(employeeId) {
  try {
    const joiner = (await pool.query(
      `SELECT TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS name,
              designation, department, employee_id AS code
         FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId])).rows[0];

    if (!joiner || !joiner.name) {
      return { sent: 0, skipped: 'the new employee could not be read' };
    }

    const audience = (await pool.query(
      `SELECT id FROM employees
        WHERE id <> $1
          AND deleted_at IS NULL
          AND status = 'active'
          AND is_user = TRUE`, [employeeId])).rows;

    /* Reads as a sentence rather than a field dump: "Priya has joined as a
     * Software Engineer in Engineering." Both halves are optional because
     * neither is guaranteed to be filled in at confirmation time. */
    const role = [joiner.designation, joiner.department].filter(Boolean).join(' · ');
    const message = role
      ? `${joiner.name} has joined as ${joiner.designation || 'a new team member'}` +
        (joiner.department ? ` in ${joiner.department}.` : '.')
      : `${joiner.name} has joined the team.`;

    let sent = 0;
    for (const person of audience) {
      const row = await createNotification(
        person.id, 'info', `Welcome ${joiner.name}`, message, '/new-hires');
      if (row) sent += 1;
    }

    logger.info({ joiner: joiner.code, sent }, '[newJoiner] announced');
    return { sent, skipped: null };
  } catch (err) {
    // Never surfaces to the caller. Onboarding succeeded; this did not.
    logger.error({ err: err.message, employeeId }, '[newJoiner] announcement failed');
    return { sent: 0, skipped: err.message };
  }
}

module.exports = { announceNewJoiner };
