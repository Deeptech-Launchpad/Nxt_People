import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';
import EmployeePicker from './EmployeePicker';
import TimeInput from '../../../components/TimeInput';
import { useLocaleFormat, formatTime, formatDate } from '../../../utils/datetime';

/* Apply Leave, in the shape the reference uses.
 *
 * The old form was one fixed set of fields for every leave type, which is why
 * Permission could not be filed from here at all. This is the reference's
 * layout: the request on the left, what it costs on the right, and a row per
 * day in between so somebody can see what they are actually booking before
 * they book it.
 *
 * The day rows come from the server (GET /leaves/day-breakdown) rather than
 * being worked out here. The browser has neither the weekend rules nor the
 * holiday calendar, so a table built locally would show three rows against a
 * total of two and there would be no way to tell which was right. The rows and
 * the total are the same answer from the same helper the apply path uses.
 *
 * Two things the reference has that are deliberately absent:
 *
 *   Team Email ID    notifies an address outside the approval chain. There is
 *                    no such field in our schema and nothing would read it; a
 *                    box that silently discards what you type is worse than no
 *                    box.
 *   per-day portions the reference lets day one be a half and day two a full.
 *                    `leaves` holds ONE is_half_day for the whole request, so
 *                    the control is offered on a single date, where it means
 *                    exactly what it says, and withheld on a range where it
 *                    would not. Supporting it properly is a schema change and
 *                    a change to how days are priced.
 */

const PORTION_NOTE = 'A half day applies to a single date. Pick one day to book half of it.';

