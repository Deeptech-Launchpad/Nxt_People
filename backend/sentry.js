/**
 * Optional Sentry wiring. Activates only when SENTRY_DSN_BACKEND is set,
 * so dev environments aren't required to install a Sentry project.
 *
 * Required env vars:
 *   SENTRY_DSN_BACKEND        — DSN from https://sentry.io/settings/projects/.../keys/
 *   SENTRY_ENVIRONMENT        — e.g. "production", "staging" (defaults to NODE_ENV)
 *   SENTRY_TRACES_SAMPLE_RATE — 0.0–1.0 (defaults to 0.1 in prod, 0 in dev)
 */
const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN_BACKEND;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? 0.1 : 0)
    ),
    // Don't leak request bodies — bodies can contain passwords, tokens, PAN, etc.
    sendDefaultPii: false,
  });
}

const enabled = Boolean(dsn);

module.exports = { Sentry, enabled };
