import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, MoreHorizontal, PieChart, List, Upload, Search, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtDate } from '../../utils/dateFormat';
import { PhotoAvatar } from '../../components/ui';
import ReportShell from './ReportShell';
import UnitToggle from './UnitToggle';
import LeaveExportModal from './LeaveExportModal';

const now = new Date();

// One colour per leave type, carried by both the list's swatch and the
// chart's booked segment so a type reads the same in either view. Absent and
// Leave Without Pay share the reference's red — the chart drops Absent, so
// the two never appear side by side.
const TYPE_COLOR = {
  casual: '#ee9a3a',
  comp_off: '#8ec26f',
  unpaid: '#e15759',
  permission: '#7b6bd6',
  absent: '#e15759',
};

const modalShell = 'fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4';
const spinner = <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

// A zero reads as "nothing happened this period" in these ledgers, and the
// reference prints it as a dash rather than a 0 — the figure that matters on
// the row is the balance, and dashes keep it from being crowded by noise.
const dash = v => (v === null || v === undefined || v === 0 || v === '' ? '-' : v);

// From/To defaults: the whole year, except that the current year stops at
// today rather than running out to a December that hasn't happened.
const yearBounds = year => ({
  from: `${year}-01-01`,
  to: year === now.getFullYear() ? now.toLocaleDateString('en-CA') : `${year}-12-31`,
});

// Both drilldowns share one header — leave type on the left, the From/To pair
// centred, actions right — which is how the reference builds them.
function DrillHeader({ label, from, to, setFrom, setTo, year, onExport, onClose }) {
  const input = 'border border-slate-200 rounded-lg px-2 py-1 text-[13px] text-slate-700 focus:outline-none focus:border-blue-400';
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100">
      <p className="text-[15px] font-semibold text-slate-800 whitespace-nowrap">{label}</p>
      <div className="flex-1 flex items-center justify-center gap-2">
        <input type="date" value={from} min={`${year}-01-01`} max={`${year}-12-31`} onChange={e => setFrom(e.target.value)} className={input} />
        <span className="text-slate-400">-</span>
        <input type="date" value={to} min={`${year}-01-01`} max={`${year}-12-31`} onChange={e => setTo(e.target.value)} className={input} />
      </div>
      <div className="flex items-center gap-1">
        {onExport && (
          <button onClick={onExport} title="Export" className="p-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <Upload size={16} />
          </button>
        )}
        <button onClick={onClose} className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"><X size={16} /></button>
      </div>
    </div>
  );
}