export default function ApplyLeaveForm({ people, peopleLoading, types, onClose, onSaved }) {
  const { timeFormat, dateFormat } = useLocaleFormat();

  const [employeeId, setEmployeeId] = useState('');
  const [leaveType, setLeaveType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [applyWith, setApplyWith] = useState('range');   // 'range' | 'total'
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [totalHours, setTotalHours] = useState('1');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDayType, setHalfDayType] = useState('first_half');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [breakdown, setBreakdown] = useState(null);
  const [balances, setBalances] = useState(null);

  const isPermission = leaveType === 'permission';
  const isCompOff = leaveType === 'comp_off';
  const singleDay = !!startDate && startDate === endDate;

  /* The end time is whichever way the person chose to express it. Both produce
   * the same pair for the API, because the API only knows about a window. */
  const effectiveEndTime = useMemo(() => {
    if (!isPermission) return '';
    if (applyWith === 'range') return endTime;
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const mins = (h || 0) * 60 + (m || 0) + Math.round((parseFloat(totalHours) || 0) * 60);
    if (mins >= 24 * 60) return '';                 // a window cannot run past midnight
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }, [isPermission, applyWith, startTime, endTime, totalHours]);

  const permHours = useMemo(() => {
    if (!isPermission || !startTime || !effectiveEndTime) return 0;
    const m = (t) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0); };
    return Math.max(0, (m(effectiveEndTime) - m(startTime)) / 60);
  }, [isPermission, startTime, effectiveEndTime]);

  // Day rows for the chosen range.
  useEffect(() => {
    if (isPermission || !startDate || !endDate) { setBreakdown(null); return; }
    let live = true;
    api.get(`/leaves/day-breakdown?startDate=${startDate}&endDate=${endDate}`)
      .then(r => { if (live) setBreakdown(r.data.data); })
      .catch(() => { if (live) setBreakdown(null); });
    return () => { live = false; };
  }, [isPermission, startDate, endDate]);

  // What this person has, for the panel on the right.
  useEffect(() => {
    if (!employeeId) { setBalances(null); return; }
    let live = true;
    const year = new Date(startDate || Date.now()).getFullYear();
    api.get(`/leaves/balance?employeeId=${employeeId}&year=${year}`)
      .then(r => { if (live) setBalances(r.data.data || []); })
      .catch(() => { if (live) setBalances(null); });
    return () => { live = false; };
  }, [employeeId, startDate]);

  const card = useMemo(
    () => (balances || []).find(b => b.code === leaveType) || null,
    [balances, leaveType]
  );

  const booking = isPermission ? permHours : (isHalfDay ? 0.5 : (breakdown?.workingDays ?? 0));
  const unit = isPermission ? 'Hour(s)' : 'Day(s)';
  const available = card ? card.available : undefined;
  const unlimited = available === null || available === undefined;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const pickType = (code) => {
    setLeaveType(code);
    // Values belonging to the other shape must not survive the switch.
    if (code === 'permission') {
      setEndDate(startDate);
      setIsHalfDay(false);
    } else {
      setStartTime(''); setEndTime('');
    }
  };

  const canSubmit = employeeId && leaveType && startDate && reason.trim().length >= 3
    && (isPermission ? permHours > 0 : (breakdown?.workingDays ?? 0) > 0 || isHalfDay);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = isPermission
        ? { employeeId, leaveType, startDate, endDate: startDate, reason,
            startTime, endTime: effectiveEndTime }
        : { employeeId, leaveType, startDate, endDate: endDate || startDate, reason,
            isHalfDay: singleDay ? isHalfDay : false,
            halfDayType: singleDay && isHalfDay ? halfDayType : null };
      await api.post('/leaves', body);
      const who = people.find(p => p._id === employeeId);
      toast.success(who ? `Applied for ${who.firstName} ${who.lastName}` : 'Applied');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not apply that leave');
    } finally { setSaving(false); }
  };

  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';
  const todayStr = new Date().toLocaleDateString('en-CA');
  const isBackdated = !!startDate && startDate < todayStr;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto p-4">
      <form onSubmit={submit}
        className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl my-6 overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">
            {isPermission ? 'Apply Permission' : 'Apply Leave'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
          {/* ── The request ───────────────────────────────────────────── */}
          <div className="p-6 space-y-4 lg:border-r border-slate-100">
            <div>
              <label className={label}>Employee *</label>
              <EmployeePicker
                people={people}
                loading={peopleLoading}
                value={employeeId}
                onChange={setEmployeeId}
                required
              />
              <p className="text-[13px] text-amber-600 mt-1">
                This spends their balance and goes to their own reporting line for approval.
              </p>
            </div>

            <div>
              <label className={label}>Leave type *</label>
              <select value={leaveType} onChange={e => pickType(e.target.value)} required className={field}>
                <option value="">Select a type</option>
                {types.map(t => <option key={t.id || t.code} value={t.code}>{t.name}</option>)}
              </select>
              {isCompOff && (
                <p className="text-[13px] text-slate-500 mt-1.5">
                  Available comp-off:{' '}
                  <span className="font-semibold text-slate-700">
                    {card ? `${r2(card.available || 0)} Day(s)` : '—'}
                  </span>
                  {card && (card.available || 0) <= 0 && (
                    <span className="text-amber-600"> — there are no credits to spend.</span>
                  )}
                </p>
              )}
            </div>

            {isPermission && (
              <div>
                <label className={label}>Apply with *</label>
                <div className="flex flex-col gap-2">
                  {[
                    ['total', 'Start time and total hours'],
                    ['range', 'Start time and end time'],
                  ].map(([v, text]) => (
                    <label key={v} className="flex items-center gap-2.5 text-[15px] text-slate-600">
                      <input type="radio" name="applyWith" value={v} checked={applyWith === v}
                        onChange={() => setApplyWith(v)} className="w-4 h-4" />
                      {text}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>{isPermission ? 'Date *' : 'From *'}</label>
                <input type="date" value={startDate} required className={field}
                  onChange={e => {
                    setStartDate(e.target.value);
                    if (isPermission || !endDate || endDate < e.target.value) setEndDate(e.target.value);
                  }} />
              </div>
              <div>
                <label className={label}>To *</label>
                <input type="date" value={endDate} required min={startDate} className={field}
                  disabled={isPermission}
                  onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>

            {/* ── A row per day, the way the reference shows it ────────── */}
            {startDate && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                {isPermission ? (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-[15px] text-slate-600 flex-1">
                      {formatDate(startDate, dateFormat)}
                    </span>
                    <TimeInput value={startTime} onChange={setStartTime}
                      className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400" />
                    {applyWith === 'range' ? (
                      <>
                        <span className="text-slate-400">–</span>
                        <TimeInput value={endTime} onChange={setEndTime} assumePm
                          className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400" />
                      </>
                    ) : (
                      <input type="number" min="0.25" step="0.25" value={totalHours}
                        onChange={e => setTotalHours(e.target.value)}
                        className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400" />
                    )}
                    <span className="text-[14px] text-slate-500 w-20 text-right">
                      {permHours > 0 ? `${permHours.toFixed(2)} Hr(s)` : '—'}
                    </span>
                  </div>
                ) : (
                  <>
                    {(breakdown?.days || []).map(d => (
                      <div key={d.date}
                        className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0
                          ${d.counts ? '' : 'bg-slate-50/70'}`}>
                        <span className="text-[15px] text-slate-600 flex-1">
                          {d.weekday} {formatDate(d.date, dateFormat)}
                        </span>
                        {d.counts ? (
                          singleDay ? (
                            <>
                              <select value={isHalfDay ? 'half' : 'full'} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px]"
                                onChange={e => setIsHalfDay(e.target.value === 'half')}>
                                <option value="full">Full Day</option>
                                <option value="half">Half Day</option>
                              </select>
                              <select value={halfDayType} disabled={!isHalfDay}
                                onChange={e => setHalfDayType(e.target.value)}
                                className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] disabled:bg-slate-50 disabled:text-slate-300">
                                <option value="first_half">1st Half</option>
                                <option value="second_half">2nd Half</option>
                              </select>
                            </>
                          ) : (
                            <span className="text-[14px] text-slate-500">Full Day</span>
                          )
                        ) : (
                          <span className="text-[14px] text-slate-400">
                            {d.label || (d.kind === 'weekend' ? 'Weekend' : 'Not a working day')}
                          </span>
                        )}
                      </div>
                    ))}
                    {!breakdown && (
                      <p className="px-4 py-3 text-[14px] text-slate-400">Working out those days…</p>
                    )}
                  </>
                )}

                <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-[14px] font-medium text-slate-600">Total</span>
                  <span className="text-[14px] font-semibold text-slate-800">
                    {isPermission
                      ? `${permHours.toFixed(2)} Hr(s)`
                      : `${isHalfDay ? 0.5 : (breakdown?.workingDays ?? 0)} Day(s)`}
                  </span>
                </div>
              </div>
            )}

            {!isPermission && startDate && !singleDay && (
              <p className="text-[13px] text-slate-400">{PORTION_NOTE}</p>
            )}

            {breakdown && breakdown.workingDays === 0 && !isPermission && (
              <p className="text-[13px] text-rose-600">
                Every day in that range is a weekend or a holiday, so there is nothing to book.
              </p>
            )}

            {isBackdated && (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This is a past date. It is recorded in the audit log under your name, and will be
                refused if that month's payroll is already finalised.
              </p>
            )}

            <div>
              <label className={label}>Reason for leave *</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                required rows={2} minLength={3} maxLength={500}
                className={`${field} resize-none`} placeholder="Why is this leave being taken?" />
            </div>
          </div>

          {/* ── What it costs ─────────────────────────────────────────── */}
          <div className="p-6 space-y-4 bg-slate-50/50">
            {!employeeId || !leaveType ? (
              <p className="text-[14px] text-slate-400">
                Pick an employee and a leave type to see their balance.
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-[13px] font-semibold text-slate-500">
                      As on {formatDate(startDate || todayStr, dateFormat)}
                    </span>
                    <span className="text-[12px] text-slate-400">{unit}</span>
                  </div>
                  <Row label="Available balance"
                    value={unlimited ? 'No limit' : r2(available)}
                    tone="text-emerald-600" />
                  <Row label="Current booking" value={r2(booking)} />
                  <div className="border-t border-slate-100 mt-2 pt-2">
                    <Row label="Balance after this booking"
                      value={unlimited ? 'No limit' : r2(available - booking)}
                      tone={!unlimited && available - booking < 0 ? 'text-rose-600' : 'text-blue-600'}
                      bold />
                  </div>
                </div>

                {!unlimited && available - booking < 0 && (
                  <p className="text-[13px] text-rose-600">
                    That is more than they have. The request will be refused.
                  </p>
                )}

                {isPermission && card?.monthlyLimit != null && (
                  <p className="text-[13px] text-slate-500">
                    Permission is capped at {card.monthlyLimit} hours a month and does not carry
                    forward.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !canSubmit}
            className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
            {saving ? 'Applying…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value, tone = 'text-slate-700', bold = false }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[14px] text-slate-500">{label}</span>
      <span className={`text-[15px] tabular-nums ${tone} ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
