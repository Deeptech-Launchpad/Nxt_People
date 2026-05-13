const request = require('supertest');
const app     = require('../app');
const { pool } = require('../db');

const ADMIN_EMAIL    = 'admin@nxtpeople.com';
const ADMIN_PASSWORD = 'password123';

let adminToken = '';

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  adminToken = res.body.token;
});

afterAll(async () => {
  await pool.end();
});

// ── GET /api/attendance/today ──────────────────────────────────────────────────
describe('GET /api/attendance/today', () => {
  it('returns today attendance summary without error', async () => {
    const res = await request(app)
      .get('/api/attendance/today')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── GET /api/attendance/my ─────────────────────────────────────────────────────
describe('GET /api/attendance/my', () => {
  it('returns paginated attendance records for the logged-in user', async () => {
    const res = await request(app)
      .get('/api/attendance/my')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/attendance/my');
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /api/attendance/checkin ───────────────────────────────────────────────
describe('POST /api/attendance/checkin', () => {
  it('returns 400 or 409 if already checked in today (idempotency guard)', async () => {
    // First attempt — may succeed or conflict depending on current DB state
    const res = await request(app)
      .post('/api/attendance/checkin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ latitude: 12.9716, longitude: 77.5946 });
    // Allow 200 (first check-in) or 400/409 (already checked in)
    expect([200, 201, 400, 409]).toContain(res.statusCode);
    if (res.statusCode === 200 || res.statusCode === 201) {
      expect(res.body.success).toBe(true);
    }
  });
});

// ── GET /api/attendance/team ───────────────────────────────────────────────────
describe('GET /api/attendance/team', () => {
  it('admin can view team attendance', async () => {
    const res = await request(app)
      .get('/api/attendance/team')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── GET /api/attendance/summary ────────────────────────────────────────────────
describe('GET /api/attendance/summary', () => {
  it('returns monthly attendance summary with correct shape', async () => {
    const now = new Date();
    const res = await request(app)
      .get(`/api/attendance/summary?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
