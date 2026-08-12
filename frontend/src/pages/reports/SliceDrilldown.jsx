import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import LeaveExportModal from './LeaveExportModal';

const COLUMNS = [
  { key: 'department', header: 'Department' },
  { key: 'designation', header: 'Designation' },
  { key: 'employmentType', header: 'Employment Type' },
];

// The list behind a chart slice: clicking "WFH (3)" should answer "which
// three people?", which the chart alone can't. Mirrors the reference's
// drill-down — Employee / Department / Designation / Employment Type, with
// its own Export.
export default function SliceDrilldown({ by, value, label, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!value) return;
    setLoading(true);
    api.get(`/reports/employee/drilldown?by=${encodeURIComponent(by)}&value=${encodeURIComponent(value)}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load employees'))
      .finally(() => setLoading(false));
  }, [by, value]);

  if (!value) return null;

  return (
    <div className="border-t border-slate-200">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
        <p className="text-[14px] font-semibold text-slate-800">
          {label}: {value} {!loading && `(${rows.length})`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExportOpen(true)}
            disabled={!rows.length}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-[13px] font-medium transition-colors disabled:opacity-50"
          >
            Export
          </button>
          <button onClick={onClose} title="Close" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-[13px]">No employees</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-100 text-[12px] font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                {COLUMNS.map(c => <th key={c.key} className="text-left px-4 py-2.5">{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r._id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">
                      <span className="text-slate-400 mr-1.5">{r.employeeCode}</span>
                      {r.firstName} {r.lastName}
                    </p>
                    <p className="text-[12px] text-slate-400">{r.email}</p>
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key} className="px-4 py-2.5 text-slate-600">{r[c.key] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={COLUMNS}
        sheetName={`${label} - ${value}`.slice(0, 31)}
        fileStub={`${label}_${value}`.replace(/[^\w-]+/g, '_')}
      />
    </div>
  );
}
