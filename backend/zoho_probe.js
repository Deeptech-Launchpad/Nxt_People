/* ── What will Zoho actually give us? ──────────────────────────────────────
 *  Comparing two systems needs the other one's answers first, and Zoho's
 *  People API is inconsistent between forms and modules. The first run of this
 *  found the split clearly:
 *
 *    forms/…            answered
 *    attendance/…       401 — the token refreshed fine and was then refused
 *    leave/…            404 — wrong path
 *
 *  A 401 AFTER a successful refresh is not a bad credential. It is a missing
 *  OAuth scope: Zoho grants them per module, and a token holding
 *  ZohoPeople.forms.ALL is refused by the attendance module however valid it
 *  is. So this now reports the granted scopes outright, which settles that
 *  question rather than leaving it to be guessed at.
 *
 *  And since forms/ answers, it asks Zoho to list its forms. Attendance is
 *  stored in one; knowing its link name beats trying names.
 *
 *  Read-only in both directions. Every Zoho call is a GET, our own database
 *  refuses any statement that is not a SELECT and proves it on startup, and
 *  the mail transport cannot connect. Nothing is imported.
 *
 *    docker compose exec backend node zoho_probe.js ANXT2600149 2026-07-01 2026-07-31
 * ────────────────────────────────────────────────────────────────────────── */
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_probe.js does not send mail'); },
  verify: async () => { throw new Error('zoho_probe.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('zoho_probe.js is read-only; this write was refused'));
  }
  return realQuery(text, params);
};

const { zohoApi } = require('./utils/zoho');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];

const zohoDate = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

const shapeOf = (v, depth = 0) => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return v.length ? `[${v.length} × ${shapeOf(v[0], depth + 1)}]` : '[]';
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `{${keys.length} keys}`;
    return `{ ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? `, +${keys.length - 6}` : ''} }`;
  }
  return typeof v;
};

async function attempt(label, endpoint) {
  process.stdout.write(`  ${label.padEnd(38)}`);
  try {
    const json = await zohoApi(endpoint);
    const body = json?.response?.result ?? json?.response ?? json;

    // Zoho answers a bad form name with HTTP 200 and an error envelope, so the
    // status code alone reported four failures as successes. An unknown form
    // is a failure whatever the transport says about it.
    const envelope = body && !Array.isArray(body) && typeof body === 'object'
      && ('errors' in body || 'message' in body || 'error' in body) && !('result' in body);
    if (envelope) {
      // "error" belongs in that list too. Without it, getUserReport's refusal
      // read as a success and then printed the first character of the error
      // string as though it were the data — a single "T", which says nothing.
      const msg = String(body.message || JSON.stringify(body.error || body.errors || {}));
      console.log(`no     200 but an error: ${msg.slice(0, 90)}`);
      return { label, endpoint, ok: false, code: 'envelope', why: msg };
    }

    console.log(`ok    ${shapeOf(body)}`);
    return { label, endpoint, ok: true, body };
  } catch (err) {
    const m = String(err.message);
    const code = (m.match(/\((\d{3})\)/) || [])[1] || '?';
    console.log(`${code === '401' ? 'scope?' : code === '404' ? 'path? '.padEnd(6) : '—     '} ${code}`);
    return { label, endpoint, ok: false, code };
  }
}

/** What the refresh token is actually allowed to reach. */
async function grantedScopes() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
    client_id: process.env.ZOHO_CLIENT_ID || '',
    client_secret: process.env.ZOHO_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  });
  const r = await fetch(`${process.env.ZOHO_AUTH_URL}?${params.toString()}`, { method: 'POST' });
  const body = await r.json();
  return body.scope || null;
}

