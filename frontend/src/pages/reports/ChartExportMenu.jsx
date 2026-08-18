import React, { useState, useRef, useEffect } from 'react';
import { Menu } from 'lucide-react';
import * as XLSX from 'xlsx';

// Small per-chart export menu (☰ → Export as CSV / XLS / XLSX), matching
// the menu Zoho shows on each individual chart.
//
// The menu is positioned `fixed` off the button's bounding rect rather than
// absolutely inside it: the report card wraps its content in
// `overflow-hidden` (for the rounded corners the tables need), which clipped
// an absolutely-positioned dropdown so it rendered as an empty white sliver
// behind the chart. Fixed positioning escapes every ancestor's overflow.
export default function ChartExportMenu({ rows, columns, fileStub }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
  };

  useEffect(() => {
    if (!open) return;
    // Keep it pinned to the button while the page moves under it.
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Columns may be plain keys or derived, and a percentage has to reach the
  // sheet as a real fraction with a % format so Excel can still do arithmetic
  // on it — writing "94.83%" as text made the column useless. Same contract as
  // the full table exports in reportExport.js.
  const buildSheet = () => {
    const cell = (c, r) => {
      const v = c.value ? c.value(r) : r[c.key];
      return v === undefined || v === null ? '' : v;
    };
    const aoa = [columns.map(c => c.header), ...rows.map(r => columns.map(c => cell(c, r)))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    columns.forEach((c, ci) => {
      if (!c.numFmt) return;
      for (let ri = 0; ri < rows.length; ri++) {
        const addr = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
        if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = c.numFmt;
      }
    });
    return ws;
  };

  const exportAs = (format) => {
    setOpen(false);
    if (!rows?.length) return;
    const ws = buildSheet();
    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${fileStub}.csv`; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${fileStub}.${format}`, { bookType: format === 'xls' ? 'biff8' : 'xlsx' });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => { place(); setOpen(o => !o); }}
        title="Export"
        className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <Menu size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[95] w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1"
            style={{ top: pos.top, left: pos.left }}
          >
            {[['csv', 'Export as CSV'], ['xls', 'Export as XLS'], ['xlsx', 'Export as XLSX']].map(([fmt, label]) => (
              <button
                key={fmt}
                onClick={() => exportAs(fmt)}
                className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
