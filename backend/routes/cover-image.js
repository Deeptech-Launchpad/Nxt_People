/* ── The banner on My Space ────────────────────────────────────────────────
 *  Organization Policy has carried two switches over this — may employees pick
 *  from the system options, and may they upload their own — with nothing to
 *  govern, because there was nowhere to set a cover. The banner was hardcoded
 *  to an image fetched from a third-party host on every dashboard load.
 *
 *  The switches decide, and they decide on the write rather than only on the
 *  screen: with uploads off, the upload route refuses; with system options off,
 *  a preset cannot be chosen. Turning one off does not erase what people
 *  already picked — it stops them changing it, which is what the wording says.
 *
 *  Presets are gradients defined here rather than photographs. Shipping stock
 *  images would mean binary assets in the repository and a licence question
 *  nobody asked for; a gradient needs neither and cannot fail to load.
 * ────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { logAudit } = require('../utils/audit');
const logger = require('../logger');

router.use(protect);

const COVER_MAX_MB = 8;

// Named so the key alone is readable in the database: "preset:dusk" says more
// than an index would when somebody is looking at a row six months from now.
const PRESETS = {
  dusk:    'linear-gradient(135deg, #1e3a5f 0%, #4a5f8a 55%, #8fa3c4 100%)',
  forest:  'linear-gradient(135deg, #14342b 0%, #2f6b4f 55%, #7fae8c 100%)',
  ember:   'linear-gradient(135deg, #5c1f14 0%, #a34a2a 55%, #e0a06a 100%)',
  slate:   'linear-gradient(135deg, #23262d 0%, #454a55 55%, #8a919e 100%)',
  tide:    'linear-gradient(135deg, #0f3d47 0%, #1f7a86 55%, #7fc4c9 100%)',
  plum:    'linear-gradient(135deg, #3b1b3f 0%, #6f3568 55%, #b18bab 100%)',
};
const PRESET_KEYS = Object.keys(PRESETS);

const coversDir = path.join(__dirname, '..', 'uploads', 'covers');
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

// The same allowlist discipline the profile photo upload uses: the extension
// written to disk comes from the allowlist, never from the uploaded name, so
// "banner.jpg.php" cannot land as .php however a future proxy is configured.
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, coversDir),
    filename: (req, file, cb) => {
      const raw = path.extname(file.originalname).toLowerCase();
      const ext = ALLOWED.has(raw) ? raw : '.jpg';
      cb(null, `${req.user._id}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: COVER_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(path.extname(file.originalname).toLowerCase())),
});

async function coverPolicy() {
  try {
    const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
    const c = (r.rows[0]?.c || {}).coverImage || {};
    return {
      allowSystemOptions: c.allowSystemOptions === true,
      allowCustomUpload: c.allowCustomUpload === true,
      orgCover: c.orgImageUrl || null,
    };
  } catch {
    return { allowSystemOptions: false, allowCustomUpload: false, orgCover: null };
  }
}

const isPreset = v => typeof v === 'string' && v.startsWith('preset:') && PRESET_KEYS.includes(v.slice(7));
const isUpload = v => typeof v === 'string' && v.startsWith('/uploads/covers/');

/** What to render, and what the viewer is allowed to change. */
router.get('/', async (req, res) => {
  try {
    const [me, policy] = await Promise.all([
      pool.query(`SELECT cover_image_url AS cover FROM employees WHERE id = $1`, [req.user._id]),
      coverPolicy(),
    ]);
    const own = me.rows[0]?.cover || null;
    res.json({
      success: true,
      data: {
        // Null means "not chosen", so the organization's cover answers for
        // them. Writing the org cover into everybody's row instead would
        // freeze it the day it was set.
        cover: own || policy.orgCover || 'preset:dusk',
        own,
        orgCover: policy.orgCover || null,
        allowSystemOptions: policy.allowSystemOptions,
        allowCustomUpload: policy.allowCustomUpload,
        presets: PRESETS,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

/** Choose a preset, or clear back to the organization's cover. */
router.put('/', async (req, res) => {
  try {
    const { cover } = req.body || {};
    const policy = await coverPolicy();

    if (cover === null || cover === '') {
      await pool.query(`UPDATE employees SET cover_image_url = NULL WHERE id = $1`, [req.user._id]);
      return res.json({ success: true, message: 'Using the organization cover' });
    }
    if (!isPreset(cover)) {
      return res.status(400).json({ success: false, message: 'That is not one of the available covers' });
    }
    if (!policy.allowSystemOptions) {
      return res.status(403).json({
        success: false,
        message: 'Choosing a cover is switched off for this organization',
      });
    }
    await pool.query(`UPDATE employees SET cover_image_url = $1 WHERE id = $2`, [cover, req.user._id]);
    res.json({ success: true, message: 'Cover updated', data: { cover } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

/** Upload one. */
router.post('/upload', (req, res) => {
  upload.single('cover')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: err.code === 'LIMIT_FILE_SIZE'
          ? `That image is larger than ${COVER_MAX_MB}MB` : 'That file could not be accepted',
      });
    }
    if (err) return res.status(400).json({ success: false, message: 'That file could not be accepted' });

    try {
      const policy = await coverPolicy();
      if (!policy.allowCustomUpload) {
        // Delete what multer already wrote: refusing the request while leaving
        // the file on disk is how an upload directory quietly fills up.
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({
          success: false,
          message: 'Uploading your own cover is switched off for this organization',
        });
      }
      if (!req.file) return res.status(400).json({ success: false, message: 'No image was sent' });

      const url = `/uploads/covers/${req.file.filename}`;
      const prior = (await pool.query(
        `SELECT cover_image_url AS cover FROM employees WHERE id = $1`, [req.user._id])).rows[0]?.cover;

      await pool.query(`UPDATE employees SET cover_image_url = $1 WHERE id = $2`, [url, req.user._id]);

      // The one it replaces is no longer reachable, so it is removed rather
      // than left behind. Presets have no file.
      if (isUpload(prior) && prior !== url) {
        fs.unlink(path.join(coversDir, path.basename(prior)), () => {});
      }
      res.json({ success: true, message: 'Cover updated', data: { cover: url } });
    } catch (e) {
      if (req.file) fs.unlink(req.file.path, () => {});
      logger.error({ err: e.message }, '[cover-image] upload failed');
      res.status(500).json({ success: false, message: 'An internal server error occurred' });
    }
  });
});

/** The organization's own cover, which everybody who has not chosen one sees. */
router.put('/org', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { cover } = req.body || {};
    if (cover !== null && cover !== '' && !isPreset(cover) && !isUpload(cover)) {
      return res.status(400).json({ success: false, message: 'That is not one of the available covers' });
    }
    const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
    const cfg = r.rows[0]?.c || {};
    const before = (cfg.coverImage || {}).orgImageUrl || null;
    const next = { ...cfg, coverImage: { ...(cfg.coverImage || {}), orgImageUrl: cover || null } };

    await pool.query(
      `UPDATE settings SET organization_policy_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify(next)]);

    if (before !== (cover || null)) {
      await logAudit(req, {
        action: 'UPDATE', resource: 'Organization policy', resourceId: 'coverImage',
        changes: { section: 'coverImage', summary: 'organization cover image',
                   fields: [{ field: 'coverImage.orgImageUrl', from: before, to: cover || null }] },
      });
    }
    res.json({ success: true, message: 'Organization cover updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
module.exports.PRESETS = PRESETS;