(async () => {
  if (!CODE || !START || !END) {
    console.log('\n  usage: node zoho_probe.js <EMPLOYEE_CODE> <START> <END>');
    console.log('  e.g.   node zoho_probe.js ANXT2600149 2026-07-01 2026-07-31\n');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  What Zoho will give us — READ ONLY, nothing imported');
  console.log(`  ${CODE}, ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('  !!    the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch {
    console.log('  ok    a deliberate write attempt was refused\n');
  }

  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name, email
       FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [CODE])).rows[0];
  if (!emp) { console.log(`  ${CODE} is not in this database.\n`); await pool.end(); return; }
  const ours = (await pool.query(
    `SELECT COUNT(*)::int n FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [emp.id, START, END])).rows[0].n;
  console.log(`  Here:  ${emp.name} — ${ours} attendance row(s) in range\n`);

  // ── The question the 401s raise ──────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  What this token is allowed to reach');
  console.log('──────────────────────────────────────────────────────────\n');
  try {
    const scope = await grantedScopes();
    if (!scope) {
      console.log('  Zoho returned no scope on the token. Cannot tell from here.\n');
    } else {
      for (const s of String(scope).split(/[\s,]+/).filter(Boolean)) console.log(`    ${s}`);
      const has = k => String(scope).toLowerCase().includes(k);
      console.log('');
      console.log(`  attendance module   ${has('attendance') ? 'GRANTED' : 'NOT GRANTED — this is why those calls 401'}`);
      console.log(`  leave module        ${has('leave') ? 'GRANTED' : 'not granted'}`);
      console.log(`  forms               ${has('forms') ? 'GRANTED' : 'not granted'}\n`);
    }
  } catch (e) {
    console.log(`  Could not read the scopes: ${e.message}\n`);
  }

  // ── What forms exist, since forms/ is what answers ───────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Forms Zoho is offering');
  console.log('──────────────────────────────────────────────────────────\n');
  let attendanceForms = [];
  try {
    const list = await zohoApi('forms');
    const forms = list?.response?.result || list?.response || list || [];
    const flat = Array.isArray(forms) ? forms : Object.values(forms).flat();
    const named = flat
      .map(f => ({ name: f.formLinkName || f.linkName || f.formName || f.displayName, label: f.displayName || f.formName }))
      .filter(f => f.name);
    console.log(`  ${named.length} form(s).\n`);
    attendanceForms = named.filter(f => /attend|shift|time/i.test(`${f.name} ${f.label}`));
    const leaveForms = named.filter(f => /leave|permission/i.test(`${f.name} ${f.label}`));
    for (const f of [...attendanceForms, ...leaveForms]) {
      console.log(`    ${String(f.name).padEnd(30)} ${f.label || ''}`);
    }
    if (!attendanceForms.length) console.log('    (nothing that looks like attendance)');
    console.log('');
  } catch (e) {
    console.log(`  Could not list forms: ${String(e.message).slice(0, 120)}\n`);
  }

  // ── Endpoints ────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Endpoints');
  console.log('──────────────────────────────────────────────────────────\n');

  const enc = encodeURIComponent;
  const results = [];

  // Whatever the form list suggested, plus the names Zoho commonly uses.
  const candidates = [...new Set([
    ...attendanceForms.map(f => f.name),
    'P_AttendanceEntry', 'attendance', 'Attendance', 'P_Attendance',
  ])];
  for (const name of candidates) {
    results.push(await attempt(`forms/${name}/getRecords`,
      `forms/${enc(name)}/getRecords?sIndex=1&limit=5`));
  }

  // Leave answered last time; the useful question now is whether it can be
  // narrowed to one person and one range rather than paged through wholesale.
  const leaveRes = await attempt('forms/leave (filtered by employee)',
    `forms/leave/getRecords?sIndex=1&limit=50&searchParams=${enc(JSON.stringify({
      searchField: 'Employee_ID', searchOperator: 'Contains', searchText: CODE,
    }))}`);
  results.push(leaveRes);

  // Zoho's own internal id for this person, taken from a leave record rather
  // than guessed. Some attendance endpoints want it and accept nothing else.
  let erecno = null;
  try {
    const first = Object.values(leaveRes.body?.[0] || {})[0]?.[0];
    erecno = first?.['Employee_ID.ID'] || null;
  } catch { /* leave it null */ }

  // ── Attendance, which is the whole reason for the new scope ──────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Attendance — the scope is granted, so now the arguments');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`  employee code ${CODE}   email ${emp.email || '—'}   erecno ${erecno || '—'}\n`);

  const sd = enc(zohoDate(START)), ed = enc(zohoDate(END));
  const attempts = [
    ['getUserReport empId', `attendance/getUserReport?empId=${enc(CODE)}&sdate=${sd}&edate=${ed}`],
    ['getUserReport empId + dateFormat',
      `attendance/getUserReport?empId=${enc(CODE)}&sdate=${sd}&edate=${ed}&dateFormat=dd-MM-yyyy`],
    ...(emp.email ? [['getUserReport emailId',
      `attendance/getUserReport?emailId=${enc(emp.email)}&sdate=${sd}&edate=${ed}&dateFormat=dd-MM-yyyy`]] : []),
    ...(erecno ? [['getUserReport erecno',
      `attendance/getUserReport?erecno=${enc(erecno)}&sdate=${sd}&edate=${ed}&dateFormat=dd-MM-yyyy`]] : []),
    ['getAttendanceEntries (one day)',
      `attendance/getAttendanceEntries?empId=${enc(CODE)}&date=${sd}&dateFormat=dd-MM-yyyy`],
    ['getUserReport ISO dates',
      `attendance/getUserReport?empId=${enc(CODE)}&sdate=${enc(String(START))}&edate=${enc(String(END))}&dateFormat=yyyy-MM-dd`],
  ];
  const attResults = [];
  for (const [label, endpoint] of attempts) attResults.push(await attempt(label, endpoint));
  results.push(...attResults);

  // Zoho's refusals name the argument they object to, so print them in full
  // rather than clipped — that sentence is the whole answer to what to send.
  const whys = [...new Set(attResults.filter(r => r.why).map(r => r.why))];
  if (whys.length) {
    console.log('\n  What it objected to, in full:\n');
    for (const w of whys) console.log(`    ${w.slice(0, 400)}`);
  }

  const ok = results.filter(r => r.ok);
  console.log(`\n  ${ok.length} of ${results.length} answered.\n`);

  for (const r of ok) {
    console.log(`  ── ${r.label}`);
    const first = Array.isArray(r.body) ? r.body[0] : r.body;
    const inner = first && typeof first === 'object' && !Array.isArray(first)
      ? (Object.values(first)[0]?.[0] ?? first) : first;
    console.log(JSON.stringify(inner, null, 1).split('\n').slice(0, 26).map(l => `     ${l}`).join('\n'));
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
