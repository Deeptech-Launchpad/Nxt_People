/**
 * routes/calendar-feed.js
 *
 * Leave and holidays as a calendar people can subscribe to.
 *
 * The setting this serves is titled "Google calendar and Microsoft 365
 * calendar integration". Full two-way integration means an OAuth application
 * per provider, per-user consent, token refresh and webhook handling — a
 * project, not a switch. What it delivers instead is an iCal feed: a private
 * URL each person adds once, which their calendar then polls. Same outcome for
 * the reader — leave and holidays appear alongside their meetings — without
 * either company's login flow. The settings card says so rather than implying
 * the full integration.
 *
 * The URL is the credential, because a subscription cannot carry a login:
 * calendars poll on their own schedule with no session and nobody to prompt.
 * So it is random, per employee, and revocable — see migrate_calendar_feed.js.
 *
 * Two feeds, deliberately separate:
 *
 *   /mine   the person's own leave plus company holidays. Private to them.
 *   /team   a manager's reportees. Only ever the FORMAT the admin chose, so an
 *           organisation that does not want names on a shared calendar can say
 *           so once and have it hold everywhere.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const logger = require('../logger');
const { protect } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { isManager, isFullAccess } = require('../utils/roles');

// How far either side of today a feed reaches. A calendar that carries three
// years of history is slow to poll and useless to read.
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// RFC 5545: escape the delimiters, and fold lines at 75 octets. Unfolded long
// lines are the usual reason a feed imports with truncated titles.
const esc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');
const fold = (line) => {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = Buffer.alloc(0);
  for (const ch of [...line]) {
    const b = Buffer.from(ch, 'utf8');
    if (cur.length + b.length > (out.length ? 74 : 75)) { out.push(cur.toString('utf8')); cur = Buffer.alloc(0); }
    cur = Buffer.concat([cur, b]);
  }
  out.push(cur.toString('utf8'));
  return out.join('\r\n ');
};

async function calendarConfig() {
  try {
    const r = await pool.query(`SELECT leave_additional_config AS c FROM settings LIMIT 1`);
    const c = r.rows[0]?.c?.calendarSync || {};
    return {
      format: Array.isArray(c.format) && c.format.length ? c.format : ['employee_name', 'leave_type'],
      updateEventStatusByType: !!c.updateEventStatusByType,
    };
  } catch (_) {
    return { format: ['employee_name', 'leave_type'], updateEventStatusByType: false };
  }
}

const TYPE_LABEL = {
  casual: 'Casual Leave', unpaid: 'Leave Without Pay',
  permission: 'Permission', comp_off: 'Compensatory Off',
  sick: 'Sick Leave', earned: 'Earned Leave',
};

/**
 * The event title, assembled from the parts the admin chose. 'none' is an
 * explicit choice meaning "say nothing about who or what", so it wins outright
 * rather than being one part among several — an organisation that picks it
 * wants a blocked-out day, not a blocked-out day labelled anyway.
 */
function titleFor(row, format) {
  if (format.includes('none')) return 'Leave';
  const parts = [];
  for (const key of format) {
    if (key === 'employee_id' && row.employeeCode) parts.push(row.employeeCode);
    if (key === 'employee_name' && row.name) parts.push(row.name);
    if (key === 'leave_policy_name' && row.policyName) parts.push(row.policyName);
    if (key === 'leave_type' && row.leaveType) parts.push(TYPE_LABEL[row.leaveType] || row.leaveType);
  }
  return parts.length ? parts.join(' — ') : 'Leave';
}

