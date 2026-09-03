const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { isFullAccess, isManager } = require('../utils/roles');
const { serverError } = require('../utils/serverError');

/* Everything that has happened to one person's record, in one list.
 *
 * The question this answers is the one HR actually asks: "when did they send
 * their PAN card", "who changed their designation", "when did they last take
 * leave". Today each of those lives on a different screen, and half of them
 * are only answerable by someone with database access.
 *
 * WHERE THE EVENTS COME FROM
 *
 * audit_log holds record changes with their old and new values, but it is
 * keyed by the id of the thing that changed — a leave row, a shift request —
 * so a leave approval carries no reference to whose leave it was. Building
 * the timeline from audit_log alone would show employee edits and nothing
 * else. So the domain tables are read directly and folded in beside it.
 *
 * WHAT IS DELIBERATELY LEFT OUT
 *
 * Attendance. Two punches a day for four years is not a timeline, it is a
 * flood that buries the twelve events somebody came here to find. Attendance
 * has its own screens, which are better at it.
 *
 * WHO SEES WHAT
 *
 * Everything here is already visible to the reader somewhere else — the
 * timeline collects it rather than revealing it. Except pay, which is not,
 * and which stays with full access.
 */
router.use(protect);

const mayRead = async (req, employeeId) => {
  if (String(req.user._id) === String(employeeId)) return true;
  if (isFullAccess(req.user.role)) return true;
  if (isManager(req.user.role)) {
    const r = await pool.query(
      `SELECT 1 FROM employees WHERE id = $1 AND (reporting_manager_id = $2 OR approving_authority_id = $2)`,
      [employeeId, req.user._id]);
    return r.rows.length > 0;
  }
  return false;
};

/* The fields worth announcing when they change. An edit that touched a
 * seating location is not a career event; a change of manager, designation or
 * status is. Everything else is folded into a single "profile updated" so the
 * list stays readable. */
const NOTABLE = {
  designation: 'Designation', department: 'Department', role: 'Role',
  status: 'Employee status', workLocation: 'Location',
  reportingManager: 'Reporting manager', reportingManagerId: 'Reporting manager',
  employmentType: 'Employment type', exitDate: 'Date of exit',
  shiftId: 'Shift', isRemote: 'Remote working',
};

