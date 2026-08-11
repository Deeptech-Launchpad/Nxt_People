import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import EmployeeFilter from './EmployeeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import { EmployeeCell } from './TableReportPage';

const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'openingBalance', header: 'Opening Balance' }, { key: 'granted', header: 'Granted' }, { key: 'booked', header: 'Booked (Days)' },
  { key: 'bookedHours', header: 'Booked (Hours)' }, { key: 'closingBalance', header: 'Closing Balance' }, { key: 'lapsed', header: 'Lapsed' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Per-employee ledger for one leave type + year, matching Zoho's Leave
// Type Wise Summary. The type dropdown is year-versioned ("Casual Leave
// 2025", "Casual Leave 2024", ...), sourced from /leave/types-available so
// it only ever lists years that actually have data, per the explicit
// instruction that our system should accumulate the same way Zoho's does.
// All filters are always visible (no toggle), matching Zoho's layout.
export default function LeaveTypeSummary() {
  const [available, setAvailable] = useState([]);
  const [selection, setSelection] = useState(null); // { leaveType, year }
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [employee, setEmployee] = useState(null);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});

  useEffect(() => {
    api.get('/reports/leave/types-available')
      .then(r => {
        const list = r.data.data || [];
        setAvailable(list);
        if (list.length) setSelection({ leaveType: list[0].leaveType, year: list[0].year });
        else setLoading(false);
      })
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load report'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selection) return;
    setLoading(true);
    const params = new URLSearchParams({
      leaveType: selection.leaveType, year: selection.year, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/type-summary?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [selection, employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setEmployee(null); setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
  };

  const filters = (
    <>
      {/* Row 1: Leave type selector, employee, actions */}
      <div>
        <select
          value={selection ? `${selection.leaveType}|${selection.year}` : ''}
          onChange={e => { const [leaveType, year] = e.target.value.split('|'); setSelection({ leaveType, year: Number(year) }); }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400 min-w-[200px]"
        >
          {available.map(a => (
            <option key={`${a.leaveType}|${a.year}`} value={`${a.leaveType}|${a.year}`}>{LEAVE_LABEL[a.leaveType] || a.leaveType} {a.year}</option>
          ))}
        </select>
      </div>
      <EmployeeFilter value={employee} onChange={setEmployee} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {/* Row 2: Direct reports + org filters */}
      <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
        <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
        <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      </div>
      {/* Row 3: Employee status */}
      <div className="w-full flex flex-wrap items-center gap-1.5">
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
      </div>
    </>
  );

  return (
    <ReportShell title="Leave Type Wise Summary" subtitle="Per-employee ledger for the selected leave type and year" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!available.length ? (
        <div className="text-center py-16 text-slate-400">No leave records yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Opening Balance</th>
                <th className="text-right px-4 py-2.5">Granted</th>
                <th className="text-right px-4 py-2.5">Booked (Days)</th>
                <th className="text-right px-4 py-2.5">Booked (Hours)</th>
                <th className="text-right px-4 py-2.5">Closing Balance</th>
                <th className="text-right px-4 py-2.5">Lapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'openingBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'granted')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'booked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'bookedHours')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'closingBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lapsed')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.openingBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.granted ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.booked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.bookedHours}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.closingBalance ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.lapsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`leave-type-summary_${selection?.leaveType}_${selection?.year}`} />
    </ReportShell>
  );
}
