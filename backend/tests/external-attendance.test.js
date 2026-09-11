/**
 * GET /api/external/attendance-summary and the extended GET /api/external/employees.
 *
 * Deliberately does not depend on the shared admin-login fixture the other
 * suites in this directory use (a hardcoded email/password against whatever
 * this environment's DB happens to hold) — this route is API-key
 * authenticated, not JWT, so its own tests provision a throwaway connection
 * and employee directly and never touch a session at all.
 */
const crypto = require('crypto');
const request = require('supertest');
const app = require('../app');
const { pool } = require('../db');

const RAW_KEY = `test-key-${Date.now()}`;
const KEY_HASH = crypto.createHash('sha256').update(RAW_KEY).digest('hex');

let connectionId = '';
let employeeId = '';
let leaveId = '';

beforeAll(async () => {
  const conn = await pool.query(
    `INSERT INTO api_connections (name, api_key_hash, is_active, allowed_data_types)
     VALUES ($1, $2, true, $3::text[]) RETURNING id`,
    ['Test Payroll Connector', KEY_HASH, ['employees:read', 'attendance:read']]
  );
  connectionId = conn.rows[0].id;

  const emp = await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, joining_date, pan_number, uan_number, bank_name, bank_account, bank_ifsc)
     VALUES ($1, 'External', 'TestEmp', $2, $3, 'ABCDE1234F', '123456789012', 'Test Bank', '00011122233', 'TEST0001234')
     RETURNING id`,
    [`EXT-${Date.now()}`, `ext-${Date.now()}@test.local`, new Date(new Date().getFullYear(), 0, 1)]
  );
  employeeId = emp.rows[0].id;

  // One approved unpaid-leave day, well inside the current month, so LOP
  // for the month-to-date window is provably non-zero rather than
  // accidentally passing on an empty result.
  const today = new Date();
  const leaveDate = new Date(today.getFullYear(), today.getMonth(), 2);
  if (leaveDate < today) {
    const leave = await pool.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'unpaid', $2, $2, 1, 'test fixture', 'approved') RETURNING id`,
      [employeeId, leaveDate.toISOString().slice(0, 10)]
    );
    leaveId = leave.rows[0].id;
  }
});

afterAll(async () => {
  if (leaveId) await pool.query('DELETE FROM leaves WHERE id = $1', [leaveId]).catch(() => {});
  if (employeeId) await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]).catch(() => {});
  if (connectionId) await pool.query('DELETE FROM api_connections WHERE id = $1', [connectionId]).catch(() => {});
  await pool.end();
});

describe('GET /api/external/employees — extended fields', () => {
  it('now includes status, exitDate and the statutory/bank fields', async () => {
    const res = await request(app)
      .get('/api/external/employees')
      .set('X-API-Key', RAW_KEY);

    expect(res.statusCode).toBe(200);
    const row = res.body.data.find((e) => e.employeeId.startsWith('EXT-'));
    expect(row).toBeDefined();
    expect(row.status).toBe('active');
    expect(row.pan).toBe('ABCDE1234F');
    expect(row.uan).toBe('123456789012');
    expect(row.bankName).toBe('Test Bank');
    expect(row.bankAccountNumber).toBe('00011122233');
    expect(row.bankIfsc).toBe('TEST0001234');
  });

  it('rejects a connection with no employees scope', async () => {
    const scoped = await pool.query(
      `INSERT INTO api_connections (name, api_key_hash, is_active, allowed_data_types)
       VALUES ('No scope', $1, true, '{attendance:read}'::text[]) RETURNING id`,
      [crypto.createHash('sha256').update('no-scope-key').digest('hex')]
    );
    const res = await request(app)
      .get('/api/external/employees')
      .set('X-API-Key', 'no-scope-key');
    expect(res.statusCode).toBe(403);
    await pool.query('DELETE FROM api_connections WHERE id = $1', [scoped.rows[0].id]);
  });
});

describe('GET /api/external/attendance-summary', () => {
  it('rejects a request with no API key', async () => {
    const res = await request(app).get('/api/external/attendance-summary');
    expect(res.statusCode).toBe(401);
  });

  it('rejects a connection with no attendance scope', async () => {
    const scoped = await pool.query(
      `INSERT INTO api_connections (name, api_key_hash, is_active, allowed_data_types)
       VALUES ('Employees only', $1, true, '{employees:read}'::text[]) RETURNING id`,
      [crypto.createHash('sha256').update('employees-only-key').digest('hex')]
    );
    const res = await request(app)
      .get('/api/external/attendance-summary')
      .set('X-API-Key', 'employees-only-key');
    expect(res.statusCode).toBe(403);
    await pool.query('DELETE FROM api_connections WHERE id = $1', [scoped.rows[0].id]);
  });

  it('returns the LOP figure computed by the same function Payroll Run uses, for the fixture employee', async () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const end = today.toISOString().slice(0, 10);

    const res = await request(app)
      .get(`/api/external/attendance-summary?startDate=${start}&endDate=${end}`)
      .set('X-API-Key', RAW_KEY);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const row = res.body.data.find((r) => r.externalId === employeeId);
    expect(row).toBeDefined();
    expect(typeof row.lopDays).toBe('number');
    expect(typeof row.presentDays).toBe('number');
    expect(row.presentDays).toBeGreaterThanOrEqual(0);

    if (leaveId) {
      // The one approved unpaid day booked in beforeAll must show up as LOP —
      // this is the whole point of reusing lopDaysForRange rather than a
      // second, independent calculation.
      expect(row.lopDays).toBeGreaterThan(0);
    }
  });

  it('rejects an invalid date range', async () => {
    const res = await request(app)
      .get('/api/external/attendance-summary?startDate=2026-05-01&endDate=2026-04-01')
      .set('X-API-Key', RAW_KEY);
    expect(res.statusCode).toBe(400);
  });
});
