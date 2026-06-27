/**
 * LeaveDetailModal — request detail popup (leave OR regularization).
 *
 * Layout (Zoho-style):
 *   • Header  — employee · name · type, status badge, a View/Details toggle, close.
 *   • Body    — "details" view: Leave Details (left) + Leave Balance panel (right,
 *               for pending when `balance` is passed). "timeline" view (via the
 *               View toggle): the Approval Timeline.
 *   • Footer  — optional Comment box + Approve/Reject (when `canAct`), Cancel Leave
 *               (when `onCancel` + pending), and Close.
 *
 * Presentation only — no workflow logic. All action props are optional:
 *   onApprove(comment) / onReject(comment)  — receive the optional comment string.
 *   onApproveAll(comment)                   — Super-Admin only: approve every remaining level at once.
 *   onCancel()                              — owner cancels their own pending request.
 *   balance                                 — array of {code,name,available,booked}.
 *   kind                                    — 'leave' (default) | 'regularization'.
 */
import React, { useState } from 'react';
import { X, CheckCircle, CheckCheck, XCircle, Calendar, Clock, FileText, User, Hash, LogIn, LogOut, Eye, ArrowLeft, MessageSquare } from 'lucide-react';
import ApprovalTimeline from './ApprovalTimeline';

const TYPE_LABEL = { casual: 'Casual Leave', comp_off: 'Compensatory Off', unpaid: 'Leave Without Pay', permission: 'Permission', sick: 'Sick Leave', earned: 'Earned Leave' };

