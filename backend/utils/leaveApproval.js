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
/**
 * The configured rule for a request type, or null when there is none. A rule
 * that exists but is switched off also returns null, so the request falls back
 * to the built-in chain rather than ending up with no approvers at all.
 */
async function loadRule(db, requestType) {
  if (!requestType) return null;
  try {
    const r = await db.query(
      `SELECT levels FROM approval_rules WHERE request_type = $1 AND is_active = TRUE LIMIT 1`,
      [requestType]
    );
    const levels = r.rows[0]?.levels;
    return Array.isArray(levels) && levels.length ? levels : null;
  } catch {
    // Table missing — an install that has not run the migration yet.
    return null;
  }
}

/**
 * Build the approver list from a configured rule.
 *
 * Steps are applied in order and the result is de-duplicated, so a rule asking
 * for two reporting levels and then HR gives three approvers — unless HR is
 * already one of the two, in which case it gives two. Renumbering afterwards
 * keeps levels contiguous, which the approve/reject logic relies on.
 */
async function levelsFromRule(db, employeeId, ancestors, rule) {
  const picks = [];
  const seen = new Set([String(employeeId)]);
  const add = id => {
    if (id && !seen.has(String(id))) { seen.add(String(id)); picks.push(id); }
  };

  // Needed by the Business Unit Head exception, which the built-in chain has
  // always applied and which the seeded rule carries forward.
  let managerIsBuHead = false;
  if (ancestors.length) {
    const d = await db.query(`SELECT designation FROM employees WHERE id = $1 LIMIT 1`, [ancestors[0]]);
    managerIsBuHead = (d.rows[0]?.designation || '').toLowerCase() === 'business unit head';
  }

  for (const step of rule) {
    if (step?.skipWhenManagerIsBuHead && managerIsBuHead) continue;

    if (step?.kind === 'reporting_to') {
      const count = Math.max(1, Math.min(Number(step.count) || 1, 10));
      for (let i = 0; i < count && i < ancestors.length; i += 1) add(ancestors[i]);
    } else if (step?.kind === 'role' && step.role) {
      const r = await db.query(
        `SELECT id FROM employees
          WHERE role = $1 AND COALESCE(status,'active') = 'active' AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`,
        [step.role]
      );
      if (r.rows.length) add(r.rows[0].id);
      else if (ancestors.length) add(ancestors[ancestors.length - 1]); // fallback: tree root
    } else if (step?.kind === 'user' && step.userId) {
      const r = await db.query(
        `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [step.userId]
      );
      if (r.rows.length) add(r.rows[0].id);
    }
  }

  return picks.map((approverId, i) => ({ level: i + 1, approverId }));
}

async function deriveLevels(db, employeeId, requestType) {
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

  // A configured rule wins. The seeded rule reproduces the chain below exactly,
  // so this changes nothing until an admin edits it in
  // Settings → Attendance → Approvals.
  const rule = await loadRule(db, requestType);
  if (rule) return levelsFromRule(db, employeeId, ancestors, rule);

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

  // Level 3 — HR & Administration, but ONLY when L1 is NOT the Business Unit Head.
  //
  // 2-level chain (no L3): employees who report directly to the BU Head (Govind).
  //   L1 = BU Head (Govind), L2 = Vellayan (tree root). HR & Admin is NOT added
  //   here; HR can still approve on behalf via the existing on-behalf mechanism.
  //
  // Govind's own leave: ancestors = [Vellayan], so L1 = Vellayan (not BU Head) and
  //   this block runs → hr_admin added as the second pick → renumbered to L2.
  //   Result: L1=Vellayan, L2=HR & Administration. Correct per spec.
  const l1DesigRes = await db.query(
    `SELECT designation FROM employees WHERE id = $1 LIMIT 1`, [ancestors[0]]
  );
  const l1IsBuHead = (l1DesigRes.rows[0]?.designation || '').toLowerCase() === 'business unit head';

  if (!l1IsBuHead) {
    const hrAdminRes = await db.query(
      `SELECT id FROM employees WHERE role = 'hr_admin' AND COALESCE(status,'active')='active' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`
    );
    if (hrAdminRes.rows.length > 0) {
      add(hrAdminRes.rows[0].id);
    } else {
      add(ancestors[ancestors.length - 1]); // fallback: tree root
    }
  }

  // Re-number sequentially after dedup so levels are always 1..N contiguous.
  return picks.map((approverId, i) => ({ level: i + 1, approverId }));
}

/** Create the approval_levels rows for a freshly-submitted request. */
async function createLevels(db, requestType, requestId, employeeId) {
  const levels = await deriveLevels(db, employeeId, requestType);
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

  // Determine the "ceiling" level this action approves up to.
  // - An assigned approver approves their own level (+ auto-covers lower).
  // - Full-access without an own pending level finalises everything still pending.
  const ceiling = ownLevel ? ownLevel.level : maxLevel;

  // NOTE: the previous "top level cannot act first" gate was removed by request —
  // any approver (and HR / Admin / Super Admin) may approve directly; lower
  // levels are no longer mandatory before a higher level acts. Lower pending
  // levels are still auto-covered on-behalf below so the chain stays consistent.

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
  // Allowed for full-access (HR / Super Admin) AND managers (Team Leads).
  // A manager is still scoped to requests they're an approver on — the route's
  // canUserAct guard enforces that before this runs.
  const full = isFullAccess(user.role);
  if (!full && user.role !== 'manager') {
    return { ok: false, message: 'You are not allowed to approve all levels at once.' };
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
    const onBehalf = !isOwn;        // covering a level this user doesn't own
    const byHr = !isOwn && full;    // HR/Super-Admin override flag — NOT for managers
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

const VALID_APPROVAL_REQUEST_TYPES = new Set(['leave', 'regularization', 'comp_off', 'wfh', 'timesheet', 'on_duty']);
const SAFE_ALIAS_RE = /^[a-z_][a-z0-9_.]*$/i;

/**
 * SQL fragment that materialises a request's approval chain as a JSON array for
 * the frontend timeline. Pass the request table alias and its id column, plus
 * the request_type literal. Reused by leaves/regularizations list queries.
 */
function approvalLevelsJson(requestTypeLiteral, reqAlias = 'l', idCol = 'id') {
  if (!VALID_APPROVAL_REQUEST_TYPES.has(requestTypeLiteral)) {
    throw new Error(`Invalid approval request type: ${requestTypeLiteral}`);
  }
  if (!SAFE_ALIAS_RE.test(reqAlias) || !SAFE_ALIAS_RE.test(idCol)) {
    throw new Error('Invalid SQL alias in approvalLevelsJson');
  }
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
  deriveLevels, levelsFromRule, loadRule, createLevels, getLevels, canUserAct,
  applyApproval, applyApproveAll, applyRejection,
  approvalLevelsJson,
};
