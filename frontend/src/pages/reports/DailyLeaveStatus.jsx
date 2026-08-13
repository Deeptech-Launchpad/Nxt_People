import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight, RotateCcw, PieChart as PieIcon, List as ListIcon } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import { CHART_COLORS, makeSliceLabel, ActiveSlice } from './chartLabels';
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
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/daily-status?${params}`)
      .then(r => { setByType(r.data.byType || []); setEmployees(r.data.employees || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date, employeeStatus, leaveType, directReportsOnly, dimFilters]);

  const total = byType.reduce((s, r) => s + Number(r.count), 0);
  // `key` is carried through so a legend click can apply the Leave type filter.
  const chartData = byType.map(r => ({ key: r.leaveType, label: LEAVE_LABEL[r.leaveType] || r.leaveType, count: r.count }));

  const reset = () => {
    setDate(todayCA()); setEmployeeStatus('all'); setLeaveType(''); setDirectReportsOnly(false); setDimFilters({});
  };

  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

  const actions = (
    <div className="flex items-center gap-2">
      {/* Date nav in header like Zoho */}
      <button onClick={() => setDate(d => shiftDay(d, -1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] font-medium text-slate-700">{formatDate(date)}</span>
      <button onClick={() => setDate(d => shiftDay(d, 1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
      {/* Icon toggle rather than text buttons, as in the reference. */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 ml-2">
        {[['chart', PieIcon, 'Chart'], ['list', ListIcon, 'List']].map(([k, Icon, title]) => (
          <button
            key={k} onClick={() => setView(k)} title={title} aria-label={title}
            className={`p-1.5 rounded-md transition-colors ${view === k ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}
          >
            <Icon size={17} />
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
    <ReportShell menuItems={menuItems} title="Daily Leave Status" subtitle="Who's on approved or pending leave for a given date" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {total === 0 ? (
        <div className="text-center py-16 text-slate-400">Nobody is on leave this date</div>
      ) : view === 'chart' ? (
        <div className="p-5">
          <div className="border border-slate-200 rounded-lg p-5">
            <p className="text-[14px] font-medium text-slate-700 mb-2">Days Comparison</p>
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <div className="w-full lg:flex-1 min-w-0">
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart margin={{ top: 20, right: 130, bottom: 20, left: 130 }}>
                    <Pie
                      data={chartData} dataKey="count" nameKey="label" cx="50%" cy="50%"
                      innerRadius={0} outerRadius={92} isAnimationActive={false}
                      label={makeSliceLabel(total, chartData, 320, (name, value) => `${name},${value}`)}
                      labelLine={false}
                      activeShape={ActiveSlice}
                    >
                      {chartData.map((d, i) => <Cell key={d.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip cursor={false} formatter={(value, name) => [value, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Clicking a legend row drills into that leave type — it applies
                  the Leave type filter and switches to the list, which is what
                  the reference does when you click one of these. */}
              <div className="w-full lg:w-64 flex-shrink-0 space-y-3">
                {chartData.map((d, i) => (
                  <button
                    key={d.label}
                    // Open the filter panel too, so the Leave type chip the
                    // click just set is visible and clearable — otherwise the
                    // list silently stays filtered with no way back.
                    onClick={() => { setLeaveType(d.key); setView('list'); setFiltersOpen(true); }}
                    className="w-full flex items-center justify-between gap-3 group"
                    title={`Show ${d.label} on this date`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-[14px] text-slate-700 group-hover:text-blue-600 group-hover:underline truncate">{d.label}</span>
                    </span>
                    <span className="text-[14px] font-semibold text-slate-800 tabular-nums group-hover:text-blue-600">{d.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Leavetype</th>
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
