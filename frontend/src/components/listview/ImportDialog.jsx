import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Upload, Download, AlertTriangle, Check } from 'lucide-react';
import api from '../../utils/api';

/* Import, as a preview-then-commit.
 *
 * The first press NEVER writes. It uploads the sheet, the server validates
 * every row inside a transaction it then rolls back, and what comes back is
 * what WOULD happen — created, updated, and each skipped row with its line
 * number and reason. Only then is Apply offered.
 *
 * That shape exists because the alternative fails silently: an import that
 * writes the good rows and drops the bad ones leaves a spreadsheet and a
 * database that quietly disagree, and nobody finds out until somebody's
 * details are wrong.
 */
export default function ImportDialog({ module, title, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const send = async (commit) => {
    if (!file) return toast.error('Choose a file first');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (commit) fd.append('commit', 'true');
      const r = await api.post(`/employee-io/import/${module}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (commit) {
        toast.success(r.data.message);
        onDone();
      } else {
        setPreview(r.data);
      }
    } catch (err) {
      const d = err.response?.data;
      toast.error(d?.message || 'Could not read that file');
      if (d?.unknownColumns?.length) setPreview({ ...d, failed: true });
    } finally { setBusy(false); }
  };

  const downloadTemplate = async () => {
    try {
      const r = await api.get(`/employee-io/import-template/${module}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${module}-import-template.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download the template');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Import {title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[14px] text-slate-600">
              Start from the template so the headings match. An export can be edited and re-imported too.
            </p>
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 text-[14px] text-brand-600 hover:text-brand-700 whitespace-nowrap">
              <Download size={15} /> Template
            </button>
          </div>

          <div>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }} />
            <button onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 text-center hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
              <Upload size={22} className="mx-auto text-slate-400 mb-2" />
              <span className="block text-[15px] text-slate-700">
                {file ? file.name : 'Choose a .xlsx or .csv file'}
              </span>
              <span className="block text-[13px] text-slate-400 mt-0.5">Up to 5 MB, 1000 rows</span>
            </button>
          </div>

          {preview && !preview.failed && (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <AlertTriangle size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-[14px] text-amber-800">
                  <strong>Nothing has been saved.</strong> This is what would happen if you apply it.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[['Created', preview.created, 'text-emerald-600'],
                  ['Updated', preview.updated, 'text-blue-600'],
                  ['Skipped', preview.skipped?.length || 0, 'text-rose-600']].map(([l, n, c]) => (
                  <div key={l} className="border border-slate-200 rounded-xl py-3">
                    <p className={`text-[22px] font-semibold tabular-nums ${c}`}>{n}</p>
                    <p className="text-[13px] text-slate-500">{l}</p>
                  </div>
                ))}
              </div>

              {preview.unknownColumns?.length > 0 && (
                <p className="text-[13.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                  Ignored column(s): {preview.unknownColumns.join(', ')}
                </p>
              )}

              {preview.skipped?.length > 0 && (
                <div className="border border-slate-200 rounded-xl max-h-52 overflow-y-auto">
                  <table className="w-full text-[14px]">
                    <thead className="bg-slate-50 text-slate-500 text-[13px] sticky top-0">
                      <tr><th className="px-3 py-2 text-left w-20">Row</th><th className="px-3 py-2 text-left">Why it was skipped</th></tr>
                    </thead>
                    <tbody>
                      {preview.skipped.map((s, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-3 py-1.5 text-slate-400 tabular-nums">{s.line}</td>
                          <td className="px-3 py-1.5 text-slate-700">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          {!preview || preview.failed ? (
            <button onClick={() => send(false)} disabled={!file || busy}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              {busy ? 'Checking…' : 'Preview'}
            </button>
          ) : (
            <button onClick={() => send(true)} disabled={busy || (preview.created + preview.updated) === 0}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              <Check size={16} />
              {busy ? 'Applying…' : `Apply ${preview.created + preview.updated} change(s)`}
            </button>
          )}
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
