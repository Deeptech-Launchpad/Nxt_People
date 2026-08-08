import React, { useState } from 'react';
import { X, CheckCircle, CheckCheck, XCircle, Gift } from 'lucide-react';
import ApprovalTimeline from './ApprovalTimeline';

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const fmtLong  = (d) => { if (!d) return '—'; const dt = new Date(String(d).slice(0,10)+'T00:00:00'); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'short', year:'numeric' }); };
const fmtShort = (d) => { if (!d) return '—'; const dt = new Date(String(d).slice(0,10)+'T00:00:00'); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); };

function Row({ label, children }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-400 w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-[15px] text-slate-700">{children}</span>
    </div>
  );
}

export default function CompOffDetailModal({ item, canAct, canApproveAll, onClose, onApprove, onApproveAll, onReject }) {
  const [acting, setActing] = useState(false);
  if (!item) return null;
  const hasLevels = Array.isArray(item.approvalLevels) && item.approvalLevels.length > 0;
  const showActions = canAct && item.status === 'pending';

  const runAction = (handler) => async (...args) => {
    if (acting) return;
    setActing(true);
    try {
      const result = handler(...args);
      if (result && typeof result.then === 'function') await result;
    } finally {
      // no-op when fire-and-forget; if the handler closed the modal this
      // component has already unmounted by the time we'd reset `acting`
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
              <Gift size={18} />
            </div>
            <div>
              {item.employee && (
                <p className="font-semibold text-slate-800 text-base">
                  {item.employee.firstName} {item.employee.lastName}
                  {item.employee.department && <span className="text-sm text-slate-400 font-normal ml-1.5">· {item.employee.department}</span>}
                </p>
              )}
              <p className="text-sm text-slate-500">Compensatory Off Request</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[item.status] || STATUS_STYLE.pending}`}>{item.status}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
        </div>

        {/* Scrollable middle content */}
        <div className="overflow-y-auto flex-1">
          {/* Details */}
          <div className="px-5 py-4">
            <Row label="Worked On">{fmtLong(item.workedDate)}</Row>
            <Row label="Comp-Off Date">{fmtShort(item.compOffDate)}</Row>
            <Row label="Days Claimed">{item.daysEarned} day{Number(item.daysEarned) !== 1 ? 's' : ''}</Row>
            {item.reason && <Row label="Reason">{item.reason}</Row>}
            {item.expiresAt && (
              <Row label={item.expired ? 'Expired On' : 'Valid Till'}>
                <span className={item.expired ? 'text-rose-500 font-medium' : ''}>{fmtShort(item.expiresAt)}</span>
              </Row>
            )}
            {item.rejectionReason && (
              <Row label="Rejection Reason"><span className="text-rose-600">{item.rejectionReason}</span></Row>
            )}

            {/* Approval Timeline */}
            {hasLevels && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[13px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Approval Timeline</p>
                <ApprovalTimeline leave={item} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {!showActions && (
            <button onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[15px] font-medium">Close</button>
          )}
          {showActions && onReject && (
            <button disabled={acting} onClick={runAction(() => onReject(item))} className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
              <XCircle size={13} /> Reject
            </button>
          )}
          {showActions && canApproveAll && onApproveAll && (
            <button disabled={acting} onClick={runAction(() => onApproveAll(item))} className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
              <CheckCheck size={13} /> Approve All
            </button>
          )}
          {showActions && onApprove && (
            <button disabled={acting} onClick={runAction(() => onApprove(item))} className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60">
              <CheckCircle size={13} /> Approve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
