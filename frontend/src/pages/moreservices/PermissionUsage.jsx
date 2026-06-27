import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Hourglass, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Permission Usage (Super Admin / HR) ──────────────────────────────────
 *  Monthly view of each employee's PERMISSION hours — approved + pending +
 *  remaining out of the 4h monthly allowance (no carry-forward). Read-only
 *  over GET /leaves/permission-usage. */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const LIMIT = 4;

export default function PermissionUsage() {
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/leaves/permission-usage?month=${month}&year=${year}`)
      .then(r => setRows(r.data.data || []))
      .catch(() => toast.error('Failed to load permission usage'))
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    setMonth(m); setYear(y);
  };

  const totalApproved = rows.reduce((s, r) => s + (parseFloat(r.approvedHours) || 0), 0);
  const totalPending  = rows.reduce((s, r) => s + (parseFloat(r.pendingHours) || 0), 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/more-services/operations')} className="text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Hourglass size={18} className="text-purple-600" />
            <div>
              <h2 className="text-[17px] font-bold text-slate-800">Permission Usage</h2>
              <p className="text-[14px] text-slate-400">Monthly permission hours · 4h allowance per employee · no carry-forward</p>
            </div>
          </div>
        </div>
        {/* Month switcher */}
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft size={15} /></button>
          <span className="text-[15px] font-semibold text-slate-700 w-36 text-center">{MONTHS[month - 1]} {year}</span>
          <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronRight size={15} /></button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-6">
        <div><span className="text-[13px] text-slate-400 uppercase tracking-wide font-semibold">Employees with usage</span><p className="text-[17px] font-bold text-slate-800">{rows.length}</p></div>
        <div><span className="text-[13px] text-slate-400 uppercase tracking-wide font-semibold">Approved hours</span><p className="text-[17px] font-bold text-emerald-600">{totalApproved.toFixed(2)}h</p></div>
        <div><span className="text-[13px] text-slate-400 uppercase tracking-wide font-semibold">Pending hours</span><p className="text-[17px] font-bold text-amber-600">{totalPending.toFixed(2)}h</p></div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Department</th>
              <th className="px-5 py-3 text-center">Requests</th>
              <th className="px-5 py-3 text-center">Approved</th>
              <th className="px-5 py-3 text-center">Pending</th>
              <th className="px-5 py-3 text-center">Remaining</th>
              <th className="px-5 py-3 w-40">Usage (of 4h)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center"><div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-400 text-[15px]">No permission requests in {MONTHS[month - 1]} {year}</td></tr>
            ) : rows.map(r => {
              const approved = parseFloat(r.approvedHours) || 0;
              const pending  = parseFloat(r.pendingHours) || 0;
              const used = approved + pending;
              const pct = Math.min(100, (used / LIMIT) * 100);
              return (
                <tr key={r._id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-[15px] font-semibold text-slate-700">{r.firstName} {r.lastName}</p>
                    <p className="text-[13px] text-slate-400 font-mono">{r.employeeId}</p>
                  </td>
                  <td className="px-5 py-3.5 text-[14px] text-slate-600">{r.department || '—'}</td>
                  <td className="px-5 py-3.5 text-center text-[15px] text-slate-600">{r.requests}</td>
                  <td className="px-5 py-3.5 text-center text-[15px] font-semibold text-emerald-600">{approved.toFixed(2)}h</td>
                  <td className="px-5 py-3.5 text-center text-[15px] font-semibold text-amber-600">{pending.toFixed(2)}h</td>
                  <td className="px-5 py-3.5 text-center text-[15px] font-semibold text-slate-700">{(parseFloat(r.remainingHours) || 0).toFixed(2)}h</td>
                  <td className="px-5 py-3.5">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${used >= LIMIT ? 'bg-rose-500' : 'bg-purple-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
