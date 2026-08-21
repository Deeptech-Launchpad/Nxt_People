/* ── Turn a Zoho authorization code into a refresh token ───────────────────
 *  The attendance module needs a scope this token does not hold, and adding a
 *  scope means a new refresh token. That exchange is a single POST, but it is
 *  a POST with five parameters, a ten-minute expiry, and a code that works
 *  exactly once — which is a lot of ways for a shell-quoting mistake to look
 *  like a Zoho problem.
 *
 *  So: paste the code, get the refresh token.
 *
 *    node zoho_grant.js 1000.abc123...
 *
 *  Reads ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_AUTH_URL from the
 *  environment the backend already has, so there is nothing to retype and no
 *  chance of pointing at the wrong data centre.
 *
 *  Touches no database and sends no mail. It prints a secret to the terminal
 *  and writes it nowhere — putting it in the .env is a decision for a person.
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();

const CODE = process.argv[2];

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.log(`\n  ${k} is not set in this environment.\n`); process.exit(1); }
  return v;
};

(async () => {
  if (!CODE) {
    console.log('\n  usage: node zoho_grant.js <authorization-code>');
    console.log('\n  Get the code from the Zoho API Console — Self Client → Generate Code,');
    console.log('  with these scopes:\n');
    console.log('    ZohoPeople.forms.READ,ZohoPeople.employee.READ,ZohoPeople.attendance.READ\n');
    console.log('  The code expires in ten minutes and works once.\n');
    process.exit(1);
  }

  // Several exchanges failed as "invalid_code" when the fault was a truncated
  // paste: the console shows the code with a trailing ellipsis, and selecting
  // it by hand takes the dots along. Zoho cannot tell a cut code from an
  // expired one, so it reports expired, and you generate another that pastes
  // the same way.
  //
  // But only the ellipsis is worth refusing over. Zoho issues codes in more
  // than one shape — a single segment of thirty-odd characters, and an older
  // two-segment form — and a length rule written from one sample rejects
  // perfectly good codes, which is a worse failure than the one it prevents.
  if (/\.\.+$/.test(CODE) || CODE.includes('…') || /\s/.test(CODE)) {
    console.log('\n  That code was not sent — it has the console\'s "..." on the end.\n');
    console.log(`  Got: ${CODE}\n`);
    console.log('  Those dots mark text too long to display; they are not part of the');
    console.log('  code. Use DOWNLOAD rather than COPY, open the file it saves, and take');
    console.log('  the code from there.\n');
    process.exit(1);
  }

  const authUrl = need('ZOHO_AUTH_URL');
  const clientId = need('ZOHO_CLIENT_ID');
  const clientSecret = need('ZOHO_CLIENT_SECRET');

  // A code is issued for one client. Exchanged against a different app's id,
  // Zoho answers invalid_code — the same words it uses for an expired code —
  // and there is nothing in that message to tell you which of the two happened.
  // Showing the id being used lets you check it against the console yourself.
  console.log(`\n  Exchanging with ${authUrl}`);
  console.log(`  As client   ${clientId}\n`);
  console.log('  That id must belong to the SAME application the code came from.');
  console.log('  A code from one app exchanged against another reads as invalid_code.\n');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: CODE,
  });

  const r = await fetch(`${authUrl}?${params.toString()}`, { method: 'POST' });
  const body = await r.json().catch(() => ({}));

  if (!body.refresh_token) {
    console.log('  No refresh token came back.\n');
    console.log(`  Zoho said: ${JSON.stringify(body)}\n`);
    if (body.error === 'invalid_code') {
      console.log('  invalid_code means the code has expired or has already been used.');
      console.log('  Generate a fresh one — each works exactly once.\n');
    }
    if (body.error === 'invalid_client') {
      console.log('  invalid_client usually means the code came from a different data');
      console.log('  centre than ZOHO_AUTH_URL points at. A .in console needs a .in URL.\n');
    }
    process.exit(1);
  }

  console.log('  ── Scopes this token now holds ──\n');
  for (const s of String(body.scope || '').split(/[\s,]+/).filter(Boolean)) console.log(`    ${s}`);
  const hasAttendance = String(body.scope || '').toLowerCase().includes('attendance');
  console.log(`\n  attendance   ${hasAttendance ? 'GRANTED' : 'STILL MISSING — the code was generated without it'}\n`);

  console.log('  ── Put this in the ROOT .env, not backend/.env ──\n');
  console.log(`ZOHO_REFRESH_TOKEN=${body.refresh_token}\n`);
  console.log('  Then: docker compose up -d --build\n');

  if (!hasAttendance) {
    console.log('  Saving this one will not help — generate another code with');
    console.log('  ZohoPeople.attendance.READ included in the scope box.\n');
  }
})().catch(e => { console.error(e); process.exit(1); });
