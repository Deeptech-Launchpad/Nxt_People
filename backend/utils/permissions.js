/* ── The permission cache ──────────────────────────────────────────────────
 *  Role checks happen on nearly every request, and in twenty-two files they
 *  happen inside synchronous helpers (isFullAccess, reportsScope) that cannot
 *  become async without rewriting their call sites — which is exactly the kind
 *  of sweeping change that loses a guard.
 *
 *  So the role → permission map is held in memory, loaded at startup and
 *  refreshed whenever a role is written. Reads are synchronous.
 *
 *  The fallback matters more than the cache. If the table cannot be read —
 *  before the migration has run, or during a database blip — every check would
 *  otherwise return false and lock the whole organization out of its own
 *  system. It falls back to the six roles compiled in below, which is what the
 *  application enforced before any of this existed.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');

// What the application enforced before roles became records. This is the
// floor, not the source of truth: once the table loads, the table wins.
const BUILT_IN = {
  admin:         ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  director:      ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  hr_admin:      ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  manager:       ['team.manage', 'team.approve', 'people.viewReports'],
  team_incharge: ['team.approve', 'people.viewReports'],
  team_member:   [],
};

const buildFallback = () => {
  const m = new Map();
  for (const [k, v] of Object.entries(BUILT_IN)) m.set(k, new Set(v));
  return m;
};

let cache = buildFallback();
let loaded = false;

/** Read the whole map in one query and swap it in atomically. */
async function reload() {
  try {
    const r = await pool.query(
      `SELECT ro.key, p.permission
         FROM roles ro
         LEFT JOIN role_permissions p ON p.role_id = ro.id
        WHERE ro.kind = 'general'`
    );
    if (!r.rows.length) {
      // No general roles at all means the migration has not run. Keeping the
      // fallback is right; replacing the map with an empty one is not.
      logger.warn('No roles found; permission checks are using the built-in map');
      cache = buildFallback();
      return cache;
    }
    const next = new Map();
    for (const row of r.rows) {
      if (!next.has(row.key)) next.set(row.key, new Set());
      if (row.permission) next.get(row.key).add(row.permission);
    }
    cache = next;
    loaded = true;
    return cache;
  } catch (err) {
    // A role whose permissions cannot be read must not become a role with no
    // permissions — that is how a database blip becomes a lockout.
    logger.error({ err }, 'Could not load role permissions; keeping the previous map');
    return cache;
  }
}

/** True when the role has the permission. Synchronous by design. */
const roleCan = (roleKey, permission) => !!cache.get(roleKey)?.has(permission);

/** Every permission a role holds — for the whoami payload the frontend reads. */
const permissionsOf = roleKey => [...(cache.get(roleKey) || [])];

const knownRoles = () => [...cache.keys()];

module.exports = { reload, roleCan, permissionsOf, knownRoles, BUILT_IN, isLoaded: () => loaded };
