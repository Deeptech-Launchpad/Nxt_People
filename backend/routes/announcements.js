const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const logger = require('../logger');
const { serverError } = require('../utils/serverError');
const { requireFunction, allows, optionsFor } = require('../utils/functionAccess');
const { sendMail, renderTemplateEmail } = require('../utils/mailer');

router.use(protect);

// Optional image on an announcement — same allowlist-and-random-filename
// discipline as the cover image upload (routes/cover-image.js): the
// extension written to disk comes from the allowlist, never from the
// uploaded name, and the stored filename is unguessable.
const ANNOUNCEMENT_IMAGE_MAX_MB = 8;
const announcementsDir = path.join(__dirname, '..', 'uploads', 'announcements');
if (!fs.existsSync(announcementsDir)) fs.mkdirSync(announcementsDir, { recursive: true });
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, announcementsDir),
    filename: (req, file, cb) => {
      const raw = path.extname(file.originalname).toLowerCase();
      const ext = ALLOWED_IMAGE_EXTS.has(raw) ? raw : '.jpg';
      cb(null, `${req.user._id}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: ANNOUNCEMENT_IMAGE_MAX_MB * 1024 * 1024 },
  // cb(null, false) would silently drop a rejected file instead of erroring —
  // the announcement would then just post without an image and no one would
  // know their upload was ignored. An Error here instead propagates to
  // handleImageUpload's `err` branch below, which reports it cleanly.
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_EXTS.has(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('INVALID_IMAGE_TYPE'));
    }
    cb(null, true);
  },
});

// Wraps multer so a rejected file (bad type / too large) comes back as a
// clean 4xx with a message the toast can show, instead of a generic 500.
function handleImageUpload(req, res, next) {
  imageUpload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: err.code === 'LIMIT_FILE_SIZE'
          ? `That image is larger than ${ANNOUNCEMENT_IMAGE_MAX_MB}MB` : 'That file could not be accepted',
      });
    }
    if (err) return res.status(400).json({ success: false, message: 'Only JPG, PNG or WEBP images are allowed' });
    next();
  });
}

const isAnnouncementUpload = (v) => typeof v === 'string' && v.startsWith('/uploads/announcements/');
const deleteAnnouncementImage = (url) => {
  if (!isAnnouncementUpload(url)) return;
  fs.unlink(path.join(announcementsDir, path.basename(url)), () => {});
};

// Shared projection — every read endpoint returns the same shape.
// Note: `isPinned` is `is_pinned`, NOT `is_active`. They used to be conflated;
// HR can now unpin an announcement (loses badge) without deactivating it
// (still visible in the feed).
const SELECT_FIELDS = `
  a.id              AS "_id",
  a.title           AS title,
  a.content         AS body,
  a.priority        AS type,
  a.is_pinned       AS "isPinned",
  a.pinned_until    AS "pinnedUntil",
  a.expires_at      AS "expiresAt",
  a.image_url       AS "imageUrl",
  a.created_at      AS "createdAt",
  json_build_object(
    'id',        e.id,
    'firstName', e.first_name,
    'lastName',  e.last_name,
    'role',      e.role,
    'photoUrl',  e.photo_url
  ) AS "postedBy"
`;

// GET /api/announcements/active — announcements that are still live for the
// current user. Returns at most 5 rows, prioritising urgent → unread → recent.
// Each row carries an `isRead` flag so the UI can highlight new items.
/* The Add / Edit / Delete checkbox beside Announcements. The role guard stays:
 * this narrows who may write, it never widens it. */
const canManage = async (req, res, next) => {
  try {
    if ((await allows(req, 'announcements')) && (await optionsFor(req, 'announcements')).manage) return next();
    return res.status(403).json({
      success: false,
      code: 'FUNCTION_NOT_ALLOWED',
      functionKey: 'announcements',
      message: 'Add / Edit / Delete for Announcements is switched off for your role under Function Based Permissions.',
    });
  } catch (err) { next(err); }
};

router.get('/active', requireFunction('announcements'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS},
              (ar.employee_id IS NOT NULL) AS "isRead"
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       LEFT JOIN announcement_reads ar
         ON ar.announcement_id = a.id AND ar.employee_id = $1
       WHERE a.is_active = true
         AND a.is_pinned  = true
         AND (a.expires_at IS NULL OR a.expires_at > NOW())
       ORDER BY (a.priority = 'urgent') DESC,
                (ar.employee_id IS NULL) DESC,
                a.created_at DESC
       LIMIT 5`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/announcements/:id/read — mark an announcement as seen by the caller.
router.post('/:id/read', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO announcement_reads (employee_id, announcement_id)
       VALUES ($1, $2)
       ON CONFLICT (employee_id, announcement_id) DO NOTHING`,
      [req.user._id, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/announcements — all active announcements (pinned first).
router.get('/', requireFunction('announcements'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       WHERE a.is_active = true
         AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
       ORDER BY a.is_pinned DESC, a.created_at DESC
       LIMIT 30`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/announcements — create announcement (admin only)
// multipart/form-data when an image is attached, same as every other plain
// field either way: handleImageUpload only ever populates req.file, and
// still parses req.body normally when the request has no file at all.
router.post('/', authorize('admin', 'director', 'hr_admin'), canManage, handleImageUpload, async (req, res) => {
  try {
    const { title, body, type = 'general', pinnedUntil, expiresAt } = req.body;
    // multipart fields arrive as strings ('true'/'false'), not booleans.
    const isPinned = req.body.isPinned === undefined ? true : req.body.isPinned === true || req.body.isPinned === 'true';
    if (!title || !body) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }

    // pinnedUntil only makes sense when the announcement is actually pinned.
    const pinExpiry = isPinned ? (pinnedUntil || null) : null;
    const imageUrl = req.file ? `/uploads/announcements/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO announcements
         (title, content, body, priority, type, is_active, is_pinned, pinned_until, expires_at, image_url, created_by, posted_by)
       VALUES ($1, $2, $2, $3, $3, TRUE, $4, $5, $6, $7, $8, $8)
       RETURNING id AS "_id", title, content AS body, priority AS type,
                 is_pinned AS "isPinned", pinned_until AS "pinnedUntil",
                 expires_at AS "expiresAt", image_url AS "imageUrl", created_at AS "createdAt"`,
      [title, body, type, isPinned, pinExpiry, expiresAt || null, imageUrl, req.user._id]
    );

    // Notify every other active employee in a single set-based INSERT.
    // Previous code looped and made N round-trips — at 200+ employees the
    // request would block for seconds. INSERT ... SELECT scales O(1) round-
    // trips regardless of headcount. Logger.warn on failure so a notif
    // glitch doesn't roll back the announcement itself.
    try {
      await pool.query(
        /* The link carries the announcement's own id. It used to be the bare
         * '/', so clicking the notification dropped you on the home page —
         * which is usually the page you were already on, making the whole
         * notification look inert. `?open=` is what the Announcements page
         * reads to open that announcement straight away. */
        `INSERT INTO notifications (employee_id, type, title, message, link)
         SELECT id, 'announcement', $1, $2, $4
           FROM employees
          WHERE status = 'active' AND id != $3`,
        ['New Announcement', title, req.user._id, `/announcements?open=${result.rows[0]._id}`]
      );
    } catch (err) {
      logger.warn({ err: err.message }, '[announcements] bulk notification insert failed');
    }

    // Email every other active employee. Fire-and-forget: headcount has no
    // realistic upper bound and each send is a real SMTP round-trip, so
    // awaiting this would make the admin's "post announcement" click hang —
    // same reasoning as the notification insert above, just one level slower.
    const announcementId = result.rows[0]._id;
    (async () => {
      try {
        const recipients = await pool.query(
          `SELECT email, first_name AS "firstName" FROM employees
            WHERE status = 'active' AND id != $1 AND email IS NOT NULL AND email <> ''`,
          [req.user._id]
        );
        const link = `${process.env.FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech'}/announcements?open=${announcementId}`;
        for (const r of recipients.rows) {
          try {
            await sendMail({
              to: r.email,
              subject: title,
              text: body,
              html: renderTemplateEmail({ title, bodyText: body, linkLabel: 'View Announcement', linkUrl: link }),
            });
          } catch (err) {
            logger.warn({ err: err.message, to: r.email }, '[announcements] email failed for one recipient');
          }
        }
      } catch (err) {
        logger.warn({ err: err.message }, '[announcements] bulk email send failed');
      }
    })();

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    serverError(res, err);
  }
});

// PUT /api/announcements/:id — update an announcement (admin only).
// Each of title/body/type/isActive/isPinned/pinnedUntil/expiresAt is optional;
// omitted fields keep their current value (COALESCE). Same for the image:
// a new file replaces it, `removeImage: true` clears it, neither leaves it
// exactly as it was — handleImageUpload makes this multipart-capable without
// changing how the non-file fields already behaved.
router.put('/:id', authorize('admin', 'director', 'hr_admin'), canManage, handleImageUpload, async (req, res) => {
  try {
    const { title, body, type, pinnedUntil, expiresAt } = req.body;
    /* A plain COALESCE cannot tell "leave this alone" from "clear it": both
     * arrive as null. That made the two dates one-way — unpinning sent
     * pinnedUntil: null and the old date stayed, so the nightly unpin cron
     * could re-fire on an announcement nobody had pinned. Sending the key at
     * all now means "set it to exactly this", including null. */
    const sent = k => Object.prototype.hasOwnProperty.call(req.body, k);
    // multipart fields arrive as strings ('true'/'false'), not booleans —
    // same conversion POST / needs for isPinned.
    const boolOrNull = (key) => sent(key) ? (req.body[key] === true || req.body[key] === 'true') : null;
    const isActive = boolOrNull('isActive');
    const isPinned = boolOrNull('isPinned');
    const removeImage = req.body.removeImage === true || req.body.removeImage === 'true';

    // undefined = leave the image exactly as it is; null = clear it; a
    // string = replace it with this new upload.
    let imageUrlUpdate;
    if (req.file) imageUrlUpdate = `/uploads/announcements/${req.file.filename}`;
    else if (removeImage) imageUrlUpdate = null;

    let priorImageUrl = null;
    if (imageUrlUpdate !== undefined) {
      const prior = await pool.query(`SELECT image_url FROM announcements WHERE id = $1`, [req.params.id]);
      priorImageUrl = prior.rows[0]?.image_url || null;
    }

    const result = await pool.query(
      `UPDATE announcements
         SET title        = COALESCE($1, title),
             content      = COALESCE($2, content),
             body         = COALESCE($2, body),
             priority     = COALESCE($3, priority),
             type         = COALESCE($3, type),
             is_active    = COALESCE($4, is_active),
             is_pinned    = COALESCE($5, is_pinned),
             pinned_until = CASE WHEN $6::boolean THEN $7::timestamptz ELSE pinned_until END,
             expires_at   = CASE WHEN $8::boolean THEN $9::date        ELSE expires_at   END,
             image_url    = CASE WHEN $10::boolean THEN $11::varchar   ELSE image_url    END,
             updated_at   = NOW()
       WHERE id = $12
       RETURNING id AS "_id", title, content AS body, priority AS type,
                 is_active AS "isActive", is_pinned AS "isPinned",
                 pinned_until AS "pinnedUntil", expires_at AS "expiresAt",
                 image_url AS "imageUrl", created_at AS "createdAt"`,
      [
        title  || null,
        body   || null,
        type   || null,
        isActive,
        isPinned,
        sent('pinnedUntil'), pinnedUntil || null,
        sent('expiresAt'),   expiresAt   || null,
        imageUrlUpdate !== undefined, imageUrlUpdate || null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    // The image it replaces (or clears) is no longer reachable, so its file
    // is removed rather than left behind — same reasoning as cover-image.js.
    if (imageUrlUpdate !== undefined && priorImageUrl && priorImageUrl !== imageUrlUpdate) {
      deleteAnnouncementImage(priorImageUrl);
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    serverError(res, err);
  }
});

// DELETE /api/announcements/:id — delete (admin only)
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), canManage, async (req, res) => {
  try {
    const prior = await pool.query('SELECT image_url FROM announcements WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    if (prior.rows[0]?.image_url) deleteAnnouncementImage(prior.rows[0].image_url);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