// Month-by-month roll-up for one leave type — the reference's "Summary".
// The From/To pair narrows which months are listed; the figures themselves
// are the year's running totals, so trimming the ends hides rows rather than
// recomputing a partial-year balance.
function SummaryModal({ employeeId, leaveType, label, year, onClose }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [unit, setUnit] = useState('days');
  const [from, setFrom] = useState(yearBounds(year).from);
  const [to, setTo] = useState(yearBounds(year).to);

  useEffect(() => {
    api.get(`/reports/leave/balance-user-detail?employeeId=${employeeId}&leaveType=${leaveType}&year=${year}`)
      .then(r => { setRows(r.data.data || []); setUnit(r.data.unit || 'days'); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [employeeId, leaveType, year]);

  const visible = rows.filter(row => {
    const ym = `${year}-${String(row.month).padStart(2, '0')}`;
    return ym >= from.slice(0, 7) && ym <= to.slice(0, 7);
  });

  return (
    <div className={modalShell}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <DrillHeader label={label} from={from} to={to} setFrom={setFrom} setTo={setTo} year={year} onClose={onClose} />
        <div className="overflow-y-auto">
          {loading ? spinner : (
            <table className="w-full text-[13.5px]">
              <thead className="bg-slate-100 text-[13px] font-medium text-slate-600 sticky top-0">
                <tr>
                  {['Period', 'Granted', 'Booked', 'Balance', 'Lapsed'].map(h => (
                    <th key={h} className="text-left font-medium px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No months in this range</td></tr>
                ) : visible.map(row => (
                  <tr key={row.month}>
                    <td className="px-4 py-2.5 text-slate-700">{row.monthLabel}</td>
                    {/* Casual is granted once, in January — later months show
                        a dash rather than a fabricated 0, as in the reference. */}
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{dash(row.granted)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{dash(unit === 'hours' ? row.bookedHours : row.bookedDays)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{row.balance ?? '-'}</td>
                    {/* No lapse policy exists in this app, so this column is
                        structurally "-" rather than a computed zero. */}
                    <td className="px-4 py-2.5 text-slate-400">-</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const HISTORY_COLUMNS = [
  { key: 'date', header: 'Date', value: r => fmtDate(r.date, { day: '2-digit', month: '2-digit', year: 'numeric' }) },
  { key: 'type', header: 'Type' },
  { key: 'added', header: 'Added' },
  { key: 'booked', header: 'Booked' },
  { key: 'balance', header: 'Balance' },
];

// The transaction-level ledger behind the summary — every row moves the
// running balance, so it reads top-to-bottom as how the figure was reached.
function HistoryModal({ employeeId, employeeCode, leaveType, label, year, onClose }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [from, setFrom] = useState(yearBounds(year).from);
  const [to, setTo] = useState(yearBounds(year).to);

  useEffect(() => {
    api.get(`/reports/leave/balance-user-history?employeeId=${employeeId}&leaveType=${leaveType}&year=${year}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [employeeId, leaveType, year]);

  const visible = rows.filter(r => r.date >= from && r.date <= to);

  return (
    <div className={modalShell}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <DrillHeader label={label} from={from} to={to} setFrom={setFrom} setTo={setTo} year={year}
          onExport={visible.length ? () => setExportOpen(true) : undefined} onClose={onClose} />
        <div className="overflow-y-auto">
          {loading ? spinner : visible.length === 0 ? (
            <div className="text-center py-16 text-slate-400">No transactions in this range</div>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead className="bg-slate-100 text-[13px] font-medium text-slate-600 sticky top-0">
                <tr>
                  {['Date', 'Type', 'Added', 'Booked', 'Balance'].map(h => (
                    <th key={h} className="text-left font-medium px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row, i) => (
                  <tr key={`${row.date}-${i}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">{fmtDate(row.date, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                    <td className="px-4 py-2.5 text-slate-700">{row.type}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{dash(row.added)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{dash(row.booked)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-700">{row.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={visible}
        baseColumns={HISTORY_COLUMNS}
        fileStub={`leave-history_${employeeCode || employeeId}_${leaveType}_${year}`}
      />
    </div>
  );
}

// The breadcrumb employee chip, which is also this page's picker. Opening it
// lists everyone straight away — the report is meaningless without a chosen
// employee, so making you guess a name before anything appears would hide the
// one control the whole page depends on. The search box narrows that list
// server-side, so it still works past the 500-row fetch.
function EmployeePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      const q = query.trim() ? `search=${encodeURIComponent(query.trim())}&` : '';
      api.get(`/employees?${q}limit=500`)
        .then(r => setList([...(r.data.data || [])].sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)))))
        .catch(() => setList([]))
        .finally(() => setLoading(false));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, query]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white border border-slate-200 hover:border-slate-300 text-[13px] font-medium text-slate-700 transition-colors">
        {value ? (
          <>
            <PhotoAvatar photoUrl={value.photoUrl} firstName={value.firstName} lastName={value.lastName} className="w-6 h-6" textClassName="text-[10px]" />
            {value.employeeId} {value.firstName} {value.lastName}
          </>
        ) : (
          <span className="flex items-center gap-2 pl-2 text-slate-500"><Search size={13} /> Select employee</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg whitespace-normal">
          <div className="p-2 border-b border-slate-100">
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] font-normal focus:outline-none focus:border-blue-400" />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {loading && list.length === 0 ? (
              <p className="px-3 py-4 text-[13px] font-normal text-slate-400 text-center">Loading…</p>
            ) : list.length === 0 ? (
              <p className="px-3 py-4 text-[13px] font-normal text-slate-400 text-center">No employees found</p>
            ) : list.map(emp => (
              <button key={emp._id} onClick={() => { onChange(emp); setOpen(false); setQuery(''); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${value?._id === emp._id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                <PhotoAvatar photoUrl={emp.photoUrl} firstName={emp.firstName} lastName={emp.lastName} className="w-6 h-6" textClassName="text-[10px]" />
                <span className="font-normal">{emp.employeeId} {emp.firstName} {emp.lastName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Per-row "⋯" — Summary and History, the two drilldowns the reference opens
// from a leave type row. It sits in a leading column to the left of the type
// and only appears on hover, as it does there.
function RowMenu({ onSummary, onHistory }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }} title="More"
        className={`p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ${open ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5">
          {[['Summary', onSummary], ['History', onHistory]].map(([label, fn]) => (
            <button key={label} onClick={e => { e.stopPropagation(); setOpen(false); fn(); }}
              className="w-full text-left px-4 py-2 text-[13.5px] text-slate-700 hover:bg-slate-50 transition-colors">
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXPORT_COLUMNS = [
  { key: 'label', header: 'Leave Type' }, { key: 'granted', header: 'Granted' }, { key: 'booked', header: 'Booked' }, { key: 'balance', header: 'Balance' },
];

// Per-employee balance — pick one employee, see their figures — matching
// Zoho's picker-driven Employee Leave Balance page: a bar Chart view
// (default) with a List toggle, and a Day/Hour unit toggle that swaps
// which leave types are shown entirely (Day never shows Permission, Hour
// shows only Permission) rather than merging both units into one row.
export default function LeaveBalance() {
  const [employee, setEmployee] = useState(null);
  const [year, setYear] = useState(now.getFullYear());
  const [unit, setUnit] = useState('day');
  const [view, setView] = useState('chart');
  const [loading, setLoading] = useState(false);
  const [dayData, setDayData] = useState([]);
  const [hourData, setHourData] = useState([]);
  const [drill, setDrill] = useState(null);
  const [sort, setSort] = useState({ key: 'label', dir: 'asc' });
  const [exportOpen, setExportOpen] = useState(false);

  const load = (emp, yr) => {
    setLoading(true);
    api.get(`/reports/leave/balance-user?employeeId=${emp._id}&year=${yr}`)
      .then(r => { setDayData(r.data.dayData || []); setHourData(r.data.hourData || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  const selectEmployee = emp => {
    setEmployee(emp);
    if (emp) load(emp, year);
    else { setDayData([]); setHourData([]); }
  };

  const changeYear = y => {
    setYear(y);
    if (employee) load(employee, y);
  };

  const rows = unit === 'hour' ? hourData : dayData;
  // Chart mode drops Absent — it has no grant/balance, just a running
  // count, and doesn't read as a bar alongside the capped/allocated types.
  const chartRows = rows.filter(r => r.leaveType !== 'absent').map(r => ({ ...r, bookedVal: r.booked, balanceVal: r.balance ?? 0 }));

  // Absent is a count off the attendance table, not a leave type the
  // drilldown endpoints accept, so it carries no Summary/History.
  const canDrill = row => row.leaveType !== 'absent';

  const sortValue = (row, key) => (key === 'label' ? row.label : (row.balance ?? row.booked ?? 0));
  const sortedRows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key), bv = sortValue(b, sort.key);
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  const toggleSort = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  // Both columns sort. The arrows stay visible on the inactive column too —
  // that's what advertises the column as sortable before you click it.
  const sortHeader = (column, label) => (
    <th className="px-4 py-2.5 text-left">
      <button onClick={() => toggleSort(column)} className={`inline-flex items-center gap-1.5 transition-colors ${sort.key === column ? 'text-slate-800' : 'hover:text-slate-700'}`}>
        {label}
        {sort.key !== column
          ? <ChevronsUpDown size={13} className="text-slate-400" />
          : sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
    </th>
  );

  const actions = (
    <>
      <UnitToggle value={unit} onChange={setUnit} />
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {[['chart', PieChart, 'Chart view'], ['list', List, 'List view']].map(([k, Icon, hint]) => (
          <button key={k} onClick={() => setView(k)} title={hint}
            className={`p-1.5 rounded-md transition-colors ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon size={15} />
          </button>
        ))}
      </div>
    </>
  );

  // Print only, matching the reference — this page offers no Export or ICS
  // in the overflow menu. Print goes through the browser pipeline and the
  // print stylesheet, so "Download as PDF" would be the same action twice.
  const menuItems = [{ key: 'print', label: 'Print', onClick: () => window.print() }];

  // No employee picker here — it's the breadcrumb chip now, where the
  // reference puts it, and two pickers driving one selection is a trap.
  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Year</label>
        <select value={year} onChange={e => changeYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {employee && (
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors ml-auto">
          Export
        </button>
      )}
    </>
  );

  const employeeChip = <EmployeePicker value={employee} onChange={selectEmployee} />;

  return (
    <ReportShell title="Employee Leave Balance" subtitle="Casual, comp-off, unpaid, and permission balances for the selected employee and year"
      actions={actions} menuItems={menuItems} breadcrumbChip={employeeChip} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!employee ? (
        <div className="text-center py-16 text-slate-400">Pick an employee from the chip above to view their leave balance</div>
      ) : view === 'chart' ? (
        chartRows.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No data</div>
        ) : (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartRows} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }}>
                  <Label value={unit === 'hour' ? 'Hour Leave Chart' : 'Day Leave Chart'} angle={-90} position="insideLeft"
                    style={{ fontSize: 12, fill: '#64748b', textAnchor: 'middle' }} />
                </YAxis>
                <Tooltip formatter={(v, name) => [v, name === 'bookedVal' ? 'Booked' : 'Balance']} />
                <Bar dataKey="bookedVal" stackId="a" name="Booked" radius={[0, 0, 0, 0]}>
                  {chartRows.map(r => <Cell key={r.leaveType} fill={TYPE_COLOR[r.leaveType] || '#f59e0b'} />)}
                </Bar>
                <Bar dataKey="balanceVal" stackId="a" name="Balance" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      ) : (
        <table className="w-full text-[14px]">
          <thead className="bg-slate-100 text-[13px] font-medium text-slate-600">
            <tr>
              <th className="w-14" />
              {sortHeader('label', 'Leave Type')}
              {sortHeader('balance', 'Current Balance')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedRows.map(row => (
              <tr key={row.leaveType} className="group hover:bg-slate-50/60">
                <td className="w-14 px-3 py-2.5">
                  {canDrill(row) && (
                    <RowMenu
                      onSummary={() => setDrill({ ...row, mode: 'summary' })}
                      onHistory={() => setDrill({ ...row, mode: 'history' })}
                    />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: TYPE_COLOR[row.leaveType] || '#cbd5e1' }} />
                    {canDrill(row) ? (
                      <button onClick={() => setDrill({ ...row, mode: 'summary' })} className="text-slate-700 hover:text-blue-600 hover:underline">{row.label}</button>
                    ) : (
                      <span className="text-slate-700">{row.label}</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-700">{row.balance ?? row.booked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {drill && drill.mode === 'summary' && (
        <SummaryModal employeeId={employee._id} leaveType={drill.leaveType} label={drill.label} year={year} onClose={() => setDrill(null)} />
      )}
      {drill && drill.mode === 'history' && (
        <HistoryModal employeeId={employee._id} employeeCode={employee.employeeId} leaveType={drill.leaveType} label={drill.label} year={year} onClose={() => setDrill(null)} />
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} fileStub={`leave-balance_${employee?.employeeId}_${year}`} />
    </ReportShell>
  );
}
