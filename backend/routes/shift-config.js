/**
 * routes/shift-config.js
 * Settings → Shifts → Configuration → General.
 *
 * Most of this screen is stored and not yet applied, and says so on its face.
 * The exception is the default work shift, which is the reason the screen is
 * worth having: it decides which shift a new employee starts on, and therefore
 * their expected hours and when they count as late.
 *
 * The default lives on shifts.is_default rather than in the blob — there is one
 * answer to "which shift is the default", and keeping a second copy in settings
 * is how the two end up disagreeing.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { invalidate } = require('../utils/shiftConfig');
const { serverError } = require('../utils/serverError');

router.use(protect);

const bool = v => !!v;

const hhmm = (v, label) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? '').trim());
  if (!m) throw new Error(`${label} must be in HH:mm form`);
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
};

const pair = src => ({ manager: bool(src?.manager), employee: bool(src?.employee) });

function clean(b) {
  const p = b.mappingPermissions || {};
  const notify = b.notifyOnShiftChange || {};
  const allowance = b.shiftAllowance || {};
  const allowanceOn = bool(allowance.enabled);
  return {
    mappingPermissions: {
      view: pair(p.view),
      edit: pair(p.edit),
      editPastWithinPayPeriod: pair(p.editPastWithinPayPeriod),
      editPastWithinCalendarYear: pair(p.editPastWithinCalendarYear),
    },
    allowViewDepartmentSchedules: bool(b.allowViewDepartmentSchedules),
    reasonMandatoryOnShiftChange: bool(b.reasonMandatoryOnShiftChange),
    notifyOnShiftChange: { email: bool(notify.email), feeds: bool(notify.feeds) },
    shiftAllowance: {
      enabled: allowanceOn,
      minimumHours: allowanceOn ? hhmm(allowance.minimumHours || '04:00', 'Minimum hours') : '04:00',
    },
    // Auto shift assignment. Off by default, and it only ever decides today's
    // shift for a check-in that has no rostered one — the reference says the
    // same: current date entries only, without impacting past data.
    autoShiftAssignment: { enabled: bool(b.autoShiftAssignment?.enabled) },
  };
}

router.get('/general', async (req, res) => {
  try {
    const [cfg, shifts] = await Promise.all([
      pool.query(`SELECT shift_config AS c FROM settings LIMIT 1`),
      pool.query(
        `SELECT id, name, start_time AS "startTime", end_time AS "endTime", is_default AS "isDefault"
           FROM shifts ORDER BY name`
      ),
    ]);
    res.json({
      success: true,
      data: {
        ...(cfg.rows[0]?.c || {}),
        shifts: shifts.rows,
        defaultShiftId: shifts.rows.find(s => s.isDefault)?.id || null,
      },
    });
  } catch (err) {
    serverError(res, err);
  }
});

router.patch('/general', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const body = req.body || {};
  let config;
  try { config = clean(body); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (body.defaultShiftId) {
      const exists = await client.query(`SELECT 1 FROM shifts WHERE id = $1`, [body.defaultShiftId]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'That shift no longer exists' });
      }
      // Set in one statement so there is never a moment with no default, or two.
      await client.query(`UPDATE shifts SET is_default = (id = $1), updated_at = NOW()`, [body.defaultShiftId]);
    }

    await client.query(
      `UPDATE settings SET shift_config = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify(config)]
    );
    await client.query('COMMIT');
    invalidate();

    const shifts = await pool.query(
      `SELECT id, name, start_time AS "startTime", end_time AS "endTime", is_default AS "isDefault"
         FROM shifts ORDER BY name`
    );
    res.json({
      success: true,
      data: { ...config, shifts: shifts.rows, defaultShiftId: shifts.rows.find(s => s.isDefault)?.id || null },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally { client.release(); }
});

module.exports = router;
