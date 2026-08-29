const express = require('express');
const router = express.Router();
const pool = require('../db');
const { fire } = require('../utils/workflowEngine');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { audit } = require('../middleware/audit');
const { createNotification } = require('./notifications');
const {
  createLevels, canUserAct, applyApproval, applyApproveAll, applyRejection, approvalLevelsJson,
} = require('../utils/leaveApproval');
const { DEFAULT_TZ } = require('../utils/timezone');
const { ruleMatchesDate, holidayClosesOffice } = require('../utils/workingDays');
const { serverError } = require('../utils/serverError');
router.use(protect);

// Comp-Off approval chain as JSON for the shared ApprovalTimeline (same engine
// leaves/regularizations use — Level 1 Reporting Person → Level 2 Secondary →
// Level 3 Final Approver).
const COMPOFF_LEVELS_JSON = approvalLevelsJson('comp_off', 'c', 'id');

/* ── Eligibility helpers ──────────────────────────────────────────────────
 *  Comp-Off is EARNED only for working a non-working day, and may be USED
 *  only on a future working day. Both questions are the same question, and
 *  it is answered by the work calendar — the weekend rules plus the holiday
 *  calendar — not by a fixed Sat/Sun assumption. With rules like "Sundays,
 *  1st & 3rd Saturdays, 2nd Mondays" the two differ constantly: a 2nd
 *  Saturday is a working day and a 2nd Monday is not.
 *
 *  Dates are handled as YYYY-MM-DD strings and only ever turned into a Date
 *  at local midnight, so nothing drifts across the IST offset. */

// Is `ymd` a non-working day under the current work calendar? → eligible to
// EARN comp-off, and ineligible to take it.
async function isNonWorkingDate(db, ymd) {
  const [hol, rules] = await Promise.all([
    db.query('SELECT type FROM holidays WHERE date = $1::date', [ymd]),
    db.query(
      `SELECT days_of_week, weeks_of_month, interval_weeks, start_date,
              end_type, end_date, end_count, is_active
         FROM weekend_rules WHERE is_active = TRUE`
    ),
  ]);
  const holType = hol.rows[0]?.type;
  if (holidayClosesOffice(holType)) return true;
  // A Working Day Exception is a working day even if a weekend rule matches;
  // a restricted holiday is optional and leaves the rules to decide.
  if (holType === 'working_day') return false;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return rules.rows.some(rule => ruleMatchesDate(rule, date));
}

// How long an earned credit stays usable — Configuration → Compensatory Off.
async function compOffExpiryMonths(db) {
  const r = await db.query('SELECT comp_off_expiry_months FROM settings LIMIT 1');
  return parseInt(r.rows[0]?.comp_off_expiry_months, 10) || 3;
}

// Did the employee actually work (a recorded check-in) on `date`?
async function workedOn(db, employeeId, date) {
  const r = await db.query(
    `SELECT 1 FROM attendance
      WHERE employee_id = $1 AND date = $2::date AND check_in IS NOT NULL LIMIT 1`,
    [employeeId, date]
  );
  return r.rows.length > 0;
}

