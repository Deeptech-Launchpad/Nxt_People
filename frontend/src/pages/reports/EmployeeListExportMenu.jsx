import React, { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildSheet, downloadWorkbook } from '../../utils/reportExport';

// Exports the raw employee-level rows behind a date-ranged report (Headcount,
// Addition Trend, Attrition Trend, Experience Wise Exit) — a separate concern
// from ChartExportMenu, which exports the chart's own aggregated series.
// `fetchRows` is called fresh on every click so the export always reflects
// whatever period/filters are currently applied, not a stale snapshot taken
// when the menu was mounted. Built on the same buildSheet/downloadWorkbook
// helpers every other full-table export in Reports already uses.
export default function EmployeeListExportMenu({ fetchRows, columns, fileStub }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportAs = async (format) => {
    setOpen(false);
    setBusy(true);
    try {
      const rows = await fetchRows();
      if (!rows?.length) { toast('No employees found for this period', { icon: 'ℹ️' }); return; }
      const ws = buildSheet({ columns, rows });
      await downloadWorkbook([{ name: 'Employees', ws }], format, fileStub);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to export');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition-colors whitespace-nowrap disabled:opacity-50"
      >
        <Download size={13} className="text-slate-400" />
        {busy ? 'Exporting…' : 'Export Employees'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute z-[95] mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 right-0">
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
    </div>
  );
}