const STATUS_PILL = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const initialsOf = (name) => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <Icon size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-600">{label}</p>
        <div className="text-[15px] text-slate-700 mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function BalanceCard({ leave, balanceCards }) {
  const card = balanceCards.find(c => c.code === leave.leaveType);
  const isPerm = leave.leaveType === 'permission';
  const u = isPerm ? 'h' : '';                       // hours suffix for permission
  // Round to 2 dp so float subtraction doesn't show 1.9399999999999997.
  const r2 = (n) => (n === null || n === undefined) ? n : Math.round((n + Number.EPSILON) * 100) / 100;
  const avail = card ? r2(card.available) : undefined;
  const booking = r2(isPerm ? (parseFloat(leave.hours) || 0) : (parseFloat(leave.totalDays ?? leave.total_days) || 0));
  const unlimited = avail === null || avail === undefined;
  const after = unlimited ? null : r2(avail - booking);
  const Row = ({ label, value, strong, muted }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-[14px] ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-[17px] ${strong ? 'font-bold text-blue-600' : muted ? 'font-medium text-slate-400' : 'font-semibold text-slate-700'}`}>{value}</span>
    </div>
  );
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[14px] font-bold text-slate-700">{isPerm ? 'Permission Balance' : 'Leave Balance'}</p>
        <span className="text-[13px] text-slate-600">{TYPE_LABEL[leave.leaveType] || leave.leaveType}</span>
      </div>
      <Row label={isPerm ? 'Available this month' : 'Available balance'} value={unlimited ? 'Unlimited' : `${avail}${u}`} />
      <Row label="Current booking" value={`${booking}${u}`} />
      <div className="border-t border-slate-100 my-1.5" />
      <Row label="Balance after current booking" value={unlimited ? '—' : `${after}${u}`} strong />
      {!isPerm && <Row label="Estimated balance (year-end)" value={unlimited ? '—' : avail} muted />}
      {isPerm && <Row label="Monthly allowance" value="4h" muted />}
    </div>
  );
}

export default function LeaveDetailModal({ leave, kind, balance, onClose, canAct = false, onApprove, onApproveAll, onReject, onCancel, defaultView = 'details' }) {
  const [view, setView] = useState(defaultView);   // 'details' | 'timeline'
  const [comment, setComment] = useState('');
  if (!leave) return null;

  const balanceCards = Array.isArray(balance) ? balance : null;
  const emp = leave.employee;
  const status = leave.status === 'pending' ? 'pending' : leave.status;
  const isReg = (kind === 'regularization') || (!kind && !leave.leaveType && (leave.checkIn !== undefined || leave.checkOut !== undefined || (leave.date && !leave.startDate)));
  const typeLabel = isReg ? 'Attendance Regularization' : (TYPE_LABEL[leave.leaveType] || `${(leave.leaveType || '').replace(/_/g, ' ')}`);
  const empName = emp ? `${emp.firstName} ${emp.lastName}` : null;
  const showBalance = !!balanceCards && status === 'pending' && !isReg;
  const noteText = leave.rejectionReason;                    // doubles as approver comment
  const noteLabel = status === 'rejected' ? 'Rejection Reason' : 'Comment';
  const showActions = canAct && (onApprove || onReject);
  const showCancel = typeof onCancel === 'function' && status === 'pending';
  const c = () => comment.trim() || undefined;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 text-[15px] font-bold flex items-center justify-center flex-shrink-0">
              {initialsOf(empName || 'Leave')}
            </div>
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold text-slate-800 truncate">{empName || 'Leave Request'}</h3>
              <p className="text-[14px] text-slate-400 truncate">{emp?.employeeId ? `${emp.employeeId} · ` : ''}{typeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-[13px] font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_PILL[status] || STATUS_PILL.pending}`}>{status}</span>
            <button
              onClick={() => setView(v => v === 'timeline' ? 'details' : 'timeline')}
              className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-[14px] font-semibold transition-colors"
            >
              {view === 'timeline' ? <><ArrowLeft size={13} /> Details</> : <><Eye size={13} /> View</>}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={18} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {view === 'timeline' ? (
            <div className="p-6">
              <h4 className="text-[15px] font-bold text-slate-700 mb-3">Approval Timeline</h4>
              <ApprovalTimeline leave={leave} />
            </div>
          ) : (
            <div className={`grid grid-cols-1 ${showBalance ? 'md:grid-cols-2' : ''} gap-0`}>
              {/* Details */}
              <div className={`p-6 ${showBalance ? 'md:border-r border-slate-100' : ''}`}>
                <h4 className="text-[15px] font-bold text-slate-700 mb-3">{isReg ? 'Regularization Details' : 'Leave Details'}</h4>

                {emp?.employeeId && <DetailRow icon={Hash} label="Employee ID">{emp.employeeId}</DetailRow>}
                {empName && (
                  <DetailRow icon={User} label="Employee">
                    {empName}{emp.department && <span className="ml-2 text-[13px] text-slate-600">{emp.department}</span>}
                  </DetailRow>
                )}
                <DetailRow icon={FileText} label={isReg ? 'Request Type' : 'Leave Type'}>
                  {typeLabel}
                  {!isReg && leave.isHalfDay && <span className="ml-2 text-[13px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">Half Day</span>}
                </DetailRow>

                {isReg ? (
                  <>
                    <DetailRow icon={Calendar} label="Date">{fmtDate(leave.date)}</DetailRow>
                    <DetailRow icon={LogIn} label="Check-in">{leave.checkIn || '—'}</DetailRow>
                    <DetailRow icon={LogOut} label="Check-out">{leave.checkOut || '—'}</DetailRow>
                  </>
                ) : leave.leaveType === 'permission' ? (
                  <>
                    <DetailRow icon={Calendar} label="Date">{fmtDate(leave.startDate)}</DetailRow>
                    <DetailRow icon={Clock} label="Time">
                      {(leave.startTime || '').slice(0, 5) || '—'} <span className="text-slate-600">–</span> {(leave.endTime || '').slice(0, 5) || '—'}
                    </DetailRow>
                    <DetailRow icon={Clock} label="Duration">{leave.hours ? `${leave.hours} hour${Number(leave.hours) !== 1 ? 's' : ''}` : '—'}</DetailRow>
                  </>
                ) : (
                  <>
                    <DetailRow icon={Calendar} label="Dates">
                      {fmtDate(leave.startDate)} <span className="text-slate-600">→</span> {fmtDate(leave.endDate)}
                    </DetailRow>
                    <DetailRow icon={Clock} label="Duration">{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}</DetailRow>
                  </>
                )}

                <DetailRow icon={FileText} label="Reason"><span className="text-slate-600">{leave.reason || '—'}</span></DetailRow>
                {leave.createdAt && <DetailRow icon={Calendar} label="Requested On">{fmtDate(leave.createdAt)}</DetailRow>}
                {noteText && (
                  <DetailRow icon={MessageSquare} label={noteLabel}>
                    <span className={status === 'rejected' ? 'text-rose-600' : 'text-slate-600'}>{noteText}</span>
                  </DetailRow>
                )}
              </div>

              {/* Balance panel (pending) */}
              {showBalance && (
                <div className="p-6 bg-slate-50/50">
                  <BalanceCard leave={leave} balanceCards={balanceCards} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(showActions || showCancel) && (
          <div className="border-t border-slate-100 bg-white px-6 py-3 space-y-3">
            {showActions && (
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
                placeholder="Add an optional comment (visible in the request history)…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400 resize-none"
              />
            )}
            <div className="flex items-center justify-end gap-2">
              {/* The dismiss button doubles as Cancel Leave when a cancel handler
                  is provided — cancelling marks the request 'cancelled'. */}
              {showCancel ? (
                <button onClick={() => onCancel(leave)} className="flex items-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-[15px] font-semibold transition-colors">
                  <XCircle size={15} /> Cancel Leave
                </button>
              ) : (
                <button onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[15px] font-medium transition-colors">Close</button>
              )}
              {showActions && onReject && (
                <button onClick={() => onReject(leave, c())} className="flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-lg text-[15px] font-semibold transition-colors">
                  <XCircle size={15} /> Reject
                </button>
              )}
              {showActions && onApprove && (
                <button onClick={() => onApprove(leave, c())} className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-2 rounded-lg text-[15px] font-semibold transition-colors">
                  <CheckCircle size={15} /> Approve
                </button>
              )}
              {/* Super-Admin only: finalise every remaining level in one click. */}
              {showActions && onApproveAll && (
                <button onClick={() => onApproveAll(leave, c())} className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-lg text-[15px] font-semibold transition-colors">
                  <CheckCheck size={15} /> Approve All
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
