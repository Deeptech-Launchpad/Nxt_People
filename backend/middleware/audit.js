/**
 * middleware/audit.js
 * Wraps res.json() to silently log every successful mutation to audit_log.
 * Usage: router.post('/', protect, authorize('admin'), audit('CREATE', 'employee'), handler)
 */
const { query } = require('../db');

const audit = (action, resource) => (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
      const resourceId =
        req.params.id ||
        data?.data?._id ||
        (Array.isArray(data?.data) ? null : data?.data?.id) ||
        null;

      query(
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
      ).catch(err => console.error('⚠️  Audit log write failed:', err.message));
    }
    return originalJson(data);
  };

  next();
};

module.exports = { audit };
