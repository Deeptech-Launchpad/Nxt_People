/* ── Hierarchy-based approval engine (generic) ────────────────────────────
 *  Single source of truth for the multi-level approval workflow shared by every
 *  request type (leave, regularization, …). The approval chain is derived
 *  dynamically from the Employee Tree (employees.reporting_manager_id parent
 *  chain) — no hardcoded users, ids, or roles. Up to 3 levels:
 *      Level 1 = employee's immediate parent (reporting_manager_id)
 *      Level 2 = Level 1's immediate parent
 *      Level 3 = the top-most ancestor (root of the tree)
 *  Short chains collapse (deduped) so an employee may have 1, 2, or 3 levels.
 *
 *  Storage: the generic `approval_levels` table, keyed by (request_type,
 *  request_id). Every function below takes `(db, requestType, requestId, …)`.
 *
 *  Rules:
 *   - Approving at level K marks K approved (direct) and auto-approves every
 *     still-pending level BELOW K as "on behalf of Level X". Levels above stay
 *     pending.
 *   - HR / Super Admin (full-access) may approve any pending level(s); recorded
 *     as on-behalf "by HR".
 *   - The top level cannot be the FIRST action — at least one lower level must
 *     already be approved before the highest level approves.
 *   - The request is fully approved only when every level is approved; any
 *     rejection rejects the whole request.
 * ───────────────────────────────────────────────────────────────────────── */

const { isFullAccess } = require('./roles');

/**
 * Walk the reporting_manager_id chain and return the ordered list of distinct
 * approver levels for `employeeId`. Uses a recursive CTE, cycle-guarded by depth.
 * @returns {Promise<Array<{level:number, approverId:string}>>}
 */
