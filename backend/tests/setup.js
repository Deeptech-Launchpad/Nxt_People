/**
 * Jest + Supertest test setup
 * Loads .env, creates a one-time admin token for all test suites, and exports helpers.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const request = require('supertest');
const app     = require('../app'); // exported Express app (see app.js)
const { pool } = require('../db');

// Shared state — populated by globalSetup helpers below
let adminToken   = '';
let employeeToken = '';
let testEmployeeId = '';

const getAdminToken   = () => adminToken;
const getEmployeeToken = () => employeeToken;
const getTestEmployeeId = () => testEmployeeId;

/**
 * Call this in a beforeAll to authenticate as the seeded admin.
 * Falls back gracefully if the DB isn't accessible.
 */
const loginAs = async (email, password) => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  if (res.body.token) return res.body.token;
  throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
};

module.exports = { request, app, pool, loginAs, getAdminToken, getEmployeeToken, getTestEmployeeId };
