import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, AlertTriangle } from 'lucide-react';
import api from '../utils/api';
import TimeInput from './TimeInput';

/* Editing a leave or permission after it has been filed.
 *
 * The row menu carried an Edit greyed out since the day it was built, with the
 * reason on it: editing an approved leave has to move the balance both ways.
 * The server does that now; this is the form for it.
 *
 * The case it exists for is small and constant: two hours of permission were
 * approved, the person came back after one, and the record should say one. That
 * is a correction to a fact, not a new request — making somebody cancel and
 * re-apply loses the approval and the history with it.
 *
 * Who may do what is enforced by the API. This mirrors it so the form does not
 * offer something that will be refused:
 *   pending    the person it belongs to, or an administrator
 *   approved   administrators only
 */

const TYPE_LABEL = {
  casual: 'Casual Leave', comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay', permission: 'Permission',
};

const ymd = (d) => (d ? String(d).slice(0, 10) : '');

export default function EditRequestModal({ leave, onClose, onSaved }) {
  const isPermission = leave.leaveType === 'permission';
  const wasApproved = leave.status === 'approved';

  const [startDate, setStartDate] = useState(ymd(leave.startDate));
  const [endDate, setEndDate] = useState(ymd(leave.endDate || leave.startDate));
  const [startTime, setStartTime] = useState((leave.startTime || '').slice(0, 5));
  const [endTime, setEndTime] = useState((leave.endTime || '').slice(0, 5));
  const [isHalfDay, setIsHalfDay] = useState(!!leave.isHalfDay);
  const [halfDayType, setHalfDayType] = useState(leave.halfDayType || 'first_half');
  const [reason, setReason] = useState(leave.reason || '');
  const [saving, setSaving] = useState(false);

  const hours = useMemo(() => {
    if (!isPermission || !startTime || !endTime) return 0;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
    return Math.max(0, (m(endTime) - m(startTime)) / 60);
  }, [isPermission, startTime, endTime]);

  const wasHours = parseFloat(leave.hours) || 0;
  const changed = isPermission
    ? (Math.abs(hours - wasHours) > 0.001 || (leave.startTime || '').slice(0, 5) !== startTime
       || (leave.endTime || '').slice(0, 5) !== endTime || (leave.reason || '') !== reason
       || ymd(leave.startDate) !== startDate)
    : (ymd(leave.startDate) !== startDate || ymd(leave.endDate) !== endDate
       || !!leave.isHalfDay !== isHalfDay || (leave.halfDayType || 'first_half') !== halfDayType
       || (leave.reason || '') !== reason);

  const submit = async (e) => {
    e.preventDefault();
    if (isPermission && hours <= 0) { toast.error('End time must be after the start time.'); return; }
    setSaving(true);
    try {
      const body = isPermission
        ? { startDate, endDate: startDate, startTime, endTime, reason }
        : { startDate, endDate, isHalfDay, halfDayType: isHalfDay ? halfDayType : null, reason };
      const r = await api.put(`/leaves/${leave._id || leave.id}`, body);
      toast.success('Request updated');
      onSaved?.(r.data.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update that request');
    } finally { setSaving(false); }
  };

  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display font-semibold text-slate-800 text-xl">
              Edit {isPermission ? 'permission' : 'leave'}
            </h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {leave.employee ? `${leave.employee.firstName} ${leave.employee.lastName} · ` : ''}
              {TYPE_LABEL[leave.leaveType] || leave.leaveType}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {wasApproved && (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              This request is already approved. Changing it moves the balance to match and is
              recorded in the audit log under your name. It stays approved — nobody is asked again.
            </span>
          </div>
        )}

        {isPermission ? (
          <>
            <div>
              <label className={label}>Date *</label>
              <input type="date" value={startDate} required className={field}
                onChange={e => { setStartDate(e.target.value); setEndDate(e.target.value); }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Start time *</label>
                <TimeInput value={startTime} onChange={setStartTime} required className={field} />
              </div>
              <div>
                <label className={label}>End time *</label>
                <TimeInput value={endTime} onChange={setEndTime} required assumePm className={field} />
              </div>
            </div>
            {startTime && endTime && (
              hours > 0
                ? <p className="text-[13px] font-medium text-purple-600">
                    {hours.toFixed(2)} hour{hours === 1 ? '' : 's'}
                    {wasHours > 0 && Math.abs(hours - wasHours) > 0.001 && (
                      <span className="text-slate-500"> — was {wasHours.toFixed(2)}h</span>
                    )}
                  </p>
                : <p className="text-[13px] font-medium text-rose-600">End time must be after the start time.</p>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>From *</label>
                <input type="date" value={startDate} required className={field}
                  onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className={label}>To *</label>
                <input type="date" value={endDate} required min={startDate} className={field}
                  onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2.5 text-[15px] text-slate-600">
              <input type="checkbox" checked={isHalfDay} className="w-4 h-4 rounded border-slate-300"
                onChange={e => setIsHalfDay(e.target.checked)} />
              Half day
            </label>
            {isHalfDay && (
              <div>
                <label className={label}>Which half</label>
                <select value={halfDayType} onChange={e => setHalfDayType(e.target.value)} className={field}>
                  <option value="first_half">First half</option>
                  <option value="second_half">Second half</option>
                </select>
              </div>
            )}
          </>
        )}

        <div>
          <label className={label}>Reason *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            required rows={2} minLength={3} maxLength={500}
            className={`${field} resize-none`} />
        </div>

        <p className="text-[12px] text-slate-400">
          The employee and the leave type cannot be changed here — that is a different request.
          Cancel this one and apply again.
        </p>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !changed || (isPermission && hours <= 0)}
            className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {!changed && <p className="text-right text-[12px] text-slate-400">Nothing has changed yet.</p>}
      </form>
    </div>
  );
}
