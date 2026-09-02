import React, { useRef, useState } from 'react';
import { X, Paperclip, Trash2 } from 'lucide-react';

/* The chrome every request modal shares: title, body, Submit/Cancel, and the
 * status legend the reference pins to the footer.
 *
 * They open OVER the day row you pressed rather than navigating. Sending you
 * to a list page to press "New Request" and retype the date you had just
 * clicked was the whole complaint.
 */

/* The reference's footer key. It explains the row colours in the weekly log,
 * so it belongs on the request that is about to change one of them. */
const LEGEND = [
  { label: 'Unpaid leave', color: '#ef4444' },
  { label: 'Absent',       color: '#f97316' },
  { label: 'Paid leave',   color: '#22c55e' },
  { label: 'On Duty',      color: '#a855f7' },
  { label: 'Weekend',      color: '#f59e0b' },
  { label: 'Holidays',     color: '#3b82f6' },
];

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {LEGEND.map(l => (
        <span key={l.label} className="flex items-center gap-1.5 text-[13px] text-slate-600">
          <span className="w-[3px] h-3.5 rounded-sm" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

export function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-[14px] font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[13px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] focus:outline-none focus:border-brand-400';

/* Attachment picker. Named `Attachment` to match the reference, but only the
 * local-file source — Zoho also offers WorkDrive and a URL, which are its own
 * storage products and not something we have. Offering them greyed would be
 * three dead links; one working control is better. */
export function AttachmentField({ file, onChange, accept = '.pdf,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg', maxMB = 5 }) {
  const ref = useRef(null);
  return (
    <div>
      {file ? (
        <div className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2.5">
          <span className="flex items-center gap-2 text-[14px] text-slate-700 min-w-0">
            <Paperclip size={15} className="flex-shrink-0 text-slate-400" />
            <span className="truncate">{file.name}</span>
            <span className="text-slate-400 flex-shrink-0">
              {(file.size / 1024).toFixed(0)} KB
            </span>
          </span>
          <button onClick={() => { onChange(null); if (ref.current) ref.current.value = ''; }}
            className="text-slate-400 hover:text-rose-600 flex-shrink-0">
            <Trash2 size={15} />
          </button>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="w-full border-2 border-dashed border-slate-200 rounded-lg py-4 text-center hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
          <span className="text-[14px] text-brand-600 font-medium">Choose a file</span>
          <span className="block text-[12.5px] text-slate-400 mt-0.5">
            PDF, XLS, DOC or an image · up to {maxMB} MB
          </span>
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          // Refused here as well as on the server, so the person is told before
          // waiting for an upload that was never going to be accepted.
          if (f.size > maxMB * 1024 * 1024) {
            e.target.value = '';
            onChange(null, `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${maxMB} MB.`);
            return;
          }
          onChange(f);
        }} />
    </div>
  );
}

export default function RequestShell({ title, onClose, onSubmit, submitting, submitLabel = 'Submit', children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-3xl'} shadow-2xl my-4 flex flex-col max-h-[94vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-display font-semibold text-slate-800 text-xl">{title}</h3>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <div className="flex gap-3">
            <button onClick={onSubmit} disabled={submitting}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              {submitting ? 'Submitting…' : submitLabel}
            </button>
            <button onClick={onClose}
              className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
              Cancel
            </button>
          </div>
          <StatusLegend />
        </div>
      </div>
    </div>
  );
}
