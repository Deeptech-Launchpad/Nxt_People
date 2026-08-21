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
// Layered rather than a single sweep: a soft light source over a graded base
// reads as a scene instead of a flat wash, which is what a two-stop gradient
// looked like at banner size.
const PRESETS = {
  dusk:    'radial-gradient(120% 90% at 78% 8%, rgba(255,214,170,0.42) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, #16283f 0%, #2f4a72 48%, #7f9bc4 100%)',
  forest:  'radial-gradient(110% 85% at 18% 12%, rgba(190,255,214,0.30) 0%, rgba(255,255,255,0) 58%), linear-gradient(160deg, #0e2a22 0%, #24614a 50%, #6faa89 100%)',
  ember:   'radial-gradient(120% 95% at 82% 12%, rgba(255,206,138,0.45) 0%, rgba(255,255,255,0) 58%), linear-gradient(160deg, #45150d 0%, #96401f 50%, #d99a63 100%)',
  slate:   'radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 60%), linear-gradient(160deg, #1b1e24 0%, #3c414c 52%, #7b828f 100%)',
  tide:    'radial-gradient(115% 90% at 22% 10%, rgba(178,247,255,0.34) 0%, rgba(255,255,255,0) 56%), linear-gradient(160deg, #082f38 0%, #176b78 50%, #74bcc2 100%)',
  plum:    'radial-gradient(120% 90% at 80% 10%, rgba(255,198,238,0.32) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, #2f1434 0%, #622d5c 50%, #a67fa2 100%)',
  sand:    'radial-gradient(120% 90% at 30% 8%, rgba(255,240,206,0.50) 0%, rgba(255,255,255,0) 58%), linear-gradient(160deg, #4a3a24 0%, #8d7343 50%, #d6bd8c 100%)',
  midnight:'radial-gradient(130% 100% at 70% 0%, rgba(126,160,255,0.28) 0%, rgba(255,255,255,0) 60%), linear-gradient(160deg, #0b1020 0%, #1d2743 52%, #4b5b86 100%)',
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
      // Banners the organization uploaded once for everybody to pick from.
      // Shipping stock photographs would put binary assets and a licence
      // question into the repository; a company's own images are better
      // anyway, and this is where they live.
      library: Array.isArray(c.library) ? c.library.filter(u => typeof u === 'string') : [],
    };
  } catch {
    return { allowSystemOptions: false, allowCustomUpload: false, orgCover: null, library: [] };
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
        library: policy.library,
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
    // A library image is an org-provided option, exactly like a preset — the
    // same switch governs both, and anything not on the list is refused.
    const fromLibrary = isUpload(cover) && policy.library.includes(cover);
    if (!isPreset(cover) && !fromLibrary) {
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
      const target = req.query.target === 'org' ? 'org'
        : req.query.target === 'library' ? 'library' : 'self';
      const forOrg = target === 'org';
      const forLibrary = target === 'library';
      const policy = await coverPolicy();

      const refuse = (message) => {
        // Delete what multer already wrote: refusing the request while leaving
        // the file on disk is how an upload directory quietly fills up.
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ success: false, message });
      };

      if ((forOrg || forLibrary) && !isFullAccess(req.user.role)) {
        return refuse('Only an administrator can change the organization covers');
      }
      if (!forOrg && !forLibrary && !policy.allowCustomUpload) {
        return refuse('Uploading your own cover is switched off for this organization');
      }
      if (!req.file) return res.status(400).json({ success: false, message: 'No image was sent' });

      if (forLibrary) {
        const url = `/uploads/covers/${req.file.filename}`;
        const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
        const cfg = r.rows[0]?.c || {};
        const cover = cfg.coverImage || {};
        const library = [...(Array.isArray(cover.library) ? cover.library : []), url];
        await pool.query(
          `UPDATE settings SET organization_policy_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
          [JSON.stringify({ ...cfg, coverImage: { ...cover, library } })]);
        await logAudit(req, {
          action: 'UPDATE', resource: 'Organization policy', resourceId: 'coverImage',
          changes: { section: 'coverImage', summary: 'added a cover to the library',
                     fields: [{ field: 'coverImage.library', from: null, to: url }] },
        });
        return res.json({ success: true, message: 'Added to the library', data: { cover: url, library } });
      }

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

/**
 * Take a banner out of the shared library.
 *
 * The file goes with it, unless somebody has it set as their own cover or it
 * is the organization cover — deleting an image still on somebody's screen
 * would leave them with a broken banner and no way to say why.
 */
router.delete('/library', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { cover } = req.body || {};
    if (!isUpload(cover)) {
      return res.status(400).json({ success: false, message: 'That is not a library image' });
    }
    const r = await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`);
    const cfg = r.rows[0]?.c || {};
    const c = cfg.coverImage || {};
    const library = (Array.isArray(c.library) ? c.library : []).filter(u => u !== cover);

    await pool.query(
      `UPDATE settings SET organization_policy_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify({ ...cfg, coverImage: { ...c, library } })]);

    const stillUsed = (await pool.query(
      `SELECT 1 FROM employees WHERE cover_image_url = $1 LIMIT 1`, [cover])).rows.length > 0
      || c.orgImageUrl === cover;
    if (!stillUsed) fs.unlink(path.join(coversDir, path.basename(cover)), () => {});

    await logAudit(req, {
      action: 'UPDATE', resource: 'Organization policy', resourceId: 'coverImage',
      changes: { section: 'coverImage', summary: 'removed a cover from the library',
                 fields: [{ field: 'coverImage.library', from: cover, to: null }] },
    });
    res.json({ success: true, message: 'Removed from the library', data: { library } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
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
