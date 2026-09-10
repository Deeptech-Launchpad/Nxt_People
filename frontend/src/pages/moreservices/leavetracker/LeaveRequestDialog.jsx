import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Pencil, Hourglass, CheckCircle2, XCircle } from 'lucide-react';
import api from '../../../utils/api';
import EmployeePicker from './EmployeePicker';
import TimeInput from '../../../components/TimeInput';
import { useLocaleFormat, formatDate, formatTime } from '../../../utils/datetime';

/* Apply, edit and view a leave request — one dialog, three modes.
 *
 * These were three separate screens with three different layouts, which is how
 * the same request could look like three different records depending on which
 * button you pressed to reach it. The reference uses ONE form and changes only
 * whether the fields are writable: the same rows in the same order, the same
 * duration table, the same balance panel beside it. Reading a request and
 * correcting it should not feel like two different products.
 *
 * mode:
 *   apply   empty and writable
 *   edit    filled and writable — what the API will accept depends on status
 *           and role, and it answers plainly when it will not
 *   view    filled and read-only, with an Edit control in the header
 *
 * The day rows come from the server (GET /leaves/day-breakdown). The browser
 * has neither the weekend rules nor the holiday calendar, so a table built here
 * would show three rows against a total of two with no way to tell which was
 * right.
 *
 * Still not per-day portions: `leaves` holds ONE is_half_day for the whole
 * request and prices it 0.5 or the working-day count, so the control appears on
 * a single date where it means what it says and is withheld on a range where it
 * would not. That one is a schema change and a change to how days are priced.
 */

const TYPE_LABEL = {
  casual: 'Casual Leave', comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay', permission: 'Permission',
};

const STATUS = {
  pending:   { text: 'Pending',   cls: 'text-amber-600',   Icon: Hourglass },
  approved:  { text: 'Approved',  cls: 'text-emerald-600', Icon: CheckCircle2 },
  rejected:  { text: 'Rejected',  cls: 'text-rose-600',    Icon: XCircle },
  cancelled: { text: 'Cancelled', cls: 'text-slate-500',   Icon: XCircle },
};

const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** "0.5" -> "0:30 Hr(s)", the way the reference writes a duration. */
function hoursLabel(h) {
  const total = Math.round((Number(h) || 0) * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} Hr(s)`;
}

/** Label left, field right — every row in the form is one of these. */
function Field({ label, required, children, hint }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] sm:items-start gap-1 sm:gap-4 px-5 py-2.5 border-b border-slate-50 last:border-0">
      <label className="text-[14px] text-slate-500 sm:pt-1.5">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      <div className="min-w-0">{children}{hint}</div>
    </div>
  );
}

/** Read-only value, so view mode keeps the row rhythm of the writable one. */
const Read = ({ children }) => (
  <p className="text-[14px] text-slate-800 pt-1.5">{children || '-'}</p>
);

export default function LeaveRequestDialog({
  mode: initialMode = 'apply',
  leave = null,
  people = [],
  peopleLoading = false,
  types = [],
  onClose,
  onSaved,
  onCancelLeave,
}) {
  const { dateFormat, timeFormat } = useLocaleFormat();
  const [mode, setMode] = useState(initialMode);
  const editable = mode !== 'view';

  const [employeeId, setEmployeeId] = useState(leave?.employee?._id || leave?.employeeId || '');
  const [leaveType, setLeaveType] = useState(leave?.leaveType || '');
  const [startDate, setStartDate] = useState(ymd(leave?.startDate));
  const [endDate, setEndDate] = useState(ymd(leave?.endDate || leave?.startDate));
  const [applyWith, setApplyWith] = useState('range');
  const [startTime, setStartTime] = useState(hhmm(leave?.startTime));
  const [endTime, setEndTime] = useState(hhmm(leave?.endTime));
  const [totalHours, setTotalHours] = useState('1');
  const [isHalfDay, setIsHalfDay] = useState(!!leave?.isHalfDay);
  const [halfDayType, setHalfDayType] = useState(leave?.halfDayType || 'first_half');
  const [teamEmail, setTeamEmail] = useState(leave?.teamEmail || '');
  const [reason, setReason] = useState(leave?.reason || '');
  const [saving, setSaving] = useState(false);

  const [breakdown, setBreakdown] = useState(null);
  const [balances, setBalances] = useState(null);

  const isPermission = leaveType === 'permission';
  const isCompOff = leaveType === 'comp_off';
  const singleDay = !!startDate && startDate === endDate;
  const status = leave?.status || 'pending';
  const S = STATUS[status] || STATUS.pending;

  const effectiveEndTime = useMemo(() => {
    if (!isPermission) return '';
    if (applyWith === 'range') return endTime;
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const mins = (h || 0) * 60 + (m || 0) + Math.round((parseFloat(totalHours) || 0) * 60);
    if (mins >= 24 * 60) return '';      // a window cannot run past midnight
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }, [isPermission, applyWith, startTime, endTime, totalHours]);

  const permHours = useMemo(() => {
    if (!isPermission) return 0;
    if (!editable) return Number(leave?.hours) || 0;
    if (!startTime || !effectiveEndTime) return 0;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
    return Math.max(0, (m(effectiveEndTime) - m(startTime)) / 60);
  }, [isPermission, editable, leave, startTime, effectiveEndTime]);

  useEffect(() => {
    if (isPermission || !startDate || !endDate) { setBreakdown(null); return; }
    let live = true;
    api.get(`/leaves/day-breakdown?startDate=${startDate}&endDate=${endDate}`)
      .then(r => { if (live) setBreakdown(r.data.data); })
      .catch(() => { if (live) setBreakdown(null); });
    return () => { live = false; };
  }, [isPermission, startDate, endDate]);

  useEffect(() => {
    if (!employeeId) { setBalances(null); return; }
    let live = true;
    const year = new Date(startDate || Date.now()).getFullYear();
    api.get(`/leaves/balance?employeeId=${employeeId}&year=${year}`)
      .then(r => { if (live) setBalances(r.data.data || []); })
      .catch(() => { if (live) setBalances(null); });
    return () => { live = false; };
  }, [employeeId, startDate]);

  const card = useMemo(() => (balances || []).find(b => b.code === leaveType) || null, [balances, leaveType]);

  const days = isPermission ? 0 : (isHalfDay ? 0.5 : (breakdown?.workingDays ?? 0));
  const booking = isPermission ? permHours : days;
  const unit = isPermission ? 'Hour(s)' : 'Day(s)';
  const available = card ? card.available : undefined;
  const unlimited = available === null || available === undefined;

  const pickType = (code) => {
    setLeaveType(code);
    if (code === 'permission') { setEndDate(startDate); setIsHalfDay(false); }
    else { setStartTime(''); setEndTime(''); }
  };

  const canSubmit = employeeId && leaveType && startDate && reason.trim().length >= 3
    && (isPermission ? permHours > 0 : days > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!editable) return;
    setSaving(true);
    try {
      const body = isPermission
        ? { employeeId, leaveType, startDate, endDate: startDate, reason, teamEmail,
            startTime, endTime: effectiveEndTime }
        : { employeeId, leaveType, startDate, endDate: endDate || startDate, reason, teamEmail,
            isHalfDay: singleDay ? isHalfDay : false,
            halfDayType: singleDay && isHalfDay ? halfDayType : null };

      if (mode === 'edit') await api.put(`/leaves/${leave._id || leave.id}`, body);
      else await api.post('/leaves', body);

      toast.success(mode === 'edit' ? 'Request updated' : 'Leave applied');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that request');
    } finally { setSaving(false); }
  };

  const input = 'w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-brand-400';
  const todayStr = new Date().toLocaleDateString('en-CA');
  const isBackdated = !!startDate && startDate < todayStr;
  const who = people.find(p => String(p._id) === String(employeeId));
  const empLabel = leave?.employee
    ? `${leave.employee.firstName} ${leave.employee.lastName} ${leave.employee.employeeId || ''}`.trim()
    : (who ? `${who.firstName} ${who.lastName} ${who.employeeId || ''}`.trim() : '');

  const title = mode === 'apply' ? (isPermission ? 'Apply Permission' : 'Apply Leave')
    : mode === 'edit' ? 'Edit Leave' : `${leave?.employee?.employeeId || ''} - ${leave?.employee?.firstName || 'Leave'}`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit}
        className="bg-white rounded-xl w-full max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-display font-semibold text-slate-800 text-[16px] truncate">{title}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            {mode === 'view' && (
              <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${S.cls}`}>
                <S.Icon size={14} /> {S.text}
              </span>
            )}
            {/* Editing is offered on the states that are still live. A resolved
                request is history, and the API refuses it anyway. */}
            {mode === 'view' && ['pending', 'approved'].includes(status) && (
              <button type="button" onClick={() => setMode('edit')} title="Edit"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <Pencil size={15} />
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/40">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_270px] gap-4 p-4">

            {/* ── The request ──────────────────────────────────────── */}
            <div className="bg-white rounded-lg border border-slate-200">
              <div className="px-5 py-3 border-b border-slate-100">
                <h4 className="text-[15px] font-semibold text-slate-700">Leave</h4>
              </div>

              <Field label="Employee ID" required={editable}>
                {editable && mode === 'apply' ? (
                  <EmployeePicker people={people} loading={peopleLoading}
                    value={employeeId} onChange={setEmployeeId} required />
                ) : (
                  /* The employee cannot move to somebody else — that is a
                     different request, not a correction — so it is read-only
                     even while editing. */
                  <Read>{empLabel}</Read>
                )}
              </Field>

              <Field label="Leave type" required={editable}
                hint={isCompOff && editable ? (
                  <p className="text-[12px] text-slate-500 mt-1">
                    Available comp-off: <span className="font-semibold text-slate-700">
                      {card ? `${r2(card.available || 0)} Day(s)` : '—'}</span>
                    {card && (card.available || 0) <= 0 && <span className="text-amber-600"> — no credits to spend.</span>}
                  </p>
                ) : null}>
                {editable && mode === 'apply' ? (
                  <select value={leaveType} onChange={e => pickType(e.target.value)} required className={input}>
                    <option value="">Select</option>
                    {types.map(t => <option key={t.id || t.code} value={t.code}>{t.name}</option>)}
                  </select>
                ) : (
                  <Read>{TYPE_LABEL[leaveType] || leaveType}</Read>
                )}
              </Field>

              {isPermission && editable && (
                <Field label="Apply with" required>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 pt-1">
                    {[['total', 'Start time and total hours'], ['range', 'Start time and end time']].map(([v, text]) => (
                      <label key={v} className="flex items-center gap-2 text-[14px] text-slate-600">
                        <input type="radio" name="applyWith" value={v} checked={applyWith === v}
                          onChange={() => setApplyWith(v)} className="w-4 h-4" />
                        {text}
                      </label>
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Date" required>
                {editable ? (
                  <div className="grid grid-cols-2 gap-3">
                    <input type="date" value={startDate} required className={input}
                      onChange={e => {
                        setStartDate(e.target.value);
                        if (isPermission || !endDate || endDate < e.target.value) setEndDate(e.target.value);
                      }} />
                    <input type="date" value={endDate} required min={startDate} className={input}
                      disabled={isPermission} onChange={e => setEndDate(e.target.value)} />
                  </div>
                ) : (
                  <Read>
                    {formatDate(startDate, dateFormat)}
                    {!singleDay && ` – ${formatDate(endDate, dateFormat)}`}
                  </Read>
                )}
              </Field>

              {/* ── Duration table ─────────────────────────────────── */}
              {startDate && (
                <div className="px-5 py-3 border-b border-slate-50">
                  <div className="sm:ml-[150px] sm:pl-4">
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="flex items-center bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-500">
                        <span className="flex-1">Date</span>
                        <span className="w-[210px]" />
                        <span className="w-24 text-right">Duration</span>
                      </div>

                      {isPermission ? (
                        <div className="flex items-center px-3 py-2">
                          <span className="text-[14px] text-slate-700 flex-1">
                            {formatDate(startDate, dateFormat)}
                          </span>
                          <span className="w-[210px] flex items-center gap-2">
                            {editable ? (
                              <>
                                <TimeInput value={startTime} onChange={setStartTime}
                                  className="w-[92px] border border-slate-200 rounded-lg pl-2 pr-6 py-1 text-[13px] focus:outline-none focus:border-brand-400" />
                                {applyWith === 'range' ? (
                                  <TimeInput value={endTime} onChange={setEndTime} assumePm
                                    className="w-[92px] border border-slate-200 rounded-lg pl-2 pr-6 py-1 text-[13px] focus:outline-none focus:border-brand-400" />
                                ) : (
                                  <input type="number" min="0.25" step="0.25" value={totalHours}
                                    onChange={e => setTotalHours(e.target.value)}
                                    className="w-[92px] border border-slate-200 rounded-lg px-2 py-1 text-[13px] focus:outline-none focus:border-brand-400" />
                                )}
                              </>
                            ) : (
                              <span className="flex-1">
                                <span className="flex justify-between text-[13px] text-slate-600">
                                  <span>{formatTime(startTime, timeFormat)}</span>
                                  <span>{formatTime(endTime, timeFormat)}</span>
                                </span>
                                {/* The window drawn against the day, so the
                                    shape of it reads at a glance. */}
                                <span className="mt-1 block h-1 rounded-full bg-slate-100 relative">
                                  <span className="absolute inset-y-0 rounded-full bg-amber-400" style={barStyle(startTime, endTime)} />
                                </span>
                              </span>
                            )}
                          </span>
                          <span className="w-24 text-right">
                            <span className="inline-block bg-slate-100 rounded px-2 py-0.5 text-[12px] text-slate-600">
                              {permHours > 0 ? hoursLabel(permHours) : '—'}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto">
                          {(breakdown?.days || []).map(d => (
                            <div key={d.date}
                              className={`flex items-center px-3 py-1.5 border-b border-slate-50 last:border-0 ${d.counts ? '' : 'bg-slate-50/70'}`}>
                              <span className="text-[14px] text-slate-700 flex-1">
                                {d.weekday} {formatDate(d.date, dateFormat)}
                              </span>
                              <span className="w-[210px] flex items-center gap-2">
                                {d.counts && editable && singleDay ? (
                                  <>
                                    <select value={isHalfDay ? 'half' : 'full'}
                                      className="border border-slate-200 rounded-lg px-2 py-1 text-[13px]"
                                      onChange={e => setIsHalfDay(e.target.value === 'half')}>
                                      <option value="full">Full Day</option>
                                      <option value="half">Half Day</option>
                                    </select>
                                    <select value={halfDayType} disabled={!isHalfDay}
                                      onChange={e => setHalfDayType(e.target.value)}
                                      className="border border-slate-200 rounded-lg px-2 py-1 text-[13px] disabled:bg-slate-50 disabled:text-slate-300">
                                      <option value="first_half">1st Half</option>
                                      <option value="second_half">2nd Half</option>
                                    </select>
                                  </>
                                ) : (
                                  <span className="text-[13px] text-slate-500">
                                    {!d.counts
                                      ? (d.label || (d.kind === 'weekend' ? 'Weekend' : 'Not a working day'))
                                      : isHalfDay ? `Half Day · ${halfDayType === 'first_half' ? '1st Half' : '2nd Half'}` : 'Full Day'}
                                  </span>
                                )}
                              </span>
                              <span className="w-24 text-right text-[13px] text-slate-600">
                                {d.counts ? `${isHalfDay ? 0.5 : 1} Day(s)` : '—'}
                              </span>
                            </div>
                          ))}
                          {!breakdown && <p className="px-3 py-2 text-[13px] text-slate-400">Working out those days…</p>}
                        </div>
                      )}

                      <div className="flex items-center bg-slate-100 px-3 py-1.5">
                        <span className="flex-1 text-[13px] font-medium text-slate-600">Total</span>
                        <span className="w-[210px]" />
                        <span className="w-24 text-right text-[13px] font-semibold text-slate-800">
                          {isPermission ? hoursLabel(permHours) : `${days} Day(s)`}
                        </span>
                      </div>
                    </div>

                    {editable && !isPermission && !singleDay && (
                      <p className="text-[12px] text-slate-400 mt-1">
                        A half day applies to a single date. Pick one day to book half of it.
                      </p>
                    )}
                    {editable && breakdown && breakdown.workingDays === 0 && !isPermission && (
                      <p className="text-[12px] text-rose-600 mt-1">
                        Every day in that range is a weekend or a holiday, so there is nothing to book.
                      </p>
                    )}
                    {editable && isBackdated && (
                      <p className="text-[12px] text-amber-700 mt-1">
                        Past date — recorded in the audit log under your name, and refused if that
                        month's payroll is already finalised.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Field label="Team Email ID">
                {editable ? (
                  <input type="email" value={teamEmail} onChange={e => setTeamEmail(e.target.value)}
                    className={input} placeholder="Optional" />
                ) : <Read>{teamEmail}</Read>}
              </Field>

              {leave?.createdAt && (
                <Field label="Date of request">
                  <Read>{formatDate(leave.createdAt, dateFormat)}</Read>
                </Field>
              )}

              <Field label="Reason for leave" required={editable}>
                {editable ? (
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    required rows={2} minLength={3} maxLength={500}
                    className={`${input} resize-none`} placeholder="Why is this leave being taken?" />
                ) : <Read>{reason}</Read>}
              </Field>

              {status === 'rejected' && leave?.rejectionReason && (
                <Field label="Rejection reason"><Read>{leave.rejectionReason}</Read></Field>
              )}
            </div>

            {/* ── What it costs ────────────────────────────────────── */}
            <div className="space-y-3">
              {!employeeId || !leaveType ? (
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <p className="text-[13px] text-slate-400">
                    Pick an employee and a leave type to see their balance.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-[12px] font-semibold text-slate-500">
                        As on {formatDate(startDate || todayStr, dateFormat)}
                      </span>
                      <span className="text-[11px] text-slate-400">{unit}</span>
                    </div>
                    <Row label="Available balance" value={unlimited ? 'No limit' : r2(available)} tone="text-emerald-600" />
                    <Row label="Current booking" value={r2(booking)} />
                    <div className="border-t border-slate-100 mt-1.5 pt-1.5">
                      <Row label="Balance after this booking"
                        value={unlimited ? 'No limit' : r2(available - booking)}
                        tone={!unlimited && available - booking < 0 ? 'text-rose-600' : 'text-blue-600'} bold />
                    </div>
                  </div>

                  {editable && !unlimited && available - booking < 0 && (
                    <p className="text-[12px] text-rose-600">
                      That is more than they have. The request will be refused.
                    </p>
                  )}
                  {isPermission && card?.monthlyLimit != null && (
                    <p className="text-[12px] text-slate-500">
                      Capped at {card.monthlyLimit} hours a month; does not carry forward.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="flex gap-2.5 px-5 py-3 border-t border-slate-100 flex-shrink-0">
          {editable ? (
            <>
              <button type="submit" disabled={saving || !canSubmit}
                className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2 rounded-lg text-[14px] font-medium disabled:opacity-60">
                {saving ? 'Saving…' : 'Submit'}
              </button>
              <button type="button"
                onClick={() => (mode === 'edit' && initialMode === 'view' ? setMode('view') : onClose())}
                className="border border-slate-200 text-slate-600 px-6 py-2 rounded-lg text-[14px] font-medium hover:bg-slate-50">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose}
                className="border border-slate-200 text-slate-600 px-6 py-2 rounded-lg text-[14px] font-medium hover:bg-slate-50">
                Close
              </button>
              {typeof onCancelLeave === 'function' && ['pending', 'approved'].includes(status) && (
                <button type="button" onClick={() => onCancelLeave(leave)}
                  className="border border-rose-200 text-rose-600 px-6 py-2 rounded-lg text-[14px] font-medium hover:bg-rose-50">
                  Cancel Leave
                </button>
              )}
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/* The window as a proportion of the working day, so a 30-minute permission at
 * 9:30 reads differently from one at 4pm. Clamped to 8:00–20:00, which is the
 * band any of these actually fall in. */
function barStyle(from, to) {
  const m = (t) => { const [h, mm] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
  const DAY_START = 8 * 60, DAY_END = 20 * 60, SPAN = DAY_END - DAY_START;
  const a = Math.max(0, Math.min(1, (m(from) - DAY_START) / SPAN));
  const b = Math.max(0, Math.min(1, (m(to) - DAY_START) / SPAN));
  return { left: `${a * 100}%`, width: `${Math.max(2, (b - a) * 100)}%` };
}

function Row({ label, value, tone = 'text-slate-700', bold = false }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className={`text-[14px] tabular-nums ${tone} ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
