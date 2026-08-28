/* ── Function Based Permissions, enforced ──────────────────────────────────
 *  Settings → User Access Control → Function Based Permissions stores a row
 *  per role per function. Nothing read those rows: the screen saved faithfully
 *  and no code consulted the result, so a function switched off stayed on
 *  everywhere. Five rows said so on screen; the other eleven implied they were
 *  enforced and were not.
 *
 *  This is what reads them.
 *
 *  Two shapes, because the endpoints are two different shapes:
 *
 *    requireFunction(key)   a guard for an endpoint that exists to serve one
 *                           function. Refuses with 403.
 *
 *    allows(req, key)       a question, for an endpoint that bundles several
 *                           functions into one payload. The dashboard returns
 *                           birthdays AND anniversaries AND new joiners; a 403
 *                           there would take the whole page down over one
 *                           switched-off widget, so those omit the section
 *                           instead of failing.
 *
 *  A missing row falls back to the catalogue default, never to false. A role
 *  created before a function existed has no row for it, and denying on absence
 *  would switch that function off for every such role the day one is added.
 *
 *  None of the sixteen functions gates Settings itself, so no combination of
 *  these switches can lock an administrator out of the screen that sets them.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const { FUNCTIONS, FUNCTION_KEYS } = require('./accessCatalog');

const DEFAULTS = new Map(FUNCTIONS.map(f => [f.key, { allowed: f.default, options: f.defaultOptions || {} }]));

/* Role definitions change when somebody saves the screen, which is rare, and
 * are read on almost every request, which is not. Cached per role key and
 * dropped wholesale on a write — a stale answer here is a permission that
 * lingers, so correctness after a save beats holding the cache longer. */
const TTL_MS = 30_000;
const cache = new Map();

function invalidate() {
  cache.clear();
}

async function forRole(roleKey) {
  if (!roleKey) return DEFAULTS;

  const hit = cache.get(roleKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  const { rows } = await pool.query(
    `SELECT rf.function_key AS key, rf.allowed, rf.options
       FROM role_functions rf
       JOIN roles r ON r.id = rf.role_id
      WHERE r.key = $1 AND r.kind = 'general'`,
    [roleKey]
  );

  const map = new Map(DEFAULTS);
  for (const r of rows) {
    if (!FUNCTION_KEYS.has(r.key)) continue;
    map.set(r.key, { allowed: !!r.allowed, options: r.options || {} });
  }

  cache.set(roleKey, { at: Date.now(), map });
  return map;
}

async function allows(req, key) {
  const map = await forRole(req.user?.role);
  return !!map.get(key)?.allowed;
}

async function optionsFor(req, key) {
  const map = await forRole(req.user?.role);
  return map.get(key)?.options || {};
}

/* The message names the screen that controls it. A 403 that only says
 * "forbidden" sends somebody to the wrong person; this one tells whoever sees
 * it in a log exactly which switch produced it. */
function requireFunction(key) {
  if (!FUNCTION_KEYS.has(key)) throw new Error(`requireFunction: '${key}' is not a function key`);
  return async (req, res, next) => {
    try {
      if (await allows(req, key)) return next();
      const label = FUNCTIONS.find(f => f.key === key)?.label || key;
      return res.status(403).json({
        success: false,
        code: 'FUNCTION_NOT_ALLOWED',
        functionKey: key,
        message: `${label} is switched off for your role under Function Based Permissions.`,
      });
    } catch (err) { next(err); }
  };
}

module.exports = { allows, optionsFor, requireFunction, forRole, invalidate };
