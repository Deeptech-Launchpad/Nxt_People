import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';

const FORMATS = ['XLSX', 'XLS', 'CSV', 'TSV'];

// Richer export dialog for Leave Tracker pages — format choice plus
// optional extra columns — matching Zoho's export modal (seen on Leave
// Type Wise Summary / Loss of Pay Details) rather than the single-click
// CSV/XLS/XLSX menu used on chart pages. `extraColumns` (optional) lists
// only fields the caller's rows actually carry — never a fixed list, so
// this never exports a blank column for data the report doesn't have.
export default function LeaveExportModal({ open, onClose, rows, baseColumns, extraColumns = [], fileStub }) {
  const [format, setFormat] = useState('XLSX');
  const [extra, setExtra] = useState({});

  if (!open) return null;

  const columns = [...baseColumns, ...extraColumns.filter(f => extra[f.key])];

  const download = () => {
    if (!rows?.length) { onClose(); return; }
    const aoa = [columns.map(c => c.header), ...rows.map(r => columns.map(c => (c.value ? c.value(r) : r[c.key]) ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (format === 'CSV') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${fileStub}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'TSV') {
      const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
      const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${fileStub}.tsv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, `${fileStub}.${format.toLowerCase()}`, { bookType: format === 'XLS' ? 'biff8' : 'xlsx' });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="text-[15px] font-bold text-slate-800">Export</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[12px] font-semibold text-slate-500 uppercase mb-2">File Format</p>
            <div className="grid grid-cols-4 gap-1.5">
              {FORMATS.map(f => (
                <button key={f} onClick={() => setFormat(f)}
                  className={`py-1.5 text-[13px] font-semibold rounded-lg border transition-colors ${format === f ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {extraColumns.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-slate-500 uppercase mb-2">Include Fields</p>
              <div className="space-y-1.5">
                {extraColumns.map(f => (
                  <label key={f.key} className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!extra[f.key]} onChange={e => setExtra(x => ({ ...x, [f.key]: e.target.checked }))} className="rounded border-slate-300" />
                    {f.header}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={download} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
            <Download size={14} /> Export
          </button>
        </div>
      </div>
    </div>
  );
}
