/**
 * Manually trigger the nightly backup (utils/backup.js) without waiting for
 * the 03:00 cron. Same code path, same S3 destination, same retention
 * pruning — this is not a dry run.
 *
 *   docker compose exec backend node run_backup.js
 */
require('dotenv').config();
const { runBackup } = require('./utils/backup');

runBackup()
  .then((summary) => {
    console.log('Backup complete:');
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
  });
