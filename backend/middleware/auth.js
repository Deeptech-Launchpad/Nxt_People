const jwt = require('jsonwebtoken');
const pool = require('../db');
const { roleCan } = require('../utils/permissions');

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      `SELECT id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, company, division, registration_status AS "registrationStatus", has_accepted AS "hasAccepted", employee_id AS "employeeId", status, deleted_at, tokens_revoked_at
       FROM employees WHERE id = $1`,
      [decoded.id]
    );
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'User not found' });

    // Soft-deleted (archived) employees must be locked out immediately —
    // deleted_at is the source of truth, not status (which may still say 'active').
    if (result.rows[0].deleted_at) {
      return res.status(401).json({ success: false, message: 'Account has been archived' });
    }

    // Reject inactive employees even if their JWT hasn't expired yet.
    // The notice-period auto-flip cron sets status to 'resigned', but a
    // user already logged in keeps a valid 15-min access token until it
    // expires. Without this check they could continue using the API for
    // up to 15 minutes after offboarding.
    if (result.rows[0].status && result.rows[0].status !== 'active') {
      return res.status(401).json({ success: false, message: 'Account is no longer active' });
    }

    // Logout-everywhere: token iat must be ≥ tokens_revoked_at. If the user
    // clicked "Sign out everywhere" since this token was issued, kill it.
    // decoded.iat is seconds-since-epoch; tokens_revoked_at is a TIMESTAMPTZ.
    const revokedAt = result.rows[0].tokens_revoked_at;
    if (revokedAt && decoded.iat && new Date(decoded.iat * 1000) < new Date(revokedAt)) {
      return res.status(401).json({ success: false, message: 'Session revoked. Please sign in again.', code: 'REVOKED' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid' });
  }
};

// Route guards ask about permissions now, so a role created in the UI can
// actually pass one. The call sites are unchanged: every authorize() in the
// codebase declares one of exactly three role sets, and each set names a
// permission. Rewriting 182 call sites by hand is how a route quietly loses
// its guard; the shape is matched instead.
const GUARD_PERMISSION = new Map([
  ['admin|director|hr_admin',                       'org.manage'],
  ['admin|director|hr_admin|manager',               'team.manage'],
  ['admin|director|hr_admin|manager|team_incharge', 'team.approve'],
]);

exports.GUARD_PERMISSION = GUARD_PERMISSION;

exports.authorize = (...roles) => {
  const shape = [...new Set(roles)].sort().join('|');
  const permission = GUARD_PERMISSION.get(shape);

  // Thrown while the routes are being built, not on the request that hits it.
  // A guard shape nobody mapped would otherwise either let everyone through
  // or nobody, and both are silent until someone notices.
  if (!permission) {
    throw new Error(
      `authorize(${roles.map(r => `'${r}'`).join(', ')}) has no permission mapped. ` +
      `Add the shape '${shape}' to GUARD_PERMISSION in middleware/auth.js.`
    );
  }

  return (req, res, next) => {
    if (roleCan(req.user.role, permission)) return next();
    return res.status(403).json({ success: false, message: `Role '${req.user.role}' not authorized` });
  };
};

// A guard for routes that name what they need rather than who may do it.
exports.requires = permission => (req, res, next) => {
  if (roleCan(req.user.role, permission)) return next();
  return res.status(403).json({ success: false, message: `Role '${req.user.role}' not authorized` });
};
