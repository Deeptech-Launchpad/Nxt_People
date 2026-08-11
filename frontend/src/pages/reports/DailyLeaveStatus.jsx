import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import LeaveTypeFilter from './LeaveTypeFilter';
import LeaveExportModal from './LeaveExportModal';
import DirectReportsToggle from './DirectReportsToggle';
import FilterToggleButton from './FilterToggleButton';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const shiftDay = (dateStr, delta) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
};
const formatDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'leaveType', header: 'Leave Type', value: r => LEAVE_LABEL[r.leaveType] || r.leaveType },
  { key: 'category', header: 'Type' }, { key: 'reason', header: 'Reason' }, { key: 'approvalStatus', header: 'Approval Status' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function DailyLeaveStatus() {
  const [date, setDate] = useState(todayCA());
  const [view, setView] = useState('chart');
  const [loading, setLoading] = useState(true);
  const [byType, setByType] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [leaveType, setLeaveType] = useState('');
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      date, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(leaveType ? { leaveType } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/daily-status?${params}`)
      .then(r => { setByType(r.data.byType || []); setEmployees(r.data.employees || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date, employeeStatus, leaveType, directReportsOnly, dimFilters]);

  const total = byType.reduce((s, r) => s + Number(r.count), 0);
  const donutData = byType.map(r => ({ label: LEAVE_LABEL[r.leaveType] || r.leaveType, count: r.count }));

  const reset = () => {
    setDate(todayCA()); setEmployeeStatus('all'); setLeaveType(''); setDirectReportsOnly(false); setDimFilters({});
  };

  const actions = (
    <div className="flex items-center gap-2">
      {/* Date nav in header like Zoho */}
      <button onClick={() => setDate(d => shiftDay(d, -1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] font-medium text-slate-700">{formatDate(date)}</span>
      <button onClick={() => setDate(d => shiftDay(d, 1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 ml-2">
        {[['chart', 'Chart'], ['list', 'List']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
            {l}
          </button>
        ))}
      </div>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <LeaveTypeFilter value={leaveType} onChange={setLeaveType} />
      <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
      <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="w-full flex flex-wrap items-center gap-2">
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
        <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showExEmployees} onChange={e => setShowExEmployees(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Show selective ex-employees
        </label>
      </div>
    </>
  ) : null;

  return (
    <ReportShell title="Daily Leave Status" subtitle="Who's on approved or pending leave for a given date" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {total === 0 ? (
        <div className="text-center py-16 text-slate-400">Nobody is on leave this date</div>
      ) : view === 'chart' ? (
        <DonutWithStats data={donutData} stats={[{ label: 'Total on Leave', value: total }]} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Leave Type</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-left px-4 py-2.5">Approval Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {employees.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 capitalize">{LEAVE_LABEL[row.leaveType] || row.leaveType}{row.isHalfDay ? ' (Half Day)' : ''}</td>
                  <td className="px-4 py-2.5">{row.category || '—'}</td>
                  <td className="px-4 py-2.5 max-w-xs truncate" title={row.reason}>{row.reason || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize ${row.approvalStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.approvalStatus}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={employees} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`daily-leave-status_${date}`} />
    </ReportShell>
  );
}
