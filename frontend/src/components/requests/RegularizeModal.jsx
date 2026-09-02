import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { DateField, TimeField, useFormat } from '../../utils/datetime';
import RequestShell, { Field, AttachmentField, inputClass } from './RequestShell';

/* Regularize Attendance, over the day you pressed.
 *
 * Period matches the reference — Day, Week, Month, Custom — and each one
 * expands into a row per working day, because our attendance_regularizations
 * is one row per date. A week therefore creates up to five requests, which the
 * summary line says out loud before you submit rather than after.
 *
 * The reason list, whether a reason is mandatory, and whether a document may
 * be attached all come from Settings -> Attendance -> Regularization. Those
 * switches existed and nothing read them.
 */

/* Zoho's defaults, offered only when Settings has no list of its own. A blank
 * dropdown would make the form unusable for everyone until an admin noticed,
 * which is a worse failure than a suggestion. */
const FALLBACK_REASONS = ['Forgot to check-in', 'Forgot to check-out', 'System Error'];

const iso = d => d.toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* The dates a period covers, anchored on the day that was clicked. Weekends are
 * kept: somebody who worked a Saturday is exactly who needs to regularize it. */
function datesFor(period, anchor, customFrom, customTo) {
  const a = new Date(anchor + 'T00:00:00');
  if (Number.isNaN(a.getTime())) return [];
  const out = [];
  if (period === 'day') return [anchor];
  if (period === 'week') {
    const start = addDays(a, -((a.getDay() + 6) % 7));       // Monday
    for (let i = 0; i < 7; i++) out.push(iso(addDays(start, i)));
    return out;
  }
  if (period === 'month') {
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(iso(d));
    return out;
  }
  // custom
  if (!customFrom || !customTo) return [];
  let d = new Date(customFrom + 'T00:00:00');
  const end = new Date(customTo + 'T00:00:00');
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || end < d) return [];
  // A guard, not a policy: an accidental year-long range would otherwise build
  // 365 rows in the browser and then 365 requests for an approver.
  let guard = 0;
  while (d <= end && guard++ < 62) { out.push(iso(d)); d = addDays(d, 1); }
  return out;
}

