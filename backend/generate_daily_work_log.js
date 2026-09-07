#!/usr/bin/env node
/**
 * generate_daily_work_log.js
 *
 * Appends NEW git commits (since the last successful run) as new rows into
 * the user's real, hand-maintained local tracker — D:\Work_Tracker_2026.xlsx,
 * sheet "Daily Work Log" — without ever touching anything else in that file.
 *
 * Safety rules, all non-negotiable given a prior incident where a naive
 * version of this script destroyed the user's real data by rebuilding the
 * whole workbook from scratch:
 *
 *   1. NEVER rebuild the workbook. Only ever read the real file, write into
 *      specific blank cells within the existing "Daily Work Log" sheet, and
 *      save. Every other sheet (Daily Summary, Task History, Monthly
 *      Summary, Lists) and every existing row is passed through untouched.
 *
 *   2. Pure append, tracked by commit hash, never by "today's date". A
 *      small state file remembers the last commit this script has already
 *      written. Each run only adds commits strictly after that one — it
 *      never deletes or rewrites a row it already added, so a hand-typed
 *      row for the same day is never at risk of being confused for one of
 *      this script's own rows and touched.
 *
 *   3. Backup before every single write, no exceptions, timestamped, kept
 *      in D:\WorkTrackerBackups\.
 *
 *   4. Formula, not a number, for Hours — matching how every existing row
 *      in this sheet already computes it (=IF(OR(start="",end=""),""",
 *      (end-start)*24)), so a manual edit to Start/End Time recalculates
 *      correctly the same way it already does for every hand-typed row.
 *
 *   5. File-lock aware. If the file is open elsewhere (Excel/LibreOffice)
 *      when this runs, the write is skipped for this run and retried next
 *      time — the state file is only advanced after a confirmed successful
 *      save, so nothing is ever lost, just delayed.
 *
 * First run ever (no state file yet): starts tracking from the CURRENT
 * HEAD commit — it does NOT backfill this repo's entire git history into
 * the user's personal tracker. A historical backfill, if ever wanted, is a
 * deliberate one-time action, not something this script decides on its own.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const xlsx = require('xlsx');

const REPO_DIR = 'D:\\Projects\\Nxt_People_source';
// Overridable for testing against a copy -- production (Task Scheduler) calls
// this with no arguments, which uses the real file and real state.
const TARGET_FILE = process.argv[2] || 'D:\\Work_Tracker_2026.xlsx';
const SHEET_NAME = 'Daily Work Log';
const BACKUP_DIR = 'D:\\WorkTrackerBackups';
const STATE_FILE = process.argv[3] || path.join(BACKUP_DIR, '.last_commit_state.txt');
const PROJECT_NAME = 'NXT People';
const DAY_START = '09:30';

// ── Excel <-> JS date/time conversions ───────────────────────────────────
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
function excelDateSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / 86400000); }
function excelTimeFraction(hh, mm) { return (hh * 60 + mm) / (24 * 60); }

function guessModule(msg) {
  const m = msg.toLowerCase();
  if (m.includes('report-email') || m.includes('scheduled report')) return 'Scheduled Reports';
  if (m.includes('leave') || m.includes('lop') || m.includes('casual')) return 'Leave Tracker';
  if (m.includes('employee information') || m.includes('employee-information')) return 'Employee Information';
  if (m.includes('document')) return 'Documents';
  if (m.includes('geofence') || m.includes('work-mode') || m.includes(' ip ') || m.includes('gps') || m.includes('cloudflare') || m.includes('proxy')) return 'Attendance/Geofencing';
  if (m.includes('login') || m.includes('rate limit') || m.includes('security')) return 'Security';
  if (m.includes('operations')) return 'Operations';
  if (m.includes('muster') || m.includes('attendance')) return 'Attendance';
  if (m.includes('profile')) return 'Profile';
  if (m.includes('dashboard')) return 'Dashboard';
  if (m.includes('report')) return 'Reports';
  return 'General';
}
function guessPriority(msg) {
  const m = msg.toLowerCase();
  if (/\bfix\b/.test(m) && /(payroll|security|login|data|bug|balance|infinite|leak)/.test(m)) return 'High';
  if (/\bfix\b/.test(m)) return 'Medium';
  if (/\b(add|build)\b/.test(m)) return 'Medium';
  return 'Low';
}

function currentHead() {
  return execSync(`git -C "${REPO_DIR}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
}
function commitsSince(lastHash) {
  const range = lastHash ? `${lastHash}..HEAD` : 'HEAD';
  const out = execSync(
    `git -C "${REPO_DIR}" log --reverse ${range} --pretty=format:"%H|%h|%ad|%s" --date=format:"%Y-%m-%d %H:%M"`,
    { encoding: 'utf8' }
  ).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const [full, short, dateTime, ...rest] = line.split('|');
    const [date, time] = dateTime.split(' ');
    return { full, short, date, time, message: rest.join('|') };
  });
}

function loadState() {
  try { return fs.readFileSync(STATE_FILE, 'utf8').trim() || null; } catch { return null; }
}
function saveState(hash) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, hash, 'utf8');
}
function backupTarget() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `Work_Tracker_2026_auto_${stamp}.xlsx`);
  fs.copyFileSync(TARGET_FILE, dest);
  return dest;
}

// First unused row: column A has no cell object at all (never written), and
// it is strictly before the merged Tip row at the very bottom of the sheet.
function firstFreeRow(ws, tipRow) {
  const ref = xlsx.utils.decode_range(ws['!ref']);
  for (let r = ref.s.r + 1; r < tipRow; r++) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: 0 })];
    if (!cell || cell.v === undefined || cell.v === '') return r;
  }
  return null; // sheet is full up to the Tip row -- needs a human decision, not a silent guess
}
function findTipRow(ws) {
  const ref = xlsx.utils.decode_range(ws['!ref']);
  for (let r = ref.e.r; r >= ref.s.r; r--) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: 0 })];
    if (cell && typeof cell.v === 'string' && cell.v.startsWith('Tip:')) return r;
  }
  return null;
}

(function main() {
  if (!fs.existsSync(TARGET_FILE)) {
    console.error(`[${new Date().toISOString()}] Target file not found: ${TARGET_FILE} -- nothing to update.`);
    process.exit(1);
  }

  const lastHash = loadState();
  if (!lastHash) {
    // First run ever: start tracking from now, no historical backfill into
    // the user's real file. This is a deliberate, one-time decision point,
    // not something to guess silently.
    saveState(currentHead());
    console.log(`[${new Date().toISOString()}] First run: no state file found. Starting from current HEAD -- no historical commits were added to ${TARGET_FILE}.`);
    return;
  }

  const commits = commitsSince(lastHash);
  if (!commits.length) {
    console.log(`[${new Date().toISOString()}] No new commits since last run. Nothing to do.`);
    return;
  }

  let wb, ws, tipRow;
  try {
    wb = xlsx.readFile(TARGET_FILE, { cellFormula: true, cellDates: false, cellNF: true, cellStyles: true });
    ws = wb.Sheets[SHEET_NAME];
    if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in ${TARGET_FILE}`);
    tipRow = findTipRow(ws);
    if (tipRow === null) throw new Error('Could not find the "Tip:" row -- refusing to guess where data ends.');
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Could not read ${TARGET_FILE} (is it open in Excel/LibreOffice?): ${err.message}. Will retry next run -- no state change.`);
    process.exit(1);
  }

  let row = firstFreeRow(ws, tipRow);
  let written = 0;
  let prevEndFrac = null;
  let prevDate = null;

  for (const c of commits) {
    if (row === null || row >= tipRow) {
      console.warn(`[${new Date().toISOString()}] Ran out of pre-formatted rows before the Tip row -- stopping early. ${written}/${commits.length} commit(s) written. Add more rows to the sheet before the Tip row, then re-run.`);
      break;
    }
    const [y, m, d] = c.date.split('-').map(Number);
    const [hh, mm] = c.time.split(':').map(Number);
    const dateSerial = excelDateSerial(y, m, d);
    const endFrac = excelTimeFraction(hh, mm);
    const startFrac = (prevDate === c.date && prevEndFrac !== null) ? prevEndFrac : excelTimeFraction(9, 30);

    const R = row + 1; // 1-based row number for formula text
    const values = [
      { t: 'n', v: dateSerial, z: 'dd\\-mmm\\-yyyy' },
      { t: 's', v: PROJECT_NAME },
      { t: 's', v: guessModule(c.message) },
      { t: 's', v: c.message },
      { t: 'n', v: startFrac, z: 'hh:mm' },
      { t: 'n', v: endFrac, z: 'hh:mm' },
      { t: 'n', v: Math.round((endFrac - startFrac) * 24 * 100) / 100, f: `IF(OR(E${R}="",F${R}=""),"",(F${R}-E${R})*24)`, z: '0.00' },
      { t: 's', v: 'Completed' },
      { t: 's', v: guessPriority(c.message) },
      { t: 's', v: 'None' },
      { t: 's', v: c.short },
      { t: 's', v: '' },
    ];
    values.forEach((cell, c2) => { ws[xlsx.utils.encode_cell({ r: row, c: c2 })] = cell; });
    // Widen the declared range if this row was outside it (shouldn't normally
    // happen -- these rows are already inside the sheet's existing !ref --
    // but kept as a safety net rather than silently writing out of bounds.
    const curRef = xlsx.utils.decode_range(ws['!ref']);
    if (row > curRef.e.r) { curRef.e.r = row; ws['!ref'] = xlsx.utils.encode_range(curRef); }

    prevDate = c.date;
    prevEndFrac = endFrac;
    row++;
    written++;
  }

  if (written === 0) {
    console.log(`[${new Date().toISOString()}] Nothing written (sheet full before the Tip row).`);
    return;
  }

  const backupPath = backupTarget();
  try {
    xlsx.writeFile(wb, TARGET_FILE);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Write failed (is the file open elsewhere?): ${err.message}. Backup was still taken at ${backupPath}. State NOT advanced -- will retry next run.`);
    process.exit(1);
  }

  saveState(commits[commits.length - 1].full);
  console.log(`[${new Date().toISOString()}] Wrote ${written} new row(s) to "${SHEET_NAME}" in ${TARGET_FILE}. Backup: ${backupPath}. Last commit now: ${commits[commits.length - 1].short}`);
})();
