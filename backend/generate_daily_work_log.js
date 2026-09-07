#!/usr/bin/env node
/**
 * generate_daily_work_log.js
 *
 * Regenerates rows in a personal, LOCAL Excel work-log from this repo's git
 * history — Date | Project/Module | Task/Work Done | Start Time | End Time |
 * Hours | Status | Priority | Issues/Blockers | Evidence/Reference | Remarks
 * — matching the format already agreed on.
 *
 * Meant to run once a day via Windows Task Scheduler, with no arguments —
 * it regenerates ONLY today's rows from today's commits and leaves every
 * earlier day's rows exactly as they already are in the file. That means:
 * if today's file is edited by hand before the day's scheduled run, that
 * edit is overwritten at the scheduled time (today keeps getting refreshed
 * from git until the day is over); once a day is no longer "today", its
 * rows are left alone and any manual edit to it sticks.
 *
 * Can also be run by hand for a specific date range to backfill history:
 *   node generate_daily_work_log.js 2026-09-01 2026-09-07
 *
 * This is a personal reporting tool, not part of the app — it never runs in
 * Docker, never touches production, and its OUTPUT file lives outside the
 * repo entirely (nothing here is meant to be committed as project data).
 */
const fs = require('fs');
const { execSync } = require('child_process');
const xlsx = require('xlsx');

const REPO_DIR = 'D:\\Projects\\Nxt_People_source';
const OUTPUT_FILE = 'D:\\Daily_Work_Tracker_2026.xlsx';
const SHEET_NAME = 'Work Log';
const DAY_START = '09:30'; // assumed start of day for the first commit of each day

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateYmd, n) {
  const d = new Date(`${dateYmd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Crude keyword guess so automated rows land in the same categories the
// manual table used — good enough for a work log, not meant to be exact.
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
function hoursBetween(start, end) {
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  let diff = toMin(end) - toMin(start);
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

function commitsForDate(dateYmd) {
  const out = execSync(
    `git -C "${REPO_DIR}" log --since="${dateYmd} 00:00" --until="${dateYmd} 23:59" --pretty=format:"%h|%ad|%s" --date=format:"%H:%M"`,
    { encoding: 'utf8' }
  ).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const [hash, time, ...rest] = line.split('|');
    return { hash, time, message: rest.join('|') };
  });
}

function rowsForDate(dateYmd) {
  const commits = commitsForDate(dateYmd);
  let prevEnd = DAY_START;
  return commits.map(c => {
    const row = {
      'Date': dateYmd,
      'Project / Module': guessModule(c.message),
      'Task / Work Done': c.message,
      'Start Time': prevEnd,
      'End Time': c.time,
      'Hours': hoursBetween(prevEnd, c.time),
      'Status': 'Completed',
      'Priority': guessPriority(c.message),
      'Issues / Blockers': 'None',
      'Evidence / Reference': c.hash,
      'Remarks': '',
    };
    prevEnd = c.time;
    return row;
  });
}

function loadExisting() {
  if (!fs.existsSync(OUTPUT_FILE)) return [];
  const wb = xlsx.readFile(OUTPUT_FILE);
  const ws = wb.Sheets[SHEET_NAME];
  return ws ? xlsx.utils.sheet_to_json(ws) : [];
}

function save(rows) {
  rows.sort((a, b) => (a['Date'] + a['End Time']).localeCompare(b['Date'] + b['End Time']));
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 11 }, { wch: 20 }, { wch: 60 }, { wch: 8 }, { wch: 8 },
    { wch: 7 }, { wch: 10 }, { wch: 9 }, { wch: 30 }, { wch: 10 }, { wch: 20 },
  ];
  xlsx.utils.book_append_sheet(wb, ws, SHEET_NAME);
  xlsx.writeFile(wb, OUTPUT_FILE);
}

const [argStart, argEnd] = process.argv.slice(2);
const today = ymd(new Date());
const rangeStart = argStart || today;
const rangeEnd = argEnd || argStart || today;

const dates = [];
for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) dates.push(d);

const existing = loadExisting().filter(r => !dates.includes(r['Date']));
const fresh = dates.flatMap(rowsForDate);
save([...existing, ...fresh]);

console.log(`[${new Date().toISOString()}] Updated ${dates.length} day(s) (${rangeStart} to ${rangeEnd}): ${fresh.length} row(s) written. Total rows in file: ${existing.length + fresh.length}. File: ${OUTPUT_FILE}`);
