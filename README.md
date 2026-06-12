# Nxt People — Enterprise HR & Attendance Management System

A full-stack HR platform inspired by Zoho People. Covers attendance, leave, timesheets, shifts, holidays, performance, payroll reports, projects/tasks, onboarding, exit, announcements, chat, and  a third-party API gateway.

Built with React 18 + Vite, Node.js + Express, PostgreSQL.

---

## Folder structure

```
nxt-people/
├── backend/
│   ├── app.js                     # Express app factory (routes + middleware)
│   ├── server.js                  # HTTP entry point + cron jobs
│   ├── db.js                      # PostgreSQL pool
│   ├── schema.sql                 # Base tables — bootstrapped by docker-compose
│   ├── seed.sql                   # Demo data (idempotent)
│   ├── migrate_*.js               # Additive migrations (run via `npm run migrate`)
│   ├── middleware/                # auth (JWT + RBAC) + audit
│   ├── routes/                    # 41 route modules under /api/*
│   ├── utils/                     # mailer, audit, seed
│   └── tests/                     # Jest + supertest (auth, attendance, leaves)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Routes (lazy-loaded)
│   │   ├── components/layout/     # Sidebar, Topbar, Layout, MobileBlocker
│   │   ├── context/               # AuthContext, AttendanceContext
│   │   ├── pages/                 # 60+ feature pages, grouped by domain
│   │   └── utils/api.js           # axios instance with token-refresh interceptor
│   ├── cypress/                   # E2E tests
│   └── vite.config.js
│
├── docker-compose.yml             # db + backend + frontend
├── package.json                   # Convenience scripts
└── README.md
```

---

## Backend route surface (41 modules under `/api/*`)

Identity & access — `auth`, `registrations`, `companies`, `profile`
Attendance & time — `attendance`, `regularizations`, `wfh`, `comp-off`, `time-logs`, `timesheets`, `shifts`, `roster`, `holidays`
Leave — `leaves`, `leave-types`, `encashments`, `approvals`
People & org — `employees`, `departments`, `org`, `feeds`, `announcements`, `messages`, `notifications`
Performance & exit — `performance`, `feedback`, `exit`
Payroll & reports — `payroll`, `payslips`, `reports`, `report-favorites`
Projects & tasks — `projects`, `tasks`, `jobs`
Integrations & admin — `api-connections`, `external` (third-party API-key gateway), `documents`, `settings`, `dashboard`, `audit`

Health check at `GET /api/health`.

---

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (or use docker-compose)
- npm 9+

### 1. Install
```bash
npm run install:all   # installs both backend + frontend
```

### 2. Configure
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your DB credentials, JWT secret, SMTP, etc.
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Initialize the database

**Cold-start path (first time only):**
```bash
# 1. Create the base tables
psql -U postgres -d nxt_people -f backend/schema.sql

# 2. Apply additive migrations (refresh_tokens, notifications, audit_log,
#    api_connections, projects, etc. — these are NOT in schema.sql)
cd backend
npm run migrate          # runs migrate_all.js
node migrate_zoho_features.js
node migrate_phase1.js
node migrate_phases2to5.js
node migrate_features.js
node migrate_final.js
node migrate_fixes.js
node migrate_refresh_audit_projects.js
node migrate_announcements_schema.js
node migrate_docs.js
node migrate_onboarding.js
node migrate_reset_password.js
node migrate_indexes.js

# 3. Seed demo data
npm run seed
```

> ⚠️ The migration story is fragmented — there are 13+ migrate scripts to apply
> in order. Consolidating these into a single ordered migration tool (Knex or
> Prisma) is on the roadmap.

**Or via docker-compose** (only loads `schema.sql` + `seed.sql`, so the migrate
scripts above must still be run inside the `backend` container):
```bash
docker-compose up -d
docker-compose exec backend sh -c "node migrate_all.js && node migrate_zoho_features.js && ..."
```

### 4. Run
```bash
npm run dev:backend    # http://localhost:5000
npm run dev:frontend   # http://localhost:5173
```

---

## Demo accounts

| Role     | Email                  | Password    |
|----------|------------------------|-------------|
| Admin    | admin@nxtpeople.com    | password123 |
| Manager  | sarah@nxtpeople.com    | password123 |
| Employee | michael@nxtpeople.com  | password123 |

---

## Auth model

- **Access token** — JWT, 15-minute lifetime (`JWT_ACCESS_EXPIRE`).
- **Refresh token** — 64-byte crypto-random, stored as SHA-256 hash with IP / user-agent in `refresh_tokens`. Rotated on every refresh, revocable on logout.
- **Frontend** — auto-refresh interceptor in [`src/utils/api.js`](frontend/src/utils/api.js); queues in-flight requests during refresh.
- **Rate limits** — global 100/15min on `/api/auth/*`, plus per-route limiters: 10/15min on `/login`, 5/15min on `/forgot-password` (both keyed by IP+email).
- **Forgot password** — generic response prevents email enumeration; reset link is sent only by email, never returned in the API response.
- **Login** — password is verified before any account-state messaging is exposed, so unknown vs. pending vs. rejected emails are indistinguishable to unauthenticated callers.

---

## REST API — selected endpoints

### Auth
| Method | Endpoint                        | Description                  |
|--------|---------------------------------|------------------------------|
| POST   | /api/auth/check-email           | Account state lookup         |
| POST   | /api/auth/register              | Submit registration          |
| POST   | /api/auth/accept-terms          | Activate approved account    |
| POST   | /api/auth/login                 | Login → access + refresh     |
| POST   | /api/auth/refresh               | Rotate refresh, new access   |
| POST   | /api/auth/logout                | Revoke refresh token         |
| GET    | /api/auth/me                    | Current user                 |
| GET    | /api/auth/sessions              | Active sessions              |
| POST   | /api/auth/forgot-password       | Send reset email             |
| PUT    | /api/auth/reset-password/:token | Set new password             |
| PUT    | /api/auth/change-password       | Change password (logged-in)  |

### Attendance
| Method | Endpoint                  | Description                  |
|--------|---------------------------|------------------------------|
| GET    | /api/attendance/today     | Today's record               |
| POST   | /api/attendance/checkin   | Check in (optional GPS)      |
| POST   | /api/attendance/checkout  | Check out                    |
| GET    | /api/attendance/my        | Monthly records              |
| GET    | /api/attendance/team      | Team view (manager/admin)    |
| GET    | /api/attendance/summary   | Monthly summary              |

### Other domains
Leaves, timesheets, shifts, holidays, employees, registrations, approvals, dashboard, reports, payroll, performance, exit, documents, announcements, notifications, projects, tasks, feedback, messages, settings, audit. See [`backend/app.js`](backend/app.js) for the full mount list.

### External API (third-party sync)
- Auth: pass `x-api-key: <raw key>` header. Keys are SHA-256-hashed at rest — the raw value is shown **once** at creation and cannot be recovered.
- Endpoints: `GET /api/external/employees`, `POST /api/external/employees` (upsert).
- Manage keys via `GET/POST/PUT/DELETE /api/api-connections` (admin only). `POST /api/api-connections/:id/regenerate-key` mints a new one.

---

## Background jobs

Defined in [`backend/server.js`](backend/server.js):

| Cron              | Job                                          |
|-------------------|----------------------------------------------|
| `0 0 1 * *`       | Monthly leave accrual (casual / sick / earned) |
| `5 0 1 1 *`       | Yearly lapse + earned-leave carry-forward (cap 15) |
| `0 9 * * 1-6`     | Daily 9 AM check-in reminder (skips holidays + 1st/3rd Sat) |
| `0 18 * * 1-6`    | Daily 6 PM check-out reminder (same skips)   |

---

## Business rules

### Attendance
- **Late** — check-in after 9:30 AM (`late_after_minutes`, configurable per company).
- **Half day** — less than `half_day_hours` worked.
- **Present / Late / Half-day / Absent** — derived from check-in time + working hours.
- **Duplicate check-in** prevented per employee per day.
- **Optional GPS gate** — `require_gps`/`gps_radius_meters` setting; check-in rejected when out of range.

### Leave
- Casual 12 / Sick 10 / Earned 15 / Unpaid unlimited (defaults; overridable per employee).
- Approved leaves auto-deduct balance; weekends excluded.
- Approval flow follows `reporting_manager_id` and `approving_authority_id`.

### Role-based access (enforced in routes + frontend)
Employee · Manager · Admin · HR (each route declares its allowed roles).

---

## Tests

Backend (Jest + supertest, against a real DB):
```bash
cd backend
npm test
```

Frontend (Cypress E2E):
```bash
cd frontend
npm run test:e2e        # interactive
npm run test:run        # headless
```

---

## Production deploy

```bash
# Frontend
cd frontend && npm run build       # → frontend/dist

# Backend
cd backend && NODE_ENV=production npm start
```

Run behind nginx / a reverse proxy. Use PM2 or systemd for process management. Set `CORS_ORIGIN` to your real frontend domain. Provide all SMTP and JWT env vars — the app will start without them but auth and email features will fail.

---

## Tech stack

| Layer       | Tools                                                       |
|-------------|-------------------------------------------------------------|
| Frontend    | React 18, Vite 5, Tailwind 3, react-router 6, Recharts, axios, lucide-react |
| Backend     | Node 18, Express 4, pg, JWT, bcryptjs, multer, nodemailer, node-cron, express-validator, express-rate-limit, xlsx |
| Database    | PostgreSQL 15 (`uuid-ossp`, `pgcrypto`)                    |
| Tests       | Jest + supertest (backend), Cypress (frontend)             |
| Container   | docker-compose                                             |

---

## License

MIT
