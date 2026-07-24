# Deployment Runbook

Production deployment of Nxt People. Target: a Linux host with Docker + Docker Compose v2.

This document is the source of truth for going live. The dev setup in README.md
is for local development; DO NOT use it for production.

---

## Architecture

```
                          ┌──────────────────┐
   user (HTTPS) ──────────►   nginx (host)   ├──── TLS termination
                          │   :443 / :80     │
                          └────────┬─────────┘
                                   │ HTTP, 127.0.0.1
                          ┌────────▼─────────┐
                          │  frontend (80)   │── serves SPA
                          │  nginx in docker ├──┐
                          └──────────────────┘  │ /api/ + /uploads/
                                                ▼
                          ┌──────────────────┐
                          │  backend (5000)  │── Express + cron jobs
                          │  not host-exposed│
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │   postgres 15    │── pgdata volume
                          │  not host-exposed│
                          └──────────────────┘
```

Only the frontend container's port is reachable from outside. The system-nginx
in front is optional but recommended (terminates TLS, serves the Let's Encrypt
challenge, gives you a reload-able config without rebuilding images).

---

## Pre-flight checklist

Confirm BEFORE running anything on the server:

- [ ] Domain name with DNS A-record pointing to the server's public IP
- [ ] Server reachable on ports 80 + 443
- [ ] Docker 24+ and Docker Compose v2 installed (`docker compose version`)
- [ ] SMTP credentials for the `EMAIL_USER` account (Gmail app password, or
      transactional provider API credentials)
- [ ] Zoho People OAuth client credentials (optional — leave blank to disable)
- [ ] Sentry DSN (optional — leave blank to disable error tracking)
- [ ] All secrets that previously touched git history have been **rotated** at
      the provider. Reusing a leaked secret is not optional.

---

## Step 1 — Clone and configure

```bash
git clone <repo-url> /opt/nxt-people
cd /opt/nxt-people
```

Generate the JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Create `backend/.env` from the template:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in **every** field. Required for first boot:

| Variable                 | Example                                   |
|--------------------------|-------------------------------------------|
| `NODE_ENV`               | `production`                              |
| `CORS_ORIGIN`            | `https://hr.acme.com`                     |
| `FRONTEND_URL`           | `https://hr.acme.com`                     |
| `ADMIN_EMAIL`            | `you@acme.com, another@acme.com`          |
| `DB_PASSWORD`            | strong random string                      |
| `JWT_SECRET`             | output of the openssl/node command above  |
| `EMAIL_USER` / `_PASS`   | SMTP account                              |

The frontend has its own `.env.example` for Sentry; if you're not using Sentry,
skip it.

---

## Step 2 — Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file backend/.env up -d --build
```

This will:

1. Build `backend` (multi-stage, non-root, dumb-init).
2. Build `frontend` (multi-stage, nginx with /api + /uploads proxy baked in).
3. Initialise Postgres from `backend/schema.sql` on first boot.
4. Backend entrypoint runs `node migrate.js` — applies every migration in order
   (idempotent; safe to re-run).
5. Backend bootstraps any `ADMIN_EMAIL` rows that don't exist yet.
6. Cron jobs start (auto-checkout, late-mark, etc.).

Watch the logs until both services report healthy:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

---

## Step 3 — First admin login

The admin row was created with no password. To set one:

1. Visit `https://hr.acme.com/login`
2. Enter the admin email → click **Continue** → click **Forgot password**
3. Click the link in the email that arrives
4. Set a strong password (and enable MFA in Profile → Security afterwards)

