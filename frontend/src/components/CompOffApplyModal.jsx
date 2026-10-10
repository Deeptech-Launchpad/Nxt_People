import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import RequestShell, { Field, inputClass } from './requests/RequestShell';

/* ── Applying for a comp-off, through either door ───────────────────────────
 *  The personal Leave Tracker and Operations → Leave Tracker both raise this.
 *  The ONLY difference is the employee field: My Data has none and files for
 *  you, Operations puts a selector on top and files for anybody — which is
 *  exactly how Zoho separates them.
 *
 *  One component, because the two forms enforce the same rules and a fix
 *  applied to a copy is a fix that silently misses the other.
 *
 *  The attendance panel is Zoho's, and it is not decoration: an administrator
 *  filing for somebody else has no idea whether that person came in on a given
 *  Sunday. Without it they pick a date, submit, and are refused with nothing to
 *  go on. Every line in it maps to a refusal the server would give.
 * ────────────────────────────────────────────────────────────────────────── */
const BLANK = { workedDate: '', compOffDate: '', reason: '', daysEarned: 1, employeeId: '' };

export default function CompOffApplyModal({
  open, onClose, onDone,
  people = null,          // null → no employee field at all (the My Data door)
  employee = null,        // one person already on screen, shown rather than picked
  expiryMonths = 3,
  currentUserId = null,
}) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [checking, setChecking] = useState(false);

  const forOthers = Array.isArray(people) || (!!employee && String(employee._id) !== String(currentUserId));

  useEffect(() => {
    if (open) { setForm({ ...BLANK, employeeId: employee?._id || '' }); setEligibility(null); }
  }, [open, employee?._id]);

  // Asked as the date or the person changes, so the answer is on screen before
  // Submit is pressed rather than arriving as a refusal afterwards.
  useEffect(() => {
    if (!open || !form.workedDate) { setEligibility(null); return; }
    let live = true;
    setChecking(true);
    const params = { date: form.workedDate };
    if (form.employeeId) params.employeeId = form.employeeId;
    api.get('/comp-off/eligibility', { params })
      .then(r => { if (live) setEligibility(r.data.data); })
      .catch(() => { if (live) setEligibility(null); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [open, form.workedDate, form.employeeId]);

  if (!open) return null;

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const earliest = new Date(today.getFullYear(), today.getMonth() - expiryMonths, today.getDate());
  const ymd = (d) => d.toLocaleDateString('en-CA');
  const monthsLabel = `${expiryMonths} month${expiryMonths === 1 ? '' : 's'}`;
  const them = forOthers ? 'they' : 'you';

  const submit = async () => {
    if (forOthers && !employee && !form.employeeId) return toast.error('Choose an employee');
    if (!form.workedDate) return toast.error('Pick the worked date');
    if (checking) return toast.error('Still checking that day — wait a moment');
    if (eligibility && !eligibility.eligible) return toast.error('That day is not eligible for a comp-off claim');
    if (!form.reason.trim()) return toast.error('Reason is required');
    setSaving(true);
    try {
      await api.post('/comp-off', form);
      const who = (people || (forOthers ? [employee] : [])).find(p => p._id === form.employeeId);
      toast.success(who ? `Comp-off filed for ${who.firstName} ${who.lastName}` : 'Comp-off request submitted!');
      onClose();
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <RequestShell title="Apply for Comp-Off" onClose={onClose} onSubmit={submit}
      submitting={saving} submitLabel="Submit Request">
      <div className="space-y-4 max-w-2xl">
        {forOthers && employee && (
          <Field label="Employee">
            <p className="text-[14.5px] text-slate-800">
              {employee.employeeId ? `${employee.employeeId} — ` : ''}{employee.firstName} {employee.lastName}
            </p>
            <p className="text-[13px] text-amber-600 mt-1">
              This grants them a paid day off. It is recorded against your name and still goes
              to their own reporting line for approval.
            </p>
          </Field>
        )}

        {forOthers && !employee && (
          <Field label="Employee" required>
            {/* No "Myself" here. Reaching this form through Operations means
                filing for somebody else — that is the entire reason the door
                exists. An admin claiming their own comp-off uses the personal
                Leave Tracker, where there is no employee field at all. */}
            <select value={form.employeeId} required
              onChange={e => setForm({ ...form, employeeId: e.target.value })} className={inputClass}>
              <option value="">Select an employee</option>
              {people.filter(p => p._id !== currentUserId).map(p => (
                <option key={p._id} value={p._id}>
                  {p.employeeId ? `${p.employeeId} — ` : ''}{p.firstName} {p.lastName}
                </option>
              ))}
            </select>
            <p className="text-[13px] text-amber-600 mt-1">
              This grants them a paid day off. It is recorded against your name and still goes
              to their own reporting line for approval.
            </p>
          </Field>
        )}

        <Field label="Worked Date (weekend / holiday)" required
          hint={`Must be a weekend or holiday ${them} actually worked, within the last ${monthsLabel}.`}>
          <input type="date" value={form.workedDate} required min={ymd(earliest)} max={ymd(today)} className={inputClass}
            onChange={e => setForm({ ...form, workedDate: e.target.value })} />
        </Field>

        {form.workedDate && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            {checking ? (
              <p className="text-sm text-slate-400">Checking that day&hellip;</p>
            ) : !eligibility ? (
              <p className="text-sm text-slate-400">Could not read that day&rsquo;s attendance.</p>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Attendance on this day</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-400">First in</dt>
                  <dd className="text-slate-700 text-right">{eligibility.attendance?.firstIn || '—'}</dd>
                  <dt className="text-slate-400">Last out</dt>
                  <dd className="text-slate-700 text-right">{eligibility.attendance?.lastOut || '—'}</dd>
                  <dt className="text-slate-400">Total hours</dt>
                  <dd className="text-slate-700 text-right">
                    {eligibility.attendance?.hours != null ? `${Number(eligibility.attendance.hours).toFixed(2)}h` : '—'}
                  </dd>
                </dl>
                {!eligibility.eligible && (
                  <p className="text-sm text-rose-600 mt-2.5">
                    {eligibility.alreadyClaimed
                      ? 'Comp-off has already been claimed for this worked date.'
                      : !eligibility.isNonWorkingDay
                        ? 'That is a normal working day — comp-off is earned only on a weekend or holiday.'
                        : 'No check-in is recorded on that day, so this cannot be claimed.'}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <Field label="Reason / Work Details" required>
          <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={2}
            placeholder={forOthers ? 'What did they work on that day?' : 'What did you work on that day?'}
            className={`${inputClass} resize-none`} />
        </Field>

        {/* Optional, because claiming the credit and taking the day are two
            separate acts. Requiring it forced somebody to decide, on the
            Monday after a Sunday they worked, exactly which future day they
            would take — before they could possibly know. */}
        <Field label="Requested Comp-Off Date"
          hint={`Leave this blank to bank the credit and take the day later, by applying Compensatory Off leave. If you already know the day, it must be a future working day within ${monthsLabel} of the worked date.`}>
          <input type="date" value={form.compOffDate} min={ymd(tomorrow)} className={inputClass}
            onChange={e => setForm({ ...form, compOffDate: e.target.value })} />
        </Field>

        <Field label="Days to Claim" required>
          <select value={form.daysEarned} onChange={e => setForm({ ...form, daysEarned: parseFloat(e.target.value) })} className={inputClass}>
            <option value={0.5}>Half Day (0.5)</option>
            <option value={1}>Full Day (1)</option>
          </select>
        </Field>
      </div>
    </RequestShell>
  );
}
