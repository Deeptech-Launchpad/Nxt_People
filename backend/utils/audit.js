const pool = require('../db');

/**
 * Log an action to the audit_log table.
 * 
 * @param {Object} req - The Express request object (used to extract user, IP, UA)
 * @param {Object} params - The log parameters
 * @param {string} params.action - e.g. "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT"
 * @param {string} params.resource - e.g. "Employee", "Leave", "Setting", "Project"
 * @param {string} [params.resourceId] - The ID of the affected resource
 * @param {Object} [params.changes] - JSON object representing changes (old/new state)
 */
async function logAudit(req, { action, resource, resourceId, changes }) {
  try {
    const actorId = req.user ? req.user._id : null;
    const actorEmail = req.user ? req.user.email : null;
    const actorRole = req.user ? req.user.role : null;
    const ipAddress = req.ip || null;
    const userAgent = req.get('user-agent')?.substring(0, 500) || null;

    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_email, actor_role, action, resource, resource_id, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        actorId,
        actorEmail,
        actorRole,
        action,
        resource,
        resourceId || null,
        changes ? JSON.stringify(changes) : null,
        ipAddress,
        userAgent
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit };
