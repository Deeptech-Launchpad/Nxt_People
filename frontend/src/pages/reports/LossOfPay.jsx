import React, { useState, useEffect } from 'react';
import { Filter, Download, ArrowRight, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import EmployeeFilter from './EmployeeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import DateChip from './DateChip';
import PeriodPresetChip from './PeriodPresetChip';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'previousPeriodBalance', header: 'Previous Period Balance' }, { key: 'booked', header: 'Booked' }, { key: 'total', header: 'Total' },
  { key: 'waivedOff', header: 'Waived Off' }, { key: 'carryOver', header: 'Carry Over' }, { key: 'reason', header: 'Reason' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Reuses the exact same lopDaysForRange() Payroll Run computes with (via
// the backend), so this can never disagree with what actually gets
// deducted. previousPeriodBalance/waivedOff/carryOver/reason are always
// 0/blank — this system doesn't track LOP adjustments or carry-over
// between pay periods, so those columns stay honestly empty.
// "Push to Payroll" is a navigation shortcut to the Payroll Run page, not
// a data write — Payroll Run recomputes LOP fresh from attendance/leave
// every time it runs, so there's nothing here to push.
export default function LossOfPay() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [employee, setEmployee] = useState(null);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/lop?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setStartDate(monthStartCA()); setEndDate(todayCA()); setEmployee(null);
    setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
  };

  const filters = (
    <>
      <PeriodPresetChip onSelect={({ start, end }) => { setStartDate(start); setEndDate(end); }} />
      <DateChip label="From Date" value={startDate} onChange={setStartDate} />
      <DateChip label="To Date" value={endDate} onChange={setEndDate} />
      <EmployeeFilter value={employee} onChange={setEmployee} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={() => navigate('/payroll/run')} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          Push To Payroll <ArrowRight size={14} />
        </button>
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
        <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
        <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      </div>
      <div className="w-full flex flex-wrap items-center gap-1.5">
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
      </div>
    </>
  );

  return (
    <ReportShell title="Loss of Pay Details" subtitle="Unpaid LOP days in the selected period — the same calculation Payroll Run uses" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No LOP days in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Previous Period Balance</th>
                <th className="text-right px-4 py-2.5">Booked (Unpaid)</th>
                <th className="text-right px-4 py-2.5">Total (Previous + Taken)</th>
                <th className="text-right px-4 py-2.5">Waived Off</th>
                <th className="text-right px-4 py-2.5">Carry Over</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'previousPeriodBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'booked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'total')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'waivedOff')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'carryOver')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.previousPeriodBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{row.booked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{row.total}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.waivedOff}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.carryOver}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`lop-details_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
