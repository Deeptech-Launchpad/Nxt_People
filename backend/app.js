/**
 * app.js — Express app factory (separated from server.js so tests can import it
 * without binding to a port or starting cron jobs).
 */
require('dotenv').config();
// Sentry must be imported (and init'd) before anything that might throw.
const { Sentry, enabled: sentryEnabled } = require('./sentry');

const express    = require('express');
const cors       = require('cors');
const pinoHttp   = require('pino-http');
const crypto     = require('crypto');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const logger = require('./logger');

const app = express();
app.set('trust proxy', 1);

// Sentry's request handler must be the FIRST middleware on the app — only when enabled.
if (sentryEnabled && Sentry.Handlers?.requestHandler) {
  app.use(Sentry.Handlers.requestHandler());
}

// ── Core middleware ────────────────────────────────────────────────────────────
// In production, CORS_ORIGIN MUST be set explicitly to the public URL. The
// previous fallback to localhost:5173 in production was a silent footgun:
// the frontend's real origin got rejected while localhost-from-the-server
// silently passed, masking the misconfiguration until users reported "logged
// in but every API call fails".
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.error('FATAL: CORS_ORIGIN must be set in production. Refusing to start.');
  process.exit(1);
}
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
// Structured request/response logger with a per-request UUID so log lines can be
// correlated across DB queries, errors, and audit entries.
if (process.env.NODE_ENV !== 'test') {
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400)        return 'warn';
      return 'info';
    },
    // Quiet noisy paths in dev.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Auth rate limiter — outer guard for the whole /api/auth namespace.
// Tighter per-route limiters (login, forgot-password) live inside routes/auth.js.
// Bypass in non-production so local dev and Cypress can iterate freely.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production' || process.env.RATE_LIMIT_DISABLED === 'true',
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',             authLimiter, require('./routes/auth'));
app.use('/api/mfa',              require('./routes/mfa'));
app.use('/api/employees',        require('./routes/employees'));
app.use('/api/attendance',       require('./routes/attendance'));
app.use('/api/leaves',           require('./routes/leaves'));
app.use('/api/leave-types',      require('./routes/leave-types'));
app.use('/api/timesheets',       require('./routes/timesheets'));
app.use('/api/time-logs',        require('./routes/time-logs'));
app.use('/api/jobs',             require('./routes/jobs'));
app.use('/api/reports',          require('./routes/reports'));
app.use('/api/report-favorites', require('./routes/report-favorites'));
app.use('/api/shifts',           require('./routes/shifts'));
app.use('/api/holidays',         require('./routes/holidays'));
app.use('/api/weekend-rules',    require('./routes/weekend-rules'));
app.use('/api/approvals',        require('./routes/approvals'));
app.use('/api/settings',         require('./routes/settings'));
app.use('/api/dashboard',        require('./routes/dashboard'));
app.use('/api/registrations',    require('./routes/registrations'));
app.use('/api/companies',        require('./routes/companies'));
app.use('/api/api-connections',  require('./routes/api-connections'));
app.use('/api/my-apps',          require('./routes/my-apps'));
// external-access mounted BEFORE external so the more-specific path wins;
// Express dispatches by registration order, not by specificity.
app.use('/api/external/access',  require('./routes/external-access'));
app.use('/api/external',         require('./routes/external'));
app.use('/api/notifications',    require('./routes/notifications'));
app.use('/api/announcements',    require('./routes/announcements'));
app.use('/api/feeds',            require('./routes/feeds'));
app.use('/api/profile',          require('./routes/profile'));
app.use('/api/regularizations',  require('./routes/regularizations'));
app.use('/api/wfh',              require('./routes/wfh'));
app.use('/api/comp-off',         require('./routes/comp-off'));
app.use('/api/performance',      require('./routes/performance'));
app.use('/api/feedback',         require('./routes/feedback'));
app.use('/api/documents',        require('./routes/documents'));
app.use('/api/exit',             require('./routes/exit'));
app.use('/api/roster',           require('./routes/roster'));
app.use('/api/payroll',          require('./routes/payroll'));
app.use('/api/payslips',         require('./routes/payslips'));
app.use('/api/encashments',      require('./routes/encashments'));
app.use('/api/messages',         require('./routes/messages'));
app.use('/api/projects',         require('./routes/projects'));
app.use('/api/tasks',            require('./routes/tasks'));
app.use('/api/departments',      require('./routes/departments'));
app.use('/api/org',              require('./routes/org'));
app.use('/api/audit',            require('./routes/audit'));
app.use('/api/admin',            require('./routes/admin-zoho'));
app.use('/api/travel',           require('./routes/travel'));
app.use('/api/compensation',     require('./routes/compensation'));
app.use('/api/hr-letters',       require('./routes/hr-letters'));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` }));

// Sentry error handler — captures 5xx automatically. Must come BEFORE our handler.
if (sentryEnabled && Sentry.Handlers?.errorHandler) {
  app.use(Sentry.Handlers.errorHandler({ shouldHandleError: (err) => (err.statusCode || 500) >= 500 }));
}

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  // Attach to the request-scoped logger so the request-id is automatically included.
  (req.log || logger).error({ err, statusCode, path: req.path }, 'Request failed');
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(statusCode).json({ success: false, message });
});

module.exports = app;
