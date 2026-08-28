import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, X, RotateCcw, AlertTriangle, CalendarDays } from 'lucide-react';
import api from '../../../utils/api';
import toast from 'react-hot-toast';

/* ── The day board ──────────────────────────────────────────────────────────
 *  One row per person per shift. Two shifts in a day means two rows for the
 *  same person, which is why the shift name is on the row rather than the
 *  person being the row.
 *
 *  Three states, and the third one is the point. Present and Absent are things
 *  HR asserted. No mark at all means nobody has looked yet — it is shown as
 *  "Presumed present" because that is how the report will count it, but
 *  nothing is stored until somebody clicks. Clearing a mark returns the row to
 *  that state rather than setting it to absent.
 * ────────────────────────────────────────────────────────────────────────── */

const today = () => new Date().toISOString().slice(0, 10);

const shiftDate = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
};

const pretty = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

const hhmm = (t) => String(t || '').slice(0, 5);

export default function MarkDay() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback((d) => {
    setLoading(true);
    api.get(`/manual-attendance/day?date=${d}`)
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the day'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const mark = async (row, state) => {
    const key = `${row.employeeId}|${row.shiftId}`;
    setBusy(key);
    try {
      const { data: res } = await api.post('/manual-attendance/mark', {
        employeeId: row.employeeId, shiftId: row.shiftId, date, state,
      });
      toast.success(res.message || 'Saved');
      load(date);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save');
    } finally { setBusy(''); }
  };

  const markAll = async () => {
    setBusy('all');
    try {
      const { data: res } = await api.post('/manual-attendance/mark-all', { date });
      toast.success(res.message);
      load(date);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save');
    } finally { setBusy(''); }
  };

  const future = date > today();
  const rows = data?.rows || [];
  const unmarked = data?.unmarkedScheduled || 0;

  return (
    <div className="space-y-4">
      {/* Date navigator. Yesterday is one click away because that is when most
          marking actually happens. */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <button
          onClick={() => setDate(shiftDate(date, -1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
          title="Previous day"
        ><ChevronLeft size={18} /></button>

        <div className="flex items-center gap-2 min-w-[260px]">
          <CalendarDays size={16} className="text-slate-400" />
          <span className="text-[15px] font-semibold text-slate-800">{pretty(date)}</span>
        </div>

        <button
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= today()}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
          title="Next day"
        ><ChevronRight size={18} /></button>

        <input
          type="date" value={date} max={today()}
          onChange={e => e.target.value && setDate(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400"
        />

        {date !== today() && (
          <button onClick={() => setDate(today())}
            className="text-[13px] text-brand-600 hover:underline font-medium">Today</button>
        )}

        <div className="flex-1" />

        {data?.isHoliday && (
          <span className="text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            Company holiday
          </span>
        )}

        <button
          onClick={markAll}
          disabled={!unmarked || busy === 'all' || future}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-200 disabled:text-slate-400 text-white px-3.5 py-2 rounded-lg text-[14px] font-medium transition-colors"
        >
          <Check size={15} /> Mark all present{unmarked ? ` (${unmarked})` : ''}
        </button>
      </div>

      {/* The unconfirmed warning belongs here, not only in the export. By the
          time somebody reads the export the month is over. */}
      {!loading && unmarked > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={17} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[13.5px] text-amber-900">
            <strong>{unmarked}</strong> scheduled {unmarked === 1 ? 'shift has' : 'shifts have'} not been marked
            for this day. {unmarked === 1 ? 'It' : 'They'} will count as present in reports, and be listed
            as unconfirmed.
          </p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5">Employee</th>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5">Shift</th>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5">Status</th>
                <th className="text-left font-medium text-slate-600 px-5 py-2.5 w-[230px]">Mark</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>
              )}

              {!loading && !rows.length && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                  Nobody is set up for attendance marking yet. Add staff and shifts on the next tab.
                </td></tr>
              )}

              {!loading && rows.map(r => {
                const key = `${r.employeeId}|${r.shiftId}`;
                const rowBusy = busy === key || busy === 'all';
                return (
                  <tr key={key} className="border-t border-slate-100">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-800">{r.name}</div>
                      <div className="text-[12px] text-slate-400">{r.code}{r.designation ? ` · ${r.designation}` : ''}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-slate-700">{r.shiftName}</div>
                      <div className="text-[12px] text-slate-400">
                        {hhmm(r.startTime)}–{hhmm(r.endTime)} · {r.spanHours}h
                        {r.payMode === 'actual' ? ' · hours' : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {!r.scheduled ? (
                        <span className="text-[12.5px] text-slate-400">Not scheduled</span>
                      ) : r.state === 'present' ? (
                        <span className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 rounded px-2 py-1">Present</span>
                      ) : r.state === 'absent' ? (
                        <span className="text-[12px] font-semibold text-red-700 bg-red-50 rounded px-2 py-1">Absent</span>
                      ) : (
                        <span className="text-[12px] font-semibold text-amber-700 bg-amber-50 rounded px-2 py-1">Presumed present</span>
                      )}
                      {r.markedBy && (
                        <div className="text-[11.5px] text-slate-400 mt-1">
                          by {r.markedBy}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {!r.scheduled || future ? (
                        <span className="text-[12.5px] text-slate-300">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => mark(r, 'present')}
                            disabled={rowBusy || r.state === 'present'}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                              r.state === 'present'
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
                            } disabled:opacity-60`}
                          ><Check size={14} /> Present</button>

                          <button
                            onClick={() => mark(r, 'absent')}
                            disabled={rowBusy || r.state === 'absent'}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                              r.state === 'absent'
                                ? 'bg-red-600 border-red-600 text-white'
                                : 'border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-700'
                            } disabled:opacity-60`}
                          ><X size={14} /> Absent</button>

                          {r.state && (
                            <button
                              onClick={() => mark(r, 'clear')}
                              disabled={rowBusy}
                              title="Clear this mark — the day goes back to unmarked, not to absent"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                            ><RotateCcw size={14} /></button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
