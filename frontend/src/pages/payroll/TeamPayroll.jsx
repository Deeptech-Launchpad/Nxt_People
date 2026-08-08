/**
 * Manager → Team Payroll
 * Shows direct-report payroll status for the selected month: who has a
 * generated payslip, who's still pending, their gross + net, any LOP.
 * Manager doesn't see structure/CTC details — just the run output.
 * Admin lands here too and sees all employees (backend handles the
 * filter — managers get their reports, admin gets everyone).
 */
import React, { useEffect, useState } from 'react';
import { Users, Wallet, AlertCircle, RefreshCw, User as UserIcon, Eye } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, fmtINR, fmtINRshort, StatusPill, StatCard } from './_shared';
import { PayslipModal } from './PayrollRun';

export default function TeamPayroll() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear]   = useState(today.getFullYear());
  const [data, setData]   = useState({ summary: null, rows: [] });
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/payroll/team?month=${month}&year=${year}`)
      .then(r => setData({ summary: r.data.summary, rows: r.data.data || [] }))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Team Payroll</h1>
          <p className="text-[15px] text-slate-500 mt-1">
            Direct-report payslip status for any month. Click a row to view full details.
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
            {MONTH_NAMES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} title="Refresh" className="ml-1 text-slate-400 hover:text-slate-700"><RefreshCw size={13} /></button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Headcount"    value={data.summary?.headcount ?? '—'} icon={Users} />
        <StatCard label="Payslips Generated"
                  value={`${data.summary?.withSlip ?? 0} / ${data.summary?.headcount ?? 0}`}
                  color={data.summary && data.summary.headcount > 0 && data.summary.withSlip === data.summary.headcount ? 'text-emerald-700' : 'text-amber-700'} />
        <StatCard label="Total Gross" value={fmtINRshort(data.summary?.gross ?? 0)} color="text-blue-700" hint={fmtINR(data.summary?.gross ?? 0)} icon={Wallet} />
        <StatCard label="Total Net"   value={fmtINRshort(data.summary?.net ?? 0)}   color="text-emerald-700" hint={fmtINR(data.summary?.net ?? 0)} />
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-[15px]">
          <thead className="bg-slate-50 text-[13px] font-bold text-slate-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5">Designation</th>
              <th className="px-4 py-2.5 text-right">Gross</th>
              <th className="px-4 py-2.5 text-right">Net Pay</th>
              <th className="px-4 py-2.5">LOP</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">
                <UserIcon size={28} className="mx-auto text-slate-300 mb-2" />
                <p>No direct reports found.</p>
                <p className="text-[13px] mt-1">Ask HR to set the reporting person on your team members.</p>
              </td></tr>
            ) : data.rows.map(r => (
              <tr key={r._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
                      {r.photoUrl
                        ? <img src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-slate-400"><UserIcon size={16} /></div>}
                    </div>
                    <div className="min-w-0 max-w-[220px]">
                      <p className="font-semibold text-slate-800 truncate">{r.firstName} {r.lastName}</p>
                      <p className="text-[13px] text-slate-400 font-mono truncate">{r.employeeId}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{r.designation || '—'}</div>
                  <div className="text-[13px] text-slate-400">{r.department || ''}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">
                  {r.payslipId ? fmtINR(r.grossEarnings) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">
                  {r.payslipId ? fmtINR(r.netPay) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[14px]">
                  {Number(r.lopDays) > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      <AlertCircle size={11} /> {Number(r.lopDays)}d
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {r.payslipStatus
                    ? <StatusPill status={r.payslipStatus} />
                    : <span className="text-[13px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-bold">Pending</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.payslipId && (
                    <button onClick={() => setViewing(r.payslipId)} title="View" className="text-blue-600 hover:text-blue-800">
                      <Eye size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && <PayslipModal id={viewing} onClose={() => setViewing(null)} adminScope />}
    </div>
  );
}
