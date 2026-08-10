import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import * as XLSX from 'xlsx';

// Small per-chart export menu (☰ → Export as CSV / XLS / XLSX), matching
// the menu Zoho shows on each individual chart. `rows` is an array of
// plain objects; `columns` is [{key, header}] controlling column order
// and headers in the exported file.
export default function ChartExportMenu({ rows, columns, fileStub }) {
  const [open, setOpen] = useState(false);

  const buildSheet = () => {
    const aoa = [columns.map(c => c.header), ...rows.map(r => columns.map(c => r[c.key] ?? ''))];
    return XLSX.utils.aoa_to_sheet(aoa);
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
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Export" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
        <Menu size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {[['csv', 'Export as CSV'], ['xls', 'Export as XLS'], ['xlsx', 'Export as XLSX']].map(([fmt, label]) => (
              <button key={fmt} onClick={() => exportAs(fmt)} className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
