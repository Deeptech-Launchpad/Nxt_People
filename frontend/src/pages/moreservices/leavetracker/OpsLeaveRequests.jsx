import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Check, X, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from './useEmployeeList';

/* ── Operations → Leave Tracker → Leave Requests ────────────────────────────
 *  Zoho's table of EVERY leave request, whatever its status, with Add Request
 *  on top so HR can apply for somebody who is already away and cannot apply for
 *  themselves. That is what this tab is for.
 *
 *  It is not the Approvals screen. Approvals answers "what is waiting on me"
 *  across leave, permission, timesheets, regularisations, WFH, comp-off and
 *  on-duty. This answers "what leave exists, for anybody, ever" — a different
 *  question with a different shape, and the first version of this tab embedded
 *  the wrong one.
 *
 *  Columns follow Zoho's exactly, in Zoho's order, so somebody moving across
 *  reads the same table.
 * ────────────────────────────────────────────────────────────────────────── */
const STATUS_STYLE = {
  approved:  'bg-emerald-100 text-emerald-700',
  pending:   'bg-amber-100 text-amber-700',
  rejected:  'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

// Zoho shows Paid / Unpaid beside the type, because that is the column that
// decides whether the day costs the person money.
const UNPAID = new Set(['unpaid', 'lop', 'loss_of_pay']);

const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const takenLabel = (r) => {
  if (r.leaveType === 'permission' || r.hours) {
    const h = parseFloat(r.hours) || 0;
    return `${h} Hour${h === 1 ? '' : 's'}`;
  }
  const d = parseFloat(r.totalDays) || 0;
  return `${d} Day${d === 1 ? '' : 's'}`;
};

export default function OpsLeaveRequests() {
  const { people } = useEmployeeList();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [types, setTypes] = useState([]);
  const LIMIT = 20;

  const blank = { employeeId: '', leaveType: '', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayType: 'first_half' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/leave-types').then(r => setTypes(r.data.data || [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) q.set('status', status);
    api.get(`/leaves?${q}`)
      .then(r => { setRows(r.data.data || []); setTotal(r.data.total ?? r.data.count ?? (r.data.data || []).length); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load leave requests'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, status]);

  const act = async (id, action) => {
    setActing(id);
    try {
      await api.put(`/leaves/${id}/action`, { action });
      toast.success(action === 'approved' ? 'Leave approved' : 'Leave rejected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update that request');
    } finally { setActing(''); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/leaves', {
        ...form,
        // A single-day request still needs both ends; Zoho fills the second in
        // for you rather than refusing.
        endDate: form.endDate || form.startDate,
        halfDayType: form.isHalfDay ? form.halfDayType : null,
      });
      const who = people.find(p => p._id === form.employeeId);
      toast.success(who ? `Leave applied for ${who.firstName} ${who.lastName}` : 'Leave applied');
      setModal(false); setForm(blank); setPage(1); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not apply that leave');
    } finally { setSaving(false); }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400">
          <option value="">All Requests</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-[15px] font-medium">
          <Plus size={16} /> Add Request
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No leave requests.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Employee Name</th>
                <th className="px-4 py-3 font-medium">Leave type</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Leave period</th>
                <th className="px-4 py-3 font-medium">Days/hours taken</th>
                <th className="px-4 py-3 font-medium">Date of request</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className={`text-[13px] px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-slate-400 text-sm">{r.employee?.employeeId}</span>{' '}
                    <span className="text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{String(r.leaveType || '').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    <span className={UNPAID.has(r.leaveType) ? 'text-rose-600' : 'text-slate-500'}>
                      {UNPAID.has(r.leaveType) ? 'Unpaid' : 'Paid'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(r.startDate)} – {fmt(r.endDate)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {takenLabel(r)}
                    {r.isHalfDay && <span className="text-slate-400 text-sm"> · half day</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmt(r.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => setDetail(r)} title="View"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50">
                        <Eye size={15} />
                      </button>
                      {r.status === 'pending' && (
                        <>
                          <button onClick={() => act(r._id, 'approved')} disabled={!!acting} title="Approve"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                            <Check size={15} />
                          </button>
                          <button onClick={() => act(r._id, 'rejected')} disabled={!!acting} title="Reject"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50">
                            <X size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-sm text-slate-400">
        <span>Total Record Count : <span className="text-slate-600 font-medium">{total}</span></span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
          <span>{(page - 1) * LIMIT + 1} – {Math.min(page * LIMIT, total)}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Apply Leave</h3>
            <div>
              <label className={label}>Employee *</label>
              <select value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} required className={field}>
                <option value="">Select an employee</option>
                {people.map(p => <option key={p._id} value={p._id}>{labelOf(p)}</option>)}
              </select>
              <p className="text-[13px] text-amber-600 mt-1">
                This spends their balance and goes to their own reporting line for approval.
              </p>
            </div>
            <div>
              <label className={label}>Leave type *</label>
              <select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value })} required className={field}>
                <option value="">Select a type</option>
                {types.map(t => <option key={t.id || t.code} value={t.code}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>From *</label>
                <input type="date" value={form.startDate} required className={field}
                  onChange={e => setForm({ ...form, startDate: e.target.value, endDate: form.endDate || e.target.value })} />
              </div>
              <div>
                <label className={label}>To *</label>
                <input type="date" value={form.endDate} required min={form.startDate} className={field}
                  onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2.5 text-[15px] text-slate-600">
              <input type="checkbox" checked={form.isHalfDay} className="w-4 h-4 rounded border-slate-300"
                onChange={e => setForm({ ...form, isHalfDay: e.target.checked })} />
              Half day
            </label>
            {form.isHalfDay && (
              <div>
                <label className={label}>Which half</label>
                <select value={form.halfDayType} onChange={e => setForm({ ...form, halfDayType: e.target.value })} className={field}>
                  <option value="first_half">First half</option>
                  <option value="second_half">Second half</option>
                </select>
              </div>
            )}
            <div>
              <label className={label}>Reason for leave *</label>
              <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                required rows={2} minLength={3} maxLength={500}
                className={`${field} resize-none`} placeholder="Why is this leave being taken?" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setModal(false); setForm(blank); }}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
                {saving ? 'Applying…' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-display font-semibold text-slate-800 text-lg">
                  {detail.employee?.firstName} {detail.employee?.lastName}
                </p>
                <p className="text-sm text-slate-400">{detail.employee?.employeeId} · {detail.employee?.department || '—'}</p>
              </div>
              <span className={`text-[13px] px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[detail.status] || 'bg-slate-100'}`}>
                {detail.status}
              </span>
            </div>
            <dl className="space-y-2.5 text-[15px]">
              {[
                ['Leave type', String(detail.leaveType || '').replace(/_/g, ' ')],
                ['Period', `${fmt(detail.startDate)} – ${fmt(detail.endDate)}`],
                ['Taken', takenLabel(detail)],
                ['Requested on', fmt(detail.createdAt)],
                ['Reason', detail.reason || '—'],
                ...(detail.rejectionReason ? [['Rejection reason', detail.rejectionReason]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-36 flex-shrink-0 text-slate-400 text-sm uppercase tracking-wide">{k}</dt>
                  <dd className="text-slate-700 capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            <button onClick={() => setDetail(null)}
              className="mt-5 w-full border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
