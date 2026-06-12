const request = require('supertest');
const app     = require('../app');
const { pool } = require('../db');

// Credentials of the seeded admin (adjust if your seed differs)
const ADMIN_EMAIL    = 'balaji@altiusnxt.com';
const ADMIN_PASSWORD = 'password123';

let adminToken = '';
let refreshToken = '';

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  adminToken   = res.body.token;
  refreshToken = res.body.refreshToken;
});

afterAll(async () => {
  await pool.end();
});

// ── /api/auth/login ────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('returns 200 + access & refresh tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.data.role).toBe('super_admin');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrongpassword' });
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for missing email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: ADMIN_PASSWORD });
    expect(res.statusCode).toBe(400);
  });
});

// ── /api/auth/me ───────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns the current user profile with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.email).toBe(ADMIN_EMAIL);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
  });
});

// ── /api/auth/refresh ──────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  it('returns a new access token and rotated refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    // Rotated — should be different from original
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid_token_xyz' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when no refresh token provided', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});
    expect(res.statusCode).toBe(401);
  });
});

// ── /api/auth/check-email ──────────────────────────────────────────────────────
describe('POST /api/auth/check-email', () => {
  it('returns active status for an existing active admin email', async () => {
    const res = await request(app)
      .post('/api/auth/check-email')
      .send({ email: ADMIN_EMAIL });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns new status for an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/check-email')
      .send({ email: `notexist_${Date.now()}@test.com` });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('new');
  });
});

// ── /api/auth/forgot-password ──────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('always returns 200 (email enumeration prevention)', async () => {
    const res1 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN_EMAIL });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.token).toBeUndefined(); // token must NEVER be in response

    const res2 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@unknown.com' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.token).toBeUndefined();
  });
});

// ── /api/auth/sessions ─────────────────────────────────────────────────────────
describe('GET /api/auth/sessions', () => {
  it('returns active sessions for authenticated user', async () => {
    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
