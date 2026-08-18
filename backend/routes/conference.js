/**
 * routes/conference.js — Conference hall booking (Operations → Conference)
 *
 * Book a hall (Floor 1 / Floor 2) for a date + time window. Overlap is
 * prevented per hall: two bookings on the SAME hall+date may not overlap in
 * time; different halls may be booked at the same time. Past dates/times are
 * rejected. All data lives in conference_bookings — nothing hardcoded.
 */
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { DEFAULT_TZ } = require('../utils/timezone');
const { serverError } = require('../utils/serverError');

router.use(protect);

const HALLS = ['Floor 1', 'Floor 2'];

// "Now" in the app's default timezone, regardless of the DB/server TZ,
// so the past-date / past-time guard matches what users see.
async function nowIst() {
  const r = await pool.query(
    `SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE '${DEFAULT_TZ}', 'YYYY-MM-DD') AS d,
            to_char(CURRENT_TIMESTAMP AT TIME ZONE '${DEFAULT_TZ}', 'HH24:MI')    AS t`
  );
  return { date: r.rows[0].d, time: r.rows[0].t };
}

// Is there a clashing booking on the same hall+date? (excludes a given id on edit)
async function hasOverlap({ hall, date, start, end, excludeId }) {
  const params = [hall, date, start, end];
  let sql = `SELECT 1 FROM conference_bookings
              WHERE hall = $1 AND booking_date = $2 AND status = 'booked'
                AND start_time < $4::time AND end_time > $3::time`;
  if (excludeId) { sql += ` AND id <> $5`; params.push(excludeId); }
  const r = await pool.query(sql + ' LIMIT 1', params);
  return r.rows.length > 0;
}

// Shared input validation. Returns an error string, or null if OK.
async function validateBooking({ hall, bookingDate, startTime, endTime }) {
  if (!HALLS.includes(hall)) return 'Please choose a valid conference hall.';
  if (!bookingDate || !startTime || !endTime) return 'Date, start time and end time are required.';
  if (endTime <= startTime) return 'End time must be after the start time.';
  const now = await nowIst();
  if (bookingDate < now.date) return 'You cannot book a hall for a past date.';
  if (bookingDate === now.date && startTime < now.time) return 'You cannot book a hall for a time that has already passed.';
  return null;
}

// ── GET /api/conference?date=YYYY-MM-DD ─ bookings for a day (default today) ──
router.get('/', async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
      ? req.query.date
      : (await nowIst()).date;
    const r = await pool.query(
      `SELECT c.id as "_id", c.title, c.booking_date as "bookingDate",
              to_char(c.start_time, 'HH24:MI') as "startTime",
              to_char(c.end_time, 'HH24:MI')   as "endTime",
              c.hall, c.description, c.status, c.booked_by as "bookedById",
              c.booked_for as "bookedFor",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) as "bookedBy",
              e.employee_id as "bookedByEmpId"
         FROM conference_bookings c
         LEFT JOIN employees e ON c.booked_by = e.id
        WHERE c.booking_date = $1
        ORDER BY c.hall ASC, c.start_time ASC`,
      [date]
    );
    res.json({ success: true, data: r.rows, date, halls: HALLS });
  } catch (err) {
    serverError(res, err);
  }
});

// ── POST /api/conference ─ create a booking ──────────────────────────────────
router.post('/', [
  body('title').isString().trim().isLength({ min: 1, max: 255 }).withMessage('Meeting purpose is required'),
  body('bookingDate').isISO8601().withMessage('Valid booking date is required'),
  body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid start time is required'),
  body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('Valid end time is required'),
  body('hall').isString().trim().notEmpty(),
  body('description').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  body('bookedFor').optional({ nullable: true }).isString().isLength({ max: 255 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });
  try {
    const { title, bookingDate, startTime, endTime, hall, description, bookedFor } = req.body;
    const vErr = await validateBooking({ hall, bookingDate, startTime, endTime });
    if (vErr) return res.status(400).json({ success: false, message: vErr });

    if (await hasOverlap({ hall, date: bookingDate, start: startTime, end: endTime })) {
      return res.status(409).json({ success: false, message: 'This conference hall is already booked for the selected time. Please choose another time.' });
    }

    const r = await pool.query(
      `INSERT INTO conference_bookings (title, booking_date, start_time, end_time, hall, description, booked_by, booked_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id as "_id"`,
      [title, bookingDate, startTime, endTime, hall, description || null, req.user._id,
       (bookedFor && bookedFor.trim()) ? bookedFor.trim() : null]
    );
    res.status(201).json({ success: true, data: { _id: r.rows[0]._id }, message: 'Conference hall booked.' });
  } catch (err) {
    serverError(res, err);
  }
});

// ── PUT /api/conference/:id ─ edit a booking (revalidates conflicts) ─────────
router.put('/:id', async (req, res) => {
  try {
    const cur = await pool.query(`SELECT * FROM conference_bookings WHERE id = $1`, [req.params.id]);
    const booking = cur.rows[0];
    if (!booking || booking.status !== 'booked') return res.status(404).json({ success: false, message: 'Booking not found.' });
    // Only the person who booked it, or HR / Super Admin, may edit.
    if (String(booking.booked_by) !== String(req.user._id) && !isFullAccess(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own bookings.' });
    }

    const title       = req.body.title ?? booking.title;
    const hall        = req.body.hall ?? booking.hall;
    const bookingDate = req.body.bookingDate ?? booking.booking_date;
    const startTime   = req.body.startTime ?? String(booking.start_time).slice(0, 5);
    const endTime     = req.body.endTime ?? String(booking.end_time).slice(0, 5);
    const description  = req.body.description ?? booking.description;
    // booked_for: when the key is present, normalise (blank → NULL); otherwise keep existing.
    const bookedFor = ('bookedFor' in req.body)
      ? ((req.body.bookedFor && String(req.body.bookedFor).trim()) ? String(req.body.bookedFor).trim() : null)
      : booking.booked_for;

    const vErr = await validateBooking({ hall, bookingDate, startTime, endTime });
    if (vErr) return res.status(400).json({ success: false, message: vErr });

    if (await hasOverlap({ hall, date: bookingDate, start: startTime, end: endTime, excludeId: booking.id })) {
      return res.status(409).json({ success: false, message: 'This conference hall is already booked for the selected time. Please choose another time.' });
    }

    await pool.query(
      `UPDATE conference_bookings
          SET title=$1, booking_date=$2, start_time=$3, end_time=$4, hall=$5, description=$6, booked_for=$7, updated_at=NOW()
        WHERE id=$8`,
      [title, bookingDate, startTime, endTime, hall, description || null, bookedFor, booking.id]
    );
    res.json({ success: true, message: 'Booking updated.' });
  } catch (err) {
    serverError(res, err);
  }
});

// ── DELETE /api/conference/:id ─ cancel/remove (frees the slot immediately) ──
router.delete('/:id', async (req, res) => {
  try {
    const cur = await pool.query(`SELECT booked_by, status FROM conference_bookings WHERE id = $1`, [req.params.id]);
    const booking = cur.rows[0];
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (String(booking.booked_by) !== String(req.user._id) && !isFullAccess(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own bookings.' });
    }
    // Mark cancelled — keeps the record but frees the slot (the overlap check
    // and schedule only consider status='booked').
    await pool.query(`UPDATE conference_bookings SET status='cancelled', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Booking cancelled.' });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
