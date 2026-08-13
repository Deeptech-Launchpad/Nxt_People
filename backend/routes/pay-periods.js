/**
 * routes/pay-periods.js
 * Pay periods — the recurring cycles the payroll-facing leave reports run over.
 *
 * A period is a *rule* ("1st to the last day, every month"), not a fixed range.
 * The current cycle is derived on read and returned as startDate/endDate, which
 * is what the pay-period chip and the reports behind it consume — so they keep
 * working without knowing the rule exists.
 *
 * Readable by any signed-in user, because the chip on Loss of pay, Leave
 * encashment and Leave data for payroll has to populate for whoever can open
 * those reports. Only full-access roles can change one: the range a period
 * covers decides what those reports report.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { LAST_DAY, cycleFor, nextCycle, dayInMonthOf, dayLabel, cycleLabel } = require('../utils/payPeriodCycle');

router.use(protect);

const CYCLES = ['monthly', 'semi_monthly', 'fortnightly', 'weekly'];
const APPLICABLE_FIELDS = ['location', 'department', 'employee_type'];

const SELECT_COLS = `
  id AS "_id", name, cycle,
  start_day      AS "startDay",
  end_day        AS "endDay",
  processing_day AS "processingDay",
  report_day     AS "reportDay",
  process_encashment    AS "processEncashment",
  pending_action        AS "pendingAction",
  convert_absences      AS "convertAbsences",
  lock_after_processing AS "lockAfterProcessing",
  applicable_to  AS "applicableTo",
  is_active      AS "isActive"
`;

// Everything the UI shows that is computed rather than stored: the current and
// upcoming cycle, the processing and report dates, and the summary lines the
// edit dialog prints. Kept here so the list, the chip and the dialog cannot
// disagree about what a rule means.
function decorate(row) {
  const now = new Date();
  const current = cycleFor(row, now);
  const upcoming = nextCycle(row, now);
  // Processing lands on the cycle it closes; the report is generated on the
  // report day of the month after, which is why a lock can only follow it.
  const processedOn = dayInMonthOf(row.processingDay, current.endDate);
  const reportOn = dayInMonthOf(row.reportDay, current.endDate, 1);
  return {
    ...row,
    ...current,
    upcoming,
    cycleLabel: cycleLabel(row),
    processingLabel: `${dayLabel(row.processingDay)} of current month`,
    reportLabel: `${dayLabel(row.reportDay)} of next month`,
    summary: { processedOn, reportOn },
  };
}

function validate(body, existing = {}) {
  const merged = { ...existing, ...body };
  const name = merged.name;
  if (!name || !String(name).trim()) return 'Pay period name is required';
  if (String(name).trim().length > 120) return 'Pay period name is too long';
  if (!CYCLES.includes(merged.cycle)) return 'Pay period cycle is not valid';

  const day = (v, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > LAST_DAY) return `${label} is not a valid day`;
    return null;
  };
  for (const [v, label] of [
    [merged.startDay, 'Start day'], [merged.endDay, 'End day'],
    [merged.processingDay, 'Payroll processing day'], [merged.reportDay, 'Payroll report generation day'],
  ]) {
    const bad = day(v, label);
    if (bad) return bad;
  }
  if (merged.pendingAction && !['auto_reject', 'auto_approve'].includes(merged.pendingAction)) {
    return 'Pending approval action is not valid';
  }
  const applicable = merged.applicableTo;
  if (applicable && Object.keys(applicable).length) {
    if (!APPLICABLE_FIELDS.includes(applicable.field)) return 'Applicable-to field is not valid';
    if (!Array.isArray(applicable.values)) return 'Applicable-to values are malformed';
  }
  return null;
}

// GET / — newest first, which is the order the chip lists them in.
// ?activeOnly=true drops retired periods; the chip uses it so a retired
// period stays readable on old reports without being offered for new ones.
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const r = await pool.query(
      `SELECT ${SELECT_COLS} FROM pay_periods
        ${activeOnly ? 'WHERE is_active = TRUE' : ''}
        ORDER BY name ASC`
    );
    res.json({ success: true, data: r.rows.map(decorate) });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// The stored start_date/end_date columns predate the cycle model and are still
// NOT NULL. Writing the resolved current cycle into them keeps the table
// self-describing for anything reading it directly.
function cycleColumns(row) {
  const { startDate, endDate } = cycleFor(row, new Date());
  return [startDate, endDate];
}

router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const b = { cycle: 'monthly', startDay: 1, endDay: LAST_DAY, processingDay: LAST_DAY, reportDay: 1, ...req.body };
    const invalid = validate(b);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const [startDate, endDate] = cycleColumns(b);
    const r = await pool.query(
      `INSERT INTO pay_periods
         (name, cycle, start_day, end_day, processing_day, report_day,
          process_encashment, pending_action, convert_absences, lock_after_processing,
          applicable_to, start_date, end_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::date,$13::date,$14)
       RETURNING ${SELECT_COLS}`,
      [String(b.name).trim(), b.cycle, Number(b.startDay), Number(b.endDay),
       Number(b.processingDay), Number(b.reportDay),
       !!b.processEncashment, b.pendingAction || null, !!b.convertAbsences, !!b.lockAfterProcessing,
       JSON.stringify(b.applicableTo || {}), startDate, endDate,
       b.isActive === undefined ? true : !!b.isActive]
    );
    res.status(201).json({ success: true, data: decorate(r.rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pay period with that name already exists' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.patch('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const current = await pool.query(`SELECT ${SELECT_COLS} FROM pay_periods WHERE id = $1`, [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ success: false, message: 'Pay period not found' });

    const b = req.body;
    // Validate the row as it will be, not just the fields that were sent — a
    // cycle change and a day change are only invalid in combination.
    const invalid = validate(b, current.rows[0]);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (b.name !== undefined) add('name', String(b.name).trim());
    if (b.cycle !== undefined) add('cycle', b.cycle);
    if (b.startDay !== undefined) add('start_day', Number(b.startDay));
    if (b.endDay !== undefined) add('end_day', Number(b.endDay));
    if (b.processingDay !== undefined) add('processing_day', Number(b.processingDay));
    if (b.reportDay !== undefined) add('report_day', Number(b.reportDay));
    if (b.processEncashment !== undefined) add('process_encashment', !!b.processEncashment);
    if (b.pendingAction !== undefined) add('pending_action', b.pendingAction || null);
    if (b.convertAbsences !== undefined) add('convert_absences', !!b.convertAbsences);
    if (b.lockAfterProcessing !== undefined) add('lock_after_processing', !!b.lockAfterProcessing);
    if (b.applicableTo !== undefined) add('applicable_to', JSON.stringify(b.applicableTo || {}));
    if (b.isActive !== undefined) add('is_active', !!b.isActive);
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    // Any day change moves the derived cycle, so the cached columns move with it.
    const [startDate, endDate] = cycleColumns({ ...current.rows[0], ...b });
    add('start_date', startDate);
    add('end_date', endDate);

    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE pay_periods SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
      params
    );
    res.json({ success: true, data: decorate(r.rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pay period with that name already exists' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM pay_periods WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Pay period not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
