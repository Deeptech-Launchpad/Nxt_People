import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const shiftDay = (dateStr, delta) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
};
const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };

export default function DailyLeaveStatus() {
  const [date, setDate] = useState(todayCA());
  const [view, setView] = useState('chart');
  const [loading, setLoading] = useState(true);
  const [byType, setByType] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeStatus, setEmployeeStatus] = useState('all');

  const load = () => {
    setLoading(true);
    api.get(`/reports/leave/daily-status?date=${date}&employeeStatus=${employeeStatus}`)
      .then(r => { setByType(r.data.byType || []); setEmployees(r.data.employees || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date, employeeStatus]);

  const total = byType.reduce((s, r) => s + Number(r.count), 0);
  const donutData = byType.map(r => ({ label: LEAVE_LABEL[r.leaveType] || r.leaveType, count: r.count }));

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Date</label>
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(d => shiftDay(d, -1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
          <button onClick={() => setDate(d => shiftDay(d, 1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
        </div>
      </div>
      <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 ml-auto">
        {[['chart', 'Chart'], ['list', 'List']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
            {l}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <ReportShell title="Daily Leave Status" subtitle="Who's on approved leave for a given date" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {total === 0 ? (
        <div className="text-center py-16 text-slate-400">Nobody is on leave this date</div>
      ) : view === 'chart' ? (
        <DonutWithStats data={donutData} stats={[{ label: 'Total on Leave', value: total }]} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr><th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Leave Type</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {employees.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 capitalize">{LEAVE_LABEL[row.leaveType] || row.leaveType}{row.isHalfDay ? ' (Half Day)' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
