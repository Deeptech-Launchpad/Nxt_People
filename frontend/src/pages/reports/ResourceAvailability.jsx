import React, { useState, useEffect } from 'react';
import { Filter } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import EmployeeStatusFilter from './EmployeeStatusFilter';

const LEGEND = { CL: 'Casual Leave', CO: 'Comp-Off', LWP: 'Leave Without Pay', PM: 'Permission', A: 'Absent', H: 'Holiday', WO: 'Weekly Off' };
const CODE_STYLE = {
  CL: 'bg-blue-100 text-blue-700', CO: 'bg-purple-100 text-purple-700',
  LWP: 'bg-red-100 text-red-700', PM: 'bg-cyan-100 text-cyan-700',
  A: 'bg-rose-100 text-rose-700', H: 'bg-amber-100 text-amber-700', WO: 'bg-slate-100 text-slate-500',
};
const codeStyle = code => CODE_STYLE[code?.replace('½', '')] || '';

const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const monthEndCA = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
};

// Day-by-day leave calendar grid (employee rows × date columns) — same
// walk pattern as Attendance's Muster Roll, but cells carry a leave-type
// code instead of a present/absent code.
export default function ResourceAvailability() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(monthEndCA());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [employeeStatus, setEmployeeStatus] = useState('all');

  const load = () => {
    setLoading(true);
    api.get(`/reports/leave/resource-availability?startDate=${startDate}&endDate=${endDate}&employeeStatus=${employeeStatus}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">From</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">To</label>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
      <div className="flex items-center gap-3 text-[12px] text-slate-500 ml-auto flex-wrap">
        {Object.entries(LEGEND).map(([code, label]) => (
          <span key={code} className="flex items-center gap-1"><span className={`px-1.5 py-0.5 rounded font-semibold ${CODE_STYLE[code]}`}>{code}</span>{label}</span>
        ))}
      </div>
    </>
  );

  return (
    <ReportShell title="Resource Availability" subtitle="Leave calendar for the selected period" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-10 whitespace-nowrap">Employee</th>
                {data.dayLabels.map(d => {
                  const dd = new Date(d);
                  return (
                    <th key={d} className="px-1.5 py-2.5 text-center w-11 leading-tight">
                      <div>{dd.getDate()} {dd.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div className="text-slate-400 font-normal normal-case">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.data.map(emp => (
                <tr key={emp._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 sticky left-0 bg-white whitespace-nowrap">
                    <p className="font-medium text-slate-700">{emp.firstName} {emp.lastName} {emp.employeeCode && <span className="text-[11px] font-normal text-slate-400">({emp.employeeCode})</span>}</p>
                    <p className="text-[11px] text-slate-400">
                      {emp.department || '—'}
                      {emp.exitDate && <span className="ml-1.5 text-red-500 font-medium">Exited {new Date(emp.exitDate).toLocaleDateString('en-IN')}</span>}
                    </p>
                  </td>
                  {emp.days.map((code, i) => (
                    <td key={i} className="px-1 py-2 text-center">
                      {code && <span className={`inline-block min-w-7 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(code)}`}>{code}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
