import React, { useState } from 'react';
import { X } from 'lucide-react';
import { buildSheet, downloadWorkbook, identityColumns, IDENTITY_OPTIONAL } from '../../utils/reportExport';

// Zoho's Leave Tracker dialogs offer TSV; the Attendance ones stop at CSV.
const LEAVE_FORMATS = ['XLS', 'XLSX', 'CSV', 'TSV'];
const ATTENDANCE_FORMATS = ['XLS', 'XLSX', 'CSV'];

// The export dialog, matching the reference: an illustration, a radio group
// of file formats defaulting to XLS, and a master "Include additional
// employee fields" checkbox that reveals Reporting To / Department /
// Designation / Location / Role.
//
// Props:
//   columns       leaf columns for the report's own data (identity columns are
//                 prepended automatically when `withIdentity` is set)
//   withIdentity  prepend the Employee Id / Name / Email block
//   meta          [[label, value]] rows written above the header
//   legend        [[[code, meaning], …]] rows for the grid reports
//   groups        [{label, span}] banner row above the leaf headers
//   sheetName     base sheet name
//   hourColumns   when given, a second "(Decimal)" sheet is written using
//                 these columns, matching the reference's dual-sheet exports
//   extraControls render-prop for page-specific options (LOP's DataDetails,
//                 Presence hours' entry toggles)
export default function LeaveExportModal({
  open, onClose, rows, baseColumns, columns, extraColumns = [], fileStub,
  withIdentity = false, meta = [], legend = [], groups = null,
  sheetName = 'Report', hourColumns = null, hourSheetName = null,
  formats = LEAVE_FORMATS, extraControls = null,
}) {
  const [format, setFormat] = useState('XLS');
  const [includeExtra, setIncludeExtra] = useState(false);
  const [picked, setPicked] = useState({});
  const [legacyExtra, setLegacyExtra] = useState({});

  if (!open) return null;

  const own = columns || baseColumns || [];

  const resolveColumns = (leaf) => {
    if (!withIdentity) {
      // Legacy call sites pass their own extraColumns checkbox list.
      return [...leaf, ...extraColumns.filter(f => legacyExtra[f.key])];
    }
    const id = includeExtra
      ? identityColumns(true).filter(c => !IDENTITY_OPTIONAL.some(o => o.key === c.key) || picked[c.key])
      : identityColumns(false);
    return [...id, ...leaf];
  };

  const download = () => {
    if (!rows?.length) { onClose(); return; }
    // The banner row has to know how many identity columns actually got
    // written — ticking the optional fields widens the block from 3 to 8 and
    // would otherwise shift every group label out of line with its columns.
    const identityWidth = resolveColumns([]).length;
    const groupSpec = typeof groups === 'function' ? groups(identityWidth) : groups;

    const sheets = [{
      name: hourColumns ? `${sheetName}(Hours)` : sheetName,
      ws: buildSheet({ meta, legend, groups: groupSpec, columns: resolveColumns(own), rows }),
    }];
    if (hourColumns) {
      sheets.push({
        name: hourSheetName || `${sheetName}(Decimal)`,
        ws: buildSheet({ meta, legend, groups: groupSpec, columns: resolveColumns(hourColumns), rows }),
      });
    }
    downloadWorkbook(sheets, format, fileStub);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4">
          <p className="text-[17px] font-semibold text-slate-800">Export</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 pb-2 overflow-y-auto">
          <div className="border border-slate-200 rounded-lg p-6">
            <div className="flex justify-center mb-3" aria-hidden="true">
              <svg width="96" height="76" viewBox="0 0 96 76" fill="none">
                <rect x="10" y="10" width="44" height="56" rx="4" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2" />
                <rect x="30" y="4" width="44" height="56" rx="4" fill="#fff" stroke="#cbd5e1" strokeWidth="2" />
                <rect x="38" y="16" width="28" height="3" rx="1.5" fill="#cbd5e1" />
                <rect x="38" y="26" width="28" height="3" rx="1.5" fill="#cbd5e1" />
                <rect x="38" y="36" width="18" height="3" rx="1.5" fill="#cbd5e1" />
                <rect x="60" y="34" width="26" height="34" rx="3" fill="#dbeafe" stroke="#93c5fd" strokeWidth="2" />
                <circle cx="78" cy="16" r="10" fill="#22c55e" />
                <path d="M78 11v9m0 0 3.5-3.5M78 20l-3.5-3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-slate-800 text-center mb-4">Choose file format</p>

            <div className="flex items-center justify-center gap-6 flex-wrap">
              {formats.map(f => (
                <label key={f} className="flex items-center gap-2 text-[14px] text-slate-700 cursor-pointer">
                  <input
                    type="radio" name="export-format" checked={format === f}
                    onChange={() => setFormat(f)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  {f}
                </label>
              ))}
            </div>

            {extraControls}

            {withIdentity && (
              <div className="mt-5">
                <label className="flex items-center gap-2.5 text-[14px] text-slate-700 cursor-pointer">
                  <input
                    type="checkbox" checked={includeExtra}
                    onChange={e => setIncludeExtra(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Include additional employee fields
                </label>
                {includeExtra && (
                  <div className="grid grid-cols-3 gap-y-2 gap-x-3 mt-3 pl-7">
                    {IDENTITY_OPTIONAL.map(f => (
                      <label key={f.key} className="flex items-center gap-2 text-[13.5px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox" checked={!!picked[f.key]}
                          onChange={e => setPicked(p => ({ ...p, [f.key]: e.target.checked }))}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        {f.header}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!withIdentity && extraColumns.length > 0 && (
              <div className="mt-5 space-y-2">
                {extraColumns.map(f => (
                  <label key={f.key} className="flex items-center gap-2.5 text-[14px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox" checked={!!legacyExtra[f.key]}
                      onChange={e => setLegacyExtra(x => ({ ...x, [f.key]: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {f.header}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 flex items-center gap-3">
          <button onClick={download} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium transition-colors">
            Export
          </button>
          <button onClick={onClose} className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
