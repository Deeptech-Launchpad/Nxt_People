import React, { useState } from 'react';

// Regenerating rebuilds a whole cycle's figures, so it asks first — and names
// the dates it will touch, because "previous cycle" means nothing on its own.
//
// Shared by Loss of Pay Details and Leave Encashment Details, the two reports
// the reference puts this button on.
//
// Every option here must actually do what its text says. An earlier version of
// this dialog reported success for work it had not done: "previous cycle" only
// moved the date range, and "resigned users" re-fetched the same unfiltered
// rows. Both now change the report they claim to change.
export default function RegenerateDialog({ current, previous, subject, onConfirm, onClose }) {
  const [scope, setScope] = useState('previous');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-[560px]">
        <div className="flex flex-col items-center pt-6 px-6">
          <div className="w-12 h-12 rounded-full bg-amber-400 flex items-center justify-center mb-3">
            <span className="text-white text-[22px] font-bold leading-none">!</span>
          </div>
          <p className="text-[16px] font-semibold text-slate-800">Alert</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          {[
            ['previous', 'Previous cycle',
              `This action will rebuild the ${subject} for ${previous} from current attendance and leave records.`],
            ['resigned', 'Current cycle for resigned users',
              `This action will rebuild the ${subject} of ${current} for resigned users only.`],
          ].map(([key, title, body]) => (
            <label key={key} className="flex items-start gap-2.5 cursor-pointer">
              <input type="radio" name="regenScope" checked={scope === key} onChange={() => setScope(key)}
                className="w-4 h-4 accent-blue-600 mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-[14px] text-slate-800">{title}</span>
                <span className="block text-[13px] text-slate-500 mt-0.5">{body}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={() => onConfirm(scope)} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium">Confirm</button>
          <button onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-5 py-2 rounded text-[14px]">Cancel</button>
        </div>
      </div>
    </div>
  );
}
