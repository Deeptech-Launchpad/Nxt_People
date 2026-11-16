// Pure logic test, no DB, no browser -- builds a real workbook with the
// REAL xlsx (SheetJS) library and reads back the actual rendered text
// Excel/LibreOffice would show, for all 8 required scenarios. Mirrors the
// exact column value/numFmt definitions now in OpsUserSpecific.jsx's
// exportXlsx() (duplicated here because that file is JSX, which plain
// Node can't import directly -- same technique already used elsewhere
// this session for frontend logic tests).
const XLSX = require('xlsx');

const STATUS_LABEL = {
  present: 'Present', late: 'Late', absent: 'Absent', 'half-day': 'Half Day',
  on_duty: 'On Duty', weekend: 'Weekend', holiday: 'Holiday',
};

const dayFractionOf = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return (ist.getHours() * 60 + ist.getMinutes()) / 1440;
};

const hoursOf = (att) => {
  const banked = Number(att?.workingHours) || 0;
  if (!att?.checkIn || att?.checkOut) return banked;
  const from = new Date(att.sessionStartedAt || att.checkIn).getTime();
  if (!Number.isFinite(from)) return banked;
  const open = Math.max(0, (Date.now() - from) / 3600000);
  return open > 18 ? banked : banked + open;
};

const columns = [
  { header: 'Date', value: r => new Date(`${r.date}T00:00:00`), numFmt: 'dd\\.mm\\.yyyy' },
  { header: 'Day Type', value: r => (r.kind === 'holiday' ? (r.holidayName || 'Holiday') : r.kind === 'weekend' ? 'Weekend' : 'Working Day') },
  { header: 'First In', value: r => dayFractionOf(r.att?.checkIn), numFmt: 'h:mm AM/PM' },
  { header: 'Last Out', value: r => dayFractionOf(r.att?.checkOut), numFmt: 'h:mm AM/PM' },
  { header: 'Total Hours', value: r => hoursOf(r.att) / 24, numFmt: '[hh]:mm' },
  { header: 'Status', value: r => (r.derivedStatus ? (STATUS_LABEL[r.derivedStatus] || r.derivedStatus) : '') },
  { header: 'Late By', value: r => (r.att?.lateMinutes > 0 ? (r.att.lateMinutes / 60) / 24 : ''), numFmt: '[hh]:mm' },
];

// Minimal re-implementation of reportExport.js's buildSheet, exactly the
// parts exportXlsx actually exercises (no meta/legend/groups/kv), so this
// test is checking the real SheetJS behaviour the shared util relies on,
// not a mock of it.
function buildSheet({ columns, rows }) {
  const aoa = [columns.map(c => c.header)];
  rows.forEach(r => aoa.push(columns.map(c => {
    const v = c.value(r);
    return v === undefined || v === null ? '' : v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  columns.forEach((c, ci) => {
    if (!c.numFmt) return;
    for (let ri = 0; ri < rows.length; ri++) {
      const addr = XLSX.utils.encode_cell({ r: 1 + ri, c: ci });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') cell.z = c.numFmt;
    }
  });
  ws['!cols'] = columns.map(c => ({ wch: Math.max(12, Math.min(34, String(c.header).length + 4)) }));
  return ws;
}

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

// What Excel/LibreOffice actually render when they open the real file is
// driven by each cell's stored number-format code (.z) applied live to its
// value (.v) -- exactly what XLSX.SSF.format computes. sheet_to_csv/
// format_cell are NOT equivalent to this: they fall back to a .w field
// SheetJS only populates once, at cell-creation time, using whatever
// format was in force THEN -- so if a column's format is set (or
// corrected) afterwards, as buildSheet does, that stale cached text is
// what those helpers return, not the real result. This is exactly how an
// invalid, unescaped 'dd.mm.yyyy' format string was first caught in this
// file: SSF.format throws on it outright, where sheet_to_csv silently
// showed the pre-existing default format instead and looked like a pass.
function renderedRow(ws, rowIndex) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: rowIndex + 1, c })];
    if (!cell) { out.push(''); continue; }
    out.push(cell.t === 's' ? String(cell.v) : XLSX.SSF.format(cell.z || cell.w || 'General', cell.v));
  }
  return out;
}

console.log('\n════ Scenario 1: normal working day, First In 9:54 AM, Last Out 6:05 PM ════\n');
{
  const days = [{
    date: '2026-11-02', kind: 'working', holidayName: null, derivedStatus: 'present',
    att: { checkIn: '2026-11-02T04:24:00.000Z', checkOut: '2026-11-02T12:35:00.000Z', workingHours: '8.183333', lateMinutes: 0 },
  }];
  const ws = buildSheet({ columns, rows: days });
  const row = renderedRow(ws, 0);
  check('Date renders as 02.11.2026 (dd.mm.yyyy)', row[0] === '02.11.2026', row);
  check('Day Type is "Working Day"', row[1] === 'Working Day', row);
  check('First In renders as 9:54 AM', row[2] === '9:54 AM', row);
  check('Last Out renders as 6:05 PM', row[3] === '6:05 PM', row);
  check('Total Hours renders as 08:11 (8.1833h)', row[4] === '08:11', row);
  check('Status is "Present"', row[5] === 'Present', row);
  check('Late By is blank (no lateness)', row[6] === '', row);
}

