/**
 * utils/backup.js — nightly DB + document backup, shipped to S3.
 *
 * Two things, both read straight off disk and shipped as-is:
 *   1. pg_dump of the whole database, gzipped.
 *   2. backend/uploads/ — including the per-employee folders where
 *      documentStore.js already wrote every identity document AES-256-GCM
 *      encrypted. This step never decrypts or re-encrypts anything; it
 *      archives the same ciphertext that's already on disk, so a stolen
 *      backup is exactly as protected as the live files are.
 *
 * Both land in S3 under backups/<YYYY-MM-DD>/, and anything older than
 * BACKUP_RETENTION_DAYS gets pruned from the bucket after a successful run.
 *
 * Misconfiguration throws rather than skipping quietly — a backup job that
 * silently does nothing is the exact failure mode the ISO 27001 review
 * flagged in the first place (docs/backup.md existed, nothing ever ran it).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { ROOT: UPLOADS_ROOT } = require('./documentStore');
const { DEFAULT_TZ } = require('./timezone');

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

function s3Config() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  // Unset -> real AWS S3. Set -> any S3-compatible endpoint (self-hosted
  // RustFS, Backblaze B2, DigitalOcean Spaces, …) without touching this file.
  const endpoint = process.env.BACKUP_S3_ENDPOINT || undefined;
  return { bucket, region, accessKeyId, secretAccessKey, endpoint };
}

/* pg_dump's stdout -> gzip -> a local file. No intermediate uncompressed
 * copy ever touches disk. */
function pgDump(destPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--host', process.env.DB_HOST || 'localhost',
      '--port', String(process.env.DB_PORT || 5432),
      '--username', process.env.DB_USER || 'postgres',
      '--no-owner', '--no-privileges',
      process.env.DB_NAME || 'nxt_people',
    ];
    const child = spawn('pg_dump', args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' },
    });
    const out = fs.createWriteStream(destPath);
    const gzip = zlib.createGzip({ level: 9 });
    let stderr = '';
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const succeed = () => { if (!settled) { settled = true; resolve(); } };

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', fail);
    gzip.on('error', fail);
    out.on('error', fail);
    child.stdout.pipe(gzip).pipe(out);

    child.on('close', (code) => {
      if (code !== 0) fail(new Error(`pg_dump exited ${code}: ${stderr.trim().slice(0, 500)}`));
      // code 0: keep waiting for `out` to actually finish flushing below.
    });
    out.on('finish', succeed);
  });
}

/* The whole uploads/ tree — documents, photos, covers, logos — as one
 * uploads/… tar.gz, built in-process with the archiver lib already used
 * elsewhere in this codebase (routes/exports.js) rather than shelling out. */
function archiveUploads(destPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };

    out.on('close', () => { if (!settled) { settled = true; resolve(archive.pointer()); } });
    out.on('error', fail);
    archive.on('error', fail);
    // A warning for a vanished file mid-archive is not fatal — an upload
    // being deleted the same minute this runs is a race, not a corruption.
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') fail(err); });

    archive.pipe(out);
    archive.directory(UPLOADS_ROOT, 'uploads');
    archive.finalize();
  });
}

function s3Client(cfg) {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // Most non-AWS S3-compatible endpoints need path-style addressing;
    // real AWS S3 wants the opposite (virtual-hosted-style, the default).
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

async function uploadFile(client, bucket, key, filePath) {
  const body = fs.readFileSync(filePath);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  return body.length;
}

/* Deletes every object under backups/<date>/… whose date is older than
 * RETENTION_DAYS. Driven by the date in the KEY, not the object's S3
 * upload timestamp, so it survives a bucket migration or a re-upload. */
async function pruneOldBackups(client, bucket, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10);
  const pruned = [];
  let ContinuationToken;
  do {
    const resp = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'backups/', ContinuationToken }));
    const toDelete = (resp.Contents || [])
      .map((obj) => ({ Key: obj.Key, date: obj.Key.match(/^backups\/(\d{4}-\d{2}-\d{2})\//)?.[1] }))
      .filter((obj) => obj.date && obj.date < cutoff)
      .map((obj) => ({ Key: obj.Key }));
    if (toDelete.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: toDelete } }));
      pruned.push(...toDelete.map((o) => o.Key));
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return pruned;
}

async function runBackup() {
  const startedAt = Date.now();
  const cfg = s3Config();
  if (!cfg) {
    throw new Error(
      'Backup cannot run: BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID and ' +
      'BACKUP_S3_SECRET_ACCESS_KEY must all be set (see .env.example).'
    );
  }

  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: process.env.CRON_TZ || DEFAULT_TZ });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxt-backup-'));
  const dumpPath = path.join(tmpDir, 'db.sql.gz');
  const archivePath = path.join(tmpDir, 'uploads.tar.gz');

  try {
    await pgDump(dumpPath);
    const uploadsBytes = await archiveUploads(archivePath);
    const dumpBytes = fs.statSync(dumpPath).size;

    const client = s3Client(cfg);
    const dbKey = `backups/${dateStr}/db.sql.gz`;
    const uploadsKey = `backups/${dateStr}/uploads.tar.gz`;
    await uploadFile(client, cfg.bucket, dbKey, dumpPath);
    await uploadFile(client, cfg.bucket, uploadsKey, archivePath);

    const pruned = await pruneOldBackups(client, cfg.bucket, RETENTION_DAYS);

    return {
      date: dateStr,
      dbDumpBytes: dumpBytes,
      uploadsArchiveBytes: uploadsBytes,
      s3Keys: [dbKey, uploadsKey],
      prunedCount: pruned.length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // Always, whether the run succeeded or not — a failed backup must not
    // also leave a plaintext-adjacent dump sitting in /tmp.
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { runBackup };