/* Whose comp-off is this, and may the caller file it?
 *
 * Zoho reaches the same form through two doors: My Data files for yourself and
 * has no employee field at all, while Operations puts an employee selector on
 * top and files for anybody. One form, one record, two contexts — so this takes
 * an optional employeeId and decides, rather than there being two endpoints
 * that could drift apart.
 *
 * Filing for somebody else grants them a paid day off, so it is an
 * administrative act and is gated like one. Absent or self-addressed, nothing
 * changes and the employee's own route behaves exactly as it did. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function resolveSubject(db, user, employeeId) {
  if (!employeeId || String(employeeId) === String(user._id)) {
    return { id: user._id, onBehalf: false };
  }
  if (!isFullAccess(user.role)) {
    return { error: 403, message: 'Only HR and administrators can file a comp-off for another employee.' };
  }
  // An id that is not a UUID would reach postgres as a cast error and surface
  // as a 500, which reads as "the server broke" rather than "that is not an
  // employee". Refuse it here where the reason can still be stated.
  if (!UUID.test(String(employeeId))) {
    return { error: 400, message: 'That is not a valid employee.' };
  }
  const r = await db.query(
    `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name
       FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
  if (!r.rows.length) return { error: 404, message: 'That employee no longer exists.' };
  return { id: r.rows[0].id, name: r.rows[0].name, onBehalf: true };
}

// Today's date in the app's default timezone as YYYY-MM-DD, so the
// past/future guards match what users see.
async function todayIst(db) {
  const r = await db.query(
    `SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE '${DEFAULT_TZ}', 'YYYY-MM-DD') AS d`
  );
  return r.rows[0].d;
}

// GET my comp-offs — only approved AND non-expired credits count toward balance.
router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id as "_id", c.worked_date as "workedDate", c.comp_off_date as "compOffDate",
              c.reason, c.days_earned as "daysEarned", c.days_used as "daysUsed",
              c.expires_at as "expiresAt", c.status,
              c.rejection_reason as "rejectionReason", c.created_at as "createdAt",
              (c.expires_at IS NOT NULL AND c.expires_at < CURRENT_DATE) as "expired",
              CASE WHEN c.applied_by IS NULL THEN NULL
                   ELSE TRIM(CONCAT(f.first_name, ' ', f.last_name)) END as "appliedBy",
              ${COMPOFF_LEVELS_JSON} as "approvalLevels"
         FROM comp_offs c
         LEFT JOIN employees f ON f.id = c.applied_by
        WHERE c.employee_id = $1 ORDER BY c.created_at DESC`,
      [req.user._id]
    );
    // Available balance = approved credits still inside their validity window.
    const balance = r.rows
      .filter(x => x.status === 'approved' && !x.expired)
      .reduce((s, x) => s + (parseFloat(x.daysEarned) - parseFloat(x.daysUsed)), 0);
    res.json({ success: true, data: r.rows, balance: Math.max(0, balance) });
  } catch (err) { serverError(res, err); }
});

// GET pending (admin/manager) — same hierarchy scoping as the leave queue:
// full-access sees the whole org; everyone else sees requests where they are an
// assigned approver of a still-pending level.
router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const full = isFullAccess(req.user.role);
    const r = await pool.query(
      `SELECT c.id as "_id", c.worked_date as "workedDate", c.comp_off_date as "compOffDate",
              c.reason, c.days_earned as "daysEarned", c.expires_at as "expiresAt",
              c.status, c.created_at as "createdAt",
              CASE WHEN c.applied_by IS NULL THEN NULL
                   ELSE TRIM(CONCAT(f.first_name, ' ', f.last_name)) END as "appliedBy",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                'department', e.department, 'employeeId', e.employee_id) as employee,
              ${COMPOFF_LEVELS_JSON} as "approvalLevels",
              ($2::boolean OR EXISTS (
                 SELECT 1 FROM approval_levels x
                  WHERE x.request_type = 'comp_off' AND x.request_id = c.id
                    AND x.approver_id = $1 AND x.status = 'pending'
              )) as "canAct"
         FROM comp_offs c
         JOIN employees e ON c.employee_id = e.id
         LEFT JOIN employees f ON f.id = c.applied_by
        WHERE c.status = 'pending'
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'comp_off' AND x.request_id = c.id
                  AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY c.worked_date DESC`,
      [req.user._id, full]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

/* What the attendance says about this employee on this day.
 *
 * Zoho puts exactly this beside the Add Request form — First in, Last out,
 * Overtime, Total hours — and it is not decoration. An administrator filing on
 * somebody else's behalf has no idea whether that person actually came in on a
 * given Sunday; without this they pick a date, submit, and get a refusal with
 * no way to find the right one. The rules that would reject the request are
 * answered here first, so the form can say so before anybody submits.
 *
 * Read-only, and it reveals only what an approver already sees on a request. */
router.get('/eligibility', async (req, res) => {
  try {
    const { date, employeeId } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'A date is required' });

    const subject = await resolveSubject(pool, req.user, employeeId);
    if (subject.error) return res.status(subject.error).json({ success: false, message: subject.message });

    const [nonWorking, att, dup] = await Promise.all([
      isNonWorkingDate(pool, date),
      pool.query(
        `SELECT to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS "firstIn",
                to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS "lastOut",
                working_hours::float AS hours, status
           FROM attendance
          WHERE employee_id = $1 AND date = $2::date LIMIT 1`,
        [subject.id, date, DEFAULT_TZ]),
      pool.query(
        'SELECT id FROM comp_offs WHERE employee_id = $1 AND worked_date = $2::date LIMIT 1',
        [subject.id, date]),
    ]);

    const a = att.rows[0] || null;
    const worked = !!(a && a.firstIn);
    res.json({
      success: true,
      data: {
        // Each of these maps to one refusal the create handler can give, so the
        // form can explain the problem instead of relaying an error.
        isNonWorkingDay: nonWorking,
        worked,
        alreadyClaimed: dup.rows.length > 0,
        eligible: nonWorking && worked && dup.rows.length === 0,
        attendance: a ? { firstIn: a.firstIn, lastOut: a.lastOut, hours: a.hours, status: a.status } : null,
      },
    });
  } catch (err) { serverError(res, err); }
});