async function deriveLevels(db, employeeId) {
  const res = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT id, reporting_manager_id, 0 AS depth
         FROM employees WHERE id = $1
       UNION ALL
       SELECT e.id, e.reporting_manager_id, c.depth + 1
         FROM employees e
         JOIN chain c ON e.id = c.reporting_manager_id
        WHERE c.depth < 20            -- cycle / runaway guard
     )
     SELECT id, depth FROM chain WHERE depth > 0 ORDER BY depth`,
    [employeeId]
  );

  // ancestors[0] = immediate parent (L1) … ancestors[last] = root.
  const ancestors = res.rows.map(r => r.id);
  if (ancestors.length === 0) return [];

  const picks = [];
  const seen = new Set();
  const add = (id) => {
    if (id && !seen.has(String(id)) && String(id) !== String(employeeId)) {
      seen.add(String(id));
      picks.push(id);
    }
  };
  add(ancestors[0]);                       // Level 1 — immediate parent
  if (ancestors.length >= 2) add(ancestors[1]); // Level 2 — grandparent
  add(ancestors[ancestors.length - 1]);    // Level 3 — top-most ancestor (root)

  // Re-number sequentially after dedup so levels are always 1..N contiguous.
  return picks.map((approverId, i) => ({ level: i + 1, approverId }));
}

/** Create the approval_levels rows for a freshly-submitted request. */
async function createLevels(db, requestType, requestId, employeeId) {
  const levels = await deriveLevels(db, employeeId);
  for (const { level, approverId } of levels) {
    await db.query(
      `INSERT INTO approval_levels (request_type, request_id, level, approver_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_type, request_id, level) DO NOTHING`,
      [requestType, requestId, level, approverId]
    );
  }
  return levels;
}

/** Fetch the approval levels for a request, joined to approver/actor names. */
async function getLevels(db, requestType, requestId) {
  const res = await db.query(
    `SELECT al.level, al.status, al.on_behalf AS "onBehalf", al.by_hr AS "byHr",
            al.acted_at AS "actedAt",
            al.approver_id AS "approverId",
            ap.first_name AS "approverFirstName", ap.last_name AS "approverLastName",
            al.acted_by AS "actedById",
            ab.first_name AS "actedByFirstName", ab.last_name AS "actedByLastName"
       FROM approval_levels al
       LEFT JOIN employees ap ON al.approver_id = ap.id
       LEFT JOIN employees ab ON al.acted_by = ab.id
      WHERE al.request_type = $1 AND al.request_id = $2
      ORDER BY al.level`,
    [requestType, requestId]
  );
  return res.rows;
}

/**
 * Can `user` act on this request at all (approve/reject)? True when they are the
 * assigned approver of any pending level, or full-access (HR/Super Admin).
 */
async function canUserAct(db, requestType, requestId, user) {
  if (isFullAccess(user.role)) return true;
  const r = await db.query(
    `SELECT 1 FROM approval_levels
      WHERE request_type = $1 AND request_id = $2 AND approver_id = $3 AND status = 'pending' LIMIT 1`,
    [requestType, requestId, user._id]
  );
  return r.rows.length > 0;
}

/**
 * Apply an APPROVAL by `user`. Mutates approval_levels inside the caller's
 * transaction. Returns { ok, status?, message?, allApproved }.
 *   - status: the new overall status ('pending' | 'approved') when ok.
 *   - allApproved: true when this action approved the final outstanding level.
 */
async function applyApproval(db, requestType, requestId, user) {
  const levels = await getLevels(db, requestType, requestId);

  // No hierarchy levels → only full-access (HR/Super Admin) can approve.
  if (levels.length === 0) {
    if (!isFullAccess(user.role)) {
      return { ok: false, message: 'No approval hierarchy is configured. Only HR or a Super Admin can approve this request.' };
    }
    return { ok: true, status: 'approved', allApproved: true };
  }

  const maxLevel = Math.max(...levels.map(l => l.level));
  const full = isFullAccess(user.role);
  const ownLevel = levels.find(l => String(l.approverId) === String(user._id) && l.status === 'pending');

  if (!ownLevel && !full) {
    return { ok: false, message: 'You are not a pending approver for this request.' };
  }

  const anyLowerApproved = (lvl) => levels.some(l => l.level < lvl && l.status === 'approved');

  // Determine the "ceiling" level this action approves up to.
  // - An assigned approver approves their own level (+ auto-covers lower).
  // - Full-access without an own pending level finalises everything still pending.
  const ceiling = ownLevel ? ownLevel.level : maxLevel;

  // Top-level-not-first guard: the highest level cannot be the first approval.
  if (ownLevel && ownLevel.level === maxLevel && maxLevel > 1 && !anyLowerApproved(maxLevel) && !full) {
    return { ok: false, message: 'A lower-level approver must approve first before the highest level can approve.' };
  }

  // A pure HR override = full-access actor who is NOT in this request's chain.
  const pureHrOverride = full && !ownLevel;

  // Approve from the bottom up so lower levels are recorded before higher ones
  // (keeps "top not first" true even within a single full-access action).
  const toApprove = levels
    .filter(l => l.status === 'pending' && l.level <= ceiling)
    .sort((a, b) => a.level - b.level);

  for (const lvl of toApprove) {
    const isOwn = !!ownLevel && lvl.level === ownLevel.level;
    const onBehalf = !isOwn;            // covering a lower level (or HR override)
    const byHr = pureHrOverride;        // ownLevel is undefined here, so isOwn is false
    await db.query(
      `UPDATE approval_levels
          SET status='approved', acted_by=$1, acted_at=NOW(), on_behalf=$2, by_hr=$3
        WHERE request_type=$4 AND request_id=$5 AND level=$6`,
      [user._id, onBehalf, byHr, requestType, requestId, lvl.level]
    );
  }

  // Recompute overall state.
  const after = await getLevels(db, requestType, requestId);
  const allApproved = after.every(l => l.status === 'approved');
  return { ok: true, status: allApproved ? 'approved' : 'pending', allApproved };
}

/**
 * Super-Admin "Approve All": approve EVERY remaining pending level in one action,
 * regardless of where (or whether) the actor sits in the chain. The actor's own
 * level (if any) is recorded as a direct approval; all other levels are marked
 * on-behalf "by HR" so the timeline shows who approved on whose behalf. Mutates
 * approval_levels inside the caller's transaction. Returns { ok, status?, message?, allApproved }.
 */
async function applyApproveAll(db, requestType, requestId, user) {
  // Gate to Super Admin only — HR keeps the normal single-level flow.
  if (user.role !== 'super_admin') {
    return { ok: false, message: 'Only a Super Admin can approve all levels at once.' };
  }
  const levels = await getLevels(db, requestType, requestId);

  // No hierarchy levels → nothing to cascade; treat as a full approval.
  if (levels.length === 0) {
    return { ok: true, status: 'approved', allApproved: true };
  }

  const ownLevel = levels.find(l => String(l.approverId) === String(user._id));
  const toApprove = levels
    .filter(l => l.status === 'pending')
    .sort((a, b) => a.level - b.level);

  for (const lvl of toApprove) {
    const isOwn = !!ownLevel && lvl.level === ownLevel.level;
    const onBehalf = !isOwn;   // covering a level the Super Admin doesn't own
    const byHr = !isOwn;       // recorded as an HR/Super-Admin override
    await db.query(
      `UPDATE approval_levels
          SET status='approved', acted_by=$1, acted_at=NOW(), on_behalf=$2, by_hr=$3
        WHERE request_type=$4 AND request_id=$5 AND level=$6`,
      [user._id, onBehalf, byHr, requestType, requestId, lvl.level]
    );
  }

  const after = await getLevels(db, requestType, requestId);
  const allApproved = after.every(l => l.status === 'approved');
  return { ok: true, status: allApproved ? 'approved' : 'pending', allApproved };
}

/**
 * Apply a REJECTION by `user`. Any single rejection rejects the whole request.
 * Marks the relevant level rejected. Returns { ok, message? }.
 */
async function applyRejection(db, requestType, requestId, user) {
  const levels = await getLevels(db, requestType, requestId);
  const full = isFullAccess(user.role);

  if (levels.length === 0) {
    if (!full) return { ok: false, message: 'You are not authorised to reject this request.' };
    return { ok: true };
  }

  // The level the user is rejecting at: their own pending level, else (for HR)
  // the lowest still-pending level.
  let target = levels.find(l => String(l.approverId) === String(user._id) && l.status === 'pending');
  if (!target && full) target = levels.find(l => l.status === 'pending');
  if (!target) return { ok: false, message: 'You are not a pending approver for this request.' };

  const byHr = full && String(target.approverId) !== String(user._id);
  await db.query(
    `UPDATE approval_levels
        SET status='rejected', acted_by=$1, acted_at=NOW(), on_behalf=$2, by_hr=$3
      WHERE request_type=$4 AND request_id=$5 AND level=$6`,
    [user._id, byHr, byHr, requestType, requestId, target.level]
  );
  return { ok: true };
}

/**
 * SQL fragment that materialises a request's approval chain as a JSON array for
 * the frontend timeline. Pass the request table alias and its id column, plus
 * the request_type literal. Reused by leaves/regularizations list queries.
 */
function approvalLevelsJson(requestTypeLiteral, reqAlias = 'l', idCol = 'id') {
  return `COALESCE((
    SELECT json_agg(json_build_object(
      'level', al.level, 'status', al.status,
      'onBehalf', al.on_behalf, 'byHr', al.by_hr, 'actedAt', al.acted_at,
      'approverName', NULLIF(TRIM(CONCAT(ap.first_name, ' ', ap.last_name)), ''),
      'approverRole', ap.role, 'approverEmail', ap.email,
      'actedByName', NULLIF(TRIM(CONCAT(ab.first_name, ' ', ab.last_name)), ''),
      'actedByRole', ab.role
    ) ORDER BY al.level)
    FROM approval_levels al
    LEFT JOIN employees ap ON al.approver_id = ap.id
    LEFT JOIN employees ab ON al.acted_by = ab.id
    WHERE al.request_type = '${requestTypeLiteral}' AND al.request_id = ${reqAlias}.${idCol}
  ), '[]'::json)`;
}

module.exports = {
  deriveLevels, createLevels, getLevels, canUserAct, applyApproval, applyApproveAll, applyRejection,
  approvalLevelsJson,
};