If the email never arrives, check:
- `docker compose -f docker-compose.prod.yml logs backend | grep -i mail`
- The SMTP provider's "delivery" or "activity" dashboard
- Spam folder
- That `FRONTEND_URL` in `.env` is the public HTTPS URL (the reset link is
  built from it; localhost links won't work)

---

## Step 4 — TLS

Recommended: terminate TLS in a system-level nginx in front of the docker
stack. Map the docker frontend to a localhost port instead of 80:

In `docker-compose.prod.yml`, change the frontend ports line:

```yaml
    ports:
      - "127.0.0.1:8080:80"
```

Then install nginx on the host and add a server block:

```nginx
server {
  listen 443 ssl http2;
  server_name hr.acme.com;

  ssl_certificate     /etc/letsencrypt/live/hr.acme.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/hr.acme.com/privkey.pem;

  client_max_body_size 25m;

  location / {
    proxy_pass         http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name hr.acme.com;
  return 301 https://$host$request_uri;
}
```

Issue the certificate with `certbot --nginx -d hr.acme.com`. Renewals are
handled by certbot's systemd timer.

---

## Step 5 — Importing real employees (optional, Zoho)

Once admin is logged in and Zoho credentials are set in `backend/.env`:

1. Restart backend to pick up Zoho env vars:
   `docker compose -f docker-compose.prod.yml restart backend`
2. As admin, go to **Admin → Sync Zoho** (or POST `/api/admin/zoho/sync`).
3. Sync is one-way and manual. It upserts employees, never touches roles,
   passwords, or leave balances on existing rows.
4. After sync, notify staff to use **Forgot password** to set their first
   password. Gmail caps personal accounts at ~500/day, Workspace at ~2,000/day
   — for a company of 70, this is fine; for larger rollouts, switch to a
   transactional provider (SendGrid, Postmark, Brevo, AWS SES) BEFORE the
   batch send.

---

## Day-to-day operations

### Update to a new version

```bash
cd /opt/nxt-people

# 1. Take a DB snapshot BEFORE pulling — your rollback artifact.
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U postgres -d nxt_people --no-owner --format=custom \
  > pre-upgrade-$(date +%Y%m%d-%H%M%S).dump

# 2. Note the current commit so you can roll the code back if needed.
git rev-parse HEAD > pre-upgrade-commit.txt

# 3. Pull + rebuild.
git pull
docker compose -f docker-compose.prod.yml --env-file backend/.env up -d --build
```

Backend migrations run automatically on container start. Zero-downtime is
not configured by default — there's a few seconds of 502 during restart.

#### Safer variant: run migrations before swapping containers

The one-liner above runs `migrate.js` *inside* the new backend container's
entrypoint. If a migration fails, the new container never becomes healthy,
`depends_on: condition: service_healthy` blocks the frontend from starting
too, and the currently-running (old, healthy) backend gets torn down by
`docker compose up` regardless — so a bad migration causes an outage, not
just a failed deploy.

To catch a bad migration *before* touching the running containers, run
migrations as a standalone one-off first:

```bash
# 1. Snapshot + note commit, same as above.

# 2. Pull the new code.
git pull

# 3. Build the new backend image, then run migrations in a throwaway
#    container against the SAME db/network. --build picks up the pulled
#    code (including any new migration files) before running. --entrypoint
#    overrides docker-entrypoint.sh (which always execs the server
#    afterward and would otherwise hang here) so this container just runs
#    migrate.js and exits. The currently-running backend/frontend keep
#    serving traffic untouched throughout.
#    If this fails, nothing in production has changed yet — fix and re-run.
docker compose -f docker-compose.prod.yml --env-file backend/.env \
  run --rm --build --entrypoint node backend migrate.js

# 4. Only if step 3 succeeded: rebuild and swap containers, telling the
#    entrypoint to skip migrations (already applied in step 3). RUN_MIGRATIONS
#    is a host shell var here — it's forwarded into the container via
#    docker-compose.prod.yml's environment section.
RUN_MIGRATIONS=false docker compose -f docker-compose.prod.yml --env-file backend/.env \
  up -d --build backend frontend
```

Since `migrate.js` now tracks completed migrations in a `schema_migrations`
table, step 3 only runs whatever is new since the last deploy — not the
full migration history — so this adds negligible time on top of the
already-required rebuild.

### Rolling back a bad deploy

If the new version is broken (5xx storm, login fails, migration corrupts data),
roll back in this order:

```bash
# 1. Bring the new stack down (DB volume preserved).
docker compose -f docker-compose.prod.yml down

# 2. Reset the working tree to the last known-good commit.
git checkout "$(cat pre-upgrade-commit.txt)"

# 3. If the bad release ran destructive migrations, restore the DB snapshot
#    you took above. SKIP THIS STEP if migrations were additive only —
#    restoring throws away every row written since the snapshot.
cat pre-upgrade-YYYYMMDD-HHMMSS.dump | \
  docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U postgres -d nxt_people --clean --if-exists

# 4. Bring the old version back up.
docker compose -f docker-compose.prod.yml --env-file backend/.env up -d --build
```

If you only need to roll back the **frontend** (most common — bad UI ship,
clean DB), pull the previous commit and rebuild just the frontend container:

```bash
git checkout "$(cat pre-upgrade-commit.txt)" -- frontend/
docker compose -f docker-compose.prod.yml up -d --build frontend
```

### Automating backups

Add a daily cron to ship dumps off the prod host:

```cron
# /etc/cron.d/nxt-people-backup
0 2 * * * root cd /opt/nxt-people && \
  docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U postgres -d nxt_people --no-owner --format=custom \
  | aws s3 cp - s3://your-bucket/nxt-people/db-$(date +\%Y\%m\%d).dump
```

Substitute S3 with B2, rsync to a peer machine, or whatever off-site target
you trust. Verify the dump is restorable monthly — an untested backup is
not a backup.

### TLS certificate renewal

`certbot --nginx -d hr.acme.com` installs a systemd timer (`certbot.timer`)
that renews automatically. Verify it's healthy after the first issue:

```bash
systemctl status certbot.timer        # should be "active (waiting)"
sudo certbot renew --dry-run          # exercises the full flow
```

Set a calendar reminder ~80 days out to confirm the next renewal landed.
Lets Encrypt certs are 90 days; the timer fires at 60.

### Tail logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
```

Backend emits structured JSON in production — pipe to `jq` or ship to
Loki / Datadog / Cloudwatch as you prefer.

### Database backup

```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U postgres -d nxt_people --no-owner --format=custom \
  > backup-$(date +%Y%m%d-%H%M%S).dump
```

Restore:

```bash
cat backup.dump | docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U postgres -d nxt_people --clean --if-exists
```

Schedule `pg_dump` via cron daily. Ship the dump off-server (S3, B2, a peer
machine) — a backup that lives only on the production host is not a backup.

### Uploaded files backup

```bash
docker run --rm -v nxt-people_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads-$(date +%Y%m%d).tgz -C /data .
```

### Rate-limit emergency override

Onboarding storms, password-reset storms, or any auth-rate-limit fire drill:

```bash
# In backend/.env:
RATE_LIMIT_DISABLED=true
# Then:
docker compose -f docker-compose.prod.yml restart backend
```

Remove the flag and restart once the burst is over.

### Reset a user's MFA

If a user loses their TOTP device AND their backup codes, only an admin can
unlock them. Admins go to **Employees → [user] → Security → Reset MFA**, or
SQL directly:

```sql
UPDATE employees
SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_backup_codes = '[]'::jsonb
WHERE email = 'them@acme.com';
```

---

## What's NOT included

These are scope decisions, not gaps. Add them if your deployment needs them:

- **Off-site backups** — `pg_dump` writes locally; you must ship the file.
- **Uptime monitoring** — Sentry catches errors, not outages. Add Uptime Kuma,
  BetterStack, or similar.
- **Horizontal scaling** — single backend container. node-cron jobs assume
  exactly one runner; running multiple backends will duplicate cron firings.
  If you need to scale, lift cron into a dedicated worker.
- **httpOnly cookie auth** — JWT lives in `localStorage`. Fine for an internal
  tool; if Nxt People becomes externally accessible to untrusted networks,
  migrate to httpOnly cookies + CSRF tokens.
- **Async email queue** — passwords reset synchronously through nodemailer.
  Fine for ≤70 users. For bulk sends, introduce BullMQ + Redis.

---

## Troubleshooting

| Symptom                                  | Likely cause                                            |
|------------------------------------------|---------------------------------------------------------|
| Frontend loads but `/api/*` returns 502  | Backend container not healthy — `logs backend`          |
| Password-reset email never sent          | SMTP env vars wrong, or provider rate-limited           |
| Password-reset link goes to `localhost`  | `FRONTEND_URL` in `.env` not set to public URL          |
| 401 on every login                       | `JWT_SECRET` was rotated — every issued token is invalid|
| `ECONNREFUSED 127.0.0.1:5432`            | Backend started before DB healthy; restart backend      |
| `Cannot read property of undefined` on /uploads | Old image — rebuild with `--build`               |
| Sunday shows as "Absent" not "Weekend"   | Weekend rule rows have `start_date > today` — see migrate_fixes.js |
