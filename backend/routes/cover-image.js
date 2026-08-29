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
const { serverError } = require('../utils/serverError');

router.use(protect);

const COVER_MAX_MB = 8;

// Named so the key alone is readable in the database: "preset:dusk" says more
// than an index would when somebody is looking at a row six months from now.
// Layered rather than a single sweep: a soft light source over a graded base
// reads as a scene instead of a flat wash, which is what a two-stop gradient
// looked like at banner size.
// Six banners shipped with the app, drawn as SVG rather than photographs.
// Authoring them removes the licence question that stock images bring, and an
// SVG at a few kilobytes cannot fail to load or be slow on a poor connection.
// They live in frontend/public/covers and are served as ordinary static files.
// The banners themselves live in the frontend's public/covers folder, and the
// list of them is built from that folder at build time — drop an image in,
// rebuild, and it appears with no code change anywhere.
//
// This container cannot see that folder, so it validates the SHAPE of a name
// rather than checking membership of a list: a safe filename under /covers.
// The worst a wrong name can do is leave one person with a missing image,
// which is a broken tile rather than a way into anything.
const SAFE_PRESET = /^[a-z0-9][a-z0-9._-]{0,60}$/i;

// What a fresh install falls back to before anybody has chosen. It ships with
// the app, so it is safe to name here.
const DEFAULT_PRESET = 'preset:dusk-ridge';

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

const isPreset = v => typeof v === 'string' && v.startsWith('preset:') && SAFE_PRESET.test(v.slice(7));
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
        cover: own || policy.orgCover || DEFAULT_PRESET,
        own,
        orgCover: policy.orgCover || null,
        allowSystemOptions: policy.allowSystemOptions,
        allowCustomUpload: policy.allowCustomUpload,
      },
    });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
  }
});

/**
 * Upload one.
 *
 * `?target=org` sets the organization's cover instead of the uploader's own.
 * That path is gated on the role rather than on allowCustomUpload: those two
 * switches govern what EMPLOYEES may do, and an administrator with both of
 * them off still has to be able to set the banner everybody sees. Without
 * this there was no way to set it at all, and the default gradient was
 * permanent.
 */
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
      const forOrg = req.query.target === 'org';
      const policy = await coverPolicy();

      const refuse = (message) => {
        // Delete what multer already wrote: refusing the request while leaving
        // the file on disk is how an upload directory quietly fills up.
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ success: false, message });
      };

      if (forOrg && !isFullAccess(req.user.role)) {
        return refuse('Only an administrator can set the organization cover');
      }
      if (!forOrg && !policy.allowCustomUpload) {
        return refuse('Uploading your own cover is switched off for this organization');
      }
      if (!req.file) return res.status(400).json({ success: false, message: 'No image was sent' });

      if (forOrg) {
        const url = `/uploads/covers/${req.file.filename}`;
        const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
        const cfg = r.rows[0]?.c || {};
        const before = (cfg.coverImage || {}).orgImageUrl || null;
        await pool.query(
          `UPDATE settings SET organization_policy_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
          [JSON.stringify({ ...cfg, coverImage: { ...(cfg.coverImage || {}), orgImageUrl: url } })]);
        if (isUpload(before) && before !== url) {
          fs.unlink(path.join(coversDir, path.basename(before)), () => {});
        }
        await logAudit(req, {
          action: 'UPDATE', resource: 'Organization policy', resourceId: 'coverImage',
          changes: { section: 'coverImage', summary: 'organization cover image',
                     fields: [{ field: 'coverImage.orgImageUrl', from: before, to: url }] },
        });
        return res.json({ success: true, message: 'Organization cover updated', data: { cover: url } });
      }

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
    serverError(res, err);
  }
});

module.exports = router;
