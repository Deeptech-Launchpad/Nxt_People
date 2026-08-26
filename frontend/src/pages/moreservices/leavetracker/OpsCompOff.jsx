import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Check, X, Eye, Ban } from 'lucide-react';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import CompOffApplyModal from '../../../components/CompOffApplyModal';
import useEmployeeList from './useEmployeeList';

/* ── Operations → Leave Tracker → Compensatory Request ──────────────────────
 *  Zoho's table, with Zoho's columns:
 *
 *      Status | Employee | Reporting to | Worked date | Expiry date |
 *      Status | Credited | Taken | Balance | Reason
 *
 *  Credited, Taken and Balance are the three numbers that matter and the card
 *  list this replaced showed none of them — you could not tell a credit that
 *  had been spent from one still available, which is the entire question this
 *  screen exists to answer.
 *
 *  Cancel Record is Zoho's too. A comp-off filed against the wrong date or the
 *  wrong person had no way back except approving and then unpicking it.
 * ────────────────────────────────────────────────────────────────────────── */
const STATUS_STYLE = {
  approved:  'bg-emerald-100 text-emerald-700',
  pending:   'bg-amber-100 text-amber-700',
  rejected:  'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Zoho's word for a credit that has been spent, versus one still to spend.
const zohoStatus = (r) => {
  if (r.status === 'pending') return 'Waiting for approval';
  if (r.status === 'rejected') return 'Rejected';
  if (r.status === 'cancelled') return 'Cancelled';
  if (parseFloat(r.daysUsed) > 0) return 'Availed';
  if (r.expired) return 'Expired';
  return 'Approved';
};

export default function OpsCompOff() {
  const { user } = useAuth();
  const { people } = useEmployeeList();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [acting, setActing] = useState('');
  const [expiryMonths, setExpiryMonths] = useState(3);

  useEffect(() => {
    api.get('/settings')
      .then(r => setExpiryMonths(parseInt(r.data.data?.compOffExpiryMonths, 10) || 3))
      .catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    api.get('/comp-off/all')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load comp-off requests'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const shown = useMemo(
    () => (filter ? rows.filter(r => r.status === filter) : rows),
    [rows, filter]);

  const act = async (id, action) => {
    setActing(id);
    try {
      await api.put(`/comp-off/${id}/action`, { action });
      toast.success(action === 'approved' ? 'Comp-off approved' : 'Comp-off rejected');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update that request');
    } finally { setActing(''); }
  };

  const cancel = async (r) => {
    if (!window.confirm(
      `Cancel this comp-off for ${r.employee?.firstName} ${r.employee?.lastName}?\n\n` +
      `Worked ${fmt(r.workedDate)} · ${r.daysEarned} day. The credit will not be available to them.`)) return;
    setActing(r._id);
    try {
      await api.put(`/comp-off/${r._id}/action`, { action: 'rejected', rejectionReason: 'Cancelled by HR' });
      toast.success('Comp-off cancelled');
      setDetail(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not cancel that request');
    } finally { setActing(''); }
  };

  const field = 'border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <select value={filter} onChange={e => setFilter(e.target.value)} className={field}>
          <option value="">All Requests</option>
          <option value="pending">Waiting for approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-[15px] font-medium">
          <Plus size={16} /> Add Request
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No compensatory requests.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Reporting to</th>
                <th className="px-4 py-3 font-medium">Worked date</th>
                <th className="px-4 py-3 font-medium">Expiry date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Credited</th>
                <th className="px-4 py-3 font-medium text-right">Taken</th>
                <th className="px-4 py-3 font-medium text-right">Balance</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const credited = parseFloat(r.daysEarned) || 0;
                const taken = parseFloat(r.daysUsed) || 0;
                // A credit that was never approved is not a balance, and an
                // expired one is not available however much is left on it.
                const usable = r.status === 'approved' && !r.expired;
                return (
                  <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60 group">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-slate-400 text-sm">{r.employee?.employeeId}</span>{' '}
                      <span className="text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</span>
                      {r.appliedBy && (
                        <span className="block text-[13px] text-indigo-500">filed by {r.appliedBy}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.reportingTo || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(r.workedDate)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${r.expired ? 'text-rose-500' : 'text-slate-500'}`}>
                      {fmt(r.expiresAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[13px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {zohoStatus(r)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{credited} day{credited === 1 ? '' : 's'}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{taken ? `${taken} day${taken === 1 ? '' : 's'}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">
                      {usable ? credited - taken : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 max-w-[220px] truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setDetail(r)} title="View"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50"><Eye size={15} /></button>
                        {r.status === 'pending' && (
                          <>
                            <button onClick={() => act(r._id, 'approved')} disabled={!!acting} title="Approve"
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"><Check size={15} /></button>
                            <button onClick={() => act(r._id, 'rejected')} disabled={!!acting} title="Reject"
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50"><X size={15} /></button>
                          </>
                        )}
                        {r.status === 'approved' && taken === 0 && (
                          <button onClick={() => cancel(r)} disabled={!!acting} title="Cancel Record"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><Ban size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-slate-400 mt-3">
        Total Record Count : <span className="text-slate-600 font-medium">{shown.length}</span>
      </p>

      <CompOffApplyModal
        open={modal}
        onClose={() => setModal(false)}
        onDone={load}
        people={people}
        currentUserId={user?._id}
        expiryMonths={expiryMonths}
      />

      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-display font-semibold text-slate-800 text-lg">
                  {detail.employee?.firstName} {detail.employee?.lastName}
                </p>
                <p className="text-sm text-slate-400">Compensatory Off Request</p>
              </div>
              <span className={`text-[13px] px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[detail.status] || 'bg-slate-100'}`}>
                {zohoStatus(detail)}
              </span>
            </div>
            <dl className="space-y-2.5 text-[15px]">
              {[
                ['Worked on', fmt(detail.workedDate)],
                ['Comp-off date', detail.compOffDate ? fmt(detail.compOffDate) : 'Not yet taken — banked'],
                ['Reporting to', detail.reportingTo || '—'],
                ['Credited', `${detail.daysEarned} day${Number(detail.daysEarned) === 1 ? '' : 's'}`],
                ['Taken', parseFloat(detail.daysUsed) ? `${detail.daysUsed} day(s)` : '—'],
                ['Valid till', fmt(detail.expiresAt)],
                ['Reason', detail.reason || '—'],
                ...(detail.appliedBy ? [['Filed by', detail.appliedBy]] : []),
                ...(detail.rejectionReason ? [['Rejection reason', detail.rejectionReason]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-36 flex-shrink-0 text-slate-400 text-sm uppercase tracking-wide">{k}</dt>
                  <dd className="text-slate-700">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDetail(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">Close</button>
              {detail.status === 'pending' && (
                <button onClick={() => act(detail._id, 'approved')} disabled={!!acting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">Approve</button>
              )}
              {detail.status === 'approved' && !parseFloat(detail.daysUsed) && (
                <button onClick={() => cancel(detail)} disabled={!!acting}
                  className="flex-1 border border-rose-200 text-rose-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-rose-50 disabled:opacity-60">Cancel Record</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
