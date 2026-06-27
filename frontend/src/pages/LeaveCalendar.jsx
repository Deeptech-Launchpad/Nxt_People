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

export default function LeaveCalendar() {
  const [date, setDate] = useState(new Date(2026, 4, 1)); // Default May 2026 or new Date()
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
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth}`;

    Promise.all([
      api.get(`/attendance/my?month=${month}&year=${year}`).catch(() => ({ data: { data: [] } })),
      api.get(`/holidays?year=${year}`).catch(() => ({ data: { data: [] } })),
      api.get(`/leaves?startDate=${startDate}&endDate=${endDate}&status=approved&limit=500`).catch(() => ({ data: { data: [] } }))
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
        const start = new Date(l.startDate + 'T00:00:00');
        const end = new Date(l.endDate + 'T00:00:00');
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          if (d.getMonth() !== month || d.getFullYear() !== year) continue;
          const ds = d.toLocaleDateString('en-CA');
          if (!newEvents[ds]) newEvents[ds] = [];
          newEvents[ds].push({ 
            type: 'leave', 
            text: `${l.employee?.firstName || 'User'} - ${l.leaveType || 'Leave'}`
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
        
        if (a.status === 'absent') {
          // If a leave or holiday already exists for this date, don't show absent
          if (!newEvents[ad].some(e => e.type === 'leave' || e.type === 'holiday')) {
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
        if (existing.some(e => ['holiday','leave','present','absent'].includes(e.type))) continue;
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
      <div className="flex flex-col h-[800px]">
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
            const isWeekend = (firstDayOfMonth + i) % 7 === 0 || (firstDayOfMonth + i) % 7 === 6;
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
                  {dayEvents.map((ev, idx) => (
                    <div key={idx}>
                      {ev.type === 'holiday' && (
                        <div className="bg-[#eef8ff] border border-[#bce0fd] text-[#1e3a8a] text-[12px] font-semibold px-2 py-1 rounded">
                          {ev.text}
                        </div>
                      )}
                      {ev.type === 'leave' && (
                        <div className="bg-[#fff1f2] border border-[#fecdd3] text-[#be123c] text-[12px] font-semibold px-2 py-1 rounded truncate">
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
