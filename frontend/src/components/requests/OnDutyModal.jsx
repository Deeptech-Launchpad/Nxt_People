import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { DateField, TimeField, useFormat } from '../../utils/datetime';
import RequestShell, { Field, AttachmentField, inputClass } from './RequestShell';

/* Request On Duty, over the day you pressed.
 *
 * On Duty is work done away from the usual place — a client visit, or a day
 * worked from home. The day is payable and counts as worked; it draws on no
 * leave balance. One request covers a range, unlike regularization, because
 * on_duty_requests already stores a start and end date on a single row.
 *
 * The Add Request menu used to point this at the regularization page, so
 * choosing "Apply OnDuty" filed the wrong kind of request entirely.
 */
const iso = d => d.toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const TYPES = ['Client visit', 'Work from home'];
const DURATIONS = ['Full Day', 'Half Day', 'Quarter Day'];

/* employeeId raises the request FOR somebody else — see RegularizeModal. */
export default function OnDutyModal({ date, employeeId, onClose, onDone }) {
  const fmt = useFormat();
  const [config, setConfig] = useState(null);
  const [from, setFrom] = useState(date || iso(new Date()));
  const [to, setTo] = useState(date || iso(new Date()));
  const [unit, setUnit] = useState('days');
  const [type, setType] = useState(TYPES[0]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [file, setFile] = useState(null);
  const [durations, setDurations] = useState({});
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/on-duty/config').then(r => setConfig(r.data.data || {})).catch(() => setConfig({}));
  }, []);

  // Keep the range honest: an end before the start silently produced an empty
  // table that looked like the form was broken.
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

  const showDocument = config?.fields?.document?.show !== false;
  const descriptionMandatory = config?.fields?.description?.mandatory !== false;

  const submit = async () => {
    if (!days.length) return toast.error('Pick a valid date range');
    if (descriptionMandatory && !description.trim()) return toast.error('A description is required');
    if (unit === 'hours' && (!startTime || !endTime)) {
      return toast.error('Enter a start and end time for an hours request');
    }
    setSaving(true);
    try {
      const payload = {
        startDate: from, endDate: to, unit,
        requestType: type,
        reason: description.trim(),
        ...(unit === 'hours' ? { startTime, endTime } : {}),
        ...(employeeId ? { employeeId } : {}),
      };
      if (file && showDocument) {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        fd.append('attachment', file);
        await api.post('/on-duty', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/on-duty', payload);
      }
      toast.success('On Duty request submitted');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit that request');
    } finally { setSaving(false); }
  };

  return (
    <RequestShell title="Request On Duty" onClose={onClose} onSubmit={submit} submitting={saving}>
      <div className="space-y-4 max-w-2xl">
        <Field label="Period">
          <div className="grid grid-cols-2 gap-3">
            <DateField value={from} onChange={setFrom} />
            <DateField value={to} onChange={setTo} min={from} />
          </div>
        </Field>

        <Field label="Units">
          <select className={inputClass} value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="days">Days</option>
            <option value="hours">Hours</option>
          </select>
        </Field>

        {/* Hours needs a window; days does not. Showing the time inputs always
            would ask for something that is ignored. */}
        {unit === 'hours' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required><TimeField value={startTime} onChange={setStartTime} /></Field>
            <Field label="To" required><TimeField value={endTime} onChange={setEndTime} /></Field>
          </div>
        )}

        <Field label="Type">
          <select className={inputClass} value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        {showDocument && (
          <Field label="Attachment">
            <AttachmentField file={file}
              onChange={(f, err) => { if (err) toast.error(err); else setFile(f); }} />
          </Field>
        )}

        {unit === 'days' && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Day</th>
                  <th className="px-3 py-2.5 text-left font-medium w-[190px]">
                    Duration <span className="text-rose-500">*</span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium w-[140px]">Session</th>
                </tr>
              </thead>
              <tbody>
                {days.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Pick a valid range.</td></tr>
                )}
                {days.map(d => {
                  const dt = new Date(d + 'T00:00:00');
                  const value = durations[d] || 'Full Day';
                  return (
                    <tr key={d} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-slate-800">
                          {dt.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' })}
                        </span>{' '}
                        <span className="text-slate-400">
                          {dt.toLocaleDateString('en-GB', { weekday: 'short' })}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <select className={inputClass} value={value}
                          onChange={e => setDurations(x => ({ ...x, [d]: e.target.value }))}>
                          {DURATIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {value === 'Full Day' ? '—' : 'First half'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Per-day duration is collected because the reference collects it, but
         * on_duty_requests stores one row for the whole range with a single
         * unit — so a mixed set of durations has nowhere to go. Said plainly
         * rather than silently dropped. */}
        {unit === 'days' && days.length > 1 &&
          new Set(days.map(d => durations[d] || 'Full Day')).size > 1 && (
          <p className="text-[13.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Different durations across days are not stored separately yet — the request is filed for
            the whole range. Raise one request per day if they really differ.
          </p>
        )}

        <Field label="Description" required={descriptionMandatory}>
          <textarea className={`${inputClass} h-24 resize-none`} value={description}
            placeholder="Where you are working and why"
            onChange={e => setDescription(e.target.value)} />
        </Field>
      </div>
    </RequestShell>
  );
}
