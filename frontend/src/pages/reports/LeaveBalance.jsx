import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import EmployeeFilter from './EmployeeFilter';
import UnitToggle from './UnitToggle';
import LeaveExportModal from './LeaveExportModal';

const now = new Date();

// Month-by-month drilldown for one leave type — opened by clicking a row,
// matching Zoho's per-type ledger modal.
function DetailModal({ employeeId, leaveType, label, year, onClose }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [unit, setUnit] = useState('days');

  useEffect(() => {
    api.get(`/reports/leave/balance-user-detail?employeeId=${employeeId}&leaveType=${leaveType}&year=${year}`)
      .then(r => { setRows(r.data.data || []); setUnit(r.data.unit || 'days'); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [employeeId, leaveType, year]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-[15px] font-bold text-slate-800">{label}</p>
            <p className="text-[12px] text-slate-400">{year}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">Period</th>
                  <th className="text-right px-4 py-2">Granted</th>
                  <th className="text-right px-4 py-2">Booked</th>
                  <th className="text-right px-4 py-2">Balance</th>
                  <th className="text-right px-4 py-2">Lapsed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(row => (
                  <tr key={row.month}>
                    <td className="px-4 py-2">{row.monthLabel}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.granted ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{unit === 'hours' ? row.bookedHours : row.bookedDays}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">{row.balance ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.lapsed}</td>
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
  const [detailType, setDetailType] = useState(null);
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
  };

  const changeYear = y => {
    setYear(y);
    if (employee) load(employee, y);
  };

  const rows = unit === 'hour' ? hourData : dayData;
  // Chart mode drops Absent — it has no grant/balance, just a running
  // count, and doesn't read as a bar alongside the capped/allocated types.
  const chartRows = rows.filter(r => r.leaveType !== 'absent').map(r => ({ ...r, bookedVal: r.booked, balanceVal: r.balance ?? 0 }));

  const filters = (
    <>
      <EmployeeFilter value={employee} onChange={selectEmployee} />
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Year</label>
        <select value={year} onChange={e => changeYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <UnitToggle value={unit} onChange={setUnit} />
      <div className="flex items-center gap-2 ml-auto">
        {employee && (
          <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
            Export
          </button>
        )}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
          {[['chart', 'Chart'], ['list', 'List']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <ReportShell title="Employee Leave Balance" subtitle="Casual, comp-off, unpaid, and permission balances for the selected employee and year" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!employee ? (
        <div className="text-center py-16 text-slate-400">Search for an employee to view their leave balance</div>
      ) : view === 'chart' ? (
        chartRows.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No data</div>
        ) : (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartRows} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v, name) => [v, name === 'bookedVal' ? 'Booked' : 'Balance']} />
                <Bar dataKey="bookedVal" stackId="a" name="Booked" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="balanceVal" stackId="a" name="Balance" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Leave Type</th>
                <th className="text-right px-4 py-2.5">Current Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row.leaveType} onClick={() => row.leaveType !== 'absent' && setDetailType(row)} className={row.leaveType !== 'absent' ? 'cursor-pointer hover:bg-slate-50' : ''}>
                  <td className={`px-4 py-2.5 font-medium ${row.leaveType !== 'absent' ? 'text-blue-600 hover:underline' : 'text-slate-700'}`}>{row.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.balance ?? row.booked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailType && detailType.leaveType !== 'absent' && (
        <DetailModal employeeId={employee._id} leaveType={detailType.leaveType} label={detailType.label} year={year} onClose={() => setDetailType(null)} />
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} fileStub={`leave-balance_${employee?.employeeId}_${year}`} />
    </ReportShell>
  );
}
