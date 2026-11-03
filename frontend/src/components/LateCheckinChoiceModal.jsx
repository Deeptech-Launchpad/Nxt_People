import React from 'react';

/* Shown only when the backend's own check — role, shift and the 9:45 AM
 * cutoff — says this check-in needs a decision (routes/attendance.js
 * returns code: 'LATE_CHECKIN_DECISION_REQUIRED'). This component has no
 * eligibility logic of its own; it only presents the choice the server is
 * asking for and sends back whichever one was picked. */
export default function LateCheckinChoiceModal({ onChoosePermission, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="font-display font-semibold text-slate-800 text-lg">You're checking in after 9:45 AM</h3>
        <p className="text-[13.5px] text-slate-500 mt-1">
          Choose how you'd like to handle today's late arrival.
        </p>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={onChoosePermission}
            className="w-full text-left rounded-xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50 px-4 py-3 transition-colors"
          >
            <p className="font-medium text-slate-800">Apply Permission</p>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Check in now, then submit a Permission request through the usual leave workflow.
            </p>
          </button>
        </div>

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
