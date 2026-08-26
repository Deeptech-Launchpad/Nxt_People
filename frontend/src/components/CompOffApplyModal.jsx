import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Send, X } from 'lucide-react';
import api from '../utils/api';

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
  expiryMonths = 3,
  currentUserId = null,
}) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [checking, setChecking] = useState(false);

  const forOthers = Array.isArray(people);

  useEffect(() => { if (open) { setForm(BLANK); setEligibility(null); } }, [open]);

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
  const them = form.employeeId ? 'they' : 'you';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/comp-off', form);
      const who = (people || []).find(p => p._id === form.employeeId);
      toast.success(who ? `Comp-off filed for ${who.firstName} ${who.lastName}` : 'Comp-off request submitted!');
      onClose();
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Apply for Comp-Off</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto">
          {forOthers && (
            <div>
              <label className={label}>Employee *</label>
              <select value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} className={field}>
                <option value="">Myself</option>
                {people.filter(p => p._id !== currentUserId).map(p => (
                  <option key={p._id} value={p._id}>
                    {p.employeeId ? `${p.employeeId} — ` : ''}{p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
              {form.employeeId && (
                <p className="text-[13px] text-amber-600 mt-1">
                  This grants them a paid day off. It is recorded against your name and still goes
                  to their own reporting line for approval.
                </p>
              )}
            </div>
          )}

          <div>
            <label className={label}>Worked Date (weekend / holiday) *</label>
            <input type="date" value={form.workedDate} required min={ymd(earliest)} max={ymd(today)} className={field}
              onChange={e => setForm({ ...form, workedDate: e.target.value })} />
            <p className="text-[13px] text-slate-400 mt-1">
              Must be a weekend or holiday {them} actually worked, within the last {monthsLabel}.
            </p>
          </div>

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

          <div>
            <label className={label}>Reason / Work Details *</label>
            <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={2}
              placeholder={form.employeeId ? 'What did they work on that day?' : 'What did you work on that day?'}
              className={`${field} resize-none`} />
          </div>

          <div>
            <label className={label}>Requested Comp-Off Date *</label>
            <input type="date" value={form.compOffDate} required min={ymd(tomorrow)} className={field}
              onChange={e => setForm({ ...form, compOffDate: e.target.value })} />
            <p className="text-[13px] text-slate-400 mt-1">A future working day, within {monthsLabel} of the worked date.</p>
          </div>

          <div>
            <label className={label}>Days to Claim *</label>
            <select value={form.daysEarned} onChange={e => setForm({ ...form, daysEarned: parseFloat(e.target.value) })} className={field}>
              <option value={0.5}>Half Day (0.5)</option>
              <option value={1}>Full Day (1)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || checking || (eligibility && !eligibility.eligible)}
              className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              <Send size={14} />{saving ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