/* Every comp-off in the company, whatever its status.
 *
 * This is Zoho's Operations -> Leave Tracker -> Compensatory Request tab, and
 * it is a different question from /my (mine) and /pending (waiting on me). An
 * administrator looking at this tab wants the whole picture — credited, taken,
 * still to be approved, already expired — which neither of the other two can
 * answer. Full access only, because it shows everybody. */
router.get('/all', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id as "_id", c.worked_date as "workedDate", c.comp_off_date as "compOffDate",
              c.reason, c.days_earned as "daysEarned", c.days_used as "daysUsed",
              c.expires_at as "expiresAt", c.status,
              c.rejection_reason as "rejectionReason", c.created_at as "createdAt",
              (c.expires_at IS NOT NULL AND c.expires_at < CURRENT_DATE) as "expired",
              CASE WHEN c.applied_by IS NULL THEN NULL
                   ELSE TRIM(CONCAT(f.first_name, ' ', f.last_name)) END as "appliedBy",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                'department', e.department, 'employeeId', e.employee_id) as employee,
              -- Who it goes to, which is Zoho's "Reporting to" column.
              CASE WHEN m.id IS NULL THEN NULL
                   ELSE TRIM(CONCAT(m.first_name, ' ', m.last_name)) END as "reportingTo",
              ${COMPOFF_LEVELS_JSON} as "approvalLevels",
              TRUE as "canAct"
         FROM comp_offs c
         JOIN employees e ON c.employee_id = e.id
         LEFT JOIN employees f ON f.id = c.applied_by
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
        ORDER BY c.created_at DESC
        LIMIT 500`);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// POST apply comp-off — validates the worked day, attendance, the requested
// comp-off day, and the configured validity window, then builds the approval chain.
router.post('/', audit('CREATE', 'comp_off'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { workedDate, compOffDate, reason, daysEarned = 1, employeeId } = req.body;
    if (!workedDate) return res.status(400).json({ success: false, message: 'Worked date is required' });
    /* Naming the day off is OPTIONAL, because claiming a credit and spending it
     * are two separate acts — which is how Zoho works and, as it turns out, how
     * this already worked underneath. utils/leaveBalance.js keeps a FIFO ledger
     * over comp_offs: applying leave of type comp_off checks the credit and
     * draws it down oldest-first on approval, refunding on cancellation.
     *
     * Requiring the date here forced somebody to decide, on the Monday after a
     * Sunday they worked, exactly which future day they would take — before
     * they could possibly know. The credit is the thing being claimed; the day
     * off is a leave request like any other. Anyone who does know can still say
     * so, and the checks below still run on it. */

    const subject = await resolveSubject(client, req.user, employeeId);
    if (subject.error) return res.status(subject.error).json({ success: false, message: subject.message });
    // Every rule below is about the person the day belongs to, never the person
    // typing. Reading req.user here was the whole reason HR could not do this.
    const who = subject.onBehalf ? subject.name : 'you';

    const today = await todayIst(client);
    // Worked date must be in the past (or today) — you can't earn for future work.
    if (workedDate > today) {
      return res.status(400).json({ success: false, message: 'The worked date cannot be in the future.' });
    }
    // Earned only for working a day the work calendar says is non-working.
    if (!(await isNonWorkingDate(client, workedDate))) {
      return res.status(400).json({ success: false, message: 'Comp-Off can only be earned for working on a weekend or holiday, as set by the work calendar.' });
    }
    // Attendance must prove the employee actually worked that day.
    if (!(await workedOn(client, subject.id, workedDate))) {
      return res.status(400).json({
        success: false,
        message: `No attendance is recorded for ${who} on that date. Comp-Off needs a recorded check-in on the worked day.`,
      });
    }
    // Only checked when a day was named. A credit with no day yet is the
    // normal case, not an incomplete one.
    if (compOffDate && compOffDate <= today) {
      return res.status(400).json({ success: false, message: 'The comp-off date must be a future date.' });
    }
    if (compOffDate && await isNonWorkingDate(client, compOffDate)) {
      return res.status(400).json({ success: false, message: 'Comp-Off can only be taken on a working day — that date is already a weekend or holiday.' });
    }
    // Validity window is configurable. Compare as ISO strings (YYYY-MM-DD)
    // to avoid any JS Date timezone drift.
    const expiryMonths = await compOffExpiryMonths(client);
    const expRes = await client.query(
      `SELECT to_char(($1::date) + ($2 || ' months')::interval, 'YYYY-MM-DD') AS exp`,
      [workedDate, expiryMonths]
    );
    const expiresAt = expRes.rows[0].exp; // 'YYYY-MM-DD'
    if (compOffDate && compOffDate > expiresAt) {
      return res.status(400).json({
        success: false,
        message: `Comp-Off must be used within ${expiryMonths} month${expiryMonths === 1 ? '' : 's'} of the worked date. Please pick an earlier date.`,
      });
    }

    await client.query('BEGIN');
    const dupCheck = await client.query(
      'SELECT id FROM comp_offs WHERE employee_id=$1 AND worked_date=$2 FOR UPDATE',
      [subject.id, workedDate]
    );
    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: subject.onBehalf
          ? `${subject.name} has already claimed comp-off for this worked date.`
          : 'You have already claimed comp-off for this worked date.',
      });
    }
    const r = await client.query(
      `INSERT INTO comp_offs (employee_id, worked_date, comp_off_date, reason, days_earned, expires_at, applied_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id as "_id", worked_date as "workedDate", comp_off_date as "compOffDate",
                 reason, days_earned as "daysEarned", expires_at as "expiresAt", status,
                 applied_by as "appliedBy", created_at as "createdAt"`,
      [subject.id, workedDate, compOffDate || null, reason || null, daysEarned, expiresAt,
       subject.onBehalf ? req.user._id : null]
    );
    const created = r.rows[0];
    // The chain belongs to the employee, not to whoever filed it — an HR-raised
    // request still goes to that person's own reporting line for approval.
    try { await createLevels(client, 'comp_off', created._id, subject.id); }
    catch (e) { /* soft-fail: a missing hierarchy still leaves an HR-approvable request */ }
    await client.query('COMMIT');

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

// PUT approve/reject — routed through the shared hierarchy engine, exactly like
// leaves: Approve covers lower levels on-behalf; Approve All finalises every
// pending level; any rejection rejects the whole request.
router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), audit('ACTION', 'comp_off'), async (req, res) => {
  const { action, rejectionReason, approveAll } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action. Use: approved or rejected' });
  }
  const wantApproveAll = action === 'approved' && approveAll === true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT * FROM comp_offs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const co = existing.rows[0];
    if (!co) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }

    if (String(co.employee_id) === String(req.user._id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You cannot approve or reject your own comp-off request.' });
    }
    if (co.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This comp-off has already been ${co.status}.` });
    }
    if (!(await canUserAct(client, 'comp_off', co.id, req.user))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You are not an approver for this comp-off request.' });
    }

    const dateLabel = new Date(co.worked_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    if (action === 'approved') {
      const result = wantApproveAll
        ? await applyApproveAll(client, 'comp_off', co.id, req.user)
        : await applyApproval(client, 'comp_off', co.id, req.user);
      if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }

      if (result.allApproved) {
        await client.query(
          `UPDATE comp_offs SET status='approved', approved_by=$1, approved_at=NOW(),
                  rejection_reason=COALESCE($2, rejection_reason) WHERE id=$3`,
          [req.user._id, rejectionReason || null, co.id]
        );
      } else {
        await client.query(
          `UPDATE comp_offs SET rejection_reason=COALESCE($1, rejection_reason) WHERE id=$2`,
          [rejectionReason || null, co.id]
        );
      }
      await client.query('COMMIT');

      if (result.allApproved) {
        await createNotification(co.employee_id, 'info', 'Comp-Off Approved ✓',
          `Your comp-off for working on ${dateLabel} (${co.days_earned} day) has been approved.`, '/leave-tracker/comp-off');
      }
      // Fire-and-forget: the approval is committed, and a workflow must never
      // be able to fail or delay it. Only when every level has approved.
      if (result.allApproved) fire('comp_off', 'approved', { recordId: co.id, actorId: req.user._id });
      return res.json({
        success: true,
        status: result.status,
        message: result.allApproved ? 'Comp-off fully approved.' : 'Your approval has been recorded. Awaiting the remaining level(s).',
      });
    }

    // REJECT
    const result = await applyRejection(client, 'comp_off', co.id, req.user);
    if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }
    await client.query(
      `UPDATE comp_offs SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2 WHERE id=$3`,
      [req.user._id, rejectionReason || null, co.id]
    );
    await client.query('COMMIT');

    await createNotification(co.employee_id, 'info', 'Comp-Off Rejected',
      `Your comp-off request for ${dateLabel} was rejected.`, '/leave-tracker/comp-off');
    fire('comp_off', 'rejected', { recordId: co.id, actorId: req.user._id });
    return res.json({ success: true, status: 'rejected', message: 'Comp-off rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

// POST use comp-off (deduct from balance) — only approved, non-expired credits.
router.post('/:id/use', audit('USE', 'comp_off'), async (req, res) => {
  try {
    const { daysToUse } = req.body;
    const days = parseFloat(daysToUse);
    if (!days || days <= 0) {
      return res.status(400).json({ success: false, message: 'daysToUse must be a positive number.' });
    }
    const r = await pool.query(
      `UPDATE comp_offs SET days_used = days_used + $1
        WHERE id = $2 AND employee_id = $3 AND status = 'approved'
          AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
          AND days_used + $1 <= days_earned
        RETURNING id`,
      [days, req.params.id, req.user._id]
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'This comp-off credit is not available, has expired, or does not have enough remaining days for that request.' });
    }
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// GET /api/comp-off/config — the Compensatory Off configuration screen.
//
// Readable by any signed-in user: the restrictions decide what the request
// form offers, so the form has to read them before anyone can raise a request.
router.get('/config', async (req, res) => {
  try {
    const r = await pool.query('SELECT comp_off_config AS config FROM settings LIMIT 1');
    res.json({ success: true, data: r.rows[0]?.config || {} });
  } catch (err) { serverError(res, err); }
});

const RAISABLE = ['full_day', 'half_day', 'quarter_day', 'hourly'];
const EXPIRY_UNITS = ['calendar_days', 'business_days', 'months'];

// PATCH /api/comp-off/config — replaces the whole configuration object.
//
// The screen edits one coherent policy, so it saves as a whole. Validating
// each field here rather than trusting the blob matters more than usual: these
// values gate what can be requested and when a credit expires, so a bad value
// would fail at request time instead of loudly on save.
router.patch('/config', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const modes = b.requestModes || {};
    if (!modes.manual && !modes.scheduler) {
      return res.status(400).json({ success: false, message: 'At least one way of requesting comp-off must be allowed' });
    }
    const raisable = b.raisableFor || {};
    if (!RAISABLE.some(k => raisable[k])) {
      return res.status(400).json({ success: false, message: 'Comp-off must be raisable for at least one duration' });
    }
    const ent = b.entitlement || {};
    for (const k of ['weekend', 'holiday']) {
      const n = Number(ent[k]);
      if (!Number.isFinite(n) || n < 0 || n > 5) {
        return res.status(400).json({ success: false, message: `${k === 'weekend' ? 'Weekend' : 'Holiday'} entitlement must be between 0 and 5` });
      }
    }
    const expiry = b.expiry || {};
    if (!['calendar_year_end', 'after'].includes(expiry.mode)) {
      return res.status(400).json({ success: false, message: 'Expiry mode is not valid' });
    }
    if (expiry.mode === 'after') {
      if (!EXPIRY_UNITS.includes(expiry.unit)) {
        return res.status(400).json({ success: false, message: 'Expiry unit is not valid' });
      }
      const n = Number(expiry.amount);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return res.status(400).json({ success: false, message: 'Expiry period must be between 1 and 365' });
      }
    }

    const config = {
      requestModes: { manual: !!modes.manual, scheduler: !!modes.scheduler },
      raisableFor: RAISABLE.reduce((o, k) => ({ ...o, [k]: !!raisable[k] }), {}),
      allowFutureDates: !!b.allowFutureDates,
      includeTimeInput: !!b.includeTimeInput,
      reasonMandatory: !!b.reasonMandatory,
      entitlement: { weekend: Number(ent.weekend), holiday: Number(ent.holiday) },
      expiry: expiry.mode === 'after'
        ? { mode: 'after', amount: Number(expiry.amount), unit: expiry.unit }
        : { mode: 'calendar_year_end' },
    };

    // comp_off_expiry_months is still read by the expiry job, so it is kept in
    // step rather than left to drift behind the screen that now owns it.
    const months = config.expiry.mode === 'after' && config.expiry.unit === 'months'
      ? config.expiry.amount : null;
    const r = await pool.query(
      `UPDATE settings
          SET comp_off_config = $1::jsonb,
              comp_off_expiry_months = COALESCE($2, comp_off_expiry_months),
              updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
        RETURNING comp_off_config AS config`,
      [JSON.stringify(config), months]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });
    res.json({ success: true, data: r.rows[0].config });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
