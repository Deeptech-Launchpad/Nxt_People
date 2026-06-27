/* ── Google ID token verification (dependency-free) ───────────────────────
 *  Verifies a Google Identity Services credential (an RS256 JWT) WITHOUT
 *  pulling in google-auth-library. It fetches Google's published signing keys
 *  (JWKS), caches them per their Cache-Control max-age, and verifies the
 *  token's signature + audience + issuer with Node's built-in crypto and the
 *  already-bundled `jsonwebtoken`.
 *
 *  Returns the decoded payload ({ email, email_verified, hd, name, ... }) on
 *  success, or throws on any verification failure.
 * ───────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
// Google mints tokens under either issuer spelling.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// In-memory JWKS cache. Keys rotate ~daily; we honour the response's max-age.
let certCache = { keys: null, expiresAt: 0 };

async function getGoogleCerts() {
  const now = Date.now();
  if (certCache.keys && now < certCache.expiresAt) return certCache.keys;

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google certificates (${res.status})`);
  const body = await res.json();

  // Respect Google's caching guidance; fall back to 1h if absent.
  const cc = res.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  const maxAge = m ? parseInt(m[1], 10) : 3600;
  certCache = { keys: body.keys || [], expiresAt: now + maxAge * 1000 };
  return certCache.keys;
}

function decodeHeader(token) {
  const part = String(token).split('.')[0];
  if (!part) throw new Error('Malformed credential');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Verify a Google ID token.
 * @param {string} idToken  The `credential` returned by Google Identity Services.
 * @param {string} audience The expected `aud` — your Google OAuth Client ID.
 * @returns {Promise<object>} The verified token payload.
 */
async function verifyGoogleIdToken(idToken, audience) {
  if (!idToken) throw new Error('Missing Google credential');
  if (!audience) throw new Error('Google Client ID is not configured');

  const header = decodeHeader(idToken);
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  let keys = await getGoogleCerts();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    // Key may have just rotated — force a refresh once before giving up.
    certCache = { keys: null, expiresAt: 0 };
    keys = await getGoogleCerts();
    jwk = keys.find(k => k.kid === header.kid);
  }
  if (!jwk) throw new Error('No matching Google signing key');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  // jwt.verify enforces signature, expiry (`exp`), audience and issuer.
  return jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience,
    issuer: GOOGLE_ISSUERS,
  });
}

module.exports = { verifyGoogleIdToken };
