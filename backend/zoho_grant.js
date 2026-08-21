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

  // Three exchanges in a row failed as "invalid_code" when the real fault was a
  // truncated paste: the Zoho console shows the code with a trailing ellipsis,
  // and hand-selecting it takes the dots along. Zoho cannot tell the difference
  // between a cut code and an expired one, so it says expired — and you go and
  // generate another, which pastes the same way. Checking the shape here ends
  // that loop.
  const shape = /^1000\.[0-9a-f]{32}\.[0-9a-f]{32}$/i;
  if (!shape.test(CODE)) {
    const tail = CODE.split('.').pop();
    console.log('\n  That code is not the right shape, so it was not sent.\n');
    console.log(`  Got:       ${CODE.length} characters, ${CODE.split('.').length - 1} dot(s)`);
    console.log('  Expected:  1000. then 32 characters, a dot, then 32 more\n');
    if (/\.$/.test(CODE) || /\.\.+/.test(CODE)) {
      console.log('  It ends in dots. Those are the console\'s "..." for text too long to');
      console.log('  show, not part of the code — the copy took the display, not the value.\n');
    } else if (tail && tail.length < 32) {
      console.log(`  The part after the last dot is ${tail.length} characters, not 32. It is cut short.\n`);
    }
    console.log('  Use the DOWNLOAD button rather than COPY, open the file it saves, and');
    console.log('  take the code from there. Nothing in that file is truncated.\n');
    process.exit(1);
  }

  const authUrl = need('ZOHO_AUTH_URL');
  const clientId = need('ZOHO_CLIENT_ID');
  const clientSecret = need('ZOHO_CLIENT_SECRET');

  console.log(`\n  Exchanging with ${authUrl}\n`);

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
