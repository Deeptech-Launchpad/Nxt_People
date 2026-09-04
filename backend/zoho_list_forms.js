/* ── Every form this Zoho account has, by its real name ──────────────────────
 *  The last check guessed three balance-shaped form names and Zoho refused
 *  all three with the same "Error occurred" envelope forms.READ gives an
 *  unknown link name — which does not distinguish "wrong name" from "no such
 *  form exists". This asks Zoho for the actual list instead of guessing
 *  again, the same call zoho_survey.js already uses to open all sixteen.
 *
 *  Read-only. One GET.
 *
 *    docker compose exec backend node zoho_list_forms.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const { zohoApi } = require('./utils/zoho');

(async () => {
  console.log('\n=== Every form Zoho reports for this account ===\n');
  const list = await zohoApi('forms');
  const body = list?.response?.result ?? list?.response ?? list;
  const forms = Array.isArray(body) ? body : Object.values(body || {}).flat().filter(Boolean);

  if (!forms.length) {
    console.log('  Nothing came back. Raw response:');
    console.log(JSON.stringify(list, null, 2).slice(0, 2000));
    return;
  }

  for (const f of forms) {
    const name = f.formLinkName || f.linkName || f.formName || f.displayName || '(unnamed)';
    const label = f.displayName && f.displayName !== name ? `  "${f.displayName}"` : '';
    console.log(`  ${name}${label}`);
  }

  console.log(`\n${forms.length} form(s) total.`);
  const hit = forms.filter(f => /balance|leaveuser|leavetype|customize/i
    .test(f.formLinkName || f.linkName || f.formName || f.displayName || ''));
  if (hit.length) {
    console.log(`\nBalance-shaped by name: ${hit.map(f => f.formLinkName || f.linkName || f.formName).join(', ')}`);
    console.log('Worth trying forms/<name>/getRecords directly.');
  } else {
    console.log('\nNothing named like a balance form. Customize Balance is very likely not');
    console.log('exposed as a form at all — it reads as a computed view inside the leave');
    console.log('module, behind ZohoPeople.leave.READ specifically, not forms.READ.');
  }
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
