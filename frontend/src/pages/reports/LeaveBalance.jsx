import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

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

// Per-employee balance — pick one employee, see their figures — matching
// Zoho's picker-driven Employee Leave Balance page rather than an
// all-employees table. Reuses the existing employee search endpoint
// (GET /employees?search=) instead of building a new one.
export default function LeaveBalance() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [detailType, setDetailType] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?search=${encodeURIComponent(query.trim())}&limit=10`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setShowResults(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const load = (emp, yr) => {
    setLoading(true);
    api.get(`/reports/leave/balance-user?employeeId=${emp._id}&year=${yr}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  const selectEmployee = emp => {
    setEmployee(emp);
    setQuery(`${emp.firstName} ${emp.lastName} (${emp.employeeId})`);
    setShowResults(false);
    load(emp, year);
  };

  const changeYear = y => {
    setYear(y);
    if (employee) load(employee, y);
  };

  const filters = (
    <>
      <div className="relative flex-1 min-w-[240px]" ref={boxRef}>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Employee</label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setShowResults(true); if (employee) setEmployee(null); }}
            onFocus={() => setShowResults(true)}
            placeholder="Search by name or employee ID"
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400"
          />
        </div>
        {showResults && results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
            {results.map(emp => (
              <button key={emp._id} onClick={() => selectEmployee(emp)} className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
                <span className="font-medium">{emp.firstName} {emp.lastName}</span>
                <span className="text-slate-400 ml-1.5">({emp.employeeId})</span>
                {emp.department && <span className="text-slate-400 ml-1.5">· {emp.department}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Year</label>
        <select value={year} onChange={e => changeYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <ReportShell title="Employee Leave Balance" subtitle="Casual, comp-off, unpaid, and permission balances for the selected employee and year" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!employee ? (
        <div className="text-center py-16 text-slate-400">Search for an employee to view their leave balance</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Leave Type</th>
                <th className="text-right px-4 py-2.5">Granted (Days)</th>
                <th className="text-right px-4 py-2.5">Booked (Days)</th>
                <th className="text-right px-4 py-2.5">Balance (Days)</th>
                <th className="text-right px-4 py-2.5">Booked (Hours)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row.leaveType} onClick={() => setDetailType(row)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-blue-600 hover:underline">{row.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.grantedDays ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.bookedDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.balanceDays ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.bookedHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailType && (
        <DetailModal employeeId={employee._id} leaveType={detailType.leaveType} label={detailType.label} year={year} onClose={() => setDetailType(null)} />
      )}
    </ReportShell>
  );
}
