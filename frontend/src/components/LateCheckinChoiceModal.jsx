import React, { useState } from 'react';

/* Shown only when the backend's own check — role, shift and the 9:45 AM
 * cutoff — says this check-in needs a decision (routes/attendance.js
 * returns code: 'LATE_CHECKIN_DECISION_REQUIRED'). This component has no
 * eligibility logic of its own; it only presents the two choices the
 * server is asking for and sends back whichever one was picked. */
export default function LateCheckinChoiceModal({ submitting, onChoosePermission, onChooseCompensate, onClose }) {
  const [mode, setMode] = useState(null); // null | 'compensate' — 'permission' resolves immediately
  const [reason, setReason] = useState('');

  // Optional: proceeds with whatever is typed, including nothing — the
  // reason field stays on screen either way (it's still the place to enter
  // one if the employee wants to), but it no longer blocks submission.
  const submitCompensate = () => {
    onChooseCompensate(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-display font-semibold text-slate-800 text-lg">You're checking in after 9:45 AM</h3>
        <p className="text-[13.5px] text-slate-500 mt-1">
          Choose how you'd like to handle today's late arrival.
        </p>

        {mode !== 'compensate' ? (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              disabled={submitting}
              onClick={onChoosePermission}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50 px-4 py-3 transition-colors disabled:opacity-60"
            >
              <p className="font-medium text-slate-800">Apply Permission</p>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Check in now, then submit a Permission request through the usual leave workflow.
              </p>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setMode('compensate')}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50 px-4 py-3 transition-colors disabled:opacity-60"
            >
              <p className="font-medium text-slate-800">Compensate Working Hours</p>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Check in now and complete a full 8h 30m of actual working time today — no permission
                or leave deduction applies to this requirement.
              </p>
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <label className="block text-[13.5px] font-medium text-slate-700">
              Late Reason <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[14px] h-24 resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why are you checking in late today? (optional)"
              autoFocus
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={submitCompensate}
                className="flex-1 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? 'Checking in…' : 'Check in — Compensate Working Hours'}
              </button>
            </div>
          </div>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 text-[13px] text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
