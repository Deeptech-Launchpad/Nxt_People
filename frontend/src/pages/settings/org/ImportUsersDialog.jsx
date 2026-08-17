import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../../../utils/api';

// Import. The file is parsed in the browser — the spreadsheet library is
// already here for the report exports, so the server takes rows rather than a
// file and does not need a second parser.
//
// Every row is reported on. A partial import that said nothing about what it
// skipped would leave someone believing 200 people were added when 40 were.
const COLUMNS = [
  ['employeeCode', 'Employee ID'],
  ['firstName', 'First Name'],
  ['lastName', 'Last Name'],
  ['email', 'Email'],
  ['role', 'Role'],
  ['joiningDate', 'Date of Joining'],
  ['location', 'Location'],
  ['department', 'Department'],
];

// Matches the header however it is capitalised or spaced, because a file that
// says "First name" should not fail against "First Name".
const normalise = h => String(h || '').trim().toLowerCase().replace(/[^a-z]/g, '');
const HEADER_TO_KEY = new Map(COLUMNS.map(([key, label]) => [normalise(label), key]));

export default function ImportUsersDialog({ isUser, onClose, onImported }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const template = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      COLUMNS.map(([, label]) => label),
      ['ANXT2600164', 'Priya', 'R', 'priya.r@altiusnxt.com', 'team_member', '01/09/2026', 'WFH', 'Software'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'user-import-template.xlsx');
  };

  const read = file => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        if (!raw.length) { setRows([]); return toast.error('That file has no rows'); }

        const mapped = raw.map(r => {
          const out = {};
          Object.entries(r).forEach(([header, value]) => {
            const key = HEADER_TO_KEY.get(normalise(header));
            if (key) out[key] = value;
          });
          return out;
        });
        const usable = mapped.filter(r => Object.keys(r).length > 0);
        if (!usable.length) {
          setRows([]);
          return toast.error('No recognised columns. Download the template to see the headers.');
        }
        setRows(usable);
      } catch {
        setRows([]);
        toast.error('That file could not be read');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const submit = () => {
    setBusy(true);
    api.post('/org-users/import', { rows, isUser })
      .then(r => {
        setResult(r.data.data);
        const { created, failed } = r.data.data;
        if (created.length) toast.success(`${created.length} added`);
        if (failed.length) toast.error(`${failed.length} could not be added`);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Import failed'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            Import {isUser ? 'Users' : 'Employee Profiles'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!result ? (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-lg py-8 flex flex-col items-center gap-2 transition-colors"
              >
                <Upload size={22} className="text-slate-400" />
                <span className="text-[14px] text-slate-700">
                  {fileName || 'Choose an .xlsx or .csv file'}
                </span>
                {rows && <span className="text-[13px] text-slate-500">{rows.length} row(s) found</span>}
              </button>
              <input
                ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => read(e.target.files?.[0])}
              />

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5">
                <p className="text-[13px] font-medium text-slate-700 mb-1.5">Expected columns</p>
                <p className="text-[13px] text-slate-600 leading-relaxed">
                  {COLUMNS.map(([, l]) => l).join(' · ')}
                </p>
                <p className="text-[12.5px] text-slate-500 mt-2">
                  Only First Name and Email are required. Location and Department are matched by
                  name against the ones already configured; anything else is left unset.
                </p>
                <button onClick={template} className="text-[13.5px] text-blue-600 hover:text-blue-500 mt-2">
                  Download template
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-[14px] text-slate-800">
                <span className="font-semibold">{result.created.length}</span> of {result.total} added
                {result.failed.length > 0 && <>, <span className="font-semibold text-red-600">{result.failed.length}</span> skipped</>}
              </p>
              {result.failed.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left font-medium text-slate-600 px-3 py-2 w-[60px]">Line</th>
                        <th className="text-left font-medium text-slate-600 px-3 py-2">Email</th>
                        <th className="text-left font-medium text-slate-600 px-3 py-2">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.failed.map((f, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-600">{f.line}</td>
                          <td className="px-3 py-2 text-slate-600 truncate max-w-[180px]">{f.email || '—'}</td>
                          <td className="px-3 py-2 text-red-600">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          {!result ? (
            <>
              <button
                onClick={submit} disabled={busy || !rows || !rows.length}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
              >
                {busy ? 'Importing…' : `Import${rows?.length ? ` ${rows.length}` : ''}`}
              </button>
              <button onClick={onClose}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={onImported}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
