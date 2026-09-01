import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X } from 'lucide-react';
import api from '../../../utils/api';

/* ── Operations → Attendance → Regularization ────────────────────────────
 *  The organisation-wide queue, laid out the way the reference does it:
 *  what the day says now beside what the request would make it, so an
 *  approver can see the correction rather than only the times asked for.
 *
 *  Same endpoints the Approvals page uses — /regularizations/pending to
 *  read, /regularizations/:id/action to act. One source of truth for the
 *  data and the decision; only the table differs.
 */
const fmtHM = (n) => {
  if (n === null || n === undefined || n === '') return '00:00';
  const total = Math.round(Number(n) * 60);
  if (!Number.isFinite(total)) return '00:00';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const fmtTime = (hms) => {
  if (!hms) return '—';
  const [h, m] = String(hms).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const STATUS_WORD = { present: 'Present', late: 'Present', absent: 'Absent', 'half-day': 'Half Day', on_duty: 'On Duty' };

// Hours the request would produce, from the times it asks for. The server
// decides this properly on approval (shift rules, leave, on-duty); this is
// only the span, shown so the queue can say what is being asked for.
const requestedHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null;
  const [ih, im] = String(checkIn).split(':').map(Number);
  const [oh, om] = String(checkOut).split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im);
  return mins > 0 ? mins / 60 : null;
};

export default function OpsRegularizationQueue() {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');

  const load = () => {
    setRows(null);
    api.get('/regularizations/pending')
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load regularizations'); setRows([]); });
  };
  useEffect(load, []);

  const act = async (row, action) => {
    const who = `${row.employee.firstName} ${row.employee.lastName || ''}`.trim();
    if (action === 'rejected' && !window.confirm(`Reject ${who}'s regularization for ${fmtDay(row.date)}?`)) return;
    setBusyId(row._id);
    try {
      await api.put(`/regularizations/${row._id}/action`, { action });
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
        <p className="text-center text-slate-400 py-16">No regularization requests have been raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium" rowSpan={2}>Employee</th>
                <th className="px-4 py-3 font-medium" rowSpan={2}>Worked day</th>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Hours</th>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Status</th>
                <th className="px-4 py-3 font-medium border-l border-slate-200" rowSpan={2}>Reason</th>
                <th className="px-4 py-3 font-medium" rowSpan={2}>Approval Status</th>
                <th className="px-4 py-3 font-medium w-28" rowSpan={2}></th>
              </tr>
              <tr className="text-left text-slate-400 text-[13px]">
                <th className="px-4 pb-2 font-medium border-l border-slate-200">Old</th>
                <th className="px-4 pb-2 font-medium">New</th>
                <th className="px-4 pb-2 font-medium border-l border-slate-200">Old</th>
                <th className="px-4 pb-2 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const newHours = requestedHours(r.checkIn, r.checkOut);
                const levels = r.approvalLevels || [];
                const done = levels.filter(l => l.status === 'approved').length;
                return (
                  <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.employee.firstName} {r.employee.lastName || ''}</span>
                      <span className="block text-[12.5px] text-slate-400">{r.employee.employeeId} · {r.employee.department || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDay(r.date)}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 border-l border-slate-100">{fmtHM(r.oldHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-800 font-medium">{newHours === null ? '—' : fmtHM(newHours)}</td>
                    <td className="px-4 py-3 text-slate-500 border-l border-slate-100">{STATUS_WORD[r.oldStatus] || 'Absent'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">Present</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate border-l border-slate-100" title={r.reason}>
                      {r.reason || '—'}
                      <span className="block text-[12.5px] text-slate-400">
                        In {fmtTime(r.checkIn)} · Out {fmtTime(r.checkOut)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-amber-600 text-[13.5px]">Waiting for approval</span>
                      {levels.length > 0 && (
                        <span className="block text-[12.5px] text-slate-400">{done} of {levels.length} levels approved</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.canAct ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => act(r, 'approved')} disabled={busyId === r._id}
                            title="Approve"
                            className="flex items-center gap-1 text-[13px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <Check size={14} /> Approve
                          </button>
                          <button onClick={() => act(r, 'rejected')} disabled={busyId === r._id}
                            title="Reject"
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
