import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Clock, Check, XCircle } from 'lucide-react';
import api from '../utils/api';

// Shift Change Request — asking to move from one shift to another.
//
// Two kinds, because they are genuinely different questions. A temporary
// change covers a date range and goes through the roster, so exactly those
// days move and the standing shift is untouched. A permanent one changes the
// standing shift from a date onwards.
//
// It routes through the same approval chain as leave, so what happens next is
// configured under Manage Accounts → Approvals, not here.

const STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
const select = `${input} bg-white`;

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

function Dialog({ options, onClose, onSaved }) {
  const [form, setForm] = useState({
    changeType: 'temporary', toShiftId: '', startDate: today(), endDate: today(), reason: '',
  });
  const [busy, setBusy] = useState(false);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  const save = () => {
    setBusy(true);
    api.post('/shift-change', form)
      .then(() => { toast.success('Shift change requested'); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not submit'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">Request a shift change</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-[13px] font-medium text-slate-700 mb-2">What kind of change</p>
            <div className="space-y-2">
              {[['temporary', 'For a few days', 'Only the dates you pick move. Your usual shift stays as it is.'],
                ['permanent', 'From now on', 'Your usual shift changes from the start date.']].map(([k, l, hint]) => (
                <label key={k} className="flex items-start gap-2.5 cursor-pointer">
                  <input type="radio" name="changeType" checked={form.changeType === k}
                    onChange={() => set({ changeType: k })} className="mt-0.5 w-4 h-4 accent-blue-600" />
                  <span>
                    <span className="block text-[14px] text-slate-800">{l}</span>
                    <span className="block text-[12.5px] text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Move to<span className="text-red-500 ml-0.5">*</span>
            </label>
            <select value={form.toShiftId} onChange={e => set({ toShiftId: e.target.value })} className={select}>
              <option value="">Select a shift</option>
              {options.shifts.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.startTime} – {s.endTime})</option>
              ))}
            </select>
            {options.shifts.length === 0 && (
              <p className="text-[12.5px] text-amber-700 mt-1">
                There is no other shift you are eligible for.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                From<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} className={input} />
            </div>
            {/* Meaningless for a permanent change, so it is not asked for. */}
            {form.changeType === 'temporary' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  To<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input type="date" value={form.endDate} min={form.startDate}
                  onChange={e => set({ endDate: e.target.value })} className={input} />
              </div>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Reason</label>
            <textarea rows={3} value={form.reason} onChange={e => set({ reason: e.target.value })} className={input} />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save}
            disabled={busy || !form.toShiftId || !form.startDate || (form.changeType === 'temporary' && !form.endDate)}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
            {busy ? 'Submitting…' : 'Submit'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShiftChange() {
  const [mine, setMine] = useState(null);
  const [pending, setPending] = useState([]);
  const [options, setOptions] = useState({ shifts: [] });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('mine');

  const load = useCallback(() => {
    api.get('/shift-change/my').then(r => setMine(r.data.data || [])).catch(() => setMine([]));
    // Silently empty for anybody who is not an approver, which is most people.
    api.get('/shift-change/pending').then(r => setPending(r.data.data || [])).catch(() => setPending([]));
  }, []);

  useEffect(() => {
    load();
    api.get('/shift-change/options').then(r => setOptions(r.data.data)).catch(() => {});
  }, [load]);

  if (mine === null) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const act = (id, action) => {
    const rejectionReason = action === 'rejected' ? window.prompt('Reason for rejecting?') : null;
    if (action === 'rejected' && rejectionReason === null) return;
    api.put(`/shift-change/${id}/action`, { action, rejectionReason })
      .then(r => { toast.success(r.data.message || 'Done'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not act'));
  };

  const cancel = r => {
    if (!window.confirm('Cancel this request?')) return;
    api.delete(`/shift-change/${r.id}`)
      .then(res => { toast.success(res.data.message || 'Cancelled'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not cancel'));
  };

  const range = r => (r.changeType === 'permanent'
    ? `From ${fmt(r.startDate)}`
    : `${fmt(r.startDate)} – ${fmt(r.endDate)}`);

  const rows = tab === 'mine' ? mine : pending;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-800">Shift Change</h1>
          <p className="text-[13.5px] text-slate-500 mt-1">
            Ask to move to a different shift. It goes to your approver, and the shift changes once approved.
          </p>
        </div>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Request a change
        </button>
      </div>

      {pending.length > 0 && (
        <div className="flex gap-6 border-b border-slate-200 mb-4">
          {[['mine', `My requests (${mine.length})`], ['pending', `Awaiting my approval (${pending.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`pb-2 text-[14px] border-b-2 -mb-px ${
                tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500'
              }`}>{l}</button>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                {tab === 'pending' && <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee</th>}
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Change</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">When</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Reason</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Status</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  {tab === 'pending' && (
                    <td className="px-6 py-3 text-slate-700 whitespace-nowrap">
                      {r.employeeCode} — {r.employeeName}
                    </td>
                  )}
                  <td className="px-6 py-3 text-slate-700 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} className="text-slate-400" />
                      {r.fromShift || 'No shift'} → <span style={{ color: r.toColor }}>●</span> {r.toShift}
                    </span>
                    <span className="block text-[12px] text-slate-400 mt-0.5">
                      {r.changeType === 'permanent' ? 'From now on' : 'For those days only'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-slate-600 whitespace-nowrap">{range(r)}</td>
                  <td className="px-6 py-3 text-slate-600">{r.reason || <span className="text-slate-400">—</span>}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-block rounded border px-2 py-0.5 text-[12.5px] ${STATUS[r.status]?.cls || ''}`}>
                      {STATUS[r.status]?.label || r.status}
                    </span>
                    {/* Approved and applied are different things, and the note
                        says which happened. */}
                    {r.appliedNote && (
                      <span className="block text-[12px] text-slate-500 mt-1">{r.appliedNote}</span>
                    )}
                    {r.rejectionReason && (
                      <span className="block text-[12px] text-slate-500 mt-1">{r.rejectionReason}</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {tab === 'pending' ? (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => act(r.id, 'approved')} title="Approve"
                          className="text-slate-400 hover:text-emerald-600 p-1.5 rounded"><Check size={16} /></button>
                        <button onClick={() => act(r.id, 'rejected')} title="Reject"
                          className="text-slate-400 hover:text-red-500 p-1.5 rounded"><XCircle size={16} /></button>
                      </div>
                    ) : (
                      ['pending', 'approved'].includes(r.status) && (
                        <button onClick={() => cancel(r)}
                          className="text-[13px] text-slate-500 hover:text-red-500">Cancel</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="text-[14px] text-slate-600">
              {tab === 'mine' ? 'You have not requested a shift change.' : 'Nothing is waiting for your approval.'}
            </p>
          </div>
        )}
      </div>

      {adding && <Dialog options={options} onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}
