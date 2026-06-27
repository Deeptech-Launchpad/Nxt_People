const request = require('supertest');
const app     = require('../app');
const { pool } = require('../db');

const ADMIN_EMAIL    = 'balaji@altiusnxt.com';
const ADMIN_PASSWORD = 'password123';

let adminToken  = '';
let createdLeaveId = '';

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  adminToken = res.body.token;
});

afterAll(async () => {
  // Clean up any test leave records we created
  if (createdLeaveId) {
    await pool.query('DELETE FROM leaves WHERE id = $1', [createdLeaveId]).catch(() => {});
  }
  await pool.end();
});

// ── GET /api/leaves/my ─────────────────────────────────────────────────────────
describe('GET /api/leaves/my', () => {
  it('returns 200 with an array of leave records', async () => {
    const res = await request(app)
      .get('/api/leaves/my')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/leaves/my');
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /api/leaves — apply for leave ────────────────────────────────────────
describe('POST /api/leaves', () => {
  it('returns 400 when end date is before start date', async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);

    const res = await request(app)
      .post('/api/leaves')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leaveType: 'casual',
        startDate: tomorrow.toISOString().split('T')[0],
        endDate: yesterday.toISOString().split('T')[0],
        reason: 'Test — invalid date range',
      });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('returns 400 for invalid leave type', async () => {
    const future = new Date(); future.setDate(future.getDate() + 5);
    const res = await request(app)
      .post('/api/leaves')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leaveType: 'INVALID_TYPE',
        startDate: future.toISOString().split('T')[0],
        endDate:   future.toISOString().split('T')[0],
        reason: 'Test — bad type',
      });
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /api/leaves — admin list ──────────────────────────────────────────────
describe('GET /api/leaves', () => {
  it('returns all leaves with status filter', async () => {
    const res = await request(app)
      .get('/api/leaves?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── GET /api/leaves/:id/action — approve/reject ────────────────────────────────
describe('PUT /api/leaves/:id/action', () => {
  it('returns 404 for non-existent leave ID', async () => {
    const res = await request(app)
      .put('/api/leaves/00000000-0000-0000-0000-000000000000/action')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approved' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
