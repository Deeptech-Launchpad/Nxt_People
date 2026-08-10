import React, { useState, useEffect } from 'react';
import { Filter, Download } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'totalDays', header: 'Total Days' }, { key: 'lopDays', header: 'Loss of Pay' }, { key: 'paidDays', header: 'Paid Days' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Per-employee payroll-period summary — Total days / Loss of Pay / Paid
// days — matching Zoho's actual Leave Data for Payroll report. Total days
// is capped by joining/exit date, so a mid-period joiner or exit shows
// their real partial-period count, not the full period length.
export default function LeavePayrollExport() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/reports/leave/payroll-export?startDate=${startDate}&endDate=${endDate}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
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
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
      <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors ml-auto">
        <Download size={14} /> Export
      </button>
    </>
  );

  return (
    <ReportShell title="Leave Data for Payroll" subtitle="Total, loss of pay, and paid days per employee for the selected pay period" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Total Days</th>
                <th className="text-right px-4 py-2.5">Loss of Pay</th>
                <th className="text-right px-4 py-2.5">Paid Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'totalDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lopDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'paidDays')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.totalDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{row.lopDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.paidDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`leave-data-for-payroll_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
