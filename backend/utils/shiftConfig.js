/**
 * utils/shiftConfig.js
 *
 * One reader for Shifts → General, shared by every route that has to obey it.
 * Same shape as utils/attendanceConfig.js: a short cache, a permissive
 * fallback, and a generation counter bumped on save so a change takes effect
 * while the admin is still looking at the screen.
 *
 * The fallback matters more here than it looks. These settings gate who may
 * change a shift and whether a reason is required; if the column is missing or
 * the database blinks, the safe answer is the behaviour that existed before
 * the setting did — permissive — rather than locking people out of their own
 * shift requests.
 */
const pool = require('../db');

const TTL_MS = 30_000;
let cache = null;      // { value, at }
let generation = 0;

const FALLBACK = {
  mappingPermissions: {
    view: { manager: true, employee: true },
    edit: { manager: false, employee: false },
    editPastWithinPayPeriod: { manager: false, employee: false },
    editPastWithinCalendarYear: { manager: false, employee: false },
  },
  allowViewDepartmentSchedules: false,
  reasonMandatoryOnShiftChange: false,
  notifyOnShiftChange: { email: false, feeds: false },
  shiftAllowance: { enabled: false, minimumHours: '04:00' },
  autoShiftAssignment: { enabled: false },
};

async function shiftConfig() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let value = FALLBACK;
  try {
    const r = await pool.query(`SELECT shift_config AS c FROM settings LIMIT 1`);
    // A merge rather than a replace, so a blob written before a later key was
    // added does not read that key as undefined at the call site.
    if (r.rows[0]?.c) value = { ...FALLBACK, ...r.rows[0].c };
  } catch (_) {
    // Column missing or database briefly away — the fallback stands.
  }
  cache = { value, at: Date.now() };
  return value;
}

const invalidate = () => { cache = null; generation += 1; };
const currentGeneration = () => generation;

/**
 * Minimum hours as a number, for the payroll allowance test. Stored as HH:mm
 * because that is how the screen asks for it.
 */
function minimumAllowanceHours(cfg) {
  const raw = cfg?.shiftAllowance?.minimumHours || '04:00';
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(raw).trim());
  if (!m) return 4;
  return Number(m[1]) + Number(m[2]) / 60;
}

/**
 * May this person change somebody's shift mapping?
 *
 * `relation` is 'self' when the subject is the actor, 'manager' when the actor
 * is the subject's reporting manager, and null otherwise. Full access (HR and
 * above) is decided by the caller and short-circuits before this is asked.
 */
function mayEditMapping(cfg, relation, { past = false, withinPayPeriod = false } = {}) {
  const perms = cfg?.mappingPermissions || FALLBACK.mappingPermissions;
  const column = relation === 'self' ? 'employee' : relation === 'manager' ? 'manager' : null;
  if (!column) return false;

  if (!perms.edit?.[column]) return false;
  if (!past) return true;

  // A past date needs its own permission on top, and the two windows are
  // different rows: inside the current pay period is a narrower allowance than
  // anywhere in the calendar year.
  return withinPayPeriod
    ? !!perms.editPastWithinPayPeriod?.[column]
    : !!perms.editPastWithinCalendarYear?.[column];
}

function mayViewMapping(cfg, relation) {
  const perms = cfg?.mappingPermissions || FALLBACK.mappingPermissions;
  const column = relation === 'self' ? 'employee' : relation === 'manager' ? 'manager' : null;
  return column ? !!perms.view?.[column] : false;
}

module.exports = {
  shiftConfig, invalidate, currentGeneration,
  minimumAllowanceHours, mayEditMapping, mayViewMapping,
  FALLBACK,
};
