/**
 * middleware/audit.js
 * Wraps res.json() to silently log every successful mutation to audit_log.
 * Usage: router.post('/', protect, authorize('admin', 'director'), audit('CREATE', 'team_member'), handler)
 */
// IMPORTANT: import the pool, then call `pool.query(...)`. Destructuring
// `const { query } = require('../db')` unbinds the method from the pool
// instance, which makes pg throw "Cannot read properties of undefined
// (reading '_Promise')" — a confusing error that bubbled up as a generic
// 500 on every DELETE.
const pool = require('../db');
const logger = require('../logger');

const audit = (action, resource) => (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
      const resourceId =
        req.params.id ||
        data?.data?._id ||
        (Array.isArray(data?.data) ? null : data?.data?.id) ||
        null;

      // Fire-and-forget on purpose — making the audit await-block would let
      // an audit-table outage cascade into "your DELETE worked but the
      // response failed". On the rare audit-write failure we log enough
      // context (who/what/when) that the row can be reconstructed manually,
      // and we report to Sentry if it's wired up.
      pool.query(
        `INSERT INTO audit_log
         (actor_id, actor_email, actor_role, action, resource, resource_id, changes, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          req.user._id,
          req.user.email,
          req.user.role,
          action,
          resource,
          resourceId ? String(resourceId) : null,
          JSON.stringify({ body: req.body }),
          req.ip || null,
          req.get('user-agent')?.substring(0, 500) || null,
        ]
      ).catch(err => {
        logger.error({
          actor: req.user.email,
          action, resource, resourceId,
          err: err.message,
        }, 'AUDIT WRITE FAILED');
        if (global.Sentry?.captureException) {
          global.Sentry.captureException(err, { tags: { audit: 'write_failed', action, resource } });
        }
      });
    }
    return originalJson(data);
  };

  next();
};

module.exports = { audit };
