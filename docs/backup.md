# Database backup & restore

Nxt-People keeps everything in a single PostgreSQL database. Lose that, you
lose every attendance record, leave balance, payroll figure, and PAN/bank
number on file. **You need backups.**

This runbook covers the minimum-viable strategy: nightly `pg_dump` → S3, with
a 30-day retention window and a documented restore drill.

---

## What gets backed up

The whole `nxt_people` database. That includes:

- Every employee record (incl. PAN, bank account, photo URLs, MFA secrets)
- Attendance, leave, timesheets, performance reviews
- Audit log, refresh tokens, notifications
- Uploaded profile photos live on disk at `backend/uploads/photos/` — they
  are NOT in the DB. Back up that directory separately (see § "Uploaded files").

## What you'll need

| Item | Why |
|---|---|
| AWS S3 bucket (or GCS / Azure Blob) | Backup destination. Versioning ON, lifecycle rule to delete after 90 days. |
| IAM user with `s3:PutObject` on that bucket | Backup script credentials. Limit to that prefix. |
| A small VM or container that can reach the DB | Where the backup script runs. |
| 5 minutes of nightly maintenance window | When the backup runs. Off-peak. |

## Nightly backup script

Save as `/usr/local/bin/nxt-people-backup.sh` on whichever host runs your DB
(or a sidecar). Make it executable: `chmod +x /usr/local/bin/nxt-people-backup.sh`.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-nxt_people}"
S3_BUCKET="${S3_BUCKET:?need bucket name}"           # e.g. nxt-people-backups
S3_PREFIX="${S3_PREFIX:-db}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# PGPASSWORD must be exported in the environment (don't write it into this file).
export PGPASSWORD="${PGPASSWORD:?PGPASSWORD not set}"

TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
TMP="/tmp/nxt-people-${TS}.sql.gz"

echo "→ Dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} …"
pg_dump --host "${DB_HOST}" --port "${DB_PORT}" --username "${DB_USER}" \
        --no-owner --no-privileges --clean --if-exists \
        "${DB_NAME}" | gzip -9 > "${TMP}"

SIZE_HUMAN="$(du -h "${TMP}" | cut -f1)"
echo "→ Uploading ${TMP} (${SIZE_HUMAN}) to s3://${S3_BUCKET}/${S3_PREFIX}/"
aws s3 cp --no-progress "${TMP}" "s3://${S3_BUCKET}/${S3_PREFIX}/${TS}.sql.gz"

rm -f "${TMP}"

# ── Cleanup: remove dumps older than RETAIN_DAYS ──────────────────────────
CUTOFF="$(date -u -d "${RETAIN_DAYS} days ago" +%Y-%m-%d 2>/dev/null \
       || date -u -v-"${RETAIN_DAYS}"d +%Y-%m-%d)"  # GNU vs BSD date
aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" | while read -r line; do
  d="$(echo "${line}" | awk '{print $1}')"
  f="$(echo "${line}" | awk '{print $4}')"
  if [[ "${d}" < "${CUTOFF}" ]]; then
    aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${f}"
    echo "× Pruned ${f}"
  fi
done

echo "✓ Backup complete: ${TS}.sql.gz (${SIZE_HUMAN})"
```

## Schedule with cron

```cron
# /etc/cron.d/nxt-people-backup
0 2 * * *  postgres  PGPASSWORD=… S3_BUCKET=nxt-people-backups /usr/local/bin/nxt-people-backup.sh >> /var/log/nxt-people-backup.log 2>&1
```

Runs at **02:00 UTC** every day. Off-peak even for east-of-UTC deployments.

### Don't want cron? Use docker-compose

```yaml
backup:
  image: postgres:15-alpine
  restart: unless-stopped
  depends_on: [db]
  environment:
    - PGPASSWORD=${DB_PASSWORD}
    - DB_HOST=db
    - DB_NAME=nxt_people
    - DB_USER=postgres
    - S3_BUCKET=${BACKUP_S3_BUCKET}
    - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
    - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
  volumes:
    - ./scripts/nxt-people-backup.sh:/backup.sh:ro
  entrypoint: ["sh", "-c"]
  command: ["apk add --no-cache aws-cli && while :; do /backup.sh; sleep 86400; done"]
```

## Restore drill

**Do this at least once a quarter.** A backup you've never restored from is
just hope. The drill:

1. Spin up a fresh empty Postgres instance (compose, local docker, anything).
2. Download the latest dump from S3:
   ```bash
   aws s3 ls s3://nxt-people-backups/db/ | tail -1
   aws s3 cp s3://nxt-people-backups/db/<latest>.sql.gz /tmp/
   ```
3. Restore:
   ```bash
   gunzip -c /tmp/<latest>.sql.gz | psql -h localhost -U postgres -d nxt_people_restore_test
   ```
4. Point a local backend at the restored DB and verify:
   - Can you log in as `admin@nxtpeople.com`?
   - Does `/api/dashboard/stats` return non-empty data?
   - Does `SELECT COUNT(*) FROM employees` match production?
5. Drop the test DB and log the drill date in your team wiki.

## Uploaded files

Profile photos and document attachments live at `backend/uploads/`. They are
**not** captured by `pg_dump`. Two options:

1. **Object storage from the start** (recommended). Replace local disk
   storage in `routes/profile.js` and `routes/documents.js` with S3 uploads.
   Then your DB backup + bucket lifecycle = full backup.
2. **Daily rsync** of `backend/uploads/` to a separate S3 prefix:
   ```bash
   aws s3 sync /opt/nxt-people/backend/uploads/ s3://nxt-people-backups/uploads/ --delete
   ```

## RPO / RTO targets (suggested)

| Metric | Target |
|---|---|
| **RPO** (max acceptable data loss) | 24 hours (matches nightly cadence). For tighter, use streaming replication. |
| **RTO** (max acceptable restore time) | 30 minutes (download → gunzip → psql for a < 5 GB dump on modern hardware). |

## What's NOT covered (yet)

- **Point-in-time recovery (PITR)** — requires WAL archiving, more setup.
  Add when the business case justifies it (multi-tenant SaaS, regulated industry).
- **Encryption at rest** of the dump itself — S3 server-side encryption (SSE-S3
  or SSE-KMS) is the easy path. Turn it on in bucket settings.
- **Off-site copy** — if your AWS account is compromised, your S3 backups go
  with it. For real disaster recovery, replicate the bucket to a second cloud.
