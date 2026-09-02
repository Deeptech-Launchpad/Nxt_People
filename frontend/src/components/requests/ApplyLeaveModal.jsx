import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search } from 'lucide-react';
import api from '../../utils/api';
import { DateField, TimeField, useFormat } from '../../utils/datetime';
import RequestShell, { Field, inputClass } from './RequestShell';

/* Apply Leave, over the day you pressed.
 *
 * The reference shows the remaining balance the moment a type is chosen —
 * "Available Leave 0 Day(s)" — which is the one number that decides whether to
 * carry on. Ours made you file the request and find out from the rejection.
 *
 * Compensatory Off swaps in "Compensated with", the list of worked days that
 * earned the day off. When there are none it says so rather than presenting an
 * empty picker.
 *
 * `mode` picks which door this opened from: 'leave' offers every type,
 * 'compoff' opens straight on Compensatory Off, matching the two separate
 * entries in the Add Request menu.
 */
const iso = d => d.toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const DURATIONS = ['Full Day', 'First Half', 'Second Half'];

export default function ApplyLeaveModal({ date, mode = 'leave', onClose, onDone }) {
  const fmt = useFormat();
  const [types, setTypes] = useState([]);
  const [typeQuery, setTypeQuery] = useState('');
  const [type, setType] = useState('');
  const [balances, setBalances] = useState(null);
  const [from, setFrom] = useState(date || iso(new Date()));
  const [to, setTo] = useState(date || iso(new Date()));
  const [teamEmail, setTeamEmail] = useState('');
  const [reason, setReason] = useState('');
  const [durations, setDurations] = useState({});
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [compDays, setCompDays] = useState(null);   // null = not loaded
  const [compWith, setCompWith] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/leave-types').then(r => {
      const list = r.data.data || [];
      setTypes(list);
      if (mode === 'compoff') {
        const c = list.find(t => /comp/i.test(t.code) || /compensat/i.test(t.name));
        if (c) setType(c.code);
      }
    }).catch(() => {});
    api.get('/leaves/balance').then(r => setBalances(r.data.data || null)).catch(() => {});
  }, [mode]);

  const isCompOff = useMemo(
    () => /comp/i.test(type) || /comp/i.test(types.find(t => t.code === type)?.name || ''),
    [type, types]);
  const isPermission = /permission/i.test(type);

  useEffect(() => {
    if (!isCompOff) { setCompDays(null); return; }
    /* The credits that can actually be spent: approved, not expired, and with
     * days left on them. /comp-off/my already computes `expired` and carries
     * daysEarned/daysUsed, so the filter lives here rather than in a new
     * endpoint that would duplicate the same rule. */
    api.get('/comp-off/my')
      .then(r => setCompDays((r.data.data || []).filter(
        c => c.status === 'approved' && !c.expired &&
             (parseFloat(c.daysEarned) - parseFloat(c.daysUsed)) > 0)))
      .catch(() => setCompDays([]));
  }, [isCompOff]);

  useEffect(() => { if (to < from) setTo(from); }, [from]);

  const days = useMemo(() => {
    const out = [];
    let d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || end < d) return out;
    let guard = 0;
    while (d <= end && guard++ < 62) { out.push(iso(d)); d = addDays(d, 1); }
    return out;
  }, [from, to]);

  /* Half days count as half. Stated here because the total is what somebody
   * checks against their balance before submitting. */
  const totalDays = days.reduce(
    (n, d) => n + ((durations[d] || 'Full Day') === 'Full Day' ? 1 : 0.5), 0);

  const shownTypes = types.filter(t =>
    !typeQuery.trim() || t.name.toLowerCase().includes(typeQuery.trim().toLowerCase()));

  const available = useMemo(() => {
    if (!type || !balances) return null;
    const row = (Array.isArray(balances) ? balances : balances.balances || [])
      .find(b => b.code === type || b.leaveType === type || b.type === type);
    if (!row) return null;
    return row.available ?? row.remaining ?? row.balance ?? null;
  }, [type, balances]);

  const submit = async () => {
    if (!type) return toast.error('Choose a leave type');
    if (!days.length) return toast.error('Pick a valid date range');
    if (isPermission && (!startTime || !endTime)) {
      return toast.error('Permission needs a start and end time');
    }
    if (isCompOff && compDays?.length && !compWith) {
      return toast.error('Choose the worked day this is compensated with');
    }
    setSaving(true);
    try {
      const half = days.length === 1 && (durations[days[0]] || 'Full Day') !== 'Full Day';
      await api.post('/leaves', {
        leaveType: type,
        startDate: from,
        endDate: to,
        reason: reason.trim(),
        teamEmail: teamEmail.trim() || undefined,
        isHalfDay: half,
        halfDayType: half
          ? ((durations[days[0]] === 'First Half') ? 'first_half' : 'second_half')
          : null,
        ...(isPermission ? { startTime, endTime } : {}),
        ...(isCompOff && compWith ? { compensatedWith: compWith } : {}),
      });
      toast.success('Leave applied');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not apply that leave');
    } finally { setSaving(false); }
  };

  return (
    <RequestShell
      title={mode === 'compoff' ? 'Apply Compensatory Off' : 'Apply Leave'}
      onClose={onClose} onSubmit={submit} submitting={saving}>
      <div className="space-y-4 max-w-2xl">
        <Field label="Leave type" required>
          {/* The reference puts a search inside the dropdown; with a handful of
              types it only earns its place once the list grows, so it appears
              above the select rather than inside it. */}
          {types.length > 6 && (
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputClass} pl-8`} placeholder="Search"
                value={typeQuery} onChange={e => setTypeQuery(e.target.value)} />
            </div>
          )}
          <select className={inputClass} value={type} onChange={e => setType(e.target.value)}
            disabled={mode === 'compoff'}>
            <option value="">Select</option>
            {shownTypes.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
          {type && (
            <p className="text-[14px] text-slate-600 mt-1.5">
              Available Leave{' '}
              <span className="text-brand-600 font-medium">
                {available === null ? '—' : `${available} Day(s)`}
              </span>
            </p>
          )}
        </Field>

        <Field label="Date" required>
          <div className="grid grid-cols-2 gap-3">
            <DateField value={from} onChange={setFrom} />
            <DateField value={to} onChange={setTo} min={from} />
          </div>
        </Field>

        {isPermission && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required><TimeField value={startTime} onChange={setStartTime} /></Field>
            <Field label="To" required><TimeField value={endTime} onChange={setEndTime} /></Field>
          </div>
        )}

        {isCompOff && (
          <Field label="Compensated with" required>
            {compDays === null ? (
              <p className="text-[14px] text-slate-400">Loading…</p>
            ) : compDays.length === 0 ? (
              /* The reference's exact wording, because it is the right message:
                 there is nothing to pick, and saying so beats an empty select. */
              <p className="text-[14px] text-slate-600 border border-slate-200 rounded-lg px-3 py-2.5">
                There are no valid compensatory work days to list here
              </p>
            ) : (
              <select className={inputClass} value={compWith} onChange={e => setCompWith(e.target.value)}>
                <option value="">Select</option>
                {compDays.map(c => (
                  <option key={c._id} value={c._id}>
                    {fmt.date(c.workedDate)} · {(parseFloat(c.daysEarned) - parseFloat(c.daysUsed))} day(s) left
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {!isPermission && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-[14px]">
              <tbody>
                {days.map(d => {
                  const dt = new Date(d + 'T00:00:00');
                  return (
                    <tr key={d} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-800 whitespace-nowrap">
                        {dt.toLocaleDateString('en-GB', { weekday: 'short' })} {fmt.date(d)}
                      </td>
                      <td className="px-3 py-2 w-[180px]">
                        <select className={inputClass} value={durations[d] || 'Full Day'}
                          disabled={days.length > 1}
                          title={days.length > 1 ? 'Half days apply to a single-day request' : undefined}
                          onChange={e => setDurations(x => ({ ...x, [d]: e.target.value }))}>
                          {DURATIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-slate-400 w-[120px]">—</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-700">Total</td>
                  <td className="px-3 py-2.5 text-right font-medium text-slate-800" colSpan={2}>
                    {totalDays} Day(s)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <Field label="Team Email ID"
          hint="Copied on the notification, so your team knows you are away.">
          <input className={inputClass} value={teamEmail} onChange={e => setTeamEmail(e.target.value)} />
        </Field>

        <Field label="Reason for leave">
          <textarea className={`${inputClass} h-24 resize-none`} value={reason}
            onChange={e => setReason(e.target.value)} />
        </Field>

        {available !== null && totalDays > available && !isPermission && (
          <p className="text-[13.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This is {totalDays} day(s) against a balance of {available}. It may be refused or fall to
            unpaid leave.
          </p>
        )}
      </div>
    </RequestShell>
  );
}
