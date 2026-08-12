import * as XLSX from 'xlsx';

// Every employee-level export in the reference opens with the same eight
// identity columns. The first three are always written; the remaining five
// are what the export dialog's "Include additional employee fields" toggles.
export const IDENTITY_CORE = [
  { key: 'employeeCode', header: 'Employee Id' },
  { key: 'employeeName', header: 'Employee Name', value: r => `${r.firstName || ''} ${r.lastName || ''}`.trim() },
  { key: 'email', header: 'Email ID' },
];

export const IDENTITY_OPTIONAL = [
  { key: 'reportingTo', header: 'Reporting To' },
  { key: 'department', header: 'Department' },
  { key: 'designation', header: 'Designation' },
  { key: 'workLocation', header: 'Location' },
  { key: 'role', header: 'Role' },
];

// Percentages go into the sheet as real fractions with a % number format, so
// Excel shows 94.83% and still treats the cell as a number. Writing "94.83%"
// as text made the column useless for any further arithmetic.
export const PERCENT_FMT = '0.00%';

const cellValue = (col, row) => {
  const v = col.value ? col.value(row) : row[col.key];
  return v === undefined || v === null ? '' : v;
};

// Builds one worksheet in the reference's layout:
//
//   meta      → leading "Start Date | 09/08/2026" rows
//   legend    → code/meaning rows for the grid reports (P - Present, …)
//   groups    → an optional banner row above the leaf headers, given as
//               [{label, span}] so "Payable Day(s)" can straddle three columns
//   columns   → the leaf headers and their accessors
//
// Returns a worksheet with merges and per-cell number formats applied.
export function buildSheet({ meta = [], legend = [], groups = null, columns, rows, kv = null }) {
  const aoa = [];
  const merges = [];

  meta.forEach(([label, value]) => aoa.push([label, value]));

  // Daily attendance status and Daily leave status aren't tables at all in
  // the reference — they're vertical label/value sheets. `kv` short-circuits
  // the whole header/column machinery for those.
  if (kv) {
    kv.forEach(([label, value]) => aoa.push([label, value]));
    const wsKv = XLSX.utils.aoa_to_sheet(aoa);
    wsKv['!cols'] = [{ wch: 22 }, { wch: 16 }];
    return wsKv;
  }
  legend.forEach(pairs => {
    // Legend pairs render as alternating code/meaning cells, matching how the
    // reference spreads its key across a single row.
    const line = [];
    pairs.forEach(([code, meaning]) => { line.push(code, ` - ${meaning}`); });
    aoa.push(line);
  });

  if (groups) {
    const groupRow = [];
    let col = 0;
    groups.forEach(g => {
      groupRow.push(g.label || null);
      for (let i = 1; i < g.span; i++) groupRow.push(null);
      if (g.span > 1 && g.label) {
        merges.push({ s: { r: aoa.length, c: col }, e: { r: aoa.length, c: col + g.span - 1 } });
      }
      col += g.span;
    });
    aoa.push(groupRow);
  }

  const headerRow = aoa.length;
  aoa.push(columns.map(c => c.header));
  rows.forEach(r => aoa.push(columns.map(c => cellValue(c, r))));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length) ws['!merges'] = merges;

  // Number formats have to be stamped after the sheet exists, since
  // aoa_to_sheet has no per-column format concept.
  columns.forEach((c, ci) => {
    if (!c.numFmt) return;
    for (let ri = 0; ri < rows.length; ri++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow + 1 + ri, c: ci });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') cell.z = c.numFmt;
    }
  });

  ws['!cols'] = columns.map(c => ({ wch: Math.max(12, Math.min(34, String(c.header).length + 4)) }));
  return ws;
}

// Writes the workbook in the chosen format. `sheets` is [{name, ws}] — the
// hour-based reports ship two, an HH:MM "(Hours)" sheet and a "(Decimal)"
// one, which is how the reference exports them.
export function downloadWorkbook(sheets, format, fileStub) {
  const fmt = String(format).toLowerCase();

  if (fmt === 'csv' || fmt === 'tsv') {
    // Delimited formats are single-sheet by nature — the first sheet wins.
    const sep = fmt === 'tsv' ? '\t' : ',';
    const text = XLSX.utils.sheet_to_csv(sheets[0].ws, { FS: sep });
    const mime = fmt === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileStub}.${fmt}`; a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const wb = XLSX.utils.book_new();
  sheets.forEach(s => XLSX.utils.book_append_sheet(wb, s.ws, s.name.slice(0, 31)));
  XLSX.writeFile(wb, `${fileStub}.${fmt}`, { bookType: fmt === 'xls' ? 'biff8' : 'xlsx' });
}

// Resolves the identity block for a given "include additional fields" state.
export function identityColumns(includeExtra) {
  return includeExtra ? [...IDENTITY_CORE, ...IDENTITY_OPTIONAL] : [...IDENTITY_CORE];
}
