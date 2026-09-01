import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X } from 'lucide-react';
import api from '../../../utils/api';

/* ── Operations → Attendance → On Duty ───────────────────────────────────
 *  The organisation-wide queue, in the reference's column layout: who, the
 *  period, the type, and how long it runs for.
 *
 *  Same endpoints the Approvals page uses — /on-duty/pending to read,
 *  /on-duty/:id/action to act.
 */
const fmtDay = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/* A request is either a stretch of days or a slice of one — the reference
 * shows "4 day(s)" and "03:00 hours" in the same column, and so does this. */
const durationOf = (r) => {
  if (r.unit === 'hours' && r.hours) return `${Number(r.hours).toFixed(2).replace(/\.00$/, '')} hours`;
  const start = new Date(`${String(r.startDate).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(r.endDate || r.startDate).slice(0, 10)}T00:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  return `${days} day${days === 1 ? '' : 's'}`;
};

export default function OpsOnDutyQueue() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');

  const load = () => {
    setRows(null);
    api.get('/on-duty/pending')
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load on-duty requests'); setRows([]); });
  };
  useEffect(load, []);

  const act = async (row, action) => {
    const who = `${row.employee.firstName} ${row.employee.lastName || ''}`.trim();
    if (action === 'rejected' && !window.confirm(`Reject ${who}'s on-duty request?`)) return;
    setBusyId(row._id);
    try {
      await api.put(`/on-duty/${row._id}/action`, { action });
      toast.success(action === 'approved' ? 'Approved' : 'Rejected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record that decision');
    } finally { setBusyId(null); }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows || [];
    return (rows || []).filter(r =>
      `${r.employee.firstName} ${r.employee.lastName || ''} ${r.employee.employeeId || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employee"
          className="border border-slate-200 rounded-xl px-3 py-2 text-[14px] w-64 focus:outline-none focus:border-brand-400" />
        <span className="text-[13px] text-slate-400">
          {rows === null ? '' : `${filtered.length} waiting for approval`}
        </span>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No on-duty requests have been raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Approval Status</th>
                <th className="px-4 py-3 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const levels = r.approvalLevels || [];
                const done = levels.filter(l => l.status === 'approved').length;
                const sameDay = !r.endDate || String(r.endDate).slice(0, 10) === String(r.startDate).slice(0, 10);
                return (
                  <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.employee.firstName} {r.employee.lastName || ''}</span>
                      <span className="block text-[12.5px] text-slate-400">{r.employee.employeeId} · {r.employee.department || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {fmtDay(r.startDate)}{sameDay ? '' : ` – ${fmtDay(r.endDate)}`}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.requestType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{durationOf(r)}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate" title={r.reason}>{r.reason || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-amber-600 text-[13.5px]">Submitted</span>
                      {levels.length > 0 && (
                        <span className="block text-[12.5px] text-slate-400">{done} of {levels.length} levels approved</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.canAct ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => act(r, 'approved')} disabled={busyId === r._id}
                            className="flex items-center gap-1 text-[13px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <Check size={14} /> Approve
                          </button>
                          <button onClick={() => act(r, 'rejected')} disabled={busyId === r._id}
                            className="flex items-center gap-1 text-[13px] text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <X size={14} /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[13px] text-slate-400">Not yours to approve</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
