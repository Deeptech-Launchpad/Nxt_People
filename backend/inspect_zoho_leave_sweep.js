#!/usr/bin/env node
/* Is the Zoho leave sweep actually seeing everything?
 *
 * READ ONLY. Nothing here writes.
 *
 * inspect_preimport_check.js reported that Zoho holds ZERO leave records
 * touching 7–9 September. That cannot sit beside what the timestamps already
 * told us: the requests dated 7 September were written by the restage at
 * 05:48:05, twenty people inside one second. If the import created them, Zoho
 * had them.
 *
 * So one of these is true, and the difference decides whether the pre-import
 * check can be trusted at all:
 *
 *   1. the sweep never reaches September — pagination stops early, or the
 *      records come back oldest-first and the cap cuts them off
 *   2. Zoho really has no leave in that range, because those records were
 *      removed there after the import
 *
 * This walks the same endpoint and reports what it actually saw: how many
 * pages, how many records, the oldest and newest dates, and a count per month.
 * A sweep that stops in June is answering a different question from the one
 * being asked of it.
 *
 *   node inspect_zoho_leave_sweep.js
 *   node inspect_zoho_leave_sweep.js --max=80000
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1]) || 40000;
const PAGE = 200;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function patiently(fn, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn(); } catch (err) {
      last = err;
      const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (code !== '429' && code !== '503' && code !== '502') throw err;
      await sleep(attempt * 5000);
    }
  }
  throw last;
}

function fromZohoDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

(async () => {
  console.log('\n  Walking forms/leave/getRecords exactly as the sweep does.\n');

  const perMonth = new Map();
  const statuses = new Map();
  let pages = 0, records = 0, parsed = 0, oldest = null, newest = null;
  let stoppedBecause = `reached the ${MAX} cap`;
  let firstPageSample = null;
  let lastPageFirstDate = null;

  for (let i = 1; i <= MAX; i += PAGE) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=${PAGE}`));
    const resp = json?.response;
    if (!resp || typeof resp !== 'object' || !('result' in resp)) {
      stoppedBecause = `Zoho returned no "result" at record ${i}`;
      break;
    }
    const rows = resp.result || [];
    pages += 1;
    records += rows.length;

    if (!Array.isArray(rows) || rows.length === 0) {
      stoppedBecause = `an empty page at record ${i}`;
      break;
    }

    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const from = fromZohoDate(rec.From);
      if (!from) continue;
      parsed += 1;
      if (!oldest || from < oldest) oldest = from;
      if (!newest || from > newest) newest = from;
      const key = from.slice(0, 7);
      perMonth.set(key, (perMonth.get(key) || 0) + 1);
      const st = String(rec.ApprovalStatus || '?').trim();
      statuses.set(st, (statuses.get(st) || 0) + 1);
      if (!firstPageSample) {
        firstPageSample = {
          employee: rec.Employee_ID, type: rec.Leavetype,
          from: rec.From, to: rec.To, status: rec.ApprovalStatus,
        };
      }
    }

    // The first date of each page, so the ordering is visible.
    const firstRec = Object.values(rows[0])[0]?.[0];
    lastPageFirstDate = fromZohoDate(firstRec?.From) || lastPageFirstDate;

    if (rows.length < PAGE) {
      stoppedBecause = `a short page (${rows.length} of ${PAGE}) at record ${i} — the documented end`;
      break;
    }
  }

  console.log(`  pages fetched        ${pages}`);
  console.log(`  records returned     ${records}`);
  console.log(`  records with a date  ${parsed}`);
  console.log(`  stopped because      ${stoppedBecause}`);
  console.log(`  oldest From          ${oldest || '—'}`);
  console.log(`  newest From          ${newest || '—'}`);
  console.log(`  first date on the last page fetched: ${lastPageFirstDate || '—'}`);

  if (firstPageSample) {
    console.log('\n  A record, as Zoho returns it:');
    for (const [k, v] of Object.entries(firstPageSample)) console.log(`    ${String(k).padEnd(10)} ${v}`);
  }

  console.log('\n  Records per month of the From date:\n');
  const months = [...perMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [m, n] of months) {
    const bar = '█'.repeat(Math.min(50, Math.ceil(n / 20)));
    console.log(`    ${m}  ${String(n).padStart(5)}  ${bar}`);
  }

  console.log('\n  By approval status:\n');
  for (const [s, n] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(s).padEnd(12)} ${n}`);
  }

  /* The specific question. If September is absent from the month table above,
   * the sweep is the problem and the pre-import check cannot be relied on. */
  const sept = perMonth.get('2026-09') || 0;
  console.log(`\n  September 2026 records seen: ${sept}`);
  if (sept === 0) {
    console.log('\n  None. Either the sweep is not reaching them, or Zoho no longer holds');
    console.log('  September leave at all. Compare "newest From" above against today: if it');
    console.log('  stops well short, the sweep is truncated and section A of the pre-import');
    console.log('  check is measuring nothing.');
  } else {
    console.log('\n  So the sweep does reach September; a zero for 7–9 Sept means Zoho really');
    console.log('  has nothing dated in those three days.');
  }

  // What we hold for the same window, for contrast.
  const local = (await pool.query(
    `SELECT to_char(start_date, 'YYYY-MM') AS m, COUNT(*)::int AS n
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE e.employee_id ~ '^ANXT' AND l.start_date >= '2026-01-01'
      GROUP BY 1 ORDER BY 1`)).rows;
  console.log('\n  For contrast, what NxtPeople holds per month:\n');
  for (const r of local) console.log(`    ${r.m}  ${String(r.n).padStart(5)}`);

  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
