import React, { useCallback, useEffect, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';
import toast from 'react-hot-toast';

/* ── The month, read back ───────────────────────────────────────────────────
 *  Confirmed and presumed are always shown apart. A single "present" figure
 *  would hide the one thing HR needs at month end: how many of those days
 *  nobody actually looked at.
 *
 *  The presumption is applied here on read. Nothing in the database says a
 *  presumed day was present, so the policy can change without a migration and
 *  the marks keep saying what really happened.
 *
 *  PAYROLL-DECISION: whether presumed days are payable has not been decided.
 *  That is why this screen refuses to add the two together for you.
 * ────────────────────────────────────────────────────────────────────────── */

const monthStart = () => new Date().toISOString().slice(0, 8) + '01';
const today = () => new Date().toISOString().slice(0, 10);

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function MarkSummary() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/manual-attendance/summary?from=${from}&to=${to}`)
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the summary'))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  /* Built in the browser from what is already on screen, so the file always
   * matches what was read. The unconfirmed dates are spelled out rather than
   * counted, because "which days" is the question that follows the number. */
  const download = () => {
    if (!data?.rows?.length) return;
    const head = ['Employee ID', 'Name', 'Designation', 'Scheduled days',
      'Confirmed present', 'Presumed present', 'Total present', 'Absent',
      'Hours', 'Unconfirmed dates'];
    const lines = [head.join(',')];
    for (const r of data.rows) {
      lines.push([
        r.code, r.name, r.designation || '', r.scheduled,
        r.confirmedPresent, r.presumedPresent, r.totalPresent, r.absent,
        r.hours, (r.unconfirmedDates || []).join(' '),
      ].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-marking-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
        <span className="text-slate-400 text-[13px]">to</span>
        <input type="date" value={to} max={today()} onChange={e => e.target.value && setTo(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
        <div className="flex-1" />
        <button
          onClick={download}
          disabled={!data?.rows?.length}
          className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-300 disabled:opacity-40 text-slate-700 px-3.5 py-2 rounded-lg text-[14px] font-medium transition-colors"
        ><Download size={15} /> Export CSV</button>
      </div>

      {t && t.presumedPresent > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={17} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[13.5px] text-amber-900">
            <strong>{t.presumedPresent}</strong> of the {t.confirmedPresent + t.presumedPresent} present
            {' '}{t.confirmedPresent + t.presumedPresent === 1 ? 'day' : 'days'} in this range
            {' '}{t.presumedPresent === 1 ? 'was' : 'were'} never marked by anybody. They are counted as
            present, and the dates are listed against each person below.
          </p>
        </div>
      )}

      {t && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['People', t.people, ''],
            ['Scheduled', t.scheduled, ''],
            ['Confirmed', t.confirmedPresent, 'text-emerald-700'],
            ['Presumed', t.presumedPresent, 'text-amber-700'],
            ['Absent', t.absent, 'text-red-700'],
            ['Hours', t.hours, ''],
          ].map(([label, value, tone]) => (
            <div key={label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[11.5px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
              <div className={`text-[22px] font-semibold tabular-nums ${tone || 'text-slate-800'}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5">Employee</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2.5">Scheduled</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2.5">Confirmed</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2.5">Presumed</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2.5">Absent</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2.5">Hours</th>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5">Unconfirmed dates</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>}
              {!loading && !data?.rows?.length && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  Nothing in this range.
                </td></tr>
              )}
              {!loading && (data?.rows || []).map(r => (
                <tr key={r.employeeId} className="border-t border-slate-100">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <div className="text-[12px] text-slate-400">
                      {r.code}
                      {(r.shifts || []).length > 1 ? ` · ${r.shifts.length} shifts` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-slate-600">{r.scheduled}</td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-medium text-emerald-700">{r.confirmedPresent}</td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-medium text-amber-700">{r.presumedPresent}</td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-medium text-red-700">{r.absent}</td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-slate-700">{r.hours}</td>
                  <td className="px-5 py-3.5 text-[12px] text-slate-500 max-w-[280px]">
                    {(r.unconfirmedDates || []).length
                      ? r.unconfirmedDates.map(d => d.slice(8) + '/' + d.slice(5, 7)).join(', ')
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