router.get('/:employeeId', async (req, res) => {
  try {
    if (!(await mayRead(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: 'Not your record' });
    }
    const id = req.params.employeeId;
    const full = isFullAccess(req.user.role);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);

    const emp = (await pool.query(
      `SELECT employee_id AS "employeeCode", first_name AS "firstName", last_name AS "lastName",
              date_of_joining AS "joined", created_at AS "created", exit_date AS "exitDate",
              status
         FROM employees WHERE id = $1`, [id])).rows[0];
    if (!emp) return res.status(404).json({ success: false, message: 'No such employee' });

    const events = [];
    const push = (e) => { if (e.at) events.push(e); };
    const who = (r) => (r?.actorFirst ? `${r.actorFirst} ${r.actorLast || ''}`.trim() : null);

    /* ── the two fixed points ─────────────────────────────────────────── */
    push({
      at: emp.joined || emp.created, kind: 'joined', icon: 'user',
      title: 'Joined the company',
      detail: emp.employeeCode ? `Employee ID ${emp.employeeCode}` : null,
    });
    if (emp.exitDate) {
      push({ at: emp.exitDate, kind: 'exit', icon: 'exit', title: 'Last working day' });
    }

    /* ── documents ────────────────────────────────────────────────────── */
    const docs = await pool.query(
      `SELECT d.name, d.type, d.created_at AS at, d.file_missing AS "missing",
              a.first_name AS "actorFirst", a.last_name AS "actorLast"
         FROM employee_documents d
         LEFT JOIN employees a ON a.id = d.uploaded_by
        WHERE d.employee_id = $1 ORDER BY d.created_at DESC LIMIT 100`, [id]);
    docs.rows.forEach(r => push({
      at: r.at, kind: 'document', icon: 'file',
      title: `Document submitted — ${r.name}`,
      detail: r.missing ? 'The file is no longer on the server' : null,
      actor: who(r),
    }));

    /* ── leave ────────────────────────────────────────────────────────── */
    const leaves = await pool.query(
      `SELECT l.leave_type AS "leaveType", l.start_date AS "startDate", l.end_date AS "endDate",
              l.status, l.created_at AS at, l.total_days AS days
         FROM leaves l WHERE l.employee_id = $1 ORDER BY l.created_at DESC LIMIT 60`, [id]);
    leaves.rows.forEach(r => push({
      at: r.at, kind: 'leave', icon: 'calendar',
      title: `${r.leaveType || 'Leave'} applied`,
      detail: `${r.days || ''} day(s) from ${String(r.startDate).slice(0, 10)}`.trim(),
      status: r.status,
    }));

    /* ── corrections and on duty ──────────────────────────────────────── */
    const regs = await pool.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS day, reason, status, created_at AS at
         FROM attendance_regularizations WHERE employee_id = $1
        ORDER BY created_at DESC LIMIT 40`, [id]);
    regs.rows.forEach(r => push({
      at: r.at, kind: 'regularization', icon: 'clock',
      title: `Attendance correction requested for ${r.day}`,
      detail: r.reason, status: r.status,
    }));

    const od = await pool.query(
      `SELECT start_date::text AS "startDate", end_date::text AS "endDate",
              request_type AS "requestType", status, created_at AS at
         FROM on_duty_requests WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 40`, [id]);
    od.rows.forEach(r => push({
      at: r.at, kind: 'onduty', icon: 'briefcase',
      title: 'On duty requested',
      detail: `${String(r.requestType || '').replace(/_/g, ' ')} · ${r.startDate}${r.endDate !== r.startDate ? ` to ${r.endDate}` : ''}`,
      status: r.status,
    }));

    /* ── record changes, from the audit trail ─────────────────────────── */
    const audit = await pool.query(
      `SELECT l.action, l.resource, l.changes, l.created_at AS at,
              a.first_name AS "actorFirst", a.last_name AS "actorLast"
         FROM audit_log l
         LEFT JOIN employees a ON a.id = l.actor_id
        WHERE l.resource_id = $1::text
        ORDER BY l.created_at DESC LIMIT 80`, [id]);

    audit.rows.forEach(r => {
      const c = r.changes || {};
      /* A change set names the fields it touched. The notable ones get their
       * own line with the before and after; the rest collapse into one entry,
       * because "profile updated" twelve times tells nobody anything. */
      const fields = Object.keys(c).filter(k => k !== 'summary');
      const notable = fields.filter(f => NOTABLE[f]);

      if (notable.length) {
        notable.forEach(f => push({
          at: r.at, kind: 'change', icon: 'edit',
          title: `${NOTABLE[f]} changed`,
          detail: c[f] && typeof c[f] === 'object'
            ? `${c[f].from ?? '—'} → ${c[f].to ?? '—'}`
            : null,
          actor: who(r),
        }));
      } else if (c.summary) {
        push({
          at: r.at, kind: r.resource === 'Employee document' ? 'document' : 'change',
          icon: r.resource === 'Employee document' ? 'file' : 'edit',
          title: c.summary, actor: who(r),
        });
      } else if (fields.length) {
        push({
          at: r.at, kind: 'change', icon: 'edit',
          title: `Profile updated`,
          detail: `${fields.length} field${fields.length === 1 ? '' : 's'} changed`,
          actor: who(r),
        });
      }
    });

    /* ── pay, for full access only ────────────────────────────────────── */
    if (full) {
      const pay = await pool.query(
        `SELECT effective_from AS at, ctc_annual AS ctc, created_at AS "createdAt"
           FROM salary_structures WHERE employee_id = $1 ORDER BY effective_from DESC LIMIT 20`, [id]);
      pay.rows.forEach(r => push({
        at: r.at || r.createdAt, kind: 'pay', icon: 'money',
        title: 'Salary structure recorded',
        detail: r.ctc ? `CTC ${Number(r.ctc).toLocaleString('en-IN')}` : null,
        restricted: true,
      }));
    }

    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({
      success: true,
      data: events.slice(0, limit),
      total: events.length,
      employee: { employeeCode: emp.employeeCode, firstName: emp.firstName, lastName: emp.lastName },
      /* Said plainly rather than left for somebody to wonder about, because
       * an activity list that silently omits a whole category is worse than
       * one that says what it does not cover. */
      note: 'Check-ins and check-outs are not listed here — see Attendance for those.',
    });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
