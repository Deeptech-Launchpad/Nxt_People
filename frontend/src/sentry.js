/**
 * Frontend Sentry init. No-op unless VITE_SENTRY_DSN is provided at build time.
 * Required env vars (set in frontend/.env or via Vite mode):
 *   VITE_SENTRY_DSN              — DSN from your React Sentry project
 *   VITE_SENTRY_ENVIRONMENT      — e.g. "production", "staging"
 *   VITE_SENTRY_RELEASE          — git sha or package version (optional)
 */
import * as Sentry from '@sentry/react';

const dsn = import.meta.env?.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env?.VITE_SENTRY_ENVIRONMENT || import.meta.env?.MODE || 'development',
    release: import.meta.env?.VITE_SENTRY_RELEASE,
    // Sensible defaults — 10 % of transactions, no session replays by default.
    tracesSampleRate: 0.1,
    // Strip query strings + bodies from breadcrumbs so we don't accidentally
    // log tokens or PII.
    beforeBreadcrumb(crumb) {
      if (crumb.category === 'fetch' || crumb.category === 'xhr') {
        if (crumb.data?.url) crumb.data.url = String(crumb.data.url).split('?')[0];
        delete crumb.data?.request_body_size;
        delete crumb.data?.response_body_size;
      }
      return crumb;
    },
  });
}

export const sentryEnabled = Boolean(dsn);
