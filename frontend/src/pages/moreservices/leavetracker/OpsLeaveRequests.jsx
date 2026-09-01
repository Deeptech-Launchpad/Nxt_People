import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Check, X, Eye, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Download } from 'lucide-react';
import FilterPanel from './FilterPanel';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from './useEmployeeList';
import RowMenu from './RowMenu';

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

// A column header that sorts. The arrow only shows on the active column, so
// the header row does not turn into a wall of chevrons.
function SortTh({ label, k, sort, onSort }) {
  const active = sort.by === k;
  return (
    <th className="px-4 py-3 font-medium">
      <button onClick={() => onSort(k)}
        className={`flex items-center gap-1 hover:text-slate-700 ${active ? 'text-slate-700' : ''}`}>
        {label}
        {active && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
    </th>
  );
}

export default function OpsLeaveRequests() {
  const { people } = useEmployeeList();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ by: 'startDate', dir: 'desc' });
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [types, setTypes] = useState([]);
  const [picked, setPicked] = useState([]);       // ids ticked for a bulk action
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const blank = { employeeId: '', leaveType: '', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayType: 'first_half' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/leave-types').then(r => setTypes(r.data.data || [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams({
      page: String(page), limit: String(limit),
      sortBy: sort.by, sortDir: sort.dir,
    });
    // The panel already drops empty values, so this cannot emit `?status=`.
    for (const [k, v] of Object.entries(filters)) q.set(k, v);
    api.get(`/leaves?${q}`)
      .then(r => {
        setRows(r.data.data || []);
        setTotal(r.data.total ?? r.data.count ?? (r.data.data || []).length);
        setPicked([]);   // a tick on a row that is no longer listed must not survive
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load leave requests'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, limit, filters, sort]);

  // Sorting or filtering while deep in the list would otherwise land on a page
  // that no longer exists and show nothing.
  const applyFilters = (f) => { setPage(1); setFilters(f); };
  const sortBy = (key) => {
    setPage(1);
    setSort(s => s.by === key ? { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: key, dir: 'asc' });
  };

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

  /* Delete moves a leave balance — an approved leave gives the days back to
   * the employee, not to whoever pressed the button. The confirm exists
   * because there is no undo, and the reason is carried because the
   * cancellation settings can require one. */
  const remove = async () => {
    const r = toDelete;
    setActing(r._id);
    try {
      await api.delete(`/leaves/${r._id}`, { data: { reason: delReason.trim() } });
      toast.success('Leave deleted and the balance returned');
      setToDelete(null); setDelReason(''); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete that request');
    } finally { setActing(''); }
  };

  /* Bulk delete. Deliberately N calls to the SAME endpoint the single delete
   * uses rather than a new bulk route: the scoping, the refund and the audit
   * row are already proved there, and a second implementation of a balance
   * refund is exactly the thing that drifts. Failures are counted, not
   * swallowed — a partial run must say which rows survived. */
  const removeMany = async () => {
    setBulkBusy(true);
    const targets = rows.filter(r => picked.includes(r._id));
    let ok = 0; const failed = [];
    for (const r of targets) {
      try {
        await api.delete(`/leaves/${r._id}`, { data: { reason: delReason.trim() } });
        ok++;
      } catch (err) {
        failed.push(`${r.employee?.firstName || 'row'}: ${err.response?.data?.message || 'failed'}`);
      }
    }
    setBulkBusy(false); setBulkOpen(false); setDelReason(''); load();
    if (ok) toast.success(`${ok} leave${ok === 1 ? '' : 's'} deleted and balances returned`);
    if (failed.length) toast.error(`${failed.length} could not be deleted — ${failed[0]}`, { duration: 6000 });
  };

  const deletable = rows.filter(r => r.status === 'pending' || r.status === 'approved');
  const allPicked = deletable.length > 0 && deletable.every(r => picked.includes(r._id));
  const togglePick = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setPicked(allPicked ? [] : deletable.map(r => r._id));
  const pickedRows = rows.filter(r => picked.includes(r._id));
  const pickedDays = pickedRows.reduce(
    (n, r) => n + (r.leaveType === 'unpaid' ? 0 : (parseFloat(r.totalDays) || 0)), 0);

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

  const pages = Math.max(1, Math.ceil(total / limit));
  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <FilterPanel
            value={filters}
            onApply={applyFilters}
            fields={[
              { name: 'q', label: 'Employee', type: 'text', placeholder: 'Name or employee ID' },
              { name: 'status', label: 'Status', type: 'select', placeholder: 'All Requests', options: [
                { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' }, { value: 'cancelled', label: 'Cancelled' },
              ] },
              { name: 'leaveType', label: 'Leave type', type: 'select', placeholder: 'All types',
                options: types.map(t => ({ value: t.code, label: t.name })) },
              { name: 'department', label: 'Department', type: 'text', placeholder: 'Any department' },
              // The endpoint reads these as an overlap test, so a range finds
              // any leave TOUCHING it, not only one contained by it.
              { name: 'date', label: 'Leave period', type: 'daterange', fromKey: 'startDate', toKey: 'endDate' },
            ]}
          />
          {/* Selection drives the bulk bar rather than a separate mode. */}
          {picked.length > 0 && (
            <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-3.5 py-2">
              <span className="text-[15px] text-brand-700 font-medium">{picked.length} selected</span>
              <button onClick={() => { setDelReason(''); setBulkOpen(true); }}
                className="flex items-center gap-1.5 text-rose-600 hover:text-rose-700 text-[15px] font-medium">
                <Trash2 size={15} /> Delete
              </button>
              <button onClick={() => setPicked([])} className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
            </div>
          )}
        </div>
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
                <th className="pl-4 pr-2 py-3 w-10">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll}
                    disabled={deletable.length === 0}
                    title={deletable.length === 0 ? 'Nothing on this page can be deleted' : 'Select all'}
                    className="w-4 h-4 rounded border-slate-300 accent-brand-600 disabled:opacity-40" />
                </th>
                <SortTh label="Status"           k="status"    sort={sort} onSort={sortBy} />
                <SortTh label="Employee Name"    k="employee"  sort={sort} onSort={sortBy} />
                <SortTh label="Leave type"       k="leaveType" sort={sort} onSort={sortBy} />
                <th className="px-4 py-3 font-medium">Type</th>
                <SortTh label="Leave period"     k="startDate" sort={sort} onSort={sortBy} />
                <SortTh label="Days/hours taken" k="totalDays" sort={sort} onSort={sortBy} />
                <SortTh label="Date of request"  k="createdAt" sort={sort} onSort={sortBy} />
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className={`border-t border-slate-50 ${picked.includes(r._id) ? 'bg-brand-50/60' : 'hover:bg-slate-50/60'}`}>
                  <td className="pl-4 pr-2 py-3">
                    {/* Only rows a delete could actually act on are selectable;
                        a tick that silently does nothing is worse than none. */}
                    <input type="checkbox" checked={picked.includes(r._id)}
                      disabled={r.status !== 'pending' && r.status !== 'approved'}
                      onChange={() => togglePick(r._id)}
                      title={r.status !== 'pending' && r.status !== 'approved' ? `Already ${r.status}` : undefined}
                      className="w-4 h-4 rounded border-slate-300 accent-brand-600 disabled:opacity-30" />
                  </td>
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
                      <RowMenu items={[
                        { label: 'View', icon: <Eye size={15} />, onClick: () => setDetail(r) },
                        { label: 'Edit', icon: <Pencil size={15} />,
                          disabled: 'Not built yet — editing an approved leave has to move the balance both ways' },
                        (r.status === 'pending' || r.status === 'approved') && {
                          label: 'Delete', icon: <Trash2 size={15} />, danger: true,
                          onClick: () => { setDelReason(''); setToDelete(r); } },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-sm text-slate-400">
        <div className="flex items-center gap-3">
          <span>Total Record Count : <span className="text-slate-600 font-medium">{total}</span></span>
          <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
            title="Rows per page"
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-600 focus:outline-none focus:border-brand-400">
            {[20, 30, 40, 50, 75, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
          <span>{total === 0 ? 0 : (page - 1) * limit + 1} – {Math.min(page * limit, total)}</span>
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

      {toDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Delete this leave?</h3>
            <p className="text-slate-500 text-[15px] mt-2">
              {toDelete.employee?.firstName} {toDelete.employee?.lastName} ·{' '}
              <span className="capitalize">{String(toDelete.leaveType || '').replace(/_/g, ' ')}</span> ·{' '}
              {fmt(toDelete.startDate)} – {fmt(toDelete.endDate)}
            </p>
            {/* Say what it costs before they press it, not after. */}
            <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-3">
              {toDelete.leaveType === 'unpaid'
                ? 'Unpaid leave holds no balance, so nothing is returned.'
                : `${takenLabel(toDelete)} will be returned to their balance.`}
              {' '}This cannot be undone.
            </p>
            <label className="block text-sm font-medium text-slate-600 mt-4 mb-1.5">Reason</label>
            <input value={delReason} onChange={e => setDelReason(e.target.value)}
              placeholder="Why this is being deleted"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setToDelete(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={remove} disabled={!!acting}
                className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
                {acting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">
              Delete {picked.length} leave request{picked.length === 1 ? '' : 's'}?
            </h3>
            {/* Bulk delete has no undo, so the total it is about to hand back
                is stated before the button, not after. */}
            <p className="text-[14px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-3">
              {pickedDays > 0
                ? `${Math.round(pickedDays * 100) / 100} day(s) will be returned across ${
                    new Set(pickedRows.map(r => r.employee?._id)).size} employee(s).`
                : 'These hold no balance, so nothing is returned.'}
              {' '}This cannot be undone.
            </p>
            <div className="max-h-40 overflow-y-auto mt-3 border border-slate-100 rounded-xl divide-y divide-slate-50">
              {pickedRows.map(r => (
                <div key={r._id} className="px-3 py-2 text-[14px] text-slate-600 flex justify-between gap-3">
                  <span className="truncate">{r.employee?.firstName} {r.employee?.lastName}</span>
                  <span className="text-slate-400 flex-shrink-0">{fmt(r.startDate)} · {takenLabel(r)}</span>
                </div>
              ))}
            </div>
            <label className="block text-sm font-medium text-slate-600 mt-4 mb-1.5">Reason</label>
            <input value={delReason} onChange={e => setDelReason(e.target.value)}
              placeholder="Applied to every row"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setBulkOpen(false)} disabled={bulkBusy}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={removeMany} disabled={bulkBusy}
                className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
                {bulkBusy ? 'Deleting…' : `Delete ${picked.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
