/* ── Can the Zoho token reach real balance data now? ─────────────────────────
 *  The 26 fractional/negative casual balances live now trace back to a CSV
 *  HR exported by hand — Zoho's balance endpoints sat behind
 *  ZohoPeople.leave.READ, which the token did not hold at the time (see
 *  [[zoho_restage_live]]). That was a fact about that day, not necessarily
 *  today: a scope can be added in the Zoho API console at any time without
 *  this codebase knowing.
 *
 *  This asks Zoho directly, two ways:
 *
 *    1. What scope string does the refresh token actually carry, right now.
 *    2. Whether any of Zoho's leave-balance-shaped endpoints answer with
 *       real data rather than a 401/403 or an error envelope wearing a 200
 *       (the same disguise zoho_probe.js already had to learn to see through).
 *
 *  If something answers, the balance figures become independently checkable
 *  against a live source instead of only against a CSV nobody may still have.
 *  If nothing does, that closes the question cleanly: the CSV (or a fresh
 *  export repeating the same manual step) is the only route, now as before.
 *
 *  Read-only. No form is written to, and this makes GET requests only.
 *
 *    docker compose exec backend node zoho_balance_scope_check.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const { zohoApi } = require('./utils/zoho');

async function grantedScopes() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    client_id: process.env.ZOHO_CLIENT_ID || '',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  });
  const r = await fetch(`${process.env.ZOHO_AUTH_URL}?${params.toString()}`, { method: 'POST' });
  const body = await r.json();
  return body.scope || body.error || JSON.stringify(body).slice(0, 200);
}

// A 200 carrying an error envelope, no `result` key. Same shape zoho_probe.js
// already learned to see through — a status code alone is not an answer.
const isEnvelope = (body) => body && !Array.isArray(body) && typeof body === 'object'
  && ('errors' in body || 'message' in body || 'error' in body) && !('result' in body);

async function attempt(label, endpoint) {
  process.stdout.write(`  ${label.padEnd(42)}`);
  try {
    const json = await zohoApi(endpoint);
    const body = json?.response?.result ?? json?.response ?? json;
    if (isEnvelope(body)) {
      const msg = String(body.message || JSON.stringify(body.error || body.errors || {}));
      console.log(`NO   200 but an error: ${msg.slice(0, 90)}`);
      return false;
    }
    const shape = Array.isArray(body) ? `[${body.length} row(s)]`
      : (body && typeof body === 'object' ? `{${Object.keys(body).length} key(s)}` : typeof body);
    console.log(`REACHABLE   ${shape}`);
    return true;
  } catch (err) {
    const m = String(err.message);
    const code = (m.match(/\((\d{3})\)/) || [])[1] || '?';
    console.log(`no          ${code === '401' || code === '403' ? code + ' — scope refused' : code}`);
    return false;
  }
}

(async () => {
  console.log('\n=== What the Zoho token can reach for leave balances ===\n');

  console.log('Granted scope string, straight from Zoho:\n');
  const scope = await grantedScopes();
  console.log(`  ${scope}\n`);
  console.log(`  Has leave.READ?   ${/leave\.(READ|ALL)/i.test(scope) ? 'YES' : 'no'}\n`);

  console.log('Candidate balance-shaped endpoints:\n');
  const candidates = [
    ['leave/getRecords (leave module, not the forms/ API)', 'leave/getRecords'],
    ['leave/getUserRecord', 'leave/getUserRecord'],
    ['forms/leaveusertransaction/getRecords', 'forms/leaveusertransaction/getRecords?sIndex=1&limit=1'],
    ['forms/P_LeaveBalance/getRecords', 'forms/P_LeaveBalance/getRecords?sIndex=1&limit=1'],
    ['forms/leavetype/getRecords', 'forms/leavetype/getRecords?sIndex=1&limit=1'],
  ];
  let anyReachable = false;
  for (const [label, endpoint] of candidates) {
    const ok = await attempt(label, endpoint);
    anyReachable = anyReachable || ok;
  }

  console.log('\n══════════════════════════════════════════════════════════');
  if (anyReachable) {
    console.log('  At least one balance-shaped endpoint answered. That means a');
    console.log('  live, independent check against Zoho is possible now — say so');
    console.log('  and I will build the comparison against the 26 figures.');
  } else {
    console.log('  Nothing balance-shaped is reachable with this token — same as');
    console.log('  when the original import needed a manual CSV export. The two');
    console.log('  ways to verify the 26 figures independently are still: find');
    console.log('  the original CSV, or have HR export Customize Balance again');
    console.log('  from inside Zoho People and hand it over.');
  }
  console.log('══════════════════════════════════════════════════════════\n');
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
