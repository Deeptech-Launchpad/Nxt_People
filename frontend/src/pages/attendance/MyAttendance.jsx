import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Grid3X3, List, Calendar,
  ChevronDown, Filter, MoreHorizontal, RotateCcw, Minus,
  LogIn, LogOut, Download, Eye
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useAttendance } from '../../context/AttendanceContext';
import { useWeekendRules } from '../../context/WeekendRulesContext';
import toast from 'react-hot-toast';

/* ── helpers ────────────────────────────────────────────────────────── */

function parseLocalDate(s) {
  if (!s) return null;
  if (typeof s !== 'string' || s.includes('T')) return new Date(s);
  return new Date(s + 'T00:00:00');
}

function fmtTime(d) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtHHMM(hours) {
  if (!hours) return '00:00';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function isoDate(d) { return d.toLocaleDateString('en-CA'); }

/* Get week start (Sunday) — matches Zoho's calendar layout. */
function weekOf(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/* Build 7 days for a given week start */
function buildWeek(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/* Timeline: converts a time string "HH:MM" or timestamp to minute offset from shiftStart */
function timeToMinutes(t) {
  if (!t) return null;
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/* ── Status pill ─────────────────────────────────────────────────────── */
const StatusPill = ({ status }) => {
  const MAP = {
    present:   { label: 'Present',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    late:      { label: 'Late',       cls: 'bg-amber-100 text-amber-700 border-amber-200'       },
    absent:    { label: 'Absent',     cls: 'bg-red-100 text-red-600 border-red-200'             },
    'half-day':{ label: 'Half Day',   cls: 'bg-blue-100 text-blue-600 border-blue-200'          },
    leave:     { label: 'On Leave',   cls: 'bg-purple-100 text-purple-600 border-purple-200'    },
    holiday:   { label: 'Holiday',    cls: 'bg-cyan-100 text-cyan-600 border-cyan-200'          },
    weekend:   { label: 'Weekend',    cls: 'bg-slate-100 text-slate-500 border-slate-200'       },
  };
  const s = MAP[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  return (
    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
      {s.label}
    </span>
  );
};

/* ── Add Request Dropdown Menu ────────────────────────────────────────── */
// Same positioning model as the Dashboard variant — caller hands in the
// button's bounding rect, the menu measures its own real height in a
// useLayoutEffect and flips above when there isn't room below.
const RequestMenu = ({ buttonRect, onClose, canRegularize = false }) => {
  const navigate = useNavigate();
  const menuRef  = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999, ready: false });

  const options = [
    canRegularize && { label: 'Regularize Attendance', path: '/attendance/regularization', icon: '✏️' },
    { label: 'Apply OnDuty',           path: '/attendance/regularization', icon: '📍' },
    { label: 'Apply Leave',            path: '/leave-tracker/requests',    icon: '📅' },
    { label: 'Apply Compensatory Off', path: '/leave-tracker/comp-off',    icon: '🔁' },
  ].filter(Boolean);

  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !buttonRect) return;
    const menuH = el.offsetHeight;
    const menuW = el.offsetWidth;
    const GUTTER = 16;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const openAbove = spaceBelow < menuH + GUTTER && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(GUTTER, buttonRect.top - menuH - 6)
      : Math.min(window.innerHeight - menuH - GUTTER, buttonRect.bottom + 6);
    const left = Math.max(
      GUTTER,
      Math.min(buttonRect.right - menuW, window.innerWidth - menuW - GUTTER)
    );
    setPos({ left, top, ready: true });
  }, [buttonRect]);

  return (
    <div
      ref={menuRef}
      className="request-menu-popup fixed z-50 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.12)] border border-slate-100 w-56 overflow-hidden"
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 bg-slate-50/60">
        <span className="text-[12px] font-bold uppercase tracking-wider text-slate-400">Add Request</span>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="py-1.5">
        {options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => { navigate(opt.path); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 transition-colors text-left group"
          >
            <span className="text-base bg-slate-50 group-hover:bg-blue-100/50 w-7 h-7 flex items-center justify-center rounded-lg border border-slate-100 group-hover:border-blue-200 transition-colors">
              {opt.icon}
            </span>
            <span className="text-[15px] font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ── Timeline bar for one row ───────────────────────────────────────── */
const SHIFT_START = 8 * 60;   // 08:00 → leftmost tick
const SHIFT_END   = 20 * 60;  // 20:00 → rightmost tick
const TICK_HOURS  = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function TimelineBar({ record, isToday, isCheckedIn }) {
  const total = SHIFT_END - SHIFT_START;
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const nowPct = Math.max(0, Math.min(100, ((nowMins - SHIFT_START) / total) * 100));
  const showNowLine = isToday;

  const sessions = record?.sessions;
  const hasMultiSession = sessions && sessions.length > 1;

  // Row with no check-in yet — only show baseline dots and (if today) the now-line.
  if (!record?.checkIn && !hasMultiSession) {
    return (
      <div className="flex-1 flex items-center relative h-12">
        <div className="absolute left-[3%] right-[3%] h-[1px] border-t border-dashed border-slate-200" style={{ top: '50%' }} />
        <div className="absolute left-[3%] w-2 h-2 rounded-full border-2 border-slate-300 bg-white" style={{ top: '50%', transform: 'translate(-50%,-50%)' }} />
        <div className="absolute right-[3%] w-2 h-2 rounded-full border-2 border-slate-300 bg-white" style={{ top: '50%', transform: 'translate(50%,-50%)' }} />
        {showNowLine && (
          <div className="absolute top-0 bottom-0 border-l border-dashed border-blue-400 z-20" style={{ left: `${nowPct}%` }} />
        )}
      </div>
    );
  }

  const color = record?.status === 'late' ? '#f59e0b' : '#22c55e';

  if (hasMultiSession) {
    return (
      <div className="flex-1 flex items-center relative h-12">
        <div className="absolute left-[3%] right-[3%] h-[1px] border-t border-dashed border-slate-200" style={{ top: '50%' }} />
        {sessions.map((s, i) => {
          const sMins = timeToMinutes(s.checkIn);
          const eMins = s.checkOut ? timeToMinutes(s.checkOut) : null;
          const sPct = Math.max(0, Math.min(100, ((sMins - SHIFT_START) / total) * 100));
          const ePct = eMins !== null ? Math.max(0, Math.min(100, ((eMins - SHIFT_START) / total) * 100)) : null;
          const isActive = isToday && isCheckedIn && i === sessions.length - 1 && !s.checkOut;
          const livePct = isActive ? Math.max(sPct, nowPct) : null;
          return (
            <React.Fragment key={i}>
              {ePct !== null && (
                <div className="absolute h-1 rounded-full" style={{ left: `${sPct}%`, width: `${Math.max(0, ePct - sPct)}%`, backgroundColor: color, top: '50%', transform: 'translateY(-50%)' }} />
              )}
              {livePct !== null && (
                <div className="absolute h-0 border-t-2 border-dashed" style={{ left: `${sPct}%`, width: `${Math.max(0, livePct - sPct)}%`, borderColor: '#22c55e', top: '50%', transform: 'translateY(-50%)' }} />
              )}
              <div
                className="absolute w-2.5 h-2.5 rounded-full bg-white z-10 border-2"
                style={{ left: `${sPct}%`, top: '50%', transform: 'translate(-50%,-50%)', borderColor: color }}
                title={`Session ${i + 1} in: ${new Date(s.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`}
              />
              {ePct !== null && (
                <div
                  className="absolute w-2.5 h-2.5 rounded-full bg-white z-10 border-2"
                  style={{ left: `${ePct}%`, top: '50%', transform: 'translate(-50%,-50%)', borderColor: color }}
                  title={`Session ${i + 1} out: ${new Date(s.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`}
                />
              )}
            </React.Fragment>
          );
        })}
        {showNowLine && (
          <div className="absolute top-0 bottom-0 border-l border-dashed border-blue-400 z-20" style={{ left: `${nowPct}%` }} />
        )}
      </div>
    );
  }

  // Single session — use sessions[0] times when available (preserves first check-in on re-check-in days)
  const ci = sessions?.[0]?.checkIn || record.checkIn;
  const co = sessions?.[0]?.checkOut || record.checkOut;

  const checkInMins  = timeToMinutes(ci);
  const checkOutMins = co ? timeToMinutes(co) : null;

  const startPct = Math.max(0, Math.min(100, ((checkInMins - SHIFT_START) / total) * 100));
  const endPct   = checkOutMins ? Math.max(0, Math.min(100, ((checkOutMins - SHIFT_START) / total) * 100)) : null;

  const liveEndPct = isToday && isCheckedIn && !checkOutMins
    ? Math.max(startPct, nowPct)
    : null;

  return (
    <div className="flex-1 flex items-center relative h-12">
      {/* Dashed baseline */}
      <div className="absolute left-[3%] right-[3%] h-[1px] border-t border-dashed border-slate-200" style={{ top: '50%' }} />

      {endPct !== null && (
        <div
          className="absolute h-1 rounded-full"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%`, backgroundColor: color, top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {liveEndPct !== null && (
        <div
          className="absolute h-0 border-t-2 border-dashed"
          style={{ left: `${startPct}%`, width: `${liveEndPct - startPct}%`, borderColor: '#22c55e', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      <div
        className="absolute w-2.5 h-2.5 rounded-full bg-white z-10 border-2"
        style={{ left: `${startPct}%`, top: '50%', transform: 'translate(-50%,-50%)', borderColor: color }}
        title={`Check-in, ${new Date(ci).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`}
      />

      {endPct !== null && (
        <div
          className="absolute w-2.5 h-2.5 rounded-full bg-white z-10 border-2"
          style={{ left: `${endPct}%`, top: '50%', transform: 'translate(-50%,-50%)', borderColor: color }}
          title={`Check-out, ${new Date(co).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`}
        />
      )}

      {showNowLine && (
        <div
          className="absolute top-0 bottom-0 border-l border-dashed border-blue-400 z-20"
          style={{ left: `${nowPct}%` }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */

export default function MyAttendance() {
  const { user } = useAuth();
  const { isCheckedIn, isCheckedOut, timerDisplay, checkIn, checkOut, actionLoading: attLoading, elapsed } = useAttendance();
  const { isWeekend: isWeekendByRule } = useWeekendRules();
  const [view, setView] = useState('timeline');
  // Filter period: 'weekly' (the default 7-day strip) or 'monthly'
  // (full-month aggregation). Affects which date range we send to
  // /attendance/summary so the footer counts always reflect the visible
  // window — never the whole month when the user is in week-view.
  const [filterPeriod, setFilterPeriod] = useState('weekly');
  const [showFilter, setShowFilter] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [weekStart, setWeekStart] = useState(weekOf(new Date()));
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [reportTab, setReportTab] = useState('days');
  const [hoveredDay, setHoveredDay] = useState(null);
  const [showRequestMenu, setShowRequestMenu] = useState(null);

  /**
   * Final weekend decision for a date, applying holiday overrides on top of
   * the weekend rules. Mirrors the precedence used in Dashboard.jsx:
   *   Working-Day Exception > Weekend rules > Other holidays (also non-working).
   */
  const effectiveIsWeekend = (date) => {
    const ymd = isoDate(date);
    const exception = holidays.find(h => isoDate(new Date(h.date)) === ymd);
    if (exception) {
      if (exception.type === 'working_day') return false;       // override → working day
      return true;                                              // any other holiday → non-working
    }
    return isWeekendByRule(date);
  };

  const week = buildWeek(weekStart);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekStart.getDate() + 6);

  /* ── fetch for the visible range ───────────────────────────────────────
   *  Summary is now scoped to the EXACT date range the user is viewing —
   *  Weekly view → 7 days, Monthly view → ~30 days. Previously the summary
   *  always queried the whole month even for a weekly view, which is why
   *  the footer showed "Weekend 10 Days" while only 1 weekend day was on
   *  screen. The /my endpoint still pulls a whole month so paging between
   *  weeks within the same month doesn't refetch.
   */
  useEffect(() => {
    setLoading(true);
    const m = weekStart.getMonth();
    const y = weekStart.getFullYear();

    let rangeStart, rangeEnd;
    if (filterPeriod === 'monthly') {
      rangeStart = isoDate(new Date(y, m, 1));
      rangeEnd   = isoDate(new Date(y, m + 1, 0));
    } else {
      rangeStart = isoDate(weekStart);
      rangeEnd   = isoDate(weekEndDate);
    }

    Promise.all([
      api.get(`/attendance/my?month=${m}&year=${y}`),
      api.get(`/attendance/summary?startDate=${rangeStart}&endDate=${rangeEnd}`),
      api.get(`/holidays?year=${y}`),
    ]).then(([r1, r2, r3]) => {
      setRecords(r1.data.data || []);
      setSummary(r2.data.data || {});
      setHolidays(r3.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getMonth(), weekStart.getFullYear(), weekStart.getDate(), filterPeriod]);

  /* ── map records by date ── */
  const recordMap = {};
  records.forEach(r => {
    const d = parseLocalDate(r.date);
    if (d) recordMap[isoDate(d)] = r;
  });

  /* ── navigation ── */
  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(weekOf(d));
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    // Don't allow paging into a week that hasn't started yet.
    const today = new Date();
    if (d > today) return;
    setWeekStart(weekOf(d));
  };
  const goToday = () => setWeekStart(weekOf(new Date()));

  const fmtRange = (s, e) =>
    `${s.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })} - ${e.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })}`;

  const todayStr = isoDate(new Date());

  // Close request menu on outside click
  useEffect(() => {
    const handleClick = () => setShowRequestMenu(null);
    if (showRequestMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showRequestMenu]);

  /* ── shift info ── */
  const shift = user?.shift;
  const shiftLabel = shift?.name
    ? `${shift.name} [ ${shift.start_time || '9:30 AM'} - ${shift.end_time || '6:00 PM'} ]`
    : 'General Shift [ 9:30 AM - 6:00 PM ]';

  return (
    <div className="flex flex-col h-full font-sans bg-[#f2f3f7] min-h-screen pb-10">

      {/* ── Top bar: shift + check-out ──────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center gap-4 shadow-sm">
        <BackButton to="/attendance" label="Attendance" />
        <span className="text-[15px] font-semibold text-slate-700">{shiftLabel}</span>
        <input
          placeholder="Add notes for check-out"
          className="flex-1 max-w-[340px] border border-slate-200 rounded-md text-[14px] px-3 py-1.5 text-slate-600 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[15px] font-bold text-slate-700 font-mono">{timerDisplay}</span>
          {isCheckedIn ? (
            <button
              onClick={() => checkOut()}
              disabled={attLoading}
              className="flex items-center gap-1.5 border-2 border-rose-500 text-rose-500 hover:bg-rose-50 text-[14px] font-bold px-4 py-1.5 rounded-lg transition-all disabled:opacity-60"
            >
              <LogOut size={14} /> Check-out
            </button>
          ) : isCheckedOut ? (
            <button
              onClick={() => checkIn()}
              disabled={attLoading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-bold px-4 py-1.5 rounded-lg transition-all disabled:opacity-60"
            >
              <LogIn size={14} /> Re-check-in
            </button>
          ) : (
            <button
              onClick={() => checkIn()}
              disabled={attLoading}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-[14px] font-bold px-4 py-1.5 rounded-lg transition-all disabled:opacity-60"
            >
              <LogIn size={14} /> Check-in
            </button>
          )}
        </div>
      </div>

      {/* ── Week navigator + view toggles ──────────────────────────────
       *  Forward navigation is blocked once the week being viewed already
       *  contains today — employees only need to look at past attendance. */}
      <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center gap-3">
        <button onClick={prevWeek} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <button onClick={goToday} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors">
          <Calendar size={14} />
        </button>
        <button
          onClick={nextWeek}
          disabled={weekEndDate >= new Date(new Date().setHours(23,59,59,999))}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={weekEndDate >= new Date(new Date().setHours(23,59,59,999)) ? 'No future attendance to view' : 'Next week'}
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-[15px] font-semibold text-slate-700 ml-1">
          {fmtRange(weekStart, weekEndDate)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* View mode */}
          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden">
            {[
              { icon: <Grid3X3 size={13} />, val: 'timeline' },
              { icon: <List size={13} />, val: 'list' },
              { icon: <Calendar size={13} />, val: 'calendar' },
            ].map(({ icon, val }) => (
              <button
                key={val}
                onClick={() => setView(val)}
                className={`px-2.5 py-1.5 transition-colors ${view === val ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {icon}
              </button>
            ))}
           </div>

           {/* Filter — Weekly vs Monthly period. Drives the date range we
               send to /attendance/summary so the footer counts reflect the
               visible window. */}
           <div className="relative">
             <button
               onClick={() => { setShowFilter(s => !s); setShowMoreMenu(false); }}
               className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                 showFilter ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-100 text-slate-500'
               }`}
               title="Filter"
             >
               <Filter size={13} />
             </button>
             {showFilter && (
               <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg z-30">
                 <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                   <span className="text-[15px] font-bold text-slate-800">Filter</span>
                   <button onClick={() => setShowFilter(false)} className="text-slate-400 hover:text-slate-700">✕</button>
                 </div>
                 <div className="p-4 space-y-3">
                   <div>
                     <label className="block text-[13px] font-medium text-slate-500 uppercase mb-1.5">Period</label>
                     <select
                       value={filterPeriod}
                       onChange={(e) => { setFilterPeriod(e.target.value); setShowFilter(false); }}
                       className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[14px] focus:outline-none focus:border-blue-400"
                     >
                       <option value="weekly">Weekly</option>
                       <option value="monthly">Monthly</option>
                     </select>
                   </div>
                   <div className="flex gap-2 pt-1">
                     <button
                       onClick={() => { setFilterPeriod('weekly'); setShowFilter(false); }}
                       className="flex-1 text-[14px] font-medium text-slate-600 border border-slate-200 rounded px-3 py-1.5 hover:bg-slate-50"
                     >
                       Reset
                     </button>
                   </div>
                 </div>
               </div>
             )}
           </div>

           {/* 3-dot menu: Export + Audit History (matches Zoho's overflow menu) */}
           <div className="relative">
             <button
               onClick={() => { setShowMoreMenu(s => !s); setShowFilter(false); }}
               className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                 showMoreMenu ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-100 text-slate-500'
               }`}
               title="More"
             >
               <MoreHorizontal size={14} />
             </button>
             {showMoreMenu && (
               <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-md shadow-lg z-30 py-1">
                 <button
                   onClick={() => {
                     setShowMoreMenu(false);
                     const start = isoDate(filterPeriod === 'monthly'
                       ? new Date(weekStart.getFullYear(), weekStart.getMonth(), 1)
                       : weekStart);
                     const end = isoDate(filterPeriod === 'monthly'
                       ? new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 0)
                       : weekEndDate);
                     // Programmatic anchor click → forces the browser to use
                     // the Content-Disposition filename instead of opening it.
                     // We can't use api.get() here because axios buffers the
                     // body; we want the browser to stream the download.
                     const token = localStorage.getItem('nxt_token');
                     fetch(`${api.defaults.baseURL}/attendance/export?startDate=${start}&endDate=${end}`, {
                       headers: { Authorization: `Bearer ${token}` },
                     })
                       .then(r => r.blob())
                       .then(blob => {
                         const url = URL.createObjectURL(blob);
                         const a = document.createElement('a');
                         a.href = url;
                         a.download = `attendance_${start}_to_${end}.csv`;
                         document.body.appendChild(a); a.click();
                         document.body.removeChild(a);
                         URL.revokeObjectURL(url);
                       })
                       .catch(() => toast.error('Export failed. Please try again.'));
                   }}
                   className="w-full text-left px-3 py-2 text-[14px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                 >
                   <Download size={13} className="text-slate-500" /> Export
                 </button>
                 <button
                   onClick={() => setShowMoreMenu(false)}
                   className="w-full text-left px-3 py-2 text-[14px] text-slate-400 hover:bg-slate-50 flex items-center gap-2 cursor-not-allowed"
                   title="Audit history not enabled yet"
                 >
                   <Eye size={13} className="text-slate-400" /> Audit History
                 </button>
               </div>
             )}
           </div>
         </div>
       </div>

      {/* ── Timeline view ────────────────────────────────────────────── */}
      {view === 'timeline' && (
        <div className="flex flex-col mx-4 my-4 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {week.map((day, idx) => {
                const ds = isoDate(day);
                const record = recordMap[ds] || null;
                const isToday = ds === todayStr;
                const isWeekend = effectiveIsWeekend(day);
                const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = day.getDate();
                const checkInStr = fmtTime(record?.sessions?.[0]?.checkIn || record?.checkIn);
                const checkOutStr = fmtTime(record?.sessions?.[record?.sessions?.length - 1]?.checkOut || record?.checkOut);
                const hoursStr = fmtHHMM(record?.workingHours);

                 return (
                   <div
                     key={ds}
                     className={`flex items-center gap-4 px-5 py-3.5 border-b border-slate-100 last:border-0 min-h-[56px] transition-colors relative
                       ${isToday ? 'bg-blue-50/30' : 'hover:bg-slate-50/80'}
                     `}
                     onMouseEnter={() => setHoveredDay(ds)}
                     onMouseLeave={() => setHoveredDay(null)}
                   >
                    {/* Day label — matches Zoho: "Today" replaces the weekday name on the current row */}
                    <div className="w-[64px] flex-shrink-0 flex items-center gap-2">
                      {isToday ? (
                        <div className="flex flex-col items-center">
                          <span className="text-[12px] font-semibold text-slate-600">Today</span>
                          <div className="w-7 h-7 rounded bg-blue-600 text-white flex items-center justify-center text-[15px] font-bold mt-1">
                            {dayNum}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <span className={`text-[12px] font-medium ${isWeekend ? 'text-slate-400' : 'text-slate-500'}`}>{dayName}</span>
                          <span className={`text-[15px] font-semibold mt-0.5 ${isWeekend ? 'text-slate-400' : 'text-slate-700'}`}>{dayNum}</span>
                        </div>
                      )}
                    </div>

                    {/* Check-in time + Late indicator */}
                    <div className="w-[80px] flex-shrink-0">
                      <span className="text-[14px] text-slate-700 font-medium">
                        {checkInStr || (isWeekend ? <span className="text-slate-300 text-[13px]">Weekend</span> : '')}
                      </span>
                      {record?.lateMinutes > 0 && (
                        <div className="text-[12px] font-semibold" style={{ color: '#F5A623' }}>
                          Late by {fmtHHMM(record.lateMinutes / 60)}
                        </div>
                      )}
                    </div>

                    {/* Timeline bar */}
                    <div className="flex-1 min-w-0">
                      {isWeekend ? (
                        /* Yellow line spanning the row with a centered Weekend pill — matches Zoho */
                        <div className="flex-1 flex items-center relative h-6">
                          <div className="absolute left-[3%] right-[3%] h-[2px] bg-amber-300" style={{ top: '50%', transform: 'translateY(-50%)' }} />
                          <div className="absolute left-[3%] w-2.5 h-2.5 rounded-full bg-amber-300" style={{ top: '50%', transform: 'translate(-50%,-50%)' }} />
                          <div className="absolute right-[3%] w-2.5 h-2.5 rounded-full bg-amber-300" style={{ top: '50%', transform: 'translate(50%,-50%)' }} />
                          <div className="absolute left-1/2 -translate-x-1/2 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 text-[12px] font-semibold text-amber-700 z-10">
                            Weekend
                          </div>
                        </div>
                      ) : (
                        <TimelineBar record={record} isToday={isToday} isCheckedIn={isCheckedIn} />
                      )}
                    </div>

                     {/* Hours worked — live ticking on today's row when checked in */}
                     <div className="w-[100px] flex-shrink-0 text-right">
                       {!isWeekend && (() => {
                         const liveOnToday = isToday && isCheckedIn;
                         let displayHours;
                         if (liveOnToday) {
                           const h = Math.floor(elapsed / 3600);
                           const m = Math.floor((elapsed % 3600) / 60);
                           const s = elapsed % 60;
                           displayHours = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                         } else {
                           displayHours = record?.workingHours ? hoursStr : '00:00';
                         }
                         return (
                           <>
                             <p className={`text-[15px] font-bold ${liveOnToday ? 'text-emerald-600' : 'text-slate-700'}`}>
                               {displayHours}
                             </p>
                             <p className="text-[12px] text-slate-400 mt-0.5">{liveOnToday ? 'Hrs' : 'Hrs worked'}</p>
                           </>
                         );
                       })()}
                     </div>

                     {/* Add Request Button — hover-revealed, viewport-clamped popup */}
                     {!isWeekend && hoveredDay === ds && (
                       <div className="flex-shrink-0 relative">
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             // Hand the button's rect to RequestMenu; it measures
                             // its own height and decides above/below.
                             const rect = e.currentTarget.getBoundingClientRect();
                             const isPastDay = ds < todayStr;
                             const canRegularize = (ds === todayStr) || (isPastDay && !!record);
                             setShowRequestMenu({
                               buttonRect: {
                                 top: rect.top, bottom: rect.bottom,
                                 left: rect.left, right: rect.right,
                               },
                               canRegularize,
                             });
                           }}
                           className="request-menu-trigger flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-2.5 py-1.5 rounded-md transition-colors shadow-sm"
                         >
                           Add Request
                         </button>
                       </div>
                     )}
                   </div>
                 );
              })}

              {/* Timeline axis */}
              <div className="flex items-start px-5 py-2 bg-slate-50/80 border-t border-slate-100">
                <div className="w-[64px] flex-shrink-0" />
                <div className="w-[80px] flex-shrink-0" />
                <div className="flex-1 relative h-4">
                  {TICK_HOURS.map(h => {
                    const pct = ((h * 60 - SHIFT_START) / (SHIFT_END - SHIFT_START)) * 100;
                    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                    return (
                      <span
                        key={h}
                        className="absolute text-[12px] text-slate-400 transform -translate-x-1/2"
                        style={{ left: `${pct}%` }}
                      >
                        {h12}:00{h < 12 ? 'AM' : 'PM'}
                      </span>
                    );
                  })}
                </div>
                <div className="w-[100px] flex-shrink-0" />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── List view ────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="mx-4 my-4 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Date', 'Day', 'Check In', 'Check Out', 'Hours', 'Status'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {week.map(day => {
                const ds = isoDate(day);
                const r = recordMap[ds];
                const isWeekend = effectiveIsWeekend(day);
                const isFuture = ds > todayStr;
                return (
                  <tr key={ds} className={`hover:bg-slate-50 transition-colors ${ds === todayStr ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-5 py-3 text-[14px] font-medium text-slate-700">
                      <div>{day.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}</div>
                      {r?.lateMinutes > 0 && (
                        <div className="text-[12px] font-semibold mt-0.5" style={{ color: '#F5A623' }}>
                          Late by {fmtHHMM(r.lateMinutes / 60)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[14px] text-slate-500">
                      {day.toLocaleDateString('en-US', { weekday:'short' })}
                    </td>
                    <td className="px-5 py-3 text-[14px] text-slate-700">{fmtTime(r?.sessions?.[0]?.checkIn || r?.checkIn) || '—'}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-700">{fmtTime(r?.sessions?.[r?.sessions?.length - 1]?.checkOut || r?.checkOut) || '—'}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-700">{r?.workingHours ? `${fmtHHMM(r.workingHours)} hrs` : '—'}</td>
                    <td className="px-5 py-3">
                      {isWeekend
                        ? <StatusPill status="weekend" />
                        : isFuture
                          ? <span className="text-slate-400 text-[13px]">—</span>
                          : <StatusPill status={r?.status || 'absent'} />
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Calendar view ────────────────────────────────────────────────
       *  Full-month grid (Sun–Sat columns) with each cell showing the
       *  status + hours worked. Matches Zoho's monthly calendar layout —
       *  clicking any cell jumps the week navigator to that date so the
       *  user can drill into the timeline view for that week.
       */}
      {view === 'calendar' && (() => {
        const m = weekStart.getMonth();
        const y = weekStart.getFullYear();
        const monthName = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const firstDay  = new Date(y, m, 1);
        const lastDay   = new Date(y, m + 1, 0);
        // Lead with empty cells so the 1st lands on the right weekday.
        const cells = [];
        for (let i = 0; i < firstDay.getDay(); i++) cells.push(null);
        for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(y, m, d));
        // Trail with empty cells so the grid is rectangular (6 rows × 7 cols).
        while (cells.length % 7 !== 0) cells.push(null);

        return (
          <div className="mx-4 my-4 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">{monthName}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setWeekStart(weekOf(new Date(y, m - 1, 15)))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">
                  <ChevronLeft size={15} />
                </button>
                <button onClick={() => setWeekStart(weekOf(new Date(y, m + 1, 15)))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            {/* Weekday header */}
            <div className="grid grid-cols-7 border-b border-slate-100">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} className="px-3 py-2 text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{d}</div>
              ))}
            </div>
            {/* Date cells */}
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                if (!day) return <div key={idx} className="h-[88px] border-r border-b border-slate-100 bg-slate-50/40" />;
                const ds = isoDate(day);
                const r  = recordMap[ds];
                const isWknd = effectiveIsWeekend(day);
                const isToday = ds === todayStr;
                const isFuture = day > new Date();
                let pill = null;
                if (isWknd) {
                  pill = (
                    <div className="text-[13px] font-medium px-2 py-1 rounded leading-tight bg-slate-100 text-slate-500 border border-slate-200">
                      Weekend
                    </div>
                  );
                } else if (r) {
                  const isAbsent = r.status === 'absent';
                  const isLate = r.status === 'late';
                  const status = isLate ? 'Present' : r.status === 'half-day' ? 'Half day' : (r.status || 'Present').replace(/^./, c => c.toUpperCase());
                  pill = (
                    <div className={`text-[13px] font-medium px-2 py-1 rounded leading-tight ${
                      isAbsent ? 'bg-rose-50 text-rose-700 border border-rose-200'
                               : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      <div>{status}</div>
                      {r.workingHours != null && <div className="text-[12px] opacity-80">{fmtHHMM(r.workingHours)} Hrs</div>}
                      {isLate && r.lateMinutes > 0 && (
                        <div className="text-[11px] font-semibold mt-0.5" style={{ color: '#F5A623' }}>
                          Late {fmtHHMM(r.lateMinutes / 60)}
                        </div>
                      )}
                    </div>
                  );
                } else if (!isWknd && !isFuture && ds < todayStr) {
                  pill = (
                    <div className="text-[13px] font-medium px-2 py-1 rounded leading-tight bg-rose-50 text-rose-700 border border-rose-200">
                      Absent
                    </div>
                  );
                }
                return (
                  <button
                    key={idx}
                    onClick={() => setWeekStart(weekOf(day))}
                    className={`h-[88px] border-r border-b border-slate-100 p-2 text-left transition-colors hover:bg-blue-50/40 ${
                      isWknd ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <div className={`text-[13px] font-semibold mb-1 inline-flex items-center justify-center ${
                      isToday ? 'w-6 h-6 rounded-full bg-blue-600 text-white' :
                      isWknd  ? 'text-slate-400' : 'text-slate-700'
                    }`}>
                      {day.getDate()}
                    </div>
                    {pill}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Summary footer bar ────────────────────────────────────────── */}
      <div className="mx-4 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center px-5 py-3 gap-6 flex-wrap">
          {/* Days/Hours toggle — clicks open the report panel */}
          <div className="flex items-center gap-2">
            <div className="flex border border-slate-200 rounded overflow-hidden">
              <button onClick={() => { setReportTab('days'); setShowReport(true); }}
                className={`px-3 py-1 text-[13px] font-semibold transition-colors ${reportTab === 'days' && showReport ? 'bg-[#1a73e8] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>Days</button>
              <button onClick={() => { setReportTab('hours'); setShowReport(true); }}
                className={`px-3 py-1 text-[13px] font-medium transition-colors ${reportTab === 'hours' && showReport ? 'bg-[#1a73e8] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>Hours</button>
            </div>
          </div>

          <div className="w-px h-5 bg-slate-200" />

          {[
            // payableDays is now backend-computed: working days in the visible
            // range that are today or earlier (excludes future days; today
            // still counts even while the shift is in progress).
            { label: 'Payable Days', val: summary?.payableDays ?? 0, color: '#f59e0b' },
            { label: 'Present',      val: summary?.present ?? 0,     color: '#a78bfa' },
            { label: 'On Duty',      val: summary?.onDuty ?? 0,      color: '#6366f1' },
            { label: 'Paid leave',   val: summary?.leave ?? 0,       color: '#22c55e' },
            { label: 'Holidays',     val: summary?.holidays ?? 0,    color: '#f97316' },
            { label: 'Weekend',      val: summary?.weekend ?? 0,     color: '#94a3b8' },
          ].map(({ label, val, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-[3px] h-[14px] rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[13px] text-slate-500">{label}</span>
              <span className="text-[14px] font-bold text-slate-700">{val} {label === 'Paid leave' ? 'Day' : 'Days'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Slide-in Attendance Report panel ────────────────────────── */}
      {showReport && (
        <div className="fixed inset-0 z-40" onClick={() => setShowReport(false)}>
          <div className="absolute right-0 top-0 h-full w-[320px] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-[17px] font-bold text-slate-800">Attendance Report</h3>
              <button onClick={() => setShowReport(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400">
                ✕
              </button>
            </div>
            {/* Days / Hours sub-tabs */}
            <div className="flex border-b border-slate-100">
              {['days', 'hours'].map(t => (
                <button key={t} onClick={() => setReportTab(t)}
                  className={`flex-1 py-2.5 text-[15px] font-semibold capitalize border-b-2 transition-colors
                    ${reportTab === t ? 'border-[#1a73e8] text-[#1a73e8]' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {/* Report items */}
            <div className="flex-1 overflow-y-auto py-2">
              {[
                { label: 'Payable Days', val: `${summary?.payableDays ?? 0} Days`, color: '#f59e0b' },
                { label: 'Present',      val: `${summary?.present ?? 0} Days`,     color: '#22c55e' },
                { label: 'On Duty',      val: `${summary?.onDuty ?? 0} Day`,       color: '#6366f1' },
                { label: 'Paid leave',   val: `${summary?.leave ?? 0} Day`,        color: '#34a853' },
                { label: 'Holidays',     val: `${summary?.holidays ?? 0} Day`,     color: '#f97316' },
                { label: 'Weekend',      val: `${summary?.weekend ?? 0} Day`,      color: '#94a3b8' },
                { label: 'Unpaid leave', val: `${summary?.unpaid ?? 0} Day`,       color: '#e53935' },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-50 last:border-0">
                  <div className="w-[3px] h-[18px] rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1">
                    <p className="text-[15px] font-semibold text-slate-700">{label}</p>
                    <p className="text-[14px] text-slate-500">{val}</p>
                  </div>
                </div>
              ))}
            </div>
           </div>
         </div>
       )}

       {/* Request Dropdown Menu */}
       {showRequestMenu && (
         <RequestMenu
           buttonRect={showRequestMenu.buttonRect}
           canRegularize={!!showRequestMenu.canRegularize}
           onClose={() => setShowRequestMenu(null)}
         />
       )}
     </div>
   );
}
