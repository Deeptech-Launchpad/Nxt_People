/* Task reminder delivery.
 *
 * Storing a reminder and never acting on it is worse than not offering the
 * field, so these are delivered — in-app, never by email, because live has no
 * allowlist between a send and a real inbox.
 *
 * The failure that matters is delivering the same reminder twice. The sweep
 * runs every minute, so a row that is read and then updated is read again by
 * the next tick before the update lands. Claiming with UPDATE ... RETURNING is
 * the fix, and this proves it by running two sweeps concurrently.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const pool = require('./db');
const { deliverDueTaskReminders, CATCH_UP_HOURS } = require('./utils/taskReminders');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 260)}`); };

const made = [];
const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
const hoursAhead = h => new Date(Date.now() + h * 3600 * 1000).toISOString();

const mkTask = async (ownerId, reminderAt, status = 'open') => {
  const r = await pool.query(
    `INSERT INTO tasks (title, assignee_id, assigned_to, status, reminder_at, due_date)
     VALUES ($1,$2,$2,$3,$4,CURRENT_DATE) RETURNING id`,
    ['reminder test', ownerId, status, reminderAt]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
};

const notifCount = async (ownerId) =>
  (await pool.query(
    `SELECT COUNT(*)::int n FROM notifications WHERE employee_id=$1 AND type='task_reminder'`,
    [ownerId])).rows[0].n;

(async () => {
  const owner = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!owner) { console.log('  no employees\n'); await pool.end(); process.exit(0); }

  await pool.query(`DELETE FROM notifications WHERE employee_id=$1 AND type='task_reminder'`, [owner.id]);

  console.log('\nTask reminder delivery\n');

  /* 1 - a due reminder is delivered once. */
  {
    const before = await notifCount(owner.id);
    await mkTask(owner.id, hoursAgo(1));
    const r = await deliverDueTaskReminders();
    check('a due reminder is delivered', r.delivered >= 1, r);
    check('  ...as exactly one notification', (await notifCount(owner.id)) === before + 1,
      { before, after: await notifCount(owner.id) });
  }

  /* 2 - THE ONE THAT MATTERS: a second sweep must not send it again. */
  {
    const before = await notifCount(owner.id);
    const again = await deliverDueTaskReminders();
    check('a second sweep delivers nothing', again.delivered === 0, again);
    check('  ...and adds no notification', (await notifCount(owner.id)) === before);
  }

  /* 3 - two sweeps racing must still deliver once. */
  {
    await pool.query(`DELETE FROM notifications WHERE employee_id=$1 AND type='task_reminder'`, [owner.id]);
    await mkTask(owner.id, hoursAgo(2));
    const [a, b] = await Promise.all([deliverDueTaskReminders(), deliverDueTaskReminders()]);
    check('two concurrent sweeps deliver it once between them',
      a.delivered + b.delivered === 1, { a: a.delivered, b: b.delivered });
    check('  ...and exactly one notification exists', (await notifCount(owner.id)) === 1,
      await notifCount(owner.id));
  }

  /* 4 - not yet due, completed, and long-stale reminders are all left alone. */
  {
    await pool.query(`DELETE FROM notifications WHERE employee_id=$1 AND type='task_reminder'`, [owner.id]);
    await mkTask(owner.id, hoursAhead(2));                       // future
    await mkTask(owner.id, hoursAgo(1), 'completed');            // already done
    await mkTask(owner.id, hoursAgo(CATCH_UP_HOURS + 5));        // older than the catch-up window
    const r = await deliverDueTaskReminders();
    check('a future reminder is not delivered early', r.delivered === 0, r);
    check('  ...nor one on a completed task', (await notifCount(owner.id)) === 0);
    check('  ...nor a stale backlog from before the catch-up window',
      (await notifCount(owner.id)) === 0);
  }

  for (const id of made) await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
  await pool.query(`DELETE FROM notifications WHERE employee_id=$1 AND type='task_reminder'`, [owner.id]);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  for (const id of made) await pool.query('DELETE FROM tasks WHERE id=$1', [id]).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
