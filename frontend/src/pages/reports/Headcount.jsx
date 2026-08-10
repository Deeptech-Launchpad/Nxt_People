import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

function BreakdownTable({ rows, labelHeader }) {
  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
        <tr><th className="text-left px-4 py-2.5">{labelHeader}</th><th className="text-right px-4 py-2.5">Count</th><th className="text-right px-4 py-2.5">Share</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.length === 0 ? (
          <tr><td colSpan={3} className="text-center py-8 text-slate-400">No data</td></tr>
        ) : rows.map((r, i) => (
          <tr key={i}>
            <td className="px-4 py-2.5 text-slate-700">{r.label}</td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.count}</td>
            <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{Math.round((r.count / total) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Headcount() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/reports/employee/headcount')
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ReportShell title="Headcount" subtitle="Active employees by department and work location" loading={loading}>
      {data && (
        <div className="p-5 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-4 w-fit">
            <p className="text-[13px] text-slate-500">Total Active Employees</p>
            <p className="text-[26px] font-bold text-emerald-700 mt-1">{data.total}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">By Department</p>
              <div className="border border-slate-100 rounded-xl overflow-hidden"><BreakdownTable rows={data.byDepartment} labelHeader="Department" /></div>
            </div>
            <div>
              <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">By Work Location</p>
              <div className="border border-slate-100 rounded-xl overflow-hidden"><BreakdownTable rows={data.byLocation} labelHeader="Location" /></div>
            </div>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
