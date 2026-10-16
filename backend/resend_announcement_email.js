/* ── Resend an announcement's email ───────────────────────────────────────
 *  Announcements now email every active employee automatically on POST
 *  (see routes/announcements.js), but one posted before that shipped never
 *  triggered it. This sends it after the fact for a single announcement.
 *
 *  Usage:
 *    node resend_announcement_email.js                 # today's most recent
 *                                                         announcement — dry
 *                                                         run, sends nothing
 *    node resend_announcement_email.js <announcementId> # a specific one —
 *                                                         dry run
 *    node resend_announcement_email.js <announcementId> --send
 *                                                        # actually sends
 *
 *  Always prints what it found and who it would email first. Only sends
 *  real mail when --send is passed explicitly — this is real mail to every
 *  active employee, not a test run.
 * ─────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');
const { sendMail, renderTemplateEmail } = require('./utils/mailer');

const args = process.argv.slice(2).filter(a => a !== '--send');
const doSend = process.argv.includes('--send');
const announcementId = args[0] || null;

(async () => {
  const ann = announcementId
    ? (await pool.query(
        `SELECT id, title, content AS body, created_at AS "createdAt" FROM announcements WHERE id = $1`,
        [announcementId]
      )).rows[0]
    : (await pool.query(
        `SELECT id, title, content AS body, created_at AS "createdAt" FROM announcements
          WHERE created_at::date = CURRENT_DATE
          ORDER BY created_at DESC LIMIT 1`
      )).rows[0];

  if (!ann) {
    console.error(announcementId
      ? `No announcement found with id ${announcementId}`
      : 'No announcement found with today\'s date — pass an announcement id explicitly.');
    await pool.end();
    process.exit(1);
  }

  const recipients = (await pool.query(
    `SELECT id, email FROM employees
      WHERE status = 'active' AND email IS NOT NULL AND email <> ''`
  )).rows;

  console.log('Announcement:', JSON.stringify({ id: ann.id, title: ann.title, createdAt: ann.createdAt }, null, 2));
  console.log(`Body:\n${ann.body}\n`);
  console.log(`Would email ${recipients.length} active employee(s).`);

  if (!doSend) {
    console.log('\nDry run only — nothing was sent. Re-run with --send to actually email everyone.');
    await pool.end();
    return;
  }

  console.log('\n--send passed — sending for real now.');
  const link = `${process.env.FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech'}/announcements?open=${ann.id}`;
  let sent = 0, failed = 0;
  for (const r of recipients) {
    try {
      await sendMail({
        to: r.email,
        subject: ann.title,
        text: ann.body,
        html: renderTemplateEmail({ title: ann.title, bodyText: ann.body, linkLabel: 'View Announcement', linkUrl: link }),
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`  failed for ${r.email}: ${err.message}`);
    }
  }
  console.log(`\nDone. Sent (or queued): ${sent}, failed: ${failed}, total: ${recipients.length}`);
  await pool.end();
})().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