console.log('\n════ Scenario 2: late check-in, Late By 00:24 ════\n');
{
  const days = [{
    date: '2026-11-03', kind: 'working', derivedStatus: 'late',
    att: { checkIn: '2026-11-03T04:54:00.000Z', checkOut: '2026-11-03T12:30:00.000Z', workingHours: '7.6', lateMinutes: 24 },
  }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('Status is "Late"', row[5] === 'Late', row);
  check('Late By renders as 00:24', row[6] === '00:24', row);
}

console.log('\n════ Scenario 3: missing checkout (Last Out must be blank, no crash) ════\n');
{
  const days = [{
    date: '2026-11-04', kind: 'working', derivedStatus: 'present',
    att: { checkIn: '2026-11-04T04:00:00.000Z', checkOut: null, sessionStartedAt: '2026-11-04T04:00:00.000Z', workingHours: '0', lateMinutes: 0 },
  }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('First In still renders (9:30 AM)', row[2] === '9:30 AM', row);
  check('Last Out is blank (no checkout, never a placeholder)', row[3] === '', row);
  check('Total Hours is a well-formed HH:MM, not NaN/blank', /^\d{2,}:\d{2}$/.test(row[4]), row);
}

console.log('\n════ Scenario 4: absent working day ════\n');
{
  const days = [{ date: '2026-11-05', kind: 'working', derivedStatus: 'absent', att: null }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('Day Type is "Working Day" (absent is a status, not a day type)', row[1] === 'Working Day', row);
  check('First In is blank', row[2] === '', row);
  check('Last Out is blank', row[3] === '', row);
  check('Total Hours is 00:00, not blank (there is a real zero to report)', row[4] === '00:00', row);
  check('Status is "Absent"', row[5] === 'Absent', row);
  check('Late By is blank', row[6] === '', row);
}

console.log('\n════ Scenario 5: weekend ════\n');
{
  const days = [{ date: '2026-11-07', kind: 'weekend', derivedStatus: 'weekend', att: null }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('Day Type is "Weekend"', row[1] === 'Weekend', row);
  check('Status is "Weekend", never "Absent" (weekends must not read as absent)', row[5] === 'Weekend', row);
}

console.log('\n════ Scenario 6: holiday ════\n');
{
  const days = [{ date: '2026-11-08', kind: 'holiday', holidayName: 'Diwali', derivedStatus: 'holiday', att: null }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('Day Type carries the actual holiday name ("Diwali")', row[1] === 'Diwali', row);
  check('Status is "Holiday", never "Absent"', row[5] === 'Holiday', row);
}

console.log('\n════ Scenario 7: attendance with zero hours (real row, no punches logged) ════\n');
{
  const days = [{
    date: '2026-11-09', kind: 'working', derivedStatus: 'present',
    att: { checkIn: null, checkOut: null, workingHours: '0', lateMinutes: 0, status: 'present' },
  }];
  const row = renderedRow(buildSheet({ columns, rows: days }), 0);
  check('First In is blank (no real punch, never invented)', row[2] === '', row);
  check('Total Hours is 00:00', row[4] === '00:00', row);
  check('Status still reads "Present" (the status itself is preserved, not overridden)', row[5] === 'Present', row);
}

console.log('\n════ Scenario 8: multiple dates across a month ════\n');
{
  const days = [
    { date: '2026-11-01', kind: 'weekend', derivedStatus: 'weekend', att: null },
    { date: '2026-11-02', kind: 'working', derivedStatus: 'present', att: { checkIn: '2026-11-02T04:24:00.000Z', checkOut: '2026-11-02T12:35:00.000Z', workingHours: '8.1833', lateMinutes: 0 } },
    { date: '2026-11-03', kind: 'working', derivedStatus: 'absent', att: null },
  ];
  const ws = buildSheet({ columns, rows: days });
  const csvLines = XLSX.utils.sheet_to_csv(ws).trim().split('\n');
  check('Exactly one header row plus one row per day (no dates dropped or merged)',
    csvLines.length === days.length + 1, { lineCount: csvLines.length, expected: days.length + 1 });
}

console.log('\n════ Column widths (requirement 3: dates must never show as ####) ════\n');
{
  const ws = buildSheet({ columns, rows: [{ date: '2026-11-02', kind: 'working', derivedStatus: 'present', att: null }] });
  const dateColWidth = ws['!cols'][0].wch;
  check(`Date column width (${dateColWidth}) is wide enough for "02.11.2026" (10 chars) plus margin`,
    dateColWidth >= 10);
}

console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
