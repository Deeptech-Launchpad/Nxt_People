import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

export default function Distribution() {
  const [by, setBy] = useState('department');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/employee/distribution?by=${by}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [by]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;

  const actions = (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
      {[['department', 'Department'], ['designation', 'Designation']].map(([k, l]) => (
        <button key={k} onClick={() => setBy(k)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${by === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <ReportShell title="Distribution" subtitle="Active employees split by department or designation" actions={actions} loading={loading} switcherCategory="Employee Information">
      <table className="w-full text-[14px]">
        <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
          <tr><th className="text-left px-4 py-2.5">{by === 'department' ? 'Department' : 'Designation'}</th><th className="text-right px-4 py-2.5">Count</th><th className="text-right px-4 py-2.5">Share</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 ? (
            <tr><td colSpan={3} className="text-center py-10 text-slate-400">No data</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2.5 text-slate-700">{r.label}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.count}</td>
              <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{Math.round((r.count / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportShell>
  );
}