export default function RegularizeModal({ date, onClose, onDone }) {
  const fmt = useFormat();
  const [config, setConfig] = useState(null);
  const [period, setPeriod] = useState('day');
  const [anchor, setAnchor] = useState(date || iso(new Date()));
  const [customFrom, setCustomFrom] = useState(date || iso(new Date()));
  const [customTo, setCustomTo] = useState(date || iso(new Date()));
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState({});          // date -> {checkIn, checkOut, reason, description}
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/regularizations/config')
      .then(r => setConfig(r.data.data || {}))
      .catch(() => setConfig({}));
  }, []);

  const dates = useMemo(
    () => datesFor(period, anchor, customFrom, customTo),
    [period, anchor, customFrom, customTo]);

  const reasons = (config?.reasons || []).filter(Boolean);
  const usingFallback = reasons.length === 0;
  const reasonOptions = usingFallback ? FALLBACK_REASONS : reasons;
  const reasonMandatory = config?.reasonMandatory !== false;
  const showDocument = config?.fields?.document?.show !== false;
  const showDescription = config?.fields?.description?.show !== false;

  const row = d => rows[d] || { checkIn: '', checkOut: '', reason: '', description: '' };
  const setRow = (d, patch) => setRows(r => ({ ...r, [d]: { ...row(d), ...patch } }));

  /* Only rows somebody has actually filled in are sent. Submitting a whole
   * month would otherwise raise 30 blank requests. */
  const filled = dates.filter(d => row(d).checkIn || row(d).checkOut);

  const totalHours = (d) => {
    const { checkIn, checkOut } = row(d);
    if (!checkIn || !checkOut) return '';
    const [h1, m1] = checkIn.split(':').map(Number);
    const [h2, m2] = checkOut.split(':').map(Number);
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60;               // an overnight shift, not a mistake
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  };

  const submit = async () => {
    if (!filled.length) return toast.error('Enter a check-in or check-out on at least one day');
    if (reasonMandatory) {
      const missing = filled.find(d => !row(d).reason.trim());
      if (missing) return toast.error(`A reason is required for ${fmt.date(missing)}`);
    }
    setSaving(true);
    let ok = 0; const failed = [];
    for (const d of filled) {
      const r = row(d);
      try {
        if (file && showDocument) {
          const fd = new FormData();
          fd.append('date', d);
          if (r.checkIn) fd.append('checkIn', r.checkIn);
          if (r.checkOut) fd.append('checkOut', r.checkOut);
          fd.append('reason', [r.reason, r.description].filter(Boolean).join(' — '));
          fd.append('attachment', file);
          await api.post('/regularizations', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } else {
          await api.post('/regularizations', {
            date: d,
            checkIn: r.checkIn || undefined,
            checkOut: r.checkOut || undefined,
            reason: [r.reason, r.description].filter(Boolean).join(' — '),
          });
        }
        ok++;
      } catch (err) {
        failed.push(`${fmt.date(d)}: ${err.response?.data?.message || 'failed'}`);
      }
    }
    setSaving(false);
    if (ok) toast.success(ok === 1 ? 'Regularization submitted' : `${ok} regularizations submitted`);
    if (failed.length) toast.error(`${failed.length} could not be submitted — ${failed[0]}`, { duration: 6000 });
    if (ok) onDone();
  };

  return (
    <RequestShell title="Request Regularization" onClose={onClose} onSubmit={submit} submitting={saving} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <Field label="Period">
            <select className={inputClass} value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          {period === 'custom' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><DateField value={customFrom} onChange={setCustomFrom} /></Field>
              <Field label="To"><DateField value={customTo} onChange={setCustomTo} /></Field>
            </div>
          ) : (
            <Field label="Date">
              <DateField value={anchor} onChange={setAnchor} />
            </Field>
          )}
        </div>

        {showDocument && (
          <div className="max-w-2xl">
            <Field label="Attachment">
              <AttachmentField file={file}
                onChange={(f, err) => { if (err) toast.error(err); else setFile(f); }} />
            </Field>
          </div>
        )}

        <div className="border border-slate-200 rounded-xl overflow-auto">
          <table className="w-full text-[14px] min-w-[900px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium w-[110px]">Worked day</th>
                <th className="px-3 py-2.5 text-left font-medium w-[170px]">
                  Check-in {reasonMandatory && <span className="text-rose-500">*</span>}
                </th>
                <th className="px-3 py-2.5 text-left font-medium w-[170px]">Check-out</th>
                <th className="px-3 py-2.5 text-left font-medium w-[110px]">Total Hours</th>
                <th className="px-3 py-2.5 text-left font-medium w-[200px]">
                  Reason {reasonMandatory && <span className="text-rose-500">*</span>}
                </th>
                {showDescription && <th className="px-3 py-2.5 text-left font-medium">Description</th>}
              </tr>
            </thead>
            <tbody>
              {dates.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Pick a valid date range.
                </td></tr>
              )}
              {dates.map(d => {
                const dt = new Date(d + 'T00:00:00');
                const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                return (
                  <tr key={d} className={`border-t border-slate-100 ${weekend ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-slate-800">
                        {dt.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' })}
                      </span>{' '}
                      <span className="text-slate-400">
                        {dt.toLocaleDateString('en-GB', { weekday: 'short' })}
                      </span>
                    </td>
                    <td className="px-3 py-2"><TimeField value={row(d).checkIn} onChange={v => setRow(d, { checkIn: v })} /></td>
                    <td className="px-3 py-2"><TimeField value={row(d).checkOut} onChange={v => setRow(d, { checkOut: v })} /></td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{totalHours(d) || '—'}</td>
                    <td className="px-3 py-2">
                      <select className={inputClass} value={row(d).reason}
                        onChange={e => setRow(d, { reason: e.target.value })}>
                        <option value="">Select</option>
                        {reasonOptions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    {showDescription && (
                      <td className="px-3 py-2">
                        <input className={inputClass} placeholder="Description" value={row(d).description}
                          onChange={e => setRow(d, { description: e.target.value })} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {usingFallback && (
          /* Say where the list comes from, so an admin can make it theirs
           * instead of wondering why these three appeared. */
          <p className="text-[13px] text-slate-500">
            These reasons are defaults. Set your own in Settings → Attendance → Regularization.
          </p>
        )}

        {/* One row per date is what the table stores, so a week is several
         * requests. Better said here than discovered by an approver. */}
        {filled.length > 1 && (
          <p className="text-[13.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This will raise <strong>{filled.length} separate requests</strong>, one per day, each
            approved on its own.
          </p>
        )}
      </div>
    </RequestShell>
  );
}
