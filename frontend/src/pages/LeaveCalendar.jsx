import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import api from '../utils/api';
import { useWeekendRules } from '../context/WeekendRulesContext';

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

/* Same wording Leave.jsx uses for the reference's own leave-type names.
 * Permission is deliberately absent from this map — it is not a day off,
 * it is hours within a day the person otherwise worked, and is handled as
 * its own event type below rather than folded in here. */
const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay',
};

/* "09:30:00" -> "09:30 AM". Permission's start/end come back as plain TIME
 * strings, not timestamps, so there is no date to route through a real
 * Date-timezone conversion — and none is needed, since a TIME column has no
 * timezone of its own to begin with. */
function fmtClock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export default function LeaveCalendar() {
  const [date, setDate] = useState(new Date());
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(false);
  // Pulls the org's weekend rules (e.g. "Sundays" + "1st & 3rd Saturdays")
  // so days that aren't actually weekends per policy still surface
  // Absent when missed. Falls back to Sun/Sat if the context is empty.
  const { isWeekend: isWeekendByRule } = useWeekendRules();

  const year = date.getFullYear();
  const month = date.getMonth();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfMonth = getFirstDayOfMonth(year, month);
  
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const prevMonth = () => setDate(new Date(year, month - 1, 1));
  const nextMonth = () => setDate(new Date(year, month + 1, 1));

  useEffect(() => {
    setLoading(true);

    Promise.all([
      api.get(`/attendance/my?month=${month}&year=${year}`).catch(() => ({ data: { data: [] } })),
      api.get(`/holidays?year=${year}`).catch(() => ({ data: { data: [] } })),
      /* This is a personal calendar — /leaves is the admin/manager list-all
       * endpoint, which a regular employee cannot even call (403, silently
       * swallowed by the catch below into an empty array) and which, for
       * someone who CAN call it, returns every employee's leave, not just
       * theirs. /leaves/my is what MyAttendance.jsx and every other
       * self-service page already uses, and it is the one that is actually
       * scoped to the person looking at the page. It takes `year`, not a
       * date range — the per-day loop below already restricts to the
       * visible month regardless. */
      api.get(`/leaves/my?year=${year}&status=approved&limit=500`).catch(() => ({ data: { data: [] } }))
    ]).then(([attRes, holRes, leaveRes]) => {
      const attData = attRes.data?.data || [];
      const holData = holRes.data?.data || [];
      const leaveData = leaveRes.data?.data || [];

      const newEvents = {};

      // 1. Process Holidays
      holData.forEach(h => {
        const hd = h.date?.split('T')[0];
        if (!hd) return;
        if (!newEvents[hd]) newEvents[hd] = [];
        newEvents[hd].push({ type: 'holiday', text: `${h.name} (Holiday)` });
      });

      // 2. Process Leaves
      leaveData.forEach(l => {
        /* Permission is hours within a day the person otherwise worked, not
         * a day off — Casual Leave and Permission on the same calendar cell
         * would read as the same kind of thing when they are not. It gets
         * its own event, carrying the actual time window, and it does NOT
         * take the day away from a 'present' entry the way a real leave
         * does — both are meant to sit on the cell together. */
        if (l.leaveType === 'permission') {
          const ds = (l.startDate || '').slice(0, 10);
          if (!ds || new Date(ds + 'T00:00:00').getMonth() !== month) return;
          if (!newEvents[ds]) newEvents[ds] = [];
          const range = l.startTime && l.endTime
            ? `${fmtClock(l.startTime)} – ${fmtClock(l.endTime)}`
            : (l.hours ? `${l.hours}h` : '');
          newEvents[ds].push({ type: 'permission', text: `Permission${range ? ` (${range})` : ''}` });
          return;
        }

        /* l.startDate is a DATE column serialized straight to JSON — a full
         * "2026-08-27T00:00:00.000Z" timestamp, not the bare "2026-08-27"
         * this used to assume. Appending "T00:00:00" to that produced
         * "...000ZT00:00:00", which `new Date()` cannot parse — Invalid
         * Date, silently. `Invalid Date <= Invalid Date` is false, so the
         * loop below never ran even once: every approved Casual Leave,
         * Leave Without Pay, and Compensatory Off request has been
         * rendering as a plain empty cell (and, once the fallback in
         * section 4 ran, as Absent) since this page was first built —
         * pre-dating the /leaves -> /leaves/my fix, which corrected WHERE
         * the data came from but not this. Slicing to the date portion
         * first is safe whichever shape the API hands back. */
        const start = new Date((l.startDate || '').slice(0, 10) + 'T00:00:00');
        const end = new Date((l.endDate || '').slice(0, 10) + 'T00:00:00');
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          if (d.getMonth() !== month || d.getFullYear() !== year) continue;
          const isWknd = typeof isWeekendByRule === 'function'
            ? isWeekendByRule(d)
            : (d.getDay() === 0 || d.getDay() === 6);
          if (isWknd) continue; // a multi-day leave doesn't consume weekend days
          const ds = d.toLocaleDateString('en-CA');
          if (!newEvents[ds]) newEvents[ds] = [];
          newEvents[ds].push({
            type: 'leave',
            text: LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType || 'Leave'
          });
        }
      });

      // 3. Process Attendance
      attData.forEach(a => {
        if (!a.date) return;
        const dObj = new Date(a.date);
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        const ad = `${y}-${m}-${d}`;
        if (!newEvents[ad]) newEvents[ad] = [];
        
        if (a.status === 'absent' && a.checkOut) {
          // A leave, a holiday, or a permission taken alongside otherwise
          // being present all mean the day is accounted for — none of them
          // should be able to sit next to an Absent pill on the same cell.
          if (!newEvents[ad].some(e => ['leave', 'holiday', 'permission'].includes(e.type))) {
            newEvents[ad].push({ type: 'absent', text: 'Absent' });
          }
        } else if (
          (a.status === 'present' || a.status === 'late' || a.status === 'half-day')
          // Only mark Present once the day is closed — same convention as
          // Dashboard. While the user is still on the clock (today,
          // checked in but no checkout yet) we leave the cell blank.
          && a.checkOut
        ) {
          let hrs = '';
          const hours = a.workingHours || a.totalHours;
          if (hours) {
            const h = Math.floor(hours);
            const m = Math.round((hours % 1) * 60);
            hrs = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} Hrs`;
          }
          newEvents[ad].push({ type: 'present', text: 'Present', hrs });
        }
      });

      // 4. Infer Absent for past working days with no attendance row.
      // The /attendance/my endpoint only returns rows where the employee
      // ACTUALLY checked in (or has an explicit status='absent' record),
      // so days where the user never showed up have no row at all and
      // were silently rendering as empty cells. Walk every past day in
      // the visible month, skip weekends / holidays / leaves / days that
      // already have a pill, and mark the remainder as Absent.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(year, month, d);
        if (day >= today) continue;                  // skip today + future
        const ds = day.toLocaleDateString('en-CA'); // YYYY-MM-DD
        const isWeekend = typeof isWeekendByRule === 'function'
          ? isWeekendByRule(day)
          : (day.getDay() === 0 || day.getDay() === 6);
        if (isWeekend) continue;
        const existing = newEvents[ds] || [];
        if (existing.some(e => ['holiday','leave','present','absent','permission'].includes(e.type))) continue;
        if (!newEvents[ds]) newEvents[ds] = [];
        newEvents[ds].push({ type: 'absent', text: 'Absent' });
      }

      setEvents(newEvents);
    }).finally(() => {
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, daysInMonth]);

  const currentDayHighlight = new Date().getMonth() === month && new Date().getFullYear() === year ? new Date().getDate() : null;

  return (
    <div className="bg-white min-h-[calc(100vh-120px)] border-t border-slate-200">
      {/* Header */}
      <div className="flex justify-center items-center py-4 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <button onClick={prevMonth} className="text-slate-400 hover:text-blue-600 transition-colors">
            <ChevronLeft size={16} strokeWidth={3} />
          </button>
          <CalendarIcon size={16} className="text-slate-400" />
          <button onClick={nextMonth} className="text-slate-400 hover:text-blue-600 transition-colors">
            <ChevronRight size={16} strokeWidth={3} />
          </button>
          <h2 className="text-[15px] font-bold text-slate-800 ml-2">
            {date.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h2>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex flex-col h-[800px] relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center">
            <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {/* Days Header */}
        <div className="grid grid-cols-7 border-b border-slate-200">
          {DAYS.map(day => (
            <div key={day} className="px-3 py-2 text-[14px] font-semibold text-slate-600 border-r border-slate-200 last:border-r-0">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div className="grid grid-cols-7 flex-1">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="border-r border-b border-slate-200 bg-white" />
          ))}
          
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dayDate = new Date(year, month, dayNum);
            const isWeekend = typeof isWeekendByRule === 'function'
              ? isWeekendByRule(dayDate)
              : (dayDate.getDay() === 0 || dayDate.getDay() === 6);
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const dayEvents = events[dateStr] || [];
            const isCurrentDay = dayNum === currentDayHighlight;

            return (
              <div
                key={dayNum}
                className={`border-r border-b border-slate-200 p-2 min-h-[120px] ${isWeekend ? 'bg-[#fffdf7]' : 'bg-white'}`}
              >
                <div className="flex items-center">
                  <span className={`text-[14px] font-semibold flex items-center justify-center w-6 h-6 rounded-full ${
                    isCurrentDay ? 'bg-blue-500 text-white' : 'text-slate-700'
                  }`}>
                    {dayNum}
                  </span>
                </div>

                <div className="mt-2 space-y-1">
                  {isWeekend && dayEvents.length === 0 && (
                    <div className="bg-slate-100 border border-slate-200 text-slate-400 text-[12px] font-semibold px-2 py-1 rounded">
                      Weekend
                    </div>
                  )}
                  {dayEvents.map((ev, idx) => (
                    <div key={idx}>
                      {ev.type === 'holiday' && (
                        <div className="bg-[#eef8ff] border border-[#bce0fd] text-[#1e3a8a] text-[12px] font-semibold px-2 py-1 rounded">
                          {ev.text}
                        </div>
                      )}
                      {ev.type === 'leave' && (
                        <div className="bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c] text-[12px] font-semibold px-2 py-1 rounded truncate">
                          {ev.text}
                        </div>
                      )}
                      {ev.type === 'permission' && (
                        <div className="bg-[#fff7ed] border border-[#fed7aa] text-[#c2410c] text-[12px] font-semibold px-2 py-1 rounded truncate">
                          {ev.text}
                        </div>
                      )}
                      {ev.type === 'absent' && (
                        <div className="bg-[#fef2f2] border border-[#fecaca] text-[#ef4444] text-[12px] font-semibold px-2 py-1 rounded">
                          {ev.text}
                        </div>
                      )}
                      {ev.type === 'present' && (
                        <div className="bg-[#eefdf5] border border-[#bbf7d0] text-[#166534] text-[12px] font-semibold px-2 py-1 rounded">
                          <p>{ev.text}</p>
                          {ev.hrs && <p className="text-[11px] font-medium opacity-80">{ev.hrs}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          
          {/* Fill remaining cells to complete the grid */}
          {Array.from({ length: 42 - (firstDayOfMonth + daysInMonth) }).map((_, i) => (
            <div key={`end-empty-${i}`} className="border-r border-b border-slate-200 bg-white" />
          ))}
        </div>
</div>
    </div>
  );
}