function buildIcs({ name, events }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NxtPeople//Leave Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    // Calendars poll on their own schedule; this is a hint, not a promise.
    'X-PUBLISHED-TTL:PT6H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];

  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    // All-day events: DTEND is exclusive in iCal, so a single day ends on the
    // following date. Getting this wrong shows every leave a day short.
    lines.push(`DTSTART;VALUE=DATE:${ymd(e.start)}`);
    lines.push(`DTEND;VALUE=DATE:${ymd(addDays(new Date(e.end), 1))}`);
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    lines.push(`TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function leaveEvents(employeeIds, cfg) {
  if (!employeeIds.length) return [];
  const from = ymd(addDays(new Date(), -PAST_DAYS)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const to = ymd(addDays(new Date(), FUTURE_DAYS)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

  const r = await pool.query(
    `SELECT l.id, l.leave_type AS "leaveType", l.start_date AS "startDate", l.end_date AS "endDate",
            l.is_half_day AS "isHalfDay", l.updated_at AS "updatedAt",
            e.employee_id AS "employeeCode", TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            lt.name AS "policyName"
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN leave_types lt ON lt.code = (CASE WHEN l.leave_type = 'comp_off' THEN 'compoff' ELSE l.leave_type END)
      WHERE l.employee_id = ANY($1::uuid[])
        AND l.status = 'approved'
        AND l.end_date >= $2::date AND l.start_date <= $3::date
      ORDER BY l.start_date`,
    [employeeIds, from, to]);

  return r.rows.map(row => ({
    // Stable per leave so an edit updates the existing event rather than
    // adding a second one beside it.
    uid: `leave-${row.id}@nxtpeople`,
    start: row.startDate,
    end: row.endDate,
    title: titleFor(row, cfg.format) + (row.isHalfDay ? ' (half day)' : ''),
    description: `${row.name} — ${TYPE_LABEL[row.leaveType] || row.leaveType}`,
    // "Update event status by leave type": unpaid leave and permission leave
    // people free rather than blocking the day, which is what a colleague
    // looking for a meeting slot actually wants to know.
    busy: cfg.updateEventStatusByType
      ? !['unpaid', 'permission'].includes(row.leaveType)
      : true,
  }));
}

async function holidayEvents() {
  const from = ymd(addDays(new Date(), -PAST_DAYS)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const to = ymd(addDays(new Date(), FUTURE_DAYS)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const r = await pool.query(
    `SELECT id, name, date, type FROM holidays
      WHERE date BETWEEN $1::date AND $2::date ORDER BY date`, [from, to])
    .catch(() => ({ rows: [] }));

  return r.rows
    // A 'working_day' row is an override saying the office IS open. Putting it
    // on a calendar as a holiday would say the opposite.
    .filter(h => h.type !== 'working_day')
    .map(h => ({
      uid: `holiday-${h.id}@nxtpeople`,
      start: h.date, end: h.date,
      title: h.name,
      description: h.type === 'optional' ? 'Optional holiday' : 'Company holiday',
      busy: false,
    }));
}

// ── The feed itself. No session: the token in the path is the credential. ───
router.get('/:token.ics', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    // Length-checked before it reaches the database, so a short or absent
    // token cannot become a query at all.
    if (token.length < 32) return res.status(404).send('Not found');

    const owner = (await pool.query(
      `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name, role
         FROM employees
        WHERE calendar_token = $1 AND status = 'active' AND deleted_at IS NULL`, [token])).rows[0];
    if (!owner) return res.status(404).send('Not found');

    const scope = req.query.scope === 'team' ? 'team' : 'mine';
    const cfg = await calendarConfig();

    let ids = [owner.id];
    if (scope === 'team') {
      if (!isManager(owner.role) && !isFullAccess(owner.role)) {
        return res.status(404).send('Not found');
      }
      const team = await pool.query(
        `SELECT id FROM employees
          WHERE status = 'active' AND deleted_at IS NULL AND is_user = TRUE
            AND ($2::boolean OR reporting_manager_id = $1)`,
        [owner.id, isFullAccess(owner.role)]);
      ids = team.rows.map(x => x.id);
    }

    const events = [...(await leaveEvents(ids, cfg)), ...(await holidayEvents())];
    const ics = buildIcs({
      name: scope === 'team' ? `NxtPeople — team leave` : `NxtPeople — ${owner.name}`,
      events,
    });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="nxtpeople-${scope}.ics"`);
    // Never cached by a proxy: the URL is a credential and the content is
    // personal.
    res.set('Cache-Control', 'private, max-age=0, no-store');
    res.send(ics);
  } catch (err) {
    logger.error({ err: err.message }, '[calendar-feed] failed');
    res.status(500).send('Calendar unavailable');
  }
});

// ── Managing your own subscription. These do need a session. ───────────────
router.get('/', protect, async (req, res) => {
  try {
    const me = (await pool.query(
      `SELECT calendar_token AS token, calendar_token_issued_at AS "issuedAt", role
         FROM employees WHERE id = $1`, [req.user._id])).rows[0];
    const base = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
    res.json({
      success: true,
      data: {
        enabled: !!me?.token,
        issuedAt: me?.issuedAt || null,
        url: me?.token ? `${base}/api/calendar/${me.token}.ics` : null,
        teamUrl: me?.token && (isManager(me.role) || isFullAccess(me.role))
          ? `${base}/api/calendar/${me.token}.ics?scope=team` : null,
      },
    });
  } catch (err) { serverError(res, err, 'calendar feed status'); }
});

// Issue or re-issue. Re-issuing deliberately breaks the previous URL — that is
// what somebody who has shared it by mistake needs it to do.
router.post('/', protect, async (req, res) => {
  try {
    const token = crypto.randomBytes(24).toString('base64url');
    await pool.query(
      `UPDATE employees SET calendar_token = $2, calendar_token_issued_at = NOW() WHERE id = $1`,
      [req.user._id, token]);
    const base = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
    res.json({ success: true, data: { url: `${base}/api/calendar/${token}.ics` } });
  } catch (err) { serverError(res, err, 'issue calendar feed'); }
});

router.delete('/', protect, async (req, res) => {
  try {
    await pool.query(
      `UPDATE employees SET calendar_token = NULL, calendar_token_issued_at = NULL WHERE id = $1`,
      [req.user._id]);
    res.json({ success: true, message: 'Calendar subscription turned off' });
  } catch (err) { serverError(res, err, 'revoke calendar feed'); }
});

module.exports = router;
