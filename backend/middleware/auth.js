const jwt = require('jsonwebtoken');
const pool = require('../db');

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      `SELECT id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, company, division, registration_status AS "registrationStatus", has_accepted AS "hasAccepted", employee_id AS "employeeId" 
       FROM employees WHERE id = $1`, 
      [decoded.id]
    );
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid' });
  }
};

exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Role '${req.user.role}' not authorized` });
  }
  next();
};
