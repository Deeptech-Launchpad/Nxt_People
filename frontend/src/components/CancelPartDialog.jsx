import React, { useMemo, useState } from 'react';
import { X, Scissors, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';

// Cancelling part of a leave range.
//
// The preview is the point of this dialog rather than decoration. Dropping days
// from the middle of a range splits the request in two, which is surprising the
// first time and much worse discovered afterwards — so it is said before the
// button is pressed, not in the toast after.
//
// The date inputs are bounded to the leave's own range, so an out-of-range
// request cannot be built here at all. The server checks it again anyway: this
// dialog is a convenience, not the rule.

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const pretty = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const shift = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return ymd(x); };

export default function CancelPartDialog({ leave, reasonMandatory, onClose, onDone }) {
  const leaveStart = ymd(leave.startDate);
  const leaveEnd = ymd(leave.endDate);

  const [from, setFrom] = useState(leaveStart);
  const [to, setTo] = useState(leaveStart);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // What the request will do, described the same way the server will do it.
  // Working days are not counted here — only the server knows the calendar —
  // so the wording says "days" and leaves the arithmetic to the response.
  const outcome = useMemo(() => {
    if (to < from) return { invalid: 'The end date is before the start date.' };
    if (from < leaveStart || to > leaveEnd) return { invalid: 'Those dates are outside this leave.' };
    if (from === leaveStart && to === leaveEnd) {
      return { invalid: 'That is the whole leave — use Cancel Leave instead.' };
    }
    if (from === leaveStart) {
      return { shape: 'start', text: `This leave will become ${pretty(shift(to, 1))} to ${pretty(leaveEnd)}.` };
    }
    if (to === leaveEnd) {
      return { shape: 'end', text: `This leave will become ${pretty(leaveStart)} to ${pretty(shift(from, -1))}.` };
    }
    return {
      shape: 'split',
      text: `This leave will be split in two: ${pretty(leaveStart)} to ${pretty(shift(from, -1))}, `
          + `and ${pretty(shift(to, 1))} to ${pretty(leaveEnd)}.`,
    };
  }, [from, to, leaveStart, leaveEnd]);

  const submit = async () => {
    if (outcome.invalid) return;
    if (reasonMandatory && !reason.trim()) {
      toast.error('A reason for cancelling is required');
      return;
    }
    setBusy(true);
    try {
      const r = await api.put(`/leaves/${leave._id}/cancel-partial`,
        { startDate: from, endDate: to, reason: reason.trim() || undefined });
      toast.success(r.data?.message || 'Days cancelled');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not cancel those days');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px] overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-slate-500" />
            <h3 className="text-[15px] font-semibold text-slate-800">Cancel part of this leave</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-[13px] text-slate-500">
            This leave runs {pretty(leaveStart)} to {pretty(leaveEnd)}. Choose the days to drop —
            the rest stays as it is, with the approval it already has.
          </p>

          <div className="flex items-center gap-3">
            <label className="flex-1">
              <span className="block text-[12.5px] font-medium text-slate-600 mb-1">From</span>
              <input
                type="date" value={from} min={leaveStart} max={leaveEnd}
                onChange={e => {
                  setFrom(e.target.value);
                  if (e.target.value > to) setTo(e.target.value);
                }}
                className="w-full text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[12.5px] font-medium text-slate-600 mb-1">To</span>
              <input
                type="date" value={to} min={from} max={leaveEnd}
                onChange={e => setTo(e.target.value)}
                className="w-full text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-[12.5px] font-medium text-slate-600 mb-1">
              Reason {reasonMandatory && <span className="text-red-500">*</span>}
            </span>
            <textarea
              rows={2} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Why are these days no longer needed?"
              className="w-full text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </label>

          {outcome.invalid ? (
            <div className="flex items-start gap-2 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{outcome.invalid}</span>
            </div>
          ) : (
            <div className={`text-[13px] rounded-lg px-3 py-2 border ${
              outcome.shape === 'split'
                ? 'text-amber-800 bg-amber-50 border-amber-200'
                : 'text-slate-600 bg-slate-50 border-slate-200'
            }`}>
              {outcome.text}
              <span className="block mt-1 text-[12px] opacity-80">
                Only working days are returned to the balance, and everyone who approved this
                leave is told it changed.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
          <button onClick={onClose}
                  className="border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium">
            Close
          </button>
          <button onClick={submit} disabled={busy || !!outcome.invalid}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg text-[14px] font-semibold transition-colors">
            {busy ? 'Cancelling…' : 'Cancel these days'}
          </button>
        </div>
      </div>
    </div>
  );
}
