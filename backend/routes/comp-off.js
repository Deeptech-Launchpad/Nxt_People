const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { audit } = require('../middleware/audit');
const { createNotification } = require('./notifications');
const {
  createLevels, canUserAct, applyApproval, applyApproveAll, applyRejection, approvalLevelsJson,
} = require('../utils/leaveApproval');
const { DEFAULT_TZ } = require('../utils/timezone');
router.use(protect);

// Comp-Off approval chain as JSON for the shared ApprovalTimeline (same engine
// leaves/regularizations use — Level 1 Reporting Person → Level 2 Secondary →
// Level 3 Final Approver).
const COMPOFF_LEVELS_JSON = approvalLevelsJson('comp_off', 'c', 'id');

/* ── Eligibility helpers ──────────────────────────────────────────────────
 *  Comp-Off is EARNED only for working on a Saturday, Sunday, or approved
 *  holiday, and may be USED only on a future regular working day (Mon–Fri that
 *  is not a holiday). All date maths runs in SQL on DATE values so there is no
 *  timezone drift from JS Date parsing. */

// Is `date` a weekend (Sat/Sun) or a configured holiday? → eligible to EARN.
async function isWeekendOrHoliday(db, date) {
  const r = await db.query(
    `SELECT EXTRACT(DOW FROM $1::date) AS dow,
            EXISTS (SELECT 1 FROM holidays WHERE date = $1::date) AS is_holiday`,
    [date]
  );
  const dow = Number(r.rows[0].dow); // 0 = Sunday … 6 = Saturday
  return dow === 0 || dow === 6 || r.rows[0].is_holiday;
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
              ${COMPOFF_LEVELS_JSON} as "approvalLevels"
         FROM comp_offs c WHERE c.employee_id = $1 ORDER BY c.created_at DESC`,
      [req.user._id]
    );
    // Available balance = approved credits still inside their 3-month validity.
    const balance = r.rows
      .filter(x => x.status === 'approved' && !x.expired)
      .reduce((s, x) => s + (parseFloat(x.daysEarned) - parseFloat(x.daysUsed)), 0);
    res.json({ success: true, data: r.rows, balance: Math.max(0, balance) });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// GET pending (admin/manager) — same hierarchy scoping as the leave queue:
// full-access sees the whole org; everyone else sees requests where they are an
// assigned approver of a still-pending level.
router.get('/pending', authorize('admin', 'director', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const full = isFullAccess(req.user.role);
    const r = await pool.query(
      `SELECT c.id as "_id", c.worked_date as "workedDate", c.comp_off_date as "compOffDate",
              c.reason, c.days_earned as "daysEarned", c.expires_at as "expiresAt",
              c.status, c.created_at as "createdAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                'department', e.department, 'employeeId', e.employee_id) as employee,
              ${COMPOFF_LEVELS_JSON} as "approvalLevels",
              ($2::boolean OR EXISTS (
                 SELECT 1 FROM approval_levels x
                  WHERE x.request_type = 'comp_off' AND x.request_id = c.id
                    AND x.approver_id = $1 AND x.status = 'pending'
              )) as "canAct"
         FROM comp_offs c JOIN employees e ON c.employee_id = e.id
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
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// POST apply comp-off — validates the worked day, attendance, the requested
// comp-off day, and the 3-month validity window, then builds the approval chain.
router.post('/', audit('CREATE', 'comp_off'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { workedDate, compOffDate, reason, daysEarned = 1 } = req.body;
    if (!workedDate) return res.status(400).json({ success: false, message: 'Worked date is required' });
    if (!compOffDate) return res.status(400).json({ success: false, message: 'Requested comp-off date is required' });

    const today = await todayIst(client);
    // Worked date must be in the past (or today) — you can't earn for future work.
    if (workedDate > today) {
      return res.status(400).json({ success: false, message: 'The worked date cannot be in the future.' });
    }
    // Earned only for weekend/holiday work.
    if (!(await isWeekendOrHoliday(client, workedDate))) {
      return res.status(400).json({ success: false, message: 'Comp-Off can only be earned for working on a Saturday, Sunday, or an approved holiday.' });
    }
    // Attendance must prove the employee actually worked that day.
    if (!(await workedOn(client, req.user._id, workedDate))) {
      return res.status(400).json({ success: false, message: 'No attendance is recorded for you on that date. Comp-Off needs a recorded check-in on the worked day.' });
    }
    // Requested comp-off day must be a FUTURE regular working day (Mon–Fri, not a holiday).
    if (compOffDate <= today) {
      return res.status(400).json({ success: false, message: 'The comp-off date must be a future date.' });
    }
    if (await isWeekendOrHoliday(client, compOffDate)) {
      return res.status(400).json({ success: false, message: 'Comp-Off can only be taken on a regular working day (Monday–Friday, excluding holidays).' });
    }
    // Validity: the credit expires 3 months after the worked date. Compare as
    // ISO strings (YYYY-MM-DD) to avoid any JS Date timezone drift.
    const expRes = await client.query(
      `SELECT to_char(($1::date) + INTERVAL '3 months', 'YYYY-MM-DD') AS exp`, [workedDate]
    );
    const expiresAt = expRes.rows[0].exp; // 'YYYY-MM-DD'
    if (compOffDate > expiresAt) {
      return res.status(400).json({ success: false, message: 'Comp-Off must be used within 3 months of the worked date. Please pick an earlier date.' });
    }

    await client.query('BEGIN');
    const dupCheck = await client.query(
      'SELECT id FROM comp_offs WHERE employee_id=$1 AND worked_date=$2 FOR UPDATE',
      [req.user._id, workedDate]
    );
    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'You have already claimed comp-off for this worked date.' });
    }
    const r = await client.query(
      `INSERT INTO comp_offs (employee_id, worked_date, comp_off_date, reason, days_earned, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id as "_id", worked_date as "workedDate", comp_off_date as "compOffDate",
                 reason, days_earned as "daysEarned", expires_at as "expiresAt", status, created_at as "createdAt"`,
      [req.user._id, workedDate, compOffDate, reason || null, daysEarned, expiresAt]
    );
    const created = r.rows[0];
    // Build the same 3-level approval chain leaves use.
    try { await createLevels(client, 'comp_off', created._id, req.user._id); }
    catch (e) { /* soft-fail: a missing hierarchy still leaves an HR-approvable request */ }
    await client.query('COMMIT');

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

// PUT approve/reject — routed through the shared hierarchy engine, exactly like
// leaves: Approve covers lower levels on-behalf; Approve All finalises every
// pending level; any rejection rejects the whole request.
router.put('/:id/action', authorize('admin', 'director', 'manager', 'team_incharge'), audit('ACTION', 'comp_off'), async (req, res) => {
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
    return res.json({ success: true, status: 'rejected', message: 'Comp-off rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
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
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
