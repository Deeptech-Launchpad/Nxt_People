import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, RotateCcw, ArrowUpDown } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import LeaveTypeFilter from './LeaveTypeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import PeriodPresetChip from './PeriodPresetChip';
import FilterToggleButton from './FilterToggleButton';
import LeaveExportModal from './LeaveExportModal';
import { downloadIcs } from '../../utils/reportIcs';

// Codes render as plain text over a coloured underline rather than a filled
// pill — with a month of data on screen, filled badges turn the grid into a
// wall of colour and bury the handful of cells that actually matter.
const CODE_COLOR = {
  CL: '#e8a33d', CO: '#70ad47', LWP: '#e15759',
  PM: '#e8a33d', A: '#e15759', H: '#5b9bd5',
};
const LEGEND = [
  ['CL', 'Casual Leave'], ['PM', 'Permission'], ['A', 'Absent'],
  ['LWP', 'Leave Without Pay'], ['CO', 'Comp-Off'],
];
const codeColor = code => CODE_COLOR[String(code || '').replace('½', '').replace(/^[\d.]+/, '').split('/')[0]] || '#94a3b8';

const isWeekendDay = d => [0, 6].includes(new Date(d).getDay());
const todayCA = new Date().toLocaleDateString('en-CA');

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const monthStartCA = () => new Date(y, m, 1).toLocaleDateString('en-CA');
const monthEndCA = () => new Date(y, m + 1, 0).toLocaleDateString('en-CA');
const formatRange = (s, e) => `${new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${new Date(e).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

// The reference export writes one column per day headed "01 Aug (Sat)" — note
// this differs from the Present/Absent grid's "1 - Aug" — and spells the value
// out in full ("Weekend", "Casual Leave") rather than using the grid's codes.
const CODE_WORD = {
  CL: 'Casual Leave', CO: 'Compensatory Off', LWP: 'Leave Without Pay',
  PM: 'Permission', A: 'Absent', H: 'Holiday', WO: 'Weekend',
};
const codeWord = code => {
  if (!code) return '';
  const base = String(code).replace('½', '').replace(/^[\d.]+/, '').split('/')[0];
  return CODE_WORD[base] || code;
};
const exportDayColumns = dayLabels => dayLabels.map((d, i) => {
  const dt = new Date(d);
  return {
    key: `d${i}`,
    header: `${String(dt.getDate()).padStart(2, '0')} ${dt.toLocaleDateString('en-US', { month: 'short' })} (${dt.toLocaleDateString('en-US', { weekday: 'short' })})`,
    value: r => codeWord(r.days[i]),
  };
});

export default function ResourceAvailability() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(monthEndCA());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [leaveType, setLeaveType] = useState('');
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [showExEmployees, setShowExEmployees] = useState(true);

  const shiftMonth = delta => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + delta);
    const s = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
    setStartDate(s); setEndDate(e);
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(leaveType ? { leaveType } : {}),
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/resource-availability?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [startDate, endDate, employeeStatus, leaveType, directReportsOnly, dimFilters]);

  // Sorting is client-side on the already-loaded page — the grid is one
  // request's worth of rows, so there's nothing to re-fetch.
  const rows = data
    ? [...data.data].sort((a, b) => {
        const an = `${a.firstName} ${a.lastName}`.toLowerCase();
        const bn = `${b.firstName} ${b.lastName}`.toLowerCase();
        return sortAsc ? an.localeCompare(bn) : bn.localeCompare(an);
      })
    : [];

  const reset = () => {
    setStartDate(monthStartCA()); setEndDate(monthEndCA());
    setEmployeeStatus('all'); setLeaveType(''); setDirectReportsOnly(false); setDimFilters({});
  };

  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap">{formatRange(startDate, endDate)}</span>
      <button onClick={() => shiftMonth(1)} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  // Every entry does real work. Print and PDF share the browser's print
  // pipeline — the print stylesheet drops the app chrome and expands the
  // grid's scroll pane so the whole month reaches the page. "Permissions" is
  // not offered: this app has no per-report access control, and a menu item
  // that does nothing is worse than an absent one.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
    {
      key: 'ics',
      label: 'Download as ICS',
      onClick: () => {
        const events = [];
        rows.forEach(emp => {
          (emp.days || []).forEach((code, i) => {
            if (!code || code === 'WO') return;
            events.push({
              date: data.dayLabels[i],
              summary: `${emp.firstName} ${emp.lastName} — ${codeWord(code)}`,
              uid: `ra-${emp._id}-${data.dayLabels[i]}@nxtpeople`,
            });
          });
        });
        if (!events.length) { toast('Nothing to add to a calendar for this period'); return; }
        downloadIcs(events, `Resource_availability_${startDate}_to_${endDate}`, 'Resource Availability');
      },
    },
    { key: 'print', label: 'Print', onClick: () => window.print() },
  ];

  const filters = filtersOpen ? (
    <>
      <PeriodPresetChip defaultKey="thisMonth" onSelect={({ start, end }) => { setStartDate(start); setEndDate(end); }} />
      <LeaveTypeFilter value={leaveType} onChange={setLeaveType} />
      <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
      <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      {/* Export lives in the ⋯ menu now, so it isn't repeated here. */}
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          Submit
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
    <ReportShell title="Resource Availability" actions={actions} periodNav={periodNav} menuItems={menuItems} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <>
          {/* A fixed-height scroll pane rather than a table that grows down the
              page: the day headers and the frozen Employee column stay put
              while you scroll a month of data in either direction. */}
          <div className="overflow-auto max-h-[62vh] border-b border-slate-200">
            <table className="text-[13px] border-collapse">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="text-left px-4 py-3 sticky left-0 z-30 bg-slate-100 whitespace-nowrap border-r border-slate-200 min-w-[240px]">
                    <button
                      onClick={() => setSortAsc(s => !s)}
                      className="flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-900"
                      title="Sort by employee"
                    >
                      Employee <ArrowUpDown size={13} className="text-slate-400" />
                    </button>
                  </th>
                  {data.dayLabels.map(d => {
                    const dd = new Date(d);
                    const weekend = isWeekendDay(d);
                    return (
                      <th
                        key={d}
                        className={`px-2 py-2 text-center w-[74px] min-w-[74px] leading-tight font-medium border-r border-slate-100 ${weekend ? 'bg-[#fdf6e3]' : d === todayCA ? 'bg-slate-100' : 'bg-slate-50'}`}
                      >
                        <div className="text-[12.5px] text-slate-600">
                          {String(dd.getDate()).padStart(2, '0')} {dd.toLocaleDateString('en-US', { month: 'short' })}
                        </div>
                        <div className="text-[11.5px] text-slate-400 font-normal">
                          {dd.toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(emp => (
                  <tr key={emp._id} className="border-b border-slate-100 hover:bg-slate-50/60 group">
                    <td className="px-4 py-2.5 sticky left-0 z-10 bg-white group-hover:bg-slate-50 whitespace-nowrap border-r border-slate-200">
                      <span className="text-[13.5px] text-slate-700">
                        <span className="text-slate-400 mr-1.5">{emp.employeeCode}</span>
                        {emp.firstName} {emp.lastName}
                      </span>
                      {emp.exitDate && (
                        <span className="ml-2 text-[11px] text-red-500 font-medium">
                          Exited {new Date(emp.exitDate).toLocaleDateString('en-IN')}
                        </span>
                      )}
                    </td>
                    {emp.days.map((code, i) => {
                      const d = data.dayLabels[i];
                      const weekend = isWeekendDay(d);
                      // Weekends are shown by tinting the column, not by
                      // stamping a code in every cell — that filled ~9 columns
                      // per month with badges carrying no information.
                      const show = code && code !== 'WO';
                      return (
                        <td
                          key={i}
                          className={`px-1 py-2.5 text-center border-r border-slate-100 ${weekend ? 'bg-[#fdf6e3]' : d === todayCA ? 'bg-slate-50' : ''}`}
                        >
                          {show && (
                            <span
                              className="inline-block text-[12px] text-slate-700 pb-0.5"
                              style={{ borderBottom: `2px solid ${codeColor(code)}` }}
                            >
                              {code}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Legend sits below the scroll pane so it stays visible while the
              grid scrolls, instead of scrolling away with the filter panel. */}
          <div className="flex items-center gap-6 flex-wrap px-4 py-3">
            {LEGEND.map(([code, label]) => (
              <span key={code} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                <span className="inline-block w-0.5 h-4 rounded" style={{ background: CODE_COLOR[code] }} />
                {code} - {label}
              </span>
            ))}
          </div>
        </>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={exportDayColumns(data?.dayLabels || [])}
        sheetName="Leave"
        fileStub="Resource_availability"
      />
    </ReportShell>
  );
}
