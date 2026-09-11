import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { ymd, weekStart, addDays, isToday, isWeekendDay, leaveChipText } from '../moreservices/shift/shiftGrid';
import { Avatar, DirectScopeNote, Spinner, Empty } from './teamShared';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── On Leave ─────────────────────────────────────────────────────────────
 *  A week at a glance: how many of the team are off each day, and who.
 *
 *  Weeks run Sunday-first and the leave chips are lettered by the same
 *  helpers the shift schedule grid uses, so the same day off reads the same
 *  way on both screens.
 *
 *  The count and the names come from ONE list — the server returns a row per
 *  person per day — rather than a count from one query and names from
 *  another, which is how a strip ends up saying "3" above two names.
 * ────────────────────────────────────────────────────────────────────────── */
export default function TeamOnLeave({ embedded = false }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [anchor]);
  const start = ymd(days[0]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/team/leave-week?start=${start}`)
      .then(r => { if (live) setRows(r.data.data || []); })
      .catch(err => {
        if (live) toast.error(err.response?.data?.message || 'Could not load the team leave week');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [start]);

  const byDay = useMemo(() => {
    const m = new Map(days.map(d => [ymd(d), []]));
    rows.forEach(r => {
      const key = String(r.date).slice(0, 10);
      if (m.has(key)) m.get(key).push(r);
    });
    return m;
  }, [rows, days]);

  const step = dir => setAnchor(a => addDays(a, dir * 7));
  const total = new Set(rows.map(r => r.employeeId)).size;

  return (
    <div className={embedded ? 'p-5' : 'p-6'}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} title="Previous week"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
          <button onClick={() => step(1)} title="Next week"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
          <span className="text-[14px] font-semibold text-slate-800 ml-1">
            {days[0].toLocaleDateString('en-GB')} – {days[6].toLocaleDateString('en-GB')}
          </span>
          <button onClick={() => setAnchor(new Date())}
            className="ml-2 text-[13px] font-medium text-blue-600 hover:text-blue-700">This week</button>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[13px] font-semibold text-slate-600">
            {total} {total === 1 ? 'person' : 'people'} off this week
          </p>
          <DirectScopeNote />
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
          {days.map(d => {
            const list = byDay.get(ymd(d)) || [];
            return (
              <div key={ymd(d)}
                className={`bg-white rounded-lg border shadow-sm overflow-hidden
                  ${isToday(d) ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
                <div className={`px-3 py-2 border-b flex items-center justify-between
                  ${isWeekendDay(d) ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div>
                    <p className="text-[12px] text-slate-500">{DAY_NAMES[d.getDay()]}</p>
                    <p className="text-[14px] font-bold text-slate-800">
                      {String(d.getDate()).padStart(2, '0')} {d.toLocaleDateString('en-GB', { month: 'short' })}
                    </p>
                  </div>
                  <span className={`text-[13px] font-bold px-2 py-0.5 rounded-full
                    ${list.length ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'}`}>
                    {list.length}
                  </span>
                </div>
                <div className="p-2.5 space-y-2 min-h-[72px]">
                  {list.length === 0 ? (
                    /* Says what is true — nobody booked off — rather than
                       showing a placeholder that could mean "not loaded". */
                    <p className="text-[12px] text-slate-400">
                      {isWeekendDay(d) ? 'Non-working day' : 'Everybody in'}
                    </p>
                  ) : list.map(p => (
                    <div key={`${p.employeeId}-${p.date}`} className="flex items-start gap-2">
                      <Avatar person={p} size={26} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-700 leading-tight truncate">
                          {p.firstName} {p.lastName}
                        </p>
                        <p className="text-[11px] text-violet-600 leading-tight truncate">
                          {leaveChipText({
                            leaveType: p.leaveType,
                            isHalfDay: p.isHalfDay,
                            halfDayType: p.halfDayType,
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <Empty icon={CalendarOff} title="Nobody on your team is off this week"
          sub="Move to another week with the arrows above." />
      )}
    </div>
  );
}
