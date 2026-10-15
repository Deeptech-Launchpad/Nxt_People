import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { isFullAccess, isApprover } from '../utils/roles';
import { useAttendance } from '../context/AttendanceContext';
import { useWeekendRules } from '../context/WeekendRulesContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import usePolling from '../hooks/usePolling';
import { useFunctionAccess } from '../context/FunctionAccessContext';
import { leaveChipText } from './moreservices/shift/shiftGrid';
import ManualAttendance from './moreservices/ManualAttendance';

import {
  Megaphone, Clock, ExternalLink, User as UserIcon, Image as ImageIcon,
  MoreHorizontal, LogIn, LogOut,
  Calendar, Star, CheckCircle,
  MessageSquare, Briefcase, Filter, X, Activity, Settings, User, Search,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import CoverImageDialog, { coverStyle, useCanChangeCover, loadCovers } from '../components/CoverImagePicker';

import api from '../utils/api';
import useSortable from '../components/table/useSortable';
import SortableTh from '../components/table/SortableTh';
import RegularizeModal from '../components/requests/RegularizeModal';
import OnDutyModal from '../components/requests/OnDutyModal';
import ApplyLeaveModal from '../components/requests/ApplyLeaveModal';
import LeaveRequestDialog from './moreservices/leavetracker/LeaveRequestDialog';
import { formatTimeRange, useFormat, useLocaleFormat, formatHoursDuration } from '../utils/datetime';
import { richTextToPlain } from '../utils/richText';
import AnnouncementDetailModal from '../components/AnnouncementDetailModal';
import toast from 'react-hot-toast';
import PhotoCropperModal from '../components/PhotoCropperModal';
import { ImgWithFallback } from '../components/ui';
import { PAYROLL_ENABLED, TIME_TRACKER_ENABLED } from '../config/features';

/* Same wording LeaveCalendar.jsx and Leave.jsx already use for a leave
 * type's name. Permission is deliberately absent — it is hours within a
 * day someone otherwise worked, not a day off, so it never explains why a
 * day has no punch the way an actual leave does. */
const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay',
};

/* Purely decorative — which icon a Leave Balance card shows for its type.
 * Falls back to the purple "person" badge for any code without a closer
 * match; does not affect which leave types are fetched or featured. */
const LEAVE_CODE_ICON = {
  casual: '/icons/dashboard/15-leaf-green.svg',
  earned: '/icons/dashboard/15-leaf-green.svg',
  sick: '/icons/dashboard/16-heart-red.svg',
  permission: '/icons/dashboard/17-user-purple.svg',
  comp_off: '/icons/dashboard/18-stopwatch-blue.svg',
  unpaid: '/icons/dashboard/16-heart-red.svg',
};

/* Short, positive lines for the greeting banner's subtitle — purely
 * decorative copy, same spirit as the "Have a productive day!" line it
 * sits beside, not application data, so no API/DB field for this. */
const MOTIVATIONAL_QUOTES = [
  'Small steps today, a stronger tomorrow.',
  'Progress happens when people grow together.',
  'Every task done well moves the whole team forward.',
  'Consistency beats intensity — keep showing up.',
  'Great work is built one focused hour at a time.',
  'Your effort today is tomorrow’s momentum.',
  'Clarity first, speed follows.',
  'A calm mind gets more done than a rushed one.',
  'Small wins, counted daily, become big ones.',
  'Teamwork turns good ideas into real results.',
  'Done is better than perfect — ship it, then improve it.',
  'Start where you are, use what you have.',
  'Good habits, repeated daily, build great careers.',
  'Ask questions early; it saves time later.',
  'Celebrate progress, not just the finish line.',
  'Focus on what you can control today.',
  'A short break now can mean sharper work later.',
  'Helping a colleague today pays forward tomorrow.',
  'Plans change — purpose doesn’t have to.',
  'Keep it simple; simple scales.',
  'Every expert was once a beginner who kept going.',
  'Patience and persistence beat raw talent.',
  'The best time to start was earlier; the next best time is now.',
  'Quality is remembered long after speed is forgotten.',
  'Learning never stops paying off.',
  'A tidy plan makes for a calm day.',
  'Small kindnesses make a big workplace.',
  'Trust the process, track the progress.',
];

// One quote per page load, kept stable for the life of the component
// (no re-roll on re-render), and nudged away from repeating whatever
// showed on the previous load.
function pickQuote() {
  const n = MOTIVATIONAL_QUOTES.length;
  let idx = Math.floor(Math.random() * n);
  try {
    const lastRaw = sessionStorage.getItem('nxt_last_quote_idx');
    const last = lastRaw === null ? null : Number(lastRaw);
    if (last !== null && n > 1 && idx === last) {
      idx = (idx + 1 + Math.floor(Math.random() * (n - 1))) % n;
    }
    sessionStorage.setItem('nxt_last_quote_idx', String(idx));
  } catch { /* private window / storage blocked — a random quote is fine */ }
  return MOTIVATIONAL_QUOTES[idx];
}

/* ─ Greeting helper ─ */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/* Time-of-day icon — animated, Zoho-People style.
 * The sun stays put in the card with a fixed warm-gold palette
 * (no more rose/red at evening — that read as Mars, not a sun).
 * Only the SKY (card background) shifts through the day. The dot
 * rays and halo carry a faint time-of-day tint that stays in the
 * yellow/amber/orange family. */
// Total minutes since midnight — used so the night boundary can land
// on 5:30 PM (1050 mins) instead of being stuck on an hour mark.
function totalMins() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function getTimeOfDayColor() {
  const m = totalMins();
  if (m >= 5  * 60 && m < 8  * 60)         return 'text-orange-400'; // dawn
  if (m >= 8  * 60 && m < 17 * 60)         return 'text-amber-500';  // day
  if (m >= 17 * 60 && m < 17 * 60 + 30)    return 'text-orange-500'; // brief dusk 5–5:30 PM
  return 'text-indigo-300';                                          // night (5:30 PM onwards)
}

/* Background gradient applied to the greeting card itself. The "sky".
 * Night palette (5:30 PM onwards) goes a step darker now — user wanted
 * the evening to read as actual evening, not just a tinted morning. */
function getTimeOfDaySky() {
  const m = totalMins();
  if (m >= 5  * 60 && m < 8  * 60)        return 'from-amber-50 via-orange-50 to-yellow-50';   // dawn
  if (m >= 8  * 60 && m < 12 * 60)        return 'from-sky-50 via-blue-50 to-white';           // morning
  if (m >= 12 * 60 && m < 17 * 60)        return 'from-yellow-50 via-amber-50 to-orange-50';   // afternoon
  if (m >= 17 * 60 && m < 17 * 60 + 30)   return 'from-orange-100 via-rose-50 to-amber-50';    // brief dusk
  return 'from-indigo-300 via-slate-300 to-indigo-200';                                         // night
}

function AnimatedTimeOfDayIcon({ size = 48 }) {
  // Moon kicks in at 5:30 PM (per user spec — Indian winter sunset is
  // around 6 PM so the evening should already feel like night by 5:30).
  const m = totalMins();
  const isNight = m < 5 * 60 || m >= 17 * 60 + 30;
  const color = getTimeOfDayColor();

  // ─ Night: crescent moon with twinkling stars ─
  if (isNight) {
    const stars = [
      { cx: 14, cy: 18, r: 0.9 },
      { cx: 50, cy: 14, r: 1.1 },
      { cx: 12, cy: 44, r: 0.8 },
      { cx: 54, cy: 50, r: 1.0 },
      { cx: 18, cy: 30, r: 0.6 },
    ];
    return (
      <div className="relative text-indigo-300 no-dark-inherit" style={{ width: size, height: size }}>
        <svg viewBox="0 0 64 64" width={size} height={size}>
          <defs>
            <radialGradient id="nxt-moon-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor="#e0e7ff" stopOpacity="0.45" />
              <stop offset="60%" stopColor="#e0e7ff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0"   />
            </radialGradient>
            <radialGradient id="nxt-moon-body" cx="38%" cy="35%" r="65%">
              <stop offset="0%"  stopColor="#fefce8" stopOpacity="1"   />
              <stop offset="60%" stopColor="#fde68a" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.85" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="url(#nxt-moon-glow)" className="nxt-sun-glow" />
          {/* Crescent: a full filled disc with a slightly-offset cutout. */}
          <mask id="nxt-moon-mask">
            <rect width="64" height="64" fill="white" />
            <circle cx="38" cy="28" r="14" fill="black" />
          </mask>
          <circle cx="32" cy="32" r="15" fill="url(#nxt-moon-body)" mask="url(#nxt-moon-mask)" />
          {/* Stars twinkling around the moon */}
          <g fill="#e2e8f0" className="nxt-star-twinkle">
            {stars.map((s, i) => <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />)}
          </g>
        </svg>
      </div>
    );
  }

  // ─ Day: warm golden gradient sun + two drifting clouds + rays + halo.
  return (
    <div className={`relative ${color} no-dark-inherit`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0">
        <defs>
          <radialGradient id="nxt-sun-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="currentColor" stopOpacity="0.30" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0"   />
          </radialGradient>
          {/* Fixed warm-gold core (NOT currentColor) so the sun reads as
              a sun in every time slot. Upper-left highlight gives it the
              sense of light coming from above. */}
          <radialGradient id="nxt-sun-fill" cx="38%" cy="35%" r="65%">
            <stop offset="0%"  stopColor="#fff6c4" stopOpacity="1"   />
            <stop offset="50%" stopColor="#fbd24a" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.85" />
          </radialGradient>
        </defs>
        {/* Soft outer glow halo */}
        <circle cx="32" cy="32" r="28" fill="url(#nxt-sun-halo)" className="nxt-sun-glow" />
      </svg>
      {/* Dotted rays — small circles around the rim, slow rotation. */}
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0 nxt-sun-rays">
        <g fill="currentColor" opacity="0.7">
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const cx = 32 + Math.cos(angle) * 26;
            const cy = 32 + Math.sin(angle) * 26;
            const r = i % 2 === 0 ? 1.3 : 0.9;
            return <circle key={i} cx={cx} cy={cy} r={r} />;
          })}
        </g>
      </svg>
      {/* Sun core — STATIC. Used to pulse via nxt-sun-core; user wanted
          a calm fixed sun, only the cloud moves. */}
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0">
        <defs>
          {/* Soft shadow under the cloud so the white reads as cotton
              on a coloured sky rather than a flat sticker. */}
          <filter id="nxt-cloud-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0.6" stdDeviation="0.6" floodColor="#94a3b8" floodOpacity="0.35" />
          </filter>
        </defs>
        <circle cx="32" cy="32" r="15" fill="url(#nxt-sun-fill)" />
      </svg>

      {/* Two clouds drifting right -> left at different speeds and
          y-positions so they feel independent rather than parallel-locked.
          Each lives in its own SVG so its translateX keyframe doesn't
          move the sun core. */}
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0">
        <g className="nxt-cloud-drift" fill="#ffffff" filter="url(#nxt-cloud-shadow)">
          <path d="
            M 24 36
            a 3.6 3.6 0 0 1 3 -3
            a 5 5 0 0 1 4.6 -3
            a 5.4 5.4 0 0 1 5.8 4
            a 3.2 3.2 0 0 1 1.2 6.2
            L 25 40.2
            a 2.6 2.6 0 0 1 -1 -4.2
            z" />
        </g>
      </svg>
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0">
        <g className="nxt-cloud-drift-2" fill="#ffffff" opacity="0.85" filter="url(#nxt-cloud-shadow)">
          {/* Slightly smaller, higher up so it doesn't overlap the first
              cloud's path. */}
          <path d="
            M 30 22
            a 2.4 2.4 0 0 1 2 -2
            a 3.4 3.4 0 0 1 3.2 -2
            a 3.8 3.8 0 0 1 4 2.8
            a 2.2 2.2 0 0 1 0.8 4.4
            L 30.6 25
            a 1.8 1.8 0 0 1 -0.6 -3
            z" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Build a 7-day week starting Sunday.
 * Weekend detection is delegated to `isWeekendFn` (driven by the configurable
 * weekend rules from `WeekendRulesContext`). If callers don't pass one we fall
 * back to the legacy hardcoded "1st & 3rd Sat" rule so older code paths still
 * render something reasonable.
 */
function getCurrentWeek(workingDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], holidays = [], isWeekendFn = null, weekOffset = 0) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = [];
    const dayOfWeek = today.getDay();
    // weekOffset shifts the whole 7-day window by N weeks (0 = current week,
    // -1 = previous, +1 = next) for the Attendance tab's week navigation.
    const sundayOffset = -dayOfWeek + weekOffset * 7;
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + sundayOffset);

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;
      const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });

      let isWeekend;
      if (typeof isWeekendFn === 'function') {
        isWeekend = isWeekendFn(d);
      } else {
        // Legacy fallback (only used until WeekendRulesContext resolves).
        isWeekend = !workingDays.includes(dayStr);
        if (dayStr === 'Sat') {
          const weekOfMonth = Math.ceil(d.getDate() / 7);
          isWeekend = weekOfMonth === 1 || weekOfMonth === 3;
        }
      }

      // Check for Holiday / Working Day exceptions
      const exception = holidays.find(h => {
        if (!h.date) return false;
        const hDate = new Date(h.date);
        const hStr = `${hDate.getFullYear()}-${String(hDate.getMonth()+1).padStart(2,'0')}-${String(hDate.getDate()).padStart(2,'0')}`;
        return hStr === dateStr;
      });

      // A restricted holiday is optional rather than a closure, so it leaves
      // the day as the weekend rules found it.
      const closes = !!exception && !['working_day', 'restricted'].includes(exception.type);
      if (exception) {
        if (exception.type === 'working_day') isWeekend = false;
        else if (closes) isWeekend = true; // Treat holidays as weekends for absent-mark prevention.
      }

      week.push({
        dateStr,
        day: dayStr,
        dateNum: day,
        isWeekend,
        isHoliday: closes,
        holidayName: closes ? exception.name : null,
        dateObj: d
      });
    }
    return week;
  }

 /* ─ Format hours decimal to HH:MM ─ */
 function fmtHHMM(hours) {
   if (!hours && hours !== 0) return '00:00';
   const h = Math.floor(hours);
   const m = Math.round((hours - h) * 60);
   return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
 }

/* ─ Resolve a person's presence for today.
 *    Accepts either the new `presence` field from the API or falls back to
 *    the legacy `isCheckedIn` boolean (which couldn't distinguish "Out"
 *    from "Yet to check-in"). */
function presenceOf(p) {
  if (!p) return null;
  if (p.presence) return p.presence;
  return p.isCheckedIn ? 'in' : 'yetToCheckIn';
}
const PRESENCE_LABEL = { in: 'Checked In', out: 'Checked Out', onLeave: 'On Leave', yetToCheckIn: 'Yet to check-in' };
const PRESENCE_COLOR = { in: 'text-emerald-600', out: 'text-slate-500', onLeave: 'text-violet-600', yetToCheckIn: 'text-amber-600' };
const PRESENCE_DOT   = { in: 'bg-emerald-500',  out: 'bg-slate-400',  onLeave: 'bg-violet-500',  yetToCheckIn: 'bg-amber-500'  };

/* Small inline status pill — used on the manager / approver / dept-member cards. */
/* Leave detail rides alongside presence the way teamShared's PresenceBadge
 * merges it: an on-leave person reads as the leave itself. Permission never
 * makes someone On Leave, so its window is added beside whatever their punch
 * says instead. The server blanks the detail outside the viewer's own
 * department, which leaves the plain label. */
const PresenceLabel = ({ person }) => {
  const { timeFormat } = useLocaleFormat();
  const p = presenceOf(person);
  if (!p) return null;
  const detail = person?.leaveType ? leaveChipText(person, timeFormat) : null;
  const label = (p === 'onLeave' || p === 'yetToCheckIn') && detail && person.leaveType !== 'permission' ? detail : PRESENCE_LABEL[p];
  return (
    <span className={`text-[13px] font-medium ${PRESENCE_COLOR[p]}`}>
      {label}
      {person?.leaveType === 'permission' && detail && (
        <span className="text-violet-600"> · {detail}</span>
      )}
    </span>
  );
};

/* ─ Tab button ─ */
const Tab = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`py-2.5 px-1 text-[13px] font-medium border-b-[2.5px] transition-all whitespace-nowrap mt-[2px] cursor-pointer
      ${active
        ? 'border-[#5c9636] text-[#12142e] font-semibold'
        : 'border-transparent text-[#777] hover:text-[#333]'
      }`}
  >
    {children}
  </button>
);

/* ─ Feed card ─ */
const FeedCard = ({ icon, children }) => (
  <div className="bg-white rounded border border-slate-200 p-3 flex items-start gap-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow">
    {icon && (
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-slate-50 border border-slate-100 text-slate-400">
        {icon}
      </div>
    )}
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

/* ─ Add Request menu (used by the Attendance Weekly Log rows).
 *    `canRegularize` is true only for today + past days where the user
 *    actually checked in — matches Zoho's behaviour.
 *
 *    Positioning: the caller passes the BUTTON's bounding rect instead
 *    of pre-computed x/y. The menu measures its own real height after
 *    first paint via useLayoutEffect, then anchors itself above OR
 *    below the button based on actual viewport space — no more
 *    height guesses, no more bottom-row overflow. */
const RequestMenu = ({ buttonRect, onClose, canRegularize = false, onPick }) => {
  const menuRef  = useRef(null);
  // Start fully off-screen on first paint so the user doesn't see a
  // flash at the wrong position; useLayoutEffect re-positions before
  // the browser paints.
  const [pos, setPos] = useState({ left: -9999, top: -9999, ready: false });

  /* These open a form OVER the row you pressed, carrying its date. They used
   * to navigate: you landed on a list page, pressed "New Request", and typed
   * back the date you had just clicked. "Apply OnDuty" was worse — it pointed
   * at the regularization page, so it filed the wrong kind of request. */
  const options = [
    canRegularize && { label: 'Regularize Attendance', kind: 'regularize', icon: '✏️' },
    { label: 'Apply OnDuty',           kind: 'onduty',  icon: '📍' },
    { label: 'Apply Leave',            kind: 'leave',   icon: '📅' },
    { label: 'Apply Compensatory Off', kind: 'compoff', icon: '🔁' },
  ].filter(Boolean);

  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !buttonRect) return;
    const menuH = el.offsetHeight;
    const menuW = el.offsetWidth;
    const GUTTER = 16;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    // Flip above when there's more room above OR when below can't fit
    // the actual menu. Either case lands the menu fully on screen.
    const openAbove = spaceBelow < menuH + GUTTER && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(GUTTER, buttonRect.top - menuH - 6)
      : Math.min(window.innerHeight - menuH - GUTTER, buttonRect.bottom + 6);
    // Right-align to the button, then clamp horizontally.
    const left = Math.max(
      GUTTER,
      Math.min(buttonRect.right - menuW, window.innerWidth - menuW - GUTTER)
    );
    setPos({ left, top, ready: true });
  }, [buttonRect]);

  return (
    <div
      ref={menuRef}
      className="request-menu-popup fixed z-50 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.1)] border border-slate-100 w-56 overflow-hidden"
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header with close button — gives users an explicit way out */}
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
            onClick={() => { onPick(opt.kind); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f2f8ec]/50 transition-colors text-left group"
          >
            <span className="text-base bg-slate-50 group-hover:bg-[#e1efd2]/50 w-7 h-7 flex items-center justify-center rounded-lg border border-slate-100 group-hover:border-[#c5e0a8] transition-colors">{opt.icon}</span>
            <span className="text-[15px] font-semibold text-slate-700 group-hover:text-[#3b6122] transition-colors">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const fmt = useFormat();
  const {
    isCheckedIn, isCheckedOut, timerDisplay,
    hrs, mins, secs,
    checkIn, checkOut,
    actionLoading: attActionLoading, record
  } = useAttendance();
  const { isWeekend: isWeekendByRule } = useWeekendRules();
  const navigate = useNavigate();

  // The banner. Null until it loads, and the container carries a plain colour
  // underneath so nothing flashes white while it does.
  //
  // This has to live in Dashboard, not in a child: `cover` and `loadCover` are
  // read further down in THIS component's JSX. Declared in RequestMenu instead
  // — which also opens with `const navigate = useNavigate();` — they were free
  // identifiers here, and the whole page rendered blank. esbuild does not
  // resolve free identifiers, so the build passed.
  const [cover, setCover] = useState(null);
  const [covers, setCovers] = useState([]);
  const [orgLogo, setOrgLogo] = useState(null);
  const [showCover, setShowCover] = useState(false);
  const canChangeCover = useCanChangeCover();
  const loadCover = React.useCallback(() => {
    api.get('/cover-image').then(r => setCover(r.data.data)).catch(() => {});
  }, []);
  useEffect(() => { loadCover(); }, [loadCover]);
  useEffect(() => { loadCovers().then(setCovers); }, []);
  useEffect(() => {
    // /org-details/details rather than /settings: the logo lives there, and
    // that route is readable by anybody signed in, which the greeting has to be.
    api.get('/org-details/details').then(r => setOrgLogo(r.data.data?.logoUrl || null)).catch(() => {});
  }, []);

  const [activeTab, setActiveTab] = useState('announcements');
  // Picked once per mount (i.e. once per page load/refresh) — see pickQuote().
  const [greetingQuote] = useState(pickQuote);
  const [feedTab, setFeedTab] = useState('all');

  /* can() answers true while permissions load, which would flash Marking to
   * everybody for a moment. Full access never depends on it; everyone else
   * waits for the real answer. */
  const { can, loading: functionsLoading } = useFunctionAccess();
  const canMark = isFullAccess(user) || (!functionsLoading && can('attendance_marking'));

  /* ?section=, not ?tab= — the embedded ManualAttendance keeps its own tab
   * state and would read a ?tab= as one of its own. Waits on canMark so a
   * link opened before permissions load still lands on the tab. */
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('section') === 'marking' && canMark) setActiveTab('marking');
  }, [searchParams, canMark]);

  /* ─ Dropdown state ─ */
  const [showPayrollMore, setShowPayrollMore] = useState(false);
  const [showRequestMenu, setShowRequestMenu] = useState(null);
  const [requestModal, setRequestModal] = useState(null);
  const payrollMoreRef = useRef();

  /* ─ Close dropdowns on outside click ─
   *   `showRequestMenu` must be in the dep list — without it the handler
   *   captured a stale `null` and the popup never closed. */
  useEffect(() => {
    const handler = (e) => {
      if (payrollMoreRef.current && !payrollMoreRef.current.contains(e.target)) setShowPayrollMore(false);
      if (
        showRequestMenu &&
        e.target.closest('.request-menu-trigger') === null &&
        e.target.closest('.request-menu-popup') === null
      ) {
        setShowRequestMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRequestMenu]);

  /* Attendance */
   const [weeklyAttendance, setWeeklyAttendance] = useState([]);
   const [weeklyLeaves, setWeeklyLeaves] = useState([]);
   // Date ranges of the caller's OWN still-pending leave/permission,
   // regularization and on-duty requests touching the visible week — see
   // fetchWeeklyAttendance for why these hold up a status label.
   const [weeklyPendingRanges, setWeeklyPendingRanges] = useState([]);
   // Attendance tab — independent week navigation (0 = current, -1 = prev, +1 = next)
   // so browsing weeks here never disturbs the current-week Work Schedule widget.
   const [attWeekOffset, setAttWeekOffset] = useState(0);
   const [attWeekData, setAttWeekData] = useState([]);
   const [attWeekLeaves, setAttWeekLeaves] = useState([]);
   const [actionLoading, setActionLoading] = useState(false);

  /* Dashboard data */
   const [announcements, setAnnouncements] = useState([]);
   const [readingAnnouncement, setReadingAnnouncement] = useState(null);
   const [projects, setProjects] = useState([]);
   const [jobs, setJobs] = useState([]);
   const [holidays, setHolidays] = useState([]);

   /* Feeds data */
   const [feeds, setFeeds] = useState([]);

   /* ─ Full profile (fetched lazily when Profile tab is opened) */
   const [profileData, setProfileData] = useState(null);
   const [profileLoading, setProfileLoading] = useState(false);

   /* ─ Leave state — which type's "Apply" card was clicked, or null when
        closed. The form itself now lives in LeaveRequestDialog, the same one
        Operations → Leave Tracker uses, instead of a second hand-built copy:
        the old one showed a Full Day/Half Day "Duration" dropdown for
        Permission (an hourly type with no such concept) because its
        condition only checked fromDate === toDate, which Permission always
        satisfies since it sets both fields to the same date. */
   const [applyLeaveType, setApplyLeaveType] = useState(null);
   const [leaveCards, setLeaveCards] = useState([]);   // all active leave types + balances

   /* ─ Time Log state */
   const [timeLogForm, setTimeLogForm] = useState({ projectId: '', jobId: '', description: '', hours: '', billable: true });
   const [runningTimer, setRunningTimer] = useState(null);

   /* ─ Payslips state */
   const [payslips, setPayslips] = useState([]);
   const [payslipFY, setPayslipFY] = useState(() => {
     const now = new Date();
     const m = now.getMonth() + 1;
     const y = now.getFullYear();
     return m >= 4 ? `${y}-${String(y+1).slice(2)}` : `${y-1}-${String(y).slice(2)}`;
   });
    const [fyList, setFyList] = useState([]);
    const [payslipsLoading, setPayslipsLoading] = useState(false);
    const [payslipDownloading, setPayslipDownloading] = useState(null);
    const payslipSort = useSortable(payslips, {
      id: 'dashboard-payslips',
      columns: {
        month: { get: p => (Number(p.year) || 0) * 100 + (Number(p.month) || 0), type: 'number' },
        grossPay: { get: p => p.grossPay, type: 'number' },
        reimbursements: { get: p => p.reimbursements, type: 'number' },
        deductions: { get: p => p.deductions, type: 'number' },
        takeHome: { get: p => p.takeHome, type: 'number' },
      },
    });

    // The PDF endpoint is authenticated, so it cannot be a plain href — it has
    // to come back as a blob through the api client that carries the token.
    const downloadPayslip = async (id) => {
      if (payslipDownloading) return;
      setPayslipDownloading(id);
      try {
        const r = await api.get(`/payroll/my/${id}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(r.data);
        const a = document.createElement('a');
        a.href = url; a.download = `payslip-${id}.pdf`; a.click();
        URL.revokeObjectURL(url);
      } catch {
        toast.error('PDF download failed');
      } finally {
        setPayslipDownloading(null);
      }
    };

    /* ─ Department members state ─ */
    const [deptMembers, setDeptMembers] = useState([]);
    const [loadingDeptMembers, setLoadingDeptMembers] = useState(false);
    const [membersModalOpen, setMembersModalOpen] = useState(false);
    const [membersSearch, setMembersSearch] = useState('');

    /* ─ Avatar lightbox state ─ Clicking your photo in the profile
       card opens a Zoho-style preview. Change Image now opens the OS
       file picker inline rather than navigating away to /profile. */
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [photoUploading, setPhotoUploading] = useState(false);
    const photoFileRef = useRef(null);
    useEffect(() => {
      if (!avatarOpen) return;
      const close = (e) => { if (e.key === 'Escape') setAvatarOpen(false); };
      document.addEventListener('keydown', close);
      return () => document.removeEventListener('keydown', close);
    }, [avatarOpen]);

    // Cropper data URL — when truthy, PhotoCropperModal is visible.
    // We keep the avatar-lightbox open in the background so the user can
    // come back to it on Cancel.
    const [cropSrc, setCropSrc] = useState(null);

    // Step 1 — user picked a file. Validate size/type, read as data URL,
    // hand off to the cropper. The upload itself waits until they confirm
    // the crop region, matching the Profile page's flow exactly.
    const handleDashPhotoPicked = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Image must be 10 MB or smaller');
        e.target.value = '';
        return;
      }
      if (!/^image\//i.test(file.type)) {
        toast.error('Only image files are allowed');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setCropSrc(reader.result);
      reader.readAsDataURL(file);
      e.target.value = '';
    };

    // Step 2 — cropper produced a cropped JPEG blob. Upload, patch the
    // cached user so every avatar re-renders, close both modals.
    const handleDashCropSave = async (blob) => {
      if (!blob) return;
      setPhotoUploading(true);
      try {
        const fd = new FormData();
        fd.append('photo', blob, 'profile.jpg');
        const r = await api.post('/profile/photo', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (r.data?.photoUrl) {
          setUser(prev => prev ? { ...prev, photoUrl: r.data.photoUrl } : prev);
        }
        toast.success('Profile photo updated');
        setCropSrc(null);
        setAvatarOpen(false);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Upload failed');
      } finally {
        setPhotoUploading(false);
      }
    };

    /* ─ Approvals state ─ */
    const [pendingApprovals, setPendingApprovals] = useState([]);
    const [loadingApprovals, setLoadingApprovals] = useState(false);
    const [actingApproval, setActingApproval] = useState('');

    /* ─ Dashboard stat cards (Total Team Members / Present Today / On Leave)
     *  — same /team/space endpoint TeamSpace.jsx already uses, department-
     *  scoped server-side. Only fetched for approver roles since that's the
     *  only audience the cards render for. */
    const [teamSpace, setTeamSpace] = useState(null);
    useEffect(() => {
      if (!isApprover(user)) return;
      api.get('/team/space').then(r => setTeamSpace(r.data.data)).catch(() => {});
    }, [user?._id]);

    /* Open Requests stat card needs pending-approvals count available on
     * mount, not only once the Approvals tab is clicked — the count fetch
     * below is the same /approvals/pending call the tab effect already
     * makes; this just also fires it once up front for approver roles. */
    useEffect(() => {
      if (!isApprover(user) || activeTab === 'approvals') return;
      api.get('/approvals/pending')
        .then(r => {
          const d = r.data.data || {};
          const tag = (rows, endpoint, kind) => (rows || []).map(row => ({ ...row, _endpoint: endpoint, _kind: kind }));
          setPendingApprovals([
            ...tag(d.leaves, 'leaves', 'leave'),
            ...tag(d.regularizations, 'regularizations', 'regularization'),
            ...tag(d.wfhRequests, 'wfh', 'wfh'),
            ...tag(d.compOffs, 'comp-off', 'compoff'),
          ]);
        })
        .catch(() => {});
    }, [user?._id]);

    /**
     * Approve or reject from the Home page, without the trip to Operations.
     *
     * The same PUT /:endpoint/:id/action the Approvals screen uses — not a
     * shortcut around it. Everything that endpoint enforces (the approval
     * hierarchy, the self-approval refusal, the balance movement) still
     * applies, and a refusal comes back here as its own message rather than a
     * generic failure.
     *
     * Removed from the list on success rather than refetched: this list is
     * "what is waiting on me", and an approved request is not.
     */
    const actOnApproval = async (approval, action, approveAll = false) => {
      let rejectionReason;
      if (action === 'rejected') {
        // Optional server-side (rejection_reason is nullable), so an empty
        // answer is allowed — but Cancel must mean cancel, and prompt()
        // returns null for that and '' for an empty OK.
        rejectionReason = window.prompt('Reason for rejecting (optional):', '');
        if (rejectionReason === null) return;
      }
      setActingApproval(approval._id);
      try {
        await api.put(`/${approval._endpoint}/${approval._id}/action`,
          approveAll ? { action, rejectionReason, approveAll: true } : { action, rejectionReason });
        toast.success(approveAll ? 'All levels approved' : action === 'approved' ? 'Approved' : 'Rejected');
        setPendingApprovals(list => list.filter(a => a._id !== approval._id));
      } catch (err) {
        toast.error(err.response?.data?.message || `Could not ${action === 'approved' ? 'approve' : 'reject'} that request`);
      } finally {
        setActingApproval('');
      }
    };


    /* ─ Manager / dept-members (from full profile or user token) */
    const manager = profileData?.manager || (user?.manager && typeof user.manager === 'object' ? user.manager : null);

  /* ─ load full profile on mount — needed for left-panel Reporting Manager too */
  useEffect(() => {
    setProfileLoading(true);
    api.get('/profile')
      .then(r => setProfileData(r.data.data))
      .catch(console.error)
      .finally(() => setProfileLoading(false));
  }, []);


   /* ─ load data */
   // Helper: log widget failures so a network blip doesn't leave the
   // Dashboard rendering stale empty arrays forever with no signal. We don't
   // toast each one (too noisy if the whole API is down) — failures are
   // logged to the console only. Each widget keeps rendering — partial
   // Dashboard is still useful.
   const logWidgetError = (name) => (err) => {
     // eslint-disable-next-line no-console
     console.warn(`[Dashboard] ${name} failed`, err?.response?.status, err?.message);
   };

   useEffect(() => {
     fetchWeeklyAttendance();

     // Active (unread / urgent / recent) announcements for the Activities tab.
     api.get('/announcements/active')
       .then(r => setAnnouncements(r.data.data || []))
       .catch(logWidgetError('announcements'));

     api.get('/feeds')
       .then(r => setFeeds(r.data.data || []))
       .catch(logWidgetError('feeds'));

     api.get('/time-logs/running')
       .then(r => setRunningTimer(r.data.data))
       .catch(logWidgetError('time-logs'));

     api.get(`/holidays?year=${new Date().getFullYear()}`)
       .then(r => {
         setHolidays(r.data.data || []);
       }).catch(logWidgetError('holidays'));

     api.get('/projects')
       .then(r => setProjects(r.data.data || []))
       .catch(logWidgetError('projects'));

     api.get('/jobs')
       .then(r => setJobs(r.data.data || []))
       .catch(logWidgetError('jobs'));
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

    // Department Members: who this shows depends on the viewer's role
    // (?scope=team on the org directory — see routes/org.js) —
    //   full-access:            department-wide, as before
    //   manager / team_incharge: their own reportees, which can sit in a
    //                            different department than the manager
    //   team_member:            peers only (same designation + same
    //                            reporting manager)
    // so the department-equality re-filter this used to do client-side would
    // wrongly drop a manager's out-of-department reportee — self-exclusion is
    // the only filter still needed here.
    const fetchDeptMembers = (silent = false) => {
      if (!profileData?.department) return;
      if (!silent) setLoadingDeptMembers(true);
      const myId = user?._id || profileData?.id;
      api.get(`/org/directory?scope=team&department=${encodeURIComponent(profileData.department)}`)
        .then(r => {
          const members = (r.data.data || []).filter(m => String(m._id) !== String(myId));
          setDeptMembers(members);
        })
        .catch(() => { if (!silent) setDeptMembers([]); })
        .finally(() => { if (!silent) setLoadingDeptMembers(false); });
    };

    useEffect(() => {
      if (profileData?.department) {
        fetchDeptMembers();
      }
    }, [profileData?.department, profileData?.manager]);

    // Picks up a teammate's check-in/check-out without needing a manual
    // page refresh — see usePolling.js for why this is a silent refetch.
    usePolling(() => fetchDeptMembers(true), 5000, [profileData?.department]);

   /* ─ load payslips when tab is active or FY changes */
  useEffect(() => {
    if (activeTab !== 'payslips') return;
    setPayslipsLoading(true);
    // /payslips was removed with the legacy payslip archive when the payroll
    // module was rebuilt; this tab kept calling it and 404'd on every load.
    // /payroll/my is the live source. It returns every locked or paid slip
    // rather than one year's, so the financial year is filtered here and the
    // year list derived from the same rows — there is no fy-list endpoint to
    // replace the second call that was also 404ing.
    api.get('/payroll/my')
      .then(r => {
        const all = r.data.data || [];
        // Indian financial year: April to March, labelled "2026-27".
        const fyOf = s => {
          const y = Number(s.payYear), m = Number(s.payMonth);
          const start = m >= 4 ? y : y - 1;
          return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
        };
        setFyList([...new Set(all.map(fyOf))].sort().reverse());
        setPayslips(all.filter(s => !payslipFY || fyOf(s) === payslipFY).map(s => ({
          _id: s._id,
          month: Number(s.payMonth),
          year: Number(s.payYear),
          grossPay: s.grossEarnings,
          reimbursements: s.reimbursement,
          deductions: s.totalDeductions,
          takeHome: s.netPay,
        })));
      })
      .catch(() => toast.error('Failed to load payslips'))
      .finally(() => setPayslipsLoading(false));
   }, [activeTab, payslipFY]);

   /* ─ load pending approvals when tab is active */
   useEffect(() => {
     if (activeTab !== 'approvals') return;
     setLoadingApprovals(true);
     api.get('/approvals/pending')
       .then(r => {
         const d = r.data.data || {};
         /* Each list is acted on at its OWN endpoint — /leaves/:id/action is
          * not /comp-off/:id/action — so the kind is tagged here, at the one
          * place that knows which list a row came out of, rather than
          * re-derived further down by guessing from the shape of the row.
          * The row's shape was already being sniffed once to build its
          * label; approving from here would have made that guess
          * load-bearing for a write. */
         const tag = (rows, endpoint, kind) =>
           (rows || []).map(row => ({ ...row, _endpoint: endpoint, _kind: kind }));
         const allPending = [
           ...tag(d.leaves, 'leaves', 'leave'),
           ...tag(d.regularizations, 'regularizations', 'regularization'),
           ...tag(d.wfhRequests, 'wfh', 'wfh'),
           ...tag(d.compOffs, 'comp-off', 'compoff'),
         ];
         setPendingApprovals(allPending);
       })
       .catch(err => {
         // 403 = employee role without approver access — show empty state, not error
         if (err.response?.status === 403) { setPendingApprovals([]); }
         else toast.error('Failed to load pending approvals');
       })
       .finally(() => setLoadingApprovals(false));
   }, [activeTab]);

   /* ─ load all leave-type balances for the Leave tab (same source as
        Leave Tracker → Leave Summary, so every configured type shows). */
   useEffect(() => {
     api.get('/leaves/balance')
       .then(r => setLeaveCards(r.data.data || []))
       .catch(() => setLeaveCards([]));
   }, []);

   // Fetch weekly attendance (used by Work Schedule widget).
   // Week can straddle a month boundary (e.g. Jun 29–Jul 4), so fetch both
   // months when needed and merge — mirrors fetchAttWeek's logic.
   const fetchWeeklyAttendance = () => {
     const now = new Date();
     const day = now.getDay();
     const weekStart = new Date(now); weekStart.setDate(now.getDate() - day);
     const weekEnd   = new Date(now); weekEnd.setDate(now.getDate() + (6 - day));
     const months = new Map();
     [weekStart, weekEnd].forEach(d => {
       months.set(`${d.getFullYear()}-${d.getMonth()}`, { y: d.getFullYear(), m: d.getMonth() });
     });
     Promise.all([...months.values()].map(({ y, m }) =>
       api.get(`/attendance/my?month=${m}&year=${y}`).then(r => r.data.data || []).catch(() => [])
     )).then(arrs => setWeeklyAttendance(arrs.flat()));

     // Same gap fetchAttWeek had: this strip only ever asked attendance, so
     // an approved day off with correctly no punch read the same as one
     // actually missed. A week spans two years only at its very edges.
     const years = [...new Set([...months.values()].map(v => v.y))];
     Promise.all(years.map(y =>
       api.get(`/leaves/my?year=${y}&status=approved&limit=500`).then(r => r.data.data || []).catch(() => [])
     )).then(arrs => setWeeklyLeaves(arrs.flat()));

     /* A day this system has already scored (Present / Half-day / Absent) can
      * still have a leave, permission, regularization or on-duty request of
      * the CALLER'S OWN sitting undecided against it — and once decided, that
      * score can change (see LeaveRequestDialog's day-breakdown / classifyDay
      * in attendanceRule.js: an approved permission lowers what a day owed,
      * an approved leave replaces the score outright, an approved
      * regularization edits the punches themselves). Nothing here recomputes
      * the stored status when the request resolves, so showing a verdict
      * before it does is a promise this page cannot keep — reference product
      * leaves the day unlabelled instead, hours only, until it is decided.
      *
      * Comp-Off and WFH are left out on purpose: neither one changes what
      * classifyDay makes of a specific day the way these three do. */
     Promise.all(years.map(y =>
       api.get(`/leaves/my?year=${y}&status=pending&limit=500`).then(r => r.data.data || []).catch(() => [])
     )).then(leaveArrs => {
       const pendingLeaves = leaveArrs.flat()
         .map(l => ({ start: (l.startDate || '').slice(0, 10), end: (l.endDate || l.startDate || '').slice(0, 10) }));

       Promise.all([
         api.get('/regularizations/my').then(r => (r.data.data || [])
           .filter(x => x.status === 'pending')
           .map(x => ({ start: x.date, end: x.date }))
         ).catch(() => []),
         api.get('/on-duty/my?status=pending').then(r => (r.data.data || [])
           .map(x => ({ start: x.startDate, end: x.endDate || x.startDate }))
         ).catch(() => []),
       ]).then(([pendingRegs, pendingOnDuty]) => {
         setWeeklyPendingRanges([...pendingLeaves, ...pendingRegs, ...pendingOnDuty]);
       });
     });
   };

   // Does ANY of the caller's own pending requests touch this date?
   const isDatePending = (dateStr) =>
     weeklyPendingRanges.some(r => dateStr >= r.start && dateStr <= r.end);

   // Fetch attendance covering the Attendance-tab's displayed week. A week can
   // straddle a month boundary, so we load every month the week touches (same
   // /attendance/my?month=&year= endpoint, 0-based month) and merge the rows.
   const fetchAttWeek = (week) => {
     if (!week || !week.length) return;
     const months = new Map();
     [week[0].dateObj, week[6].dateObj].forEach(d => {
       months.set(`${d.getFullYear()}-${d.getMonth()}`, { y: d.getFullYear(), m: d.getMonth() });
     });
     Promise.all([...months.values()].map(({ y, m }) =>
       api.get(`/attendance/my?month=${m}&year=${y}`).then(r => r.data.data || []).catch(() => [])
     )).then(arrs => setAttWeekData(arrs.flat()));

     /* This card had no idea leave existed — it only ever asked attendance,
      * so an approved Casual Leave with (correctly) no punch fell straight
      * through to the same "Absent" a genuinely missed day gets. A week can
      * span two years at most at its very edges (Dec 31 / Jan 1), same
      * reasoning as the months above. */
     const years = [...new Set([...months.values()].map(v => v.y))];
     Promise.all(years.map(y =>
       api.get(`/leaves/my?year=${y}&status=approved&limit=500`).then(r => r.data.data || []).catch(() => [])
     )).then(arrs => setAttWeekLeaves(arrs.flat()));
   };

   // Load the displayed week's records whenever the user navigates Prev/Next.
   // Only the dates matter here (weekend/holiday flags are applied at render),
   // so offset is the only dependency.
   useEffect(() => {
     fetchAttWeek(getCurrentWeek(undefined, [], null, attWeekOffset));
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [attWeekOffset]);

   /* ─ check-in / check-out */
   const handleCheckIn = async () => {
     await checkIn('Office');
     fetchWeeklyAttendance();
     fetchAttWeek(getCurrentWeek(undefined, [], null, attWeekOffset));
   };

   const handleCheckOut = async () => {
     await checkOut('Office');
     fetchWeeklyAttendance();
     fetchAttWeek(getCurrentWeek(undefined, [], null, attWeekOffset));
   };

  const handleStartTimer = async () => {
    if (!timeLogForm.projectId || !timeLogForm.jobId) {
      return toast.error('Please select both project and job');
    }
    setActionLoading(true);
    try {
      const r = await api.post('/time-logs/start', timeLogForm);
      setRunningTimer(r.data.data);
      toast.success('Timer started!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start timer');
    } finally { setActionLoading(false); }
  };

  const handleStopTimer = async () => {
    if (!runningTimer) return;
    setActionLoading(true);
    try {
      await api.post(`/time-logs/stop/${runningTimer._id}`);
      setRunningTimer(null);
      toast.success('Timer stopped and log saved!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to stop timer');
    } finally { setActionLoading(false); }
  };

  /* ─ computed ─ */
  // hrs, mins, secs come directly from AttendanceContext


  /* ─ shift info from user.shift */
  const shift = user?.shift;
  const shiftName = shift?.name || 'No shift assigned';
  /* Was the raw database strings — "09:30 - 18:00" — sitting beside punch
   * times that were already formatted as "01:11 PM". Two conventions on one
   * line. formatTimeRange follows the organisation's 12/24-hour setting, which
   * existed in Settings and was read by nothing. */
  const { timeFormat: orgTimeFormat } = useLocaleFormat();
  const shiftTime = (shift?.start_time && shift?.end_time)
    ? formatTimeRange(shift.start_time, shift.end_time, orgTimeFormat)
    : '';

  /* ─ week range display (Attendance tab — offset-aware) */
  const now = new Date();
  const weekStart = new Date(now);
  // Same Monday-start convention as before, shifted by the navigated week offset.
  weekStart.setDate(now.getDate() - now.getDay() + 1 + attWeekOffset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekRange = `${weekStart.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })} - ${weekEnd.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })}`;
  // The 7-day rows shown in the Attendance tab for the navigated week.
  const attWeek = getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule, attWeekOffset);

  /* ─ My Schedule (current week) — same per-day status rules the old
   * horizontal Work Schedule widget used (Present/Half-day/Absent/Holiday/
   * Weekend/leave label), just computed once into a plain array so the
   * sidebar card below can render it as a vertical list instead of a
   * 7-column grid. No new business logic — identical conditions. */
  const scheduleDays = getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule).map((day) => {
    const rec = weeklyAttendance.find(r => {
      const rDate = new Date(r.date);
      const y = rDate.getFullYear();
      const m = String(rDate.getMonth() + 1).padStart(2, '0');
      const d = String(rDate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}` === day.dateStr;
    });
    const leave = !rec && weeklyLeaves.find(l => {
      if (l.leaveType === 'permission') return false;
      const s = (l.startDate || '').slice(0, 10);
      const e = (l.endDate || '').slice(0, 10);
      return day.dateStr >= s && day.dateStr <= e;
    });
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = day.dateStr === todayStr;
    const isFuture = day.dateStr > todayStr;
    const isPast = day.dateStr < todayStr;
    const isWeekend = day.isWeekend;

    let label = null;
    let labelColor = '';
    if (day.isHoliday) {
      label = day.holidayName ? `${day.holidayName} (Holiday)` : 'Holiday'; labelColor = 'text-teal-500';
    } else if (isWeekend) {
      label = 'Weekend'; labelColor = 'text-orange-500';
    } else if (leave) {
      label = LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType;
      labelColor = 'text-amber-600';
    } else if (isDatePending(day.dateStr)) {
      // left unlabelled on purpose — see isDatePending above
    } else if (isPast || (isToday && isCheckedOut)) {
      const wh = Number(rec?.workingHours) || 0;
      if (!rec || (wh < 4 && rec?.status !== 'half-day')) {
        label = 'Absent'; labelColor = 'text-red-500';
      } else if (rec?.status === 'half-day' || (wh >= 4 && wh < 7.5)) {
        label = 'Half-day'; labelColor = 'text-blue-500';
      } else {
        label = 'Present'; labelColor = 'text-emerald-600';
      }
    } else if (isToday && !isCheckedIn) {
      label = 'Work day'; labelColor = 'text-slate-500';
    }

    let hoursText = null;
    if (!isWeekend && !isFuture) {
      hoursText = isToday && isCheckedIn
        ? `${timerDisplay} Hrs`
        : isToday && isCheckedOut
          ? `${hrs}:${mins} Hrs`
          : rec?.workingHours !== undefined
            ? `${fmtHHMM(rec.workingHours)} Hrs`
            : null;
    }

    return { day, isToday, label, labelColor, hoursText };
  });

  /* ─ tabs ─ */
  // Payslips only appears when payroll is live — see config/features.
  const TABS = ['Announcements', 'Feeds', 'Profile', 'Approvals', 'Leave', 'Attendance',
    ...(canMark ? ['Marking Present/Absent'] : []),
    ...(TIME_TRACKER_ENABLED ? ['Time Logs'] : []),
    ...(PAYROLL_ENABLED ? ['Payslips'] : [])];
  const tabKey = (tab) => (tab === 'Marking Present/Absent' ? 'marking' : tab.toLowerCase().replace(' ', ''));

  return (
    <div className="flex flex-col relative w-full min-h-full font-sans bg-[#f2f3f7]">

      {/* ─ Hero Banner ─ */}
      {/* The banner used to be a hardcoded Unsplash URL, so every dashboard
          load fetched an image from a third party and the two cover-image
          settings on Organization Policy governed nothing. It now comes from
          whatever this person, or the organization, chose. */}
      <div
        className="w-full relative flex-shrink-0 bg-slate-700"
        style={{
          height: 'clamp(130px, 10vw, 170px)',
          ...((cover?.own || cover?.orgCover)
            ? coverStyle(cover.own || cover.orgCover, covers)
            : { backgroundImage: 'url("/cover-bg-greeting.png")', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }),
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/10" />

        {/* "People Progress Together" is baked into the default banner
            photo (public/cover-bg-greeting.png) itself, so it is not
            rendered again here as a separate overlay. */}

        {/* Greeting — overlaid directly on the cover photo. Anchored below
            the top-right controls and above the overlap the content below
            has with the banner, so neither covers it. */}
        <div className="absolute left-5 top-4 flex items-start gap-3 max-w-[65%]">
          {orgLogo && (
            <>
              <img src={orgLogo} alt="" className="h-8 w-auto object-contain drop-shadow-sm mt-1" />
              <div className="h-8 w-[1px] bg-slate-800/15 mt-1"></div>
            </>
          )}
          <div>
            <p className="text-[17px] font-semibold text-slate-800 leading-tight [text-shadow:0_1px_10px_rgba(255,255,255,0.6)]">
              {getGreeting()},
            </p>
            <h1 className="text-[32px] font-extrabold text-slate-900 tracking-tight leading-tight [text-shadow:0_1px_12px_rgba(255,255,255,0.6)]">
              {user?.firstName || 'User'} <span aria-hidden="true">👋</span>
            </h1>
            <p className="text-[15px] text-slate-500 italic font-medium mt-1 [text-shadow:0_1px_8px_rgba(255,255,255,0.6)]">
              “{greetingQuote}”
            </p>
          </div>
        </div>

        {/* Date / weather card */}
        <div className="absolute right-[4%] top-11 bg-white/90 backdrop-blur-sm rounded-lg pl-4 pr-5 py-3 shadow-sm flex items-center gap-2">
          <AnimatedTimeOfDayIcon size={26} />
          <div>
            <p className="text-[15px] font-bold text-slate-800 leading-tight whitespace-nowrap">
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <p className="text-[12.5px] text-slate-500 leading-tight whitespace-nowrap">Have a productive day!</p>
          </div>
        </div>

        <div className="absolute top-2.5 right-5 flex items-center gap-2">
          {/* Access My Payroll — only while payroll is live. */}
          {PAYROLL_ENABLED && (
            <button
              onClick={() => navigate('/payroll/my')}
              className="bg-white/90 backdrop-blur-sm hover:bg-white text-slate-700 text-[14px] font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all shadow-sm border border-white/80"
            >
              <ExternalLink size={12} /> Access my payroll
            </button>
          )}

          {/* ─ Payroll more menu */}
          <div className="relative" ref={payrollMoreRef}>
            <button
              onClick={() => setShowPayrollMore(v => !v)}
              className="bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white w-7 h-7 rounded-md flex items-center justify-center transition-all"
            >
              <MoreHorizontal size={15} />
            </button>
            {showPayrollMore && (
              <div className="absolute right-0 top-9 w-52 bg-white rounded-xl shadow-2xl z-50 border border-slate-100 overflow-hidden py-1">
                <button
                  onClick={() => { navigate('/profile'); setShowPayrollMore(false); }}
                  className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <UserIcon size={14} className="text-slate-400" /> View Profile
                </button>
                {/* Alongside Profile and Settings rather than as a button on the
                    banner: it is changed once and then never again, which is a
                    menu item, not a permanent control over the page. Hidden
                    entirely for anybody who is not allowed to change it. */}
                {canChangeCover && (
                  <button
                    onClick={() => { setShowCover(true); setShowPayrollMore(false); }}
                    className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <ImageIcon size={14} className="text-slate-400" /> Cover image
                  </button>
                )}
                {isFullAccess(user) && (
                  <button
                    onClick={() => { navigate('/settings'); setShowPayrollMore(false); }}
                    className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Settings size={14} className="text-slate-400" /> Settings
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <CoverImageDialog open={showCover} onClose={() => setShowCover(false)} onChanged={loadCover} />

      {/* ─ Main content — quick-action cards slightly overlap the banner's
          bottom edge. ─ */}
      <div className="relative z-10 w-full px-6 -mt-[20px] pb-5">
        {/* Removed the 1200px cap — on wide monitors the right side was
            sitting empty. Let the row stretch with the parent so the
            activity panel fills available width. */}
        <div className="flex items-stretch gap-5 w-full">

          {/* ══ LEFT COLUMN ═══════════════════════════════════════════ */}
          <div className="w-[280px] flex-shrink-0 flex flex-col gap-3">

            {/* Profile card */}
            <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.08)] border border-slate-200 text-center pb-3">
              {/* Avatar — passport style. Clickable: opens a Zoho-style modal
                  showing the full photo plus a "Change Image" button that
                  navigates to the Profile page. Sits fully inside the card
                  (no negative margin pulling it up over the top border) so
                  it never overlaps the hero banner's hill shape behind it. */}
              <div className="flex justify-center">
                <div className="relative w-24 mt-3.5">
                  <button
                    type="button"
                    onClick={() => setAvatarOpen(true)}
                    title="View profile photo"
                    className="w-24 h-24 rounded-full bg-slate-50 border-4 border-white flex items-center justify-center text-slate-300 shadow-xl relative z-10 overflow-hidden hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer transition-colors"
                  >
                    <ImgWithFallback src={user?.photoUrl} alt="avatar" className="w-full h-full object-cover"
                      fallback={<UserIcon size={48} strokeWidth={1} className="opacity-30" />} />
                  </button>
                  {/* Presence dot — same isCheckedIn state the status badge
                      and timer below already use. */}
                  <span className={`absolute z-20 bottom-1 right-1 w-3.5 h-3.5 rounded-full border-[3px] border-white ${isCheckedIn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                </div>
              </div>

              <div className="mt-1.5 px-4">
                {/* Full name */}
                <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
                  {user?.firstName} {user?.lastName}
                </h2>
                {/* Designation */}
                <p className="text-[12.5px] text-slate-500 mt-0.5">
                  {user?.designation || 'Employee'}
                </p>

                {/* Employee ID / Department / Work Location — same fields
                    the Profile tab already shows (profileData, fetched on
                    mount), laid out as a compact label/value table. */}
                <div className="mt-2 pt-2 border-t border-slate-100 text-left space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] text-slate-400">Employee ID</span>
                    <span className="text-[14.5px] font-semibold text-slate-800">{user?.employeeId || '—'}</span>
                  </div>
                  {profileData?.department && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] text-slate-400">Department</span>
                      <span className="text-[14.5px] font-semibold text-slate-800 truncate max-w-[150px]" title={profileData.department}>{profileData.department}</span>
                    </div>
                  )}
                  {profileData?.workLocation && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] text-slate-400">Location</span>
                      <span className="text-[14.5px] font-semibold text-slate-800 truncate max-w-[150px]" title={profileData.workLocation}>{profileData.workLocation}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status + timer – Zoho clean style */}
              <div className="mt-2 flex flex-col items-center gap-1.5">
                {/* Status badge */}
                <span className={`text-[12px] font-bold px-3 py-0.5 rounded ${
                  isCheckedOut
                    ? 'text-rose-600'
                    : isCheckedIn
                      ? 'text-emerald-600'
                      : 'text-slate-500'
                }`}>
                  {isCheckedOut ? 'Out' : isCheckedIn ? 'In' : 'Not Checked In'}
                </span>

                {/* Zoho-style timer: each two-digit segment in its own
                    rounded gray pill, separated by colons.
                    HH : MM : SS */}
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-[15px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2 py-0.5 min-w-[36px] text-center leading-none">{hrs}</span>
                  <span className="text-[14px] font-bold text-slate-400">:</span>
                  <span className="text-[15px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2 py-0.5 min-w-[36px] text-center leading-none">{mins}</span>
                  <span className="text-[14px] font-bold text-slate-400">:</span>
                  <span className="text-[15px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2 py-0.5 min-w-[36px] text-center leading-none">{secs}</span>
                </div>
              </div>

              {/* Check-in / out button */}
              <div className="mt-2 px-6" data-tour="checkin-btn">
                {!isCheckedIn && !isCheckedOut && (
                  <button
                    onClick={handleCheckIn}
                    disabled={attActionLoading}
                    className="w-full bg-slate-700 hover:bg-slate-800 text-white text-[13px] font-bold py-1.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
                  >
                    <LogIn size={13} /> Check-in
                  </button>
                )}
                {isCheckedIn && (
                  <button
                    onClick={handleCheckOut}
                    disabled={attActionLoading}
                    className="w-full border-2 border-rose-500 text-rose-500 hover:bg-rose-50 text-[13px] font-bold py-1.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <LogOut size={13} /> Check-out
                  </button>
                )}
                {isCheckedOut && record?.checkOut && (
                  <div className="space-y-1.5">
                    <p className="text-[11.5px] text-slate-400 font-medium">
                      Checked out at <span className="text-slate-600 font-bold">{fmt.instant(record.checkOut)}</span>
                    </p>
                    <button
                      onClick={handleCheckIn}
                      disabled={attActionLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-1.5 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <LogIn size={13} /> Re-check-in
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reporting Manager Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">Reporting Manager</h3>
              {(manager || profileData?.manager) ? (() => {
                const mgr = manager || profileData?.manager;
                return (
                  <>
                    <div
                      className="flex items-center gap-3 -m-1 p-1 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => navigate(`/employees/${mgr.id || mgr._id}`)}
                    >
                      <div className="relative flex-shrink-0">
                        <img
                          src={`https://ui-avatars.com/api/?name=${mgr.firstName}+${mgr.lastName}&background=e0e7ff&color=4f46e5&size=44`}
                          className="w-12 h-12 rounded-full border border-slate-100"
                          alt="manager"
                        />
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${PRESENCE_DOT[presenceOf(mgr)] || 'bg-slate-300'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold text-slate-700 truncate">
                          {mgr.employeeId} - {mgr.firstName}
                        </p>
                        <p className="text-[12.5px] text-slate-500 truncate">{mgr.designation || <PresenceLabel person={mgr} />}</p>
                      </div>
                    </div>
                    {/* Reuses the real /chat page — same feature the top-bar
                        chat icon opens, not a new messaging system. */}
                    <button
                      onClick={() => navigate('/chat')}
                      className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-slate-600 border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50 transition-colors"
                    >
                      <MessageSquare size={13} /> Message
                    </button>
                  </>
                );
              })() : (
                <p className="text-[14px] text-slate-400 italic">No manager assigned</p>
              )}
            </div>

             {/* Department Members — compact avatar strip; full names/
                 presence/search are still one click away via the "+N More"
                 modal below. */}
             <div className="flex-1 bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md transition-shadow">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="text-[14px] font-bold text-slate-800">
                   Department Members{deptMembers.length > 0 ? ` (${deptMembers.length})` : ''}
                 </h3>
                 {deptMembers.length > 4 && (
                   <button onClick={() => setMembersModalOpen(true)}
                     className="text-[12.5px] font-bold text-[#4a7a2c] hover:text-[#3b6122] transition-colors">
                     View all
                   </button>
                 )}
               </div>
               {loadingDeptMembers ? (
                 <div className="flex items-center gap-2">
                   <div className="w-6 h-6 border-[3px] border-[#5c9636] border-t-transparent rounded-full animate-spin" />
                   <span className="text-[12px] text-slate-500">Loading...</span>
                 </div>
               ) : deptMembers.length === 0 ? (
                 <span className="text-[12px] text-slate-500 italic">No team members found</span>
               ) : (
                 <div className="flex items-center -space-x-2">
                   {deptMembers.slice(0, 4).map((member) => (
                     <button key={member._id} type="button" onClick={() => navigate(`/employees/${member._id}`)}
                       title={`${member.employeeId} - ${member.firstName}${member.firstName ? ' · ' : ''}${PRESENCE_LABEL[presenceOf(member)] || ''}`}
                       className="relative w-10 h-10 rounded-full border-2 border-white bg-slate-100 overflow-hidden hover:z-10 hover:ring-2 hover:ring-[#c5e0a8] transition-all shrink-0">
                       <ImgWithFallback src={member.photoUrl} alt={member.firstName} className="w-full h-full object-cover"
                         fallback={<User size={18} className="m-auto mt-2.5 text-slate-300" />} />
                       <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-[1.5px] border-white ${PRESENCE_DOT[presenceOf(member)] || 'bg-slate-300'}`} />
                     </button>
                   ))}
                   {deptMembers.length > 4 && (
                     <button onClick={() => setMembersModalOpen(true)}
                       className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 text-slate-600 text-[12px] font-bold flex items-center justify-center hover:bg-slate-200 transition-colors shrink-0">
                       +{deptMembers.length - 4}
                     </button>
                   )}
                 </div>
               )}
             </div>
          </div>

          {/* ══ RIGHT OF PROFILE — quick actions span the full width of
              the center+schedule area, then split into the center/schedule
              sub-columns below that row. dash-outer-col gives the quick
              actions grid a container-query context sized to that full
              combined width; dash-center-col (on the narrower sub-column
              below) gives the stat-cards grid its own, smaller one. */}
          <div className="dash-outer-col flex-1 min-w-0 flex flex-col gap-3">

            {/* Quick Actions row — always exactly 6 cards, so a fixed
                column count that shrinks per-card (via the container
                query breakpoints in index.css) is used instead of
                auto-fit/auto-fill, which can leave one card short of
                fitting and silently wrap it alone onto its own row. */}
            <div className="qa-grid gap-2">
              {[
                { label: 'Apply Leave', sub: 'Take time off', img: '/icons/dashboard/01-calendar-green.svg', onClick: () => setRequestModal({ kind: 'leave', date: null }) },
                { label: 'Mark Attendance', sub: 'Check in now', img: '/icons/dashboard/02-fingerprint-blue.svg', onClick: () => navigate('/attendance/checkin') },
                // Payroll is built but not switched on for employees yet
                // (PAYROLL_ENABLED in config/features.js) — the card still
                // shows, but stays a "Coming soon" tile like Learning Portal
                // until that flag flips, same as every other payroll entry
                // point in the app.
                PAYROLL_ENABLED
                  ? { label: 'View Payslip', sub: 'Salary details', img: '/icons/dashboard/03-document-orange.svg', onClick: () => navigate('/payroll/my') }
                  : { label: 'View Payslip', sub: 'Salary details', img: '/icons/dashboard/03-document-orange.svg', disabled: true },
                { label: 'My Requests', sub: 'Track requests', img: '/icons/dashboard/04-clipboard-purple.svg', onClick: () => navigate('/leave-tracker/requests') },
                { label: 'Learning Portal', sub: 'Grow your skills', img: '/icons/dashboard/05-graduation-cap-green.svg', disabled: true },
                { label: 'Directory', sub: 'Find colleagues', img: '/icons/dashboard/06-users-blue.svg', onClick: () => navigate('/directory') },
              ].map((qa) => (
                qa.disabled ? (
                  <div key={qa.label} title="Coming soon"
                    className="h-[112px] bg-white rounded-xl border border-slate-200 p-2.5 flex flex-col justify-between gap-1.5 cursor-not-allowed">
                    <img src={qa.img} alt="" className="w-9 h-9" />
                    <div>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">{qa.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{qa.sub}</p>
                    </div>
                  </div>
                ) : (
                  <button key={qa.label} onClick={qa.onClick}
                    className="h-[112px] bg-white rounded-xl border border-slate-200 p-2.5 flex flex-col justify-between gap-1.5 text-left shadow-sm hover:shadow-md hover:border-slate-300 transition-all group">
                    <div className="flex items-center justify-between">
                      <img src={qa.img} alt="" className="w-9 h-9" />
                      <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-slate-700 leading-tight">{qa.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{qa.sub}</p>
                    </div>
                  </button>
                )
              ))}
            </div>

            {/* ── Sub-row below quick actions: center (stats + tabs) next
                to the schedule column. ── */}
            <div className="flex items-stretch gap-5 w-full">
            <div className="dash-center-col flex-1 min-w-0 min-h-0 flex flex-col gap-3">

            {/* Stat cards row — visible only to approver roles, same
                audience TeamSpace.jsx already serves /team/space to. */}
            {isApprover(user) && teamSpace && (
              <div className="stat-grid gap-2">
                <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src="/icons/dashboard/07-users-blue-alt.svg" alt="" className="w-8 h-8 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[17px] font-extrabold text-slate-800 leading-none">{teamSpace.teamStrength ?? 0}</p>
                      <p className="text-[11px] text-slate-500 mt-1">Total Team Members</p>
                    </div>
                  </div>
                  {/* Cropped to just its bar-chart half — the badge half
                      carried a hardcoded "↑12%" that doesn't reflect real
                      data, so only the bars (decorative) are shown. */}
                  <div className="relative h-7 w-8 overflow-hidden flex-shrink-0" aria-hidden="true">
                    <img src="/icons/dashboard/08-growth-badge-12pct.svg" alt=""
                      className="absolute h-7 w-auto max-w-none -left-[47px]" />
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={16} strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[17px] font-extrabold text-slate-800 leading-none">{teamSpace.teamAvailability?.in ?? 0}</p>
                      <p className="text-[11px] text-slate-500 mt-1">Present Today</p>
                    </div>
                  </div>
                  {/* Present / total team strength — derived from the same
                      two numbers already shown on this row, not a separate
                      fetch. */}
                  {(() => {
                    const totalStrength = teamSpace.teamStrength || 0;
                    const presentCount = teamSpace.teamAvailability?.in ?? 0;
                    const pct = totalStrength > 0 ? Math.round((presentCount / totalStrength) * 100) : 0;
                    const radius = 13, circumference = 2 * Math.PI * radius;
                    return (
                      <div className="relative w-8 h-8 flex-shrink-0">
                        <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
                          <circle cx="16" cy="16" r={radius} fill="none" stroke="#D5F0DC" strokeWidth="4" />
                          <circle cx="16" cy="16" r={radius} fill="none" stroke="#16B84A" strokeWidth="4"
                            strokeLinecap="round" strokeDasharray={`${(pct / 100) * circumference} ${circumference}`} />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-slate-800">{pct}%</span>
                      </div>
                    );
                  })()}
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src="/icons/dashboard/10-airplane-orange.svg" alt="" className="w-8 h-8 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[17px] font-extrabold text-slate-800 leading-none">{teamSpace.teamAvailability?.onLeave ?? 0}</p>
                      <p className="text-[11px] text-slate-500 mt-1">On Leave</p>
                    </div>
                  </div>
                  <img src="/icons/dashboard/11-bars-orange.svg" alt="" className="h-6 w-auto flex-shrink-0" />
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src="/icons/dashboard/12-document-red.svg" alt="" className="w-8 h-8 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[17px] font-extrabold text-slate-800 leading-none">{pendingApprovals.length}</p>
                      <p className="text-[11px] text-slate-500 mt-1">Open Requests</p>
                    </div>
                  </div>
                  <img src="/icons/dashboard/13-bars-red.svg" alt="" className="h-6 w-auto flex-shrink-0" />
                </div>
              </div>
            )}

          {/* ══ TABS CARD ═════════════════════════════════════════════
              Wrapped in a `relative` placeholder that carries the flex-1 +
              min-height instead of the card itself, with the card absolutely
              positioned (`inset-0`) inside it. An absolutely positioned
              element contributes nothing to its container's content-based
              (auto) sizing — without this, the card's own content (e.g. the
              Attendance tab's full weekly list) would count toward how tall
              this column "wants" to be before the schedule column ever gets
              a chance to stretch it, growing the whole page with whichever
              tab happens to be open instead of scrolling inside the card. */}
          <div className="relative flex-1 min-h-[280px] lg:min-h-[480px]">
          <div className="absolute inset-0 min-w-0 bg-white rounded-xl shadow-[0_4px_25px_rgba(0,0,0,0.05)] border border-slate-200 flex flex-col overflow-hidden">

            {/* Tabs row */}
            <div className="flex items-center border-b border-slate-100 bg-white sticky top-0 z-20">
              <div className="flex items-center gap-5 px-4 overflow-x-auto scrollbar-none flex-1">
                {TABS.map(tab => (
                  <Tab
                    key={tab}
                    active={activeTab === tabKey(tab)}
                    onClick={() => setActiveTab(tabKey(tab))}
                  >
                    {tab}
                  </Tab>
                ))}
              </div>
            </div>

            {/* Tab body — min-h-0 lets this actually shrink to the space the
                stretched card gives it (instead of growing to fit whatever
                the active tab's content is) so overflow-y-auto can clip and
                scroll long content, like the Attendance tab's weekly list,
                in place, keeping the page's height independent of which
                tab is open. */}
            <div key={activeTab} className="flex-1 min-h-0 bg-[#f8f9fc] overflow-y-auto tab-scroll p-4 pr-5 space-y-3">

              {/* ─ Announcements tab — the default tab. Reuses the same
                  `feeds` data and card markup Feeds' own "Announcements"
                  filter shows, just promoted to its own top-level tab (no
                  composer, no filter chips — those stay on Feeds). */}
              {activeTab === 'announcements' && (
                <div className="space-y-3">
                  {(() => {
                    const shown = feeds.filter(f => f.tab === 'announcements');
                    return shown.length > 0 ? (
                      shown.map((f, i) => (
                        <FeedCard key={i}>
                          <div className="flex items-center gap-2.5 mb-2">
                            <img
                              src={f.type === 'urgent'
                                ? '/icons/dashboard/28-mandatory-announcement-shield-green.svg'
                                : '/icons/dashboard/27-announcement-megaphone-red.svg'}
                              alt="" className="w-8 h-8 flex-shrink-0"
                            />
                            <div>
                              <p className="text-[12.5px] font-bold text-slate-800">{f.title}</p>
                              <p className="text-[11.5px] text-slate-400 font-medium">
                                {fmt.instant(f.createdAt)} • {f.type?.toUpperCase() || 'UPDATE'}
                              </p>
                            </div>
                          </div>
                          {f.body && (
                            <p className="text-[12.5px] text-slate-600 leading-relaxed">
                              {f.body}
                            </p>
                          )}
                        </FeedCard>
                      ))
                    ) : (
                      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm">
                        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Megaphone size={22} className="text-slate-200" />
                        </div>
                        <p className="text-[12.5px] font-bold text-slate-400">No announcements yet</p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ─ Activities tab — hidden from navigation (no TABS entry
                  points to this key anymore), kept fully intact so nothing
                  that reads from it elsewhere breaks. ─ */}
              {activeTab === 'activities' && (
                <div className="flex flex-col gap-4">
                  {/* Good Morning Banner */}
                  {/* Card itself is the sky — gradient changes through the day
                      (dawn / morning / afternoon / dusk / night). The sun
                      stays fixed in the right slot, only its tint + dots
                      adapt. Card stays light enough to keep dark text legible
                      around the clock. */}
                  <div className={`greeting-banner bg-gradient-to-r ${getTimeOfDaySky()} rounded-xl border border-slate-200 p-5 flex items-center gap-5 shadow-sm transition-colors duration-500`}>
                    {/* The organization's own logo, set under Organization
                        Details. This was a hardcoded AltiusNxt file, so every
                        company using this saw somebody else's brand on their
                        home page. With none set the block is dropped entirely
                        rather than leaving a gap and a divider around nothing. */}
                    {orgLogo && (
                      <>
                        <div className="flex items-center">
                          <img src={orgLogo} alt="" className="h-10 w-auto object-contain" />
                        </div>
                        <div className="h-10 w-[1px] bg-slate-200"></div>
                      </>
                    )}
                    <div className="flex-1">
                      {/* Heading scaled up + heavier weight to match Zoho's
                          prominence — was 15px font-bold slate-800, now
                          18px extrabold slate-900 so it carries the same
                          visual weight as the AltiusNxt logo beside it. */}
                      <h4 className="text-[18px] font-extrabold text-slate-900 tracking-tight">
                        {getGreeting()} {user?.firstName || 'User'}
                      </h4>
                      <p className="text-[13.5px] text-slate-500 mt-1">Have a productive day!</p>
                    </div>
                    {/* Animated time-of-day icon — rotating rays + pulsing
                        core + soft glow, swapped for a moon overnight. */}
                    <AnimatedTimeOfDayIcon size={96} />
                  </div>

                  {/* ─ Announcements card — surfaces unread + urgent + recent ─ */}
                  {announcements.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-500">
                            <Megaphone size={16} />
                          </div>
                          <div>
                            <h4 className="text-[16px] font-bold text-slate-800">Announcements</h4>
                            <p className="text-[14px] text-slate-500">
                              {announcements.filter(a => !a.isRead).length > 0
                                ? `${announcements.filter(a => !a.isRead).length} new`
                                : 'You’re all caught up'}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => navigate('/announcements')}
                          className="text-[14px] font-bold text-[#1a73e8] hover:text-[#1557B0] transition-colors"
                        >
                          View all
                        </button>
                      </div>

                      <div className="flex flex-col gap-2">
                        {announcements.slice(0, 3).map((a) => {
                          const created = new Date(a.createdAt);
                          const ago = (() => {
                            const diff = Math.max(0, Date.now() - created.getTime());
                            const mins = Math.floor(diff / 60000);
                            if (mins < 60)  return `${mins}m ago`;
                            const hrs  = Math.floor(mins / 60);
                            if (hrs < 24)   return `${hrs}h ago`;
                            const days = Math.floor(hrs / 24);
                            if (days < 7)   return `${days}d ago`;
                            return created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                          })();
                          const isUrgent = a.type === 'urgent';
                          return (
                            <button
                              key={a._id}
                              onClick={() => {
                                // Optimistic mark-as-read; server call is fire-and-forget.
                                if (!a.isRead) {
                                  setAnnouncements(prev => prev.map(x => x._id === a._id ? { ...x, isRead: true } : x));
                                  api.post(`/announcements/${a._id}/read`).catch(() => {});
                                }
                                // Read it here. This used to leave the Home page
                                // for the full list to show a message the card
                                // already had, and the list then clipped it too.
                                setReadingAnnouncement(a);
                              }}
                              className={`text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                                a.isRead
                                  ? 'border-slate-200 hover:border-slate-300 bg-white'
                                  : 'border-blue-100 bg-blue-50/40 hover:bg-blue-50'
                              }`}
                            >
                              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                                isUrgent ? 'bg-red-500' : a.isRead ? 'bg-slate-300' : 'bg-[#1a73e8]'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`text-[15px] truncate ${a.isRead ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`}>
                                    {a.title}
                                  </p>
                                  {isUrgent && (
                                    <span className="text-[12px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENT</span>
                                  )}
                                  {!a.isRead && !isUrgent && (
                                    <span className="text-[12px] font-bold text-[#1a73e8] bg-blue-100 px-1.5 py-0.5 rounded">NEW</span>
                                  )}
                                </div>
                                <p className="text-[14px] text-slate-500 mt-0.5 line-clamp-1">{richTextToPlain(a.body)}</p>
                                <p className="text-[13px] text-slate-400 mt-1">
                                  {a.postedBy?.firstName} {a.postedBy?.lastName} · {ago}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                   {/* Work Schedule 7-day widget */}
                   <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                     <div className="flex items-center gap-3 mb-6">
                       <div className="w-8 h-8 rounded-full bg-[#D6E8FF] flex items-center justify-center text-[#1a73e8]">
                         <Clock size={16} />
                       </div>
                        <div>
                          <h4 className="text-[16px] font-bold text-slate-800">Work Schedule</h4>
                          <p className="text-[14px] text-slate-500">
                            {getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule).length > 0 
                              ? `${getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule)[0].dateObj.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })} - ${getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule)[6].dateObj.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })}`
                              : ''
                            }
                          </p>
                        </div>
                     </div>
                     
                     <div className="relative">
                       {/* Shift Bar */}
                       <div className="h-14 bg-[#D6E8FF] border-l-[3px] border-[#1a73e8] flex flex-col justify-center px-4 rounded-r-md">
                         <p className="text-[15px] font-bold text-[#1a73e8]">{shiftName}</p>
                         <p className="text-[13px] font-semibold text-[#1a73e8]/80">{shiftTime}</p>
                       </div>

                        <div className="grid grid-cols-7 mt-8 relative">
                          <div className="absolute top-[3px] left-[7%] right-[7%] h-[1px] bg-slate-200 z-0"></div>
                          {getCurrentWeek(user?.shift?.workingDays, holidays, isWeekendByRule).map((day, i) => {
                            const record = weeklyAttendance.find(r => {
                              const rDate = new Date(r.date);
                              const y = rDate.getFullYear();
                              const m = String(rDate.getMonth() + 1).padStart(2, '0');
                              const d = String(rDate.getDate()).padStart(2, '0');
                              return `${y}-${m}-${d}` === day.dateStr;
                            });
                            // Approved leave covering this day — only checked when there is
                            // no attendance record, so a day the person also worked keeps
                            // showing what they actually did. Permission excluded, same as
                            // everywhere else: hours within a worked day, not a day off.
                            // l.startDate is a DATE column serialized to a full timestamp,
                            // not a bare "YYYY-MM-DD" — sliced the same defensive way the
                            // other two widgets already do.
                            const leave = !record && weeklyLeaves.find(l => {
                              if (l.leaveType === 'permission') return false;
                              const s = (l.startDate || '').slice(0, 10);
                              const e = (l.endDate || '').slice(0, 10);
                              return day.dateStr >= s && day.dateStr <= e;
                            });
                            const todayStr = new Date().toISOString().split('T')[0];
                            const isToday   = day.dateStr === todayStr;
                            const isFuture  = day.dateStr > todayStr;
                            const isPast    = day.dateStr < todayStr;
                            const isWeekend = day.isWeekend;

                            // Match Zoho People: every past working day carries a status label
                            // (Present / Half-day / Absent). Today gets the same label once
                            // checked out — checked-in-but-not-yet-checked-out shows no label,
                            // just the live ticking hours below. Future days show no status.
                            // "Late" is never surfaced here — it lives in the detailed attendance view.
                            let label = null;        // text under the date
                            let labelColor = '';     // tailwind class
                            if (day.isHoliday) {
                              label = day.holidayName ? `${day.holidayName}(Holiday)` : 'Holiday'; labelColor = 'text-teal-500';
                            } else if (isWeekend) {
                              label = 'Weekend'; labelColor = 'text-orange-500';
                            } else if (leave) {
                              label = LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType;
                              labelColor = 'text-amber-600';
                            } else if (isDatePending(day.dateStr)) {
                              /* A pending leave/permission/regularization/on-duty request of the
                               * caller's own touches this date, and nothing recomputes the stored
                               * verdict when it resolves — so whatever we'd say now (even "Absent")
                               * is a promise this page cannot keep. Reference product leaves the
                               * day unlabelled — hours only — until the request is decided; label
                               * stays null and the hours still render below. */
                            } else if (isPast || (isToday && isCheckedOut)) {
                              const wh = Number(record?.workingHours) || 0;
                              if (!record || (wh < 4 && record?.status !== 'half-day')) {
                                label = 'Absent'; labelColor = 'text-red-500';
                              } else if (record?.status === 'half-day' || (wh >= 4 && wh < 7.5)) {
                                label = 'Half-day'; labelColor = 'text-blue-500';
                              } else {
                                label = 'Present'; labelColor = 'text-emerald-600';
                              }
                            }
                            // Today while still checked in (no checkout yet): no status label —
                            // just the live ticking hours below. Future: also no status label.

                            return (
                              <div
                                key={i}
                                className="flex flex-col items-center relative z-10"
                              >
                                <div className={`w-[7px] h-[7px] rounded-full mb-3 ${isToday ? 'bg-[#1a73e8] ring-4 ring-[#D6E8FF]' : 'bg-slate-300'}`}></div>
                                <p className="text-[14px] font-medium text-slate-500">
                                  {day.day} <span className={`font-bold ml-0.5 ${isToday ? 'bg-[#1a73e8] text-white px-1.5 py-0.5 rounded' : 'text-slate-800'}`}>{day.dateNum}</span>
                                </p>
                                {label && (
                                  <p className={`text-[13px] font-bold mt-1 ${labelColor}`}>{label}</p>
                                )}
                                {!isWeekend && !isFuture && (
                                  <p className="text-[13px] text-slate-800 font-medium mt-0.5">
                                    {isToday && isCheckedIn
                                      ? `${timerDisplay} Hrs`
                                      : isToday && isCheckedOut
                                        ? `${hrs}:${mins} Hrs`
                                        : record?.workingHours !== undefined
                                          ? `${fmtHHMM(record.workingHours)} Hrs`
                                          : '00:00 Hrs'
                                    }
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                  {/* Upcoming Holidays */}
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-8 h-8 rounded-full bg-cyan-50 flex items-center justify-center text-cyan-500">
                        <Calendar size={16} />
                      </div>
                      <h4 className="text-[16px] font-bold text-slate-800">Upcoming Holidays</h4>
                    </div>
                    
                    <div className="flex gap-4 overflow-hidden pb-2">
                      {(() => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        // An Exception Working Day (type='working_day') is the
                        // opposite of a holiday — a day off that was turned into
                        // a mandatory working day — so it does not belong in a
                        // list meant to tell people when they're next off.
                        const upcoming = holidays.filter(h => h.type !== 'working_day' && new Date(h.date) >= today);

                        if (upcoming.length === 0) {
                          return <p className="text-[15px] text-slate-400 italic py-2">No upcoming holidays</p>;
                        }
                        
                        return (
                          <>
                            {upcoming.slice(0, 3).map((h, i) => {
                              const hd = new Date(h.date);
                              return (
                                <div key={i} className="flex-1 min-w-[180px] border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition-colors cursor-pointer">
                                  <p className="text-[15px] font-bold text-slate-800">{h.name}</p>
                                  <p className="text-[13px] text-slate-500 mt-1.5">
                                    {hd.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}, {hd.toLocaleDateString('en-US', { weekday: 'long' })}
                                  </p>
                                </div>
                              );
                            })}
                            <button onClick={() => navigate('/leave-tracker/holidays')} className="text-[14px] font-bold text-[#1a73e8] hover:text-[#1557B0] flex items-center px-2 shrink-0 transition-colors">
                              View all
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* ─ Feeds tab ─ */}
              {activeTab === 'feeds' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0">
                        <UserIcon size={20} />
                      </div>
                      <div className="flex-1">
                        <textarea
                          placeholder="Share something with your colleagues..."
                          className="w-full bg-slate-50 border-none rounded-xl p-3 text-[13.5px] text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100 resize-none min-h-[80px] transition-all"
                        />
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-50">
                          <div className="flex items-center gap-3 text-slate-400">
                            <button className="hover:text-indigo-600 transition-colors"><Star size={18}/></button>
                            <button className="hover:text-indigo-600 transition-colors"><MessageSquare size={18}/></button>
                          </div>
                          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-1.5 rounded-lg text-[15px] font-bold shadow-lg shadow-indigo-900/10 transition-all">
                            Post
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Feed Filters — mirror the notification bell, grouped into tabs */}
                  <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
                    {[['All', 'all'], ['Shifts', 'shifts']].map(([label, key]) => (
                      <button
                        key={key}
                        onClick={() => setFeedTab(key)}
                        className={`px-4 py-1.5 rounded-full text-[14px] font-bold whitespace-nowrap transition-all ${
                          feedTab === key ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Real Feed Cards — filtered to the active tab (All shows everything) */}
                  {(() => {
                    const shown = feedTab === 'all' ? feeds : feeds.filter(f => f.tab === feedTab);
                    return shown.length > 0 ? (
                    shown.map((f, i) => (
                      <FeedCard key={i}>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-[20px] border border-slate-100">
                            {f.icon || '📌'}
                          </div>
                          <div>
                            <p className="text-[13.5px] font-bold text-slate-800">{f.title}</p>
                            <p className="text-[13px] text-slate-400 font-medium">
                              {fmt.instant(f.createdAt)} • {f.type?.toUpperCase() || 'UPDATE'}
                            </p>
                          </div>
                        </div>
                        {f.body && (
                          <p className="text-[13.5px] text-slate-600 leading-relaxed">
                            {f.body}
                          </p>
                        )}
                      </FeedCard>
                    ))
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Activity size={28} className="text-slate-200" />
                      </div>
                      <p className="text-[13.5px] font-bold text-slate-400">No activity in your feed yet</p>
                    </div>
                  );
                  })()}
                </div>
              )}

              {/* ─ Profile tab ─ */}
              {activeTab === 'profile' && (
                profileLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 animate-pulse">
                    <div className="w-16 h-16 bg-slate-100 rounded-full mb-3"/>
                    <div className="h-4 w-32 bg-slate-100 rounded"/>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-[14px] font-bold text-slate-700 uppercase tracking-wider">Basic Information</h3>
                        <button className="text-[13px] text-blue-600 font-bold hover:underline" onClick={() => navigate('/profile')}>Edit Full Profile</button>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-50">
                        {[
                          { label: 'Employee ID',   val: profileData?.employeeId },
                          { label: 'Email',         val: profileData?.email },
                          { label: 'Phone',         val: profileData?.phone },
                          { label: 'Date of Birth', val: profileData?.dateOfBirth ? new Date(profileData.dateOfBirth + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : null },
                          { label: 'Joining Date',  val: profileData?.joiningDate  ? new Date(profileData.joiningDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : null },
                          { label: 'Company',       val: profileData?.company },
                        ].map(({ label, val }) => (
                          <div key={label} className="px-5 py-3 border-b border-slate-50">
                            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
                            <p className="text-[15px] font-semibold text-slate-800">{val || '-'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {profileData?.shift?.name && (
                      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
                        <h3 className="text-[14px] font-bold text-slate-700 uppercase tracking-wider mb-2">Shift</h3>
                        <p className="text-[15px] font-semibold text-slate-800">{profileData.shift.name}</p>
                        <p className="text-[13px] text-slate-500 mt-0.5">{profileData.shift.startTime} – {profileData.shift.endTime}</p>
                      </div>
                    )}
                  </div>
                )
              )}

              {/* ─ Approvals tab ─ */}
              {activeTab === 'approvals' && (
                loadingApprovals ? (
                  <div className="flex justify-center py-14">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : pendingApprovals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <CheckCircle size={32} className="text-slate-200 mb-3"/>
                    <p className="text-[15px] font-semibold text-slate-500">No pending approvals</p>
                    <p className="text-[14px] text-slate-400 mt-1">Leave and WFH requests you need to approve will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingApprovals.map(approval => (
                      <div key={approval._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm hover:border-blue-200 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 overflow-hidden flex-shrink-0">
                            <ImgWithFallback src={approval.employee?.photoUrl} alt="avatar" className="w-full h-full object-cover"
                              fallback={<User size={20} />} />
                          </div>
                          <div>
                            <p className="text-[15px] font-bold text-slate-800">
                              {approval.employee?.firstName} {approval.employee?.lastName}
                            </p>
                            <p className="text-[14px] text-slate-500 capitalize">
                              {approval._kind === 'compoff' ? `Comp-Off · ${approval.daysEarned} day(s)` :
                               approval._kind === 'regularization' ? 'Attendance Regularization' :
                               approval._kind === 'wfh' ? 'Work From Home' :
                               approval.leaveType === 'permission' ? `Permission · ${formatHoursDuration(approval.hours)}` :
                               `${approval.leaveType} Leave · ${approval.totalDays} Day(s)`}
                            </p>
                            <p className="text-[13px] text-slate-400 mt-0.5">
                              {(() => {
                                const d = approval.workedDate || approval.date || approval.startDate;
                                if (!d) return '';
                                const dt = new Date(String(d).slice(0,10) + 'T00:00:00');
                                const s = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                                if (!approval.endDate || approval.startDate === approval.endDate) return s;
                                const dt2 = new Date(String(approval.endDate).slice(0,10) + 'T00:00:00');
                                return `${s} - ${dt2.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
                              })()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          {/* Same rule the Approvals screen applies: an approver
                              may not act on their own request. The server
                              refuses it either way, but a button that always
                              403s is worse than no button. */}
                          {approval.canAct !== false && approval.employee?._id !== user?._id && (
                            <>
                              <button
                                onClick={() => actOnApproval(approval, 'approved')}
                                disabled={actingApproval === approval._id}
                                className="text-[14px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                              >
                                {actingApproval === approval._id ? '…' : 'Approve'}
                              </button>
                              {/* Same gate as Approvals.jsx: the server refuses
                                  approveAll from team_incharge, and regularizations
                                  and on-duty ignore the flag and approve one level. */}
                              {['admin', 'director', 'hr_admin', 'manager'].includes(user?.role)
                                && ['leaves', 'comp-off', 'wfh'].includes(approval._endpoint) && (
                                <button
                                  onClick={() => { if (window.confirm('Approve all remaining levels for this request? This skips any other pending approvers.')) actOnApproval(approval, 'approved', true); }}
                                  disabled={actingApproval === approval._id}
                                  className="text-[14px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  Approve All
                                </button>
                              )}
                              <button
                                onClick={() => actOnApproval(approval, 'rejected')}
                                disabled={actingApproval === approval._id}
                                className="text-[14px] font-bold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {/* Leave Approvals, not Leave Tracker. This pointed at
                              the Leave Tracker workspace, whose default tab is
                              User-specific Operations — so Review landed on an
                              employee search box with the request nowhere in
                              sight. Approvals.jsx already reads ?openId=, picks
                              the tab the request is actually on and opens its
                              detail; it was only ever being handed to the wrong
                              screen. */}
                          <button
                            onClick={() => navigate(`/more-services/operations/leave-approvals?openId=${approval._id}`)}
                            className="text-[14px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* ─ Leave tab — all configured leave types (same source as Leave
                   Tracker → Leave Summary; clean local icons override any
                   mojibake-stored backend icon). ─ */}
              {activeTab === 'leave' && (() => {
                const L_ICON = { casual: '☀️', comp_off: '⭐', unpaid: '📋', permission: '🔑', sick: '🏥', earned: '💼' };
                const L_BG   = { casual: 'bg-amber-50', comp_off: 'bg-green-50', unpaid: 'bg-gray-50', permission: 'bg-purple-50', sick: 'bg-red-50', earned: 'bg-blue-50' };
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {leaveCards.length === 0 ? (
                      <p className="text-[15px] text-slate-400 italic col-span-full">No leave types configured.</p>
                    ) : leaveCards.map(l => (
                      <div key={l.code} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                        <div className={`absolute top-0 right-0 w-16 h-16 ${L_BG[l.code] || 'bg-slate-50'} rounded-bl-full flex items-center justify-center pl-4 pb-4 opacity-50`}>
                          <span className="text-3xl">{L_ICON[l.code] || '📋'}</span>
                        </div>
                        <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-1">{l.name}</p>
                        <h4 className="text-[28px] font-bold text-emerald-500 tracking-tighter">{l.available === null || l.available === undefined ? '—' : l.available}</h4>
                        <p className="text-[13px] text-slate-400 font-medium">Available</p>
                        <button
                          onClick={() => {
                            // Comp-Off has its own earn/claim workflow (worked date +
                            // requested comp-off date) — send the user there instead of
                            // the generic leave modal.
                            if (l.code === 'comp_off') { navigate('/leave-tracker/comp-off'); return; }
                            setApplyLeaveType(l.code);
                          }}
                          className="mt-4 w-full bg-slate-50 hover:bg-slate-100 text-slate-600 text-[14px] font-bold py-1.5 rounded-lg border border-slate-200 transition-all"
                        >
                          Apply
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {activeTab === 'marking' && canMark && <ManualAttendance embedded />}

              {/* ─ Attendance tab — Zoho-style weekly log ─ */}
              {activeTab === 'attendance' && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                    <h3 className="text-[16px] font-bold text-slate-700">
                      {attWeekOffset === 0 ? 'This Week' : attWeekOffset === -1 ? 'Last Week' : attWeekOffset === 1 ? 'Next Week' : 'Week'}
                    </h3>
                    {/* Previous / Next week navigation — loads that week's records. */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setAttWeekOffset(o => o - 1)} title="Previous week"
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700">
                        <ChevronLeft size={15} />
                      </button>
                      <span className="text-[13px] font-bold text-[#1a73e8] bg-blue-50 px-3 py-1 rounded-full whitespace-nowrap">{weekRange}</span>
                      <button onClick={() => setAttWeekOffset(o => Math.min(0, o + 1))} disabled={attWeekOffset >= 0} title="Next week"
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        <ChevronRight size={15} />
                      </button>
                      {attWeekOffset !== 0 && (
                        <button onClick={() => setAttWeekOffset(0)} className="text-[13px] text-[#1a73e8] hover:underline font-medium ml-0.5">Today</button>
                      )}
                    </div>
                  </div>
                  <div>
                    {attWeek.map((row, i) => {
                      // Match the API record by *local* date — Postgres DATEs come back as
                      // UTC midnight, which is the previous day in IST, so a naive
                      // string-prefix match misses today's row.
                      const att = attWeekData.find((a) => {
                        if (!a.date) return false;
                        const d = new Date(a.date);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        return `${y}-${m}-${day}` === row.dateStr;
                      });
                      // Approved leave covering this day, if any — checked
                      // ONLY to explain a day with no punch. A day the
                      // person also worked (att exists) keeps showing what
                      // they actually did; Permission is excluded for the
                      // same reason it is everywhere else, it is not a day
                      // off. l.startDate is a DATE column serialized to a
                      // full timestamp, not a bare "YYYY-MM-DD" — sliced
                      // the same defensive way LeaveCalendar.jsx now does.
                      const leave = !att && attWeekLeaves.find(l => {
                        if (l.leaveType === 'permission') return false;
                        const s = (l.startDate || '').slice(0, 10);
                        const e = (l.endDate || '').slice(0, 10);
                        return row.dateStr >= s && row.dateStr <= e;
                      });
                      const isWeekend = row.isWeekend;
                      const todayCA   = new Date().toLocaleDateString('en-CA');
                      const isToday   = row.dateStr === todayCA;
                      const isPast    = row.dateStr < todayCA;
                      /* Any working day up to today. This required an
                       * attendance record to exist, which hid the option on
                       * exactly the days that most need it: a day with no
                       * punch at all shows as Absent and cannot be corrected,
                       * while a day already punched — the one that needs
                       * correcting least — offers it. Forgetting to check in
                       * is the ordinary reason to regularize.
                       *
                       * The backend never had this restriction. It accepts a
                       * date with no attendance row and, on approval, inserts
                       * one. Only the button was missing.
                       *
                       * isWeekend covers holidays too — getCurrentWeek sets it
                       * for any holiday that closes the office. The deadline is
                       * left to the server, which knows each person's window
                       * and says when it closed. */
                      const canRegularize = !isWeekend && (isToday || isPast);

                      const checkInTxt  = att?.checkIn  ? fmt.instant(att.checkIn)  : 'No check-in';
                      const checkOutTxt = att?.checkOut ? fmt.instant(att.checkOut) : 'No check-out';
                      const hoursTxt = (() => {
                        if (isToday && isCheckedIn) return `${timerDisplay} Hrs`;
                        if (att?.workingHours !== undefined) return `${fmtHHMM(att.workingHours)} Hrs`;
                        return null;
                      })();

                      return (
                        <div
                          key={i}
                          className={`group flex items-stretch gap-4 px-6 py-4 border-b border-slate-100 last:border-b-0 transition-colors ${
                            isWeekend ? 'bg-amber-50/40' : isToday ? 'bg-blue-50/30' : 'hover:bg-slate-50/60'
                          }`}
                        >
                          {/* Day + date label */}
                          <div className="w-[70px] flex-shrink-0 flex flex-col justify-center">
                            <p className={`text-[15px] font-semibold ${isWeekend ? 'text-amber-500' : 'text-slate-700'}`}>
                              {row.day}
                            </p>
                            {isToday ? (
                              <span className="text-[16px] font-bold text-white bg-[#1a73e8] px-1.5 py-0.5 rounded mt-1 inline-block w-fit">
                                {row.dateNum}
                              </span>
                            ) : (
                              <p className={`text-[16px] font-bold mt-1 ${isWeekend ? 'text-amber-500' : 'text-slate-700'}`}>
                                {row.dateNum} <span className="text-[13px] font-medium text-slate-400">{row.dateObj.toLocaleDateString('en-US', { month: 'short' })}</span>
                              </p>
                            )}
                          </div>

                          {/* Wide shift bar */}
                          <div className="flex-1 bg-[#E8F0FE] border-l-[3px] border-[#1a73e8] rounded-r px-4 py-3 flex flex-col justify-center min-w-0">
                            <p className="text-[13.5px] font-semibold text-slate-800 truncate">{shiftName}</p>
                            <p className="text-[13px] text-slate-500 truncate">{shiftTime}</p>
                          </div>

                          {/* Punch info + status text */}
                          <div className="w-[280px] flex-shrink-0 flex flex-col justify-center text-[15px]">
                            {(() => {
                              // Compute the status badge ("Present" / "Half-day" / "Absent")
                              // for non-weekend, non-future rows that have a real record OR
                              // are today-and-checked-in. Matches Zoho's label hierarchy.
                              const wh = Number(att?.workingHours) || 0;
                              let statusLabel = null;
                              let statusColor = '';
                              if (att) {
                                if (att.status === 'half-day' || (wh >= 4 && wh < 7.5)) {
                                  statusLabel = 'Half-day'; statusColor = 'text-blue-500';
                                } else if (wh < 4 && !isToday) {
                                  statusLabel = 'Absent'; statusColor = 'text-rose-500';
                                } else if (att.checkOut) {
                                  // Only mark Present once the day is closed — Zoho convention.
                                  // While the user is still on the clock (today, checked in but
                                  // not yet out) we leave the label blank; the live timer is
                                  // already conveying the state.
                                  statusLabel = 'Present'; statusColor = 'text-emerald-600';
                                }
                              }

                              if (row.isHoliday) {
                                return (
                                  <>
                                    <p className="text-slate-600">No check-in - No check-out</p>
                                    <p className="text-[14px] font-semibold text-teal-500 mt-1">
                                      {row.holidayName ? `${row.holidayName}(Holiday)` : 'Holiday'}
                                    </p>
                                  </>
                                );
                              }
                              if (isWeekend) {
                                return (
                                  <>
                                    <p className="text-slate-600">No check-in - No check-out</p>
                                    <p className="text-[14px] font-semibold text-amber-500 mt-1">Weekend</p>
                                  </>
                                );
                              }
                              if (att) {
                                return (
                                  <>
                                    <p className="text-slate-700">
                                      <span className={!att.checkIn  ? 'text-slate-400' : ''}>{checkInTxt}</span>
                                      <span className="text-slate-400"> - </span>
                                      <span className={!att.checkOut ? 'text-slate-400' : ''}>{checkOutTxt}</span>
                                      {hoursTxt && (
                                        <>
                                          <span className="text-slate-400 mx-1">·</span>
                                          <span className="font-semibold text-slate-700">{hoursTxt}</span>
                                        </>
                                      )}
                                    </p>
                                    {statusLabel && (
                                      <p className={`text-[14px] font-semibold mt-1 ${statusColor}`}>{statusLabel}</p>
                                    )}
                                  </>
                                );
                              }
                              if (leave) {
                                return (
                                  <>
                                    <p className="text-slate-400">No check-in - No check-out</p>
                                    <p className="text-[14px] font-semibold text-amber-600 mt-1">
                                      {LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType}
                                    </p>
                                  </>
                                );
                              }
                              if (isToday && isCheckedIn) {
                                /* Fallback: user is checked in but the weekly fetch hasn't
                                   caught up yet — still show the live timer. */
                                return (
                                  <>
                                    <p className="text-slate-700">
                                      <span>{record?.checkIn ? fmt.instant(record.checkIn) : 'Checked in'}</span>
                                      <span className="text-slate-400"> - </span>
                                      <span className="text-slate-400">No check-out</span>
                                      <span className="text-slate-400 mx-1">·</span>
                                      <span className="font-semibold text-slate-700">{timerDisplay} Hrs</span>
                                    </p>
                                    <p className="text-[14px] font-semibold text-emerald-600 mt-1">Present</p>
                                  </>
                                );
                              }
                              if (isPast) {
                                return (
                                  <>
                                    <p className="text-slate-400">No check-in - No check-out</p>
                                    <p className="text-[14px] font-semibold text-rose-500 mt-1">Absent</p>
                                  </>
                                );
                              }
                              return <span />;
                            })()}
                          </div>

                          {/* Add Request — hover-revealed, hidden for weekends */}
                          <div className="w-[140px] flex-shrink-0 flex items-center justify-end">
                            {!isWeekend && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Hand the BUTTON's rect to RequestMenu — it measures its
                                  // own rendered height in a useLayoutEffect and decides
                                  // above/below from there. No more height guesses.
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setShowRequestMenu({
                                    buttonRect: {
                                      top: rect.top, bottom: rect.bottom,
                                      left: rect.left, right: rect.right,
                                    },
                                    canRegularize,
                                    // The day this row is for. Without it the
                                    // form opened on today whatever you clicked.
                                    date: row.dateStr,
                                  });
                                }}
                                // On touch devices `group-hover` never fires, so the trigger
                                // stayed invisible. opacity-100 by default + lg:opacity-0 with
                                // lg:group-hover:opacity-100 restores the hover-reveal aesthetic on
                                // desktop while keeping the button reachable on mobile/tablet.
                                className="request-menu-trigger opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 text-[14px] font-semibold text-[#1a73e8] hover:text-[#1557B0] border border-[#1a73e8]/40 hover:border-[#1a73e8] hover:bg-blue-50 rounded px-3 py-1.5 transition-opacity"
                              >
                                + Add Request
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─ Time Logs tab ─ */}
              {activeTab === 'timelogs' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-[17px] font-bold text-slate-800">Track Work Time</h3>
                      <button className="text-indigo-600 text-[14px] font-bold hover:underline">View All Logs</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
                      <div className="space-y-2">
                        <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Project</label>
                        <select 
                          value={timeLogForm.projectId}
                          onChange={e => setTimeLogForm({...timeLogForm, projectId: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-100 transition-all appearance-none"
                        >
                          <option value="">Select Project</option>
                          {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Job Name</label>
                        <select 
                          value={timeLogForm.jobId}
                          onChange={e => setTimeLogForm({...timeLogForm, jobId: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-100 transition-all appearance-none"
                        >
                          <option value="">Select Job</option>
                          {jobs.map(j => <option key={j._id} value={j._id}>{j.name}</option>)}
                        </select>
                      </div>
                    </div>

                    {runningTimer ? (
                      <button 
                        onClick={handleStopTimer}
                        disabled={actionLoading}
                        className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 rounded-xl shadow-xl shadow-rose-900/10 flex items-center justify-center gap-3 transition-all transform hover:-translate-y-0.5"
                      >
                        <Clock size={20} className="animate-pulse" /> Stop Recording
                      </button>
                    ) : (
                      <button 
                        onClick={handleStartTimer}
                        disabled={actionLoading}
                        className="w-full bg-[#1a1d35] hover:bg-[#2a2f55] text-white font-bold py-4 rounded-xl shadow-xl shadow-indigo-900/10 flex items-center justify-center gap-3 transition-all transform hover:-translate-y-0.5"
                      >
                        <Clock size={20} /> Start Recording
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ─ Payslips tab ─ */}
              {activeTab === 'payslips' && (() => {
                const fmtINR = (n) => n != null
                  ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—';
                const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
                      <Filter size={14} className="text-[#1a73e8]" />
                      <span className="text-[15px] font-semibold text-slate-700">Financial Year :</span>
                      <select
                        value={payslipFY}
                        onChange={e => setPayslipFY(e.target.value)}
                        className="border border-slate-200 rounded px-2 py-1 text-[14px] font-bold text-[#1a73e8] outline-none focus:border-blue-300 bg-white"
                      >
                        {(fyList.length > 0 ? fyList : [payslipFY]).map(fy => (
                          <option key={fy} value={fy}>Financial Year : {fy.replace('-', '–')} ▾</option>
                        ))}
                      </select>
                    </div>
                    {payslipsLoading ? (
                      <div className="flex justify-center py-12">
                        <div className="w-6 h-6 border-[3px] border-[#1a73e8] border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : payslips.length === 0 ? (
                      <div className="p-14 text-center">
                        <Briefcase size={28} className="text-slate-200 mx-auto mb-3" />
                        <p className="text-[15px] font-semibold text-slate-500">No payslips found for FY {payslipFY.replace('-', '–')}</p>
                        <p className="text-[14px] text-slate-400 mt-1">Payslips will appear once generated by HR.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-slate-100">
                              {[['month','Month'],['grossPay','Gross Pay'],['reimbursements','Reimbursements'],['deductions','Deductions'],['takeHome','Take Home'],[null,'Payslips'],[null,'Tax Worksheet']].map(([k, h]) => (
                                <SortableTh key={h} sort={k ? payslipSort : null} k={k} className={`px-5 py-3 text-[13px] font-semibold text-slate-500 uppercase tracking-wider ${['Gross Pay','Reimbursements','Deductions','Take Home'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</SortableTh>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {payslipSort.sorted.map(p => (
                              <tr key={p._id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-3.5">
                                  <button className="text-[15px] font-semibold text-[#1a73e8] hover:underline">
                                    {MONTHS[(p.month || 1) - 1]} {p.year}
                                  </button>
                                </td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700 text-right tabular-nums">{fmtINR(p.grossPay)}</td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700 text-right tabular-nums">{fmtINR(p.reimbursements)}</td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700 text-right tabular-nums">{fmtINR(p.deductions)}</td>
                                <td className="px-5 py-3.5 text-[13.5px] font-bold text-slate-800 text-right tabular-nums">{fmtINR(p.takeHome)}</td>
                                <td className="px-5 py-3.5">
                                  <button
                                    onClick={() => downloadPayslip(p._id)}
                                    disabled={payslipDownloading === p._id}
                                    className="text-[15px] font-semibold text-[#1a73e8] hover:underline disabled:opacity-40"
                                  >
                                    {payslipDownloading === p._id ? 'Downloading…' : 'View'}
                                  </button>
                                </td>
                                <td className="px-5 py-3.5">
                                  {p.taxWorksheetUrl
                                    ? <a href={p.taxWorksheetUrl} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-[#1a73e8] hover:underline">View</a>
                                    : <span className="text-[14px] text-slate-400">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* ─ end of payslips tab */}
            </div>
          </div>
          </div>
          </div>

          {/* ══ RIGHT SIDEBAR — My Schedule / Leave Balance ══ */}
          <div className="w-[300px] flex-shrink-0 space-y-3">

            {/* My Schedule — current-week data (weeklyAttendance/weeklyLeaves/
                holidays via scheduleDays above), shown as a vertical list. */}
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <img src="/icons/dashboard/14-calendar-navy.svg" alt="" className="w-6 h-6" />
                  <h4 className="text-[14px] font-bold text-slate-800">My Schedule</h4>
                </div>
                <button onClick={() => navigate('/calendar')} className="text-[12.5px] font-bold text-blue-600 hover:text-blue-700 transition-colors">
                  View Calendar
                </button>
              </div>
              {scheduleDays.length > 0 && (
                <p className="text-[12px] text-slate-400 mb-2">
                  {scheduleDays[0].day.dateObj.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })} - {scheduleDays[6].day.dateObj.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })}
                </p>
              )}
              <div className="divide-y divide-slate-100">
                {scheduleDays.map((sd, i) => (
                  <div key={i} className={`flex items-center justify-between py-1.5 ${sd.isToday ? '-mx-2 px-2 bg-[#f2f8ec] rounded-lg border-l-[3px] border-[#4a7a2c]' : ''}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="text-center w-9">
                        <p className="text-[11px] text-slate-400 uppercase leading-none">{sd.day.day}</p>
                        <p className={`text-[13px] font-bold mt-0.5 ${sd.isToday ? 'text-[#4a7a2c]' : 'text-slate-700'}`}>{sd.day.dateNum}</p>
                      </div>
                      <p className={`text-[13px] font-semibold ${sd.labelColor || 'text-slate-600'}`}>
                        {sd.label || 'Work day'}
                      </p>
                    </div>
                    <p className="text-[12.5px] text-slate-500">{sd.hoursText || '—'}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave Balance — same /leaves/balance data already loaded for
                the Leave tab (leaveCards). */}
            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <img src="/icons/dashboard/14-calendar-navy.svg" alt="" className="w-6 h-6" />
                  <h4 className="text-[14px] font-bold text-slate-800">Leave Balance</h4>
                </div>
                <button onClick={() => navigate('/leave-tracker/balance')} className="text-[12.5px] font-bold text-[#4a7a2c] hover:text-[#3b6122] transition-colors">
                  View Details
                </button>
              </div>
              {leaveCards.length === 0 ? (
                <p className="text-[13px] text-slate-400 italic">No leave types configured</p>
              ) : (() => {
                // Only Casual Leave + Permission shown here — Comp Off and
                // Leave Without Pay are still fetched in leaveCards and
                // remain one click away via "View Details".
                const featured = leaveCards.filter(c => c.code === 'casual' || c.code === 'permission');
                const shown = featured.length > 0 ? featured : leaveCards.slice(0, 2);
                return (
                  <div className="grid grid-cols-2 gap-2.5">
                    {shown.map(c => {
                      const isUnlimited = c.available === null && c.code === 'unpaid';
                      return (
                        <div key={c.code} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                          <img src={LEAVE_CODE_ICON[c.code] || '/icons/dashboard/17-user-purple.svg'} alt="" className="w-6 h-6 mb-1.5" />
                          <p className="text-[16px] font-extrabold text-slate-800 leading-none">{isUnlimited ? '0' : (c.available ?? '—')}</p>
                          <p className="text-[11.5px] text-slate-500 mt-1 truncate" title={c.name || LEAVE_TYPE_LABELS[c.code] || c.code}>
                            {c.name || LEAVE_TYPE_LABELS[c.code] || c.code}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ── Bottom row: banner (left) + Quick Links (center) + quote (right) ── */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1.4fr_1.5fr_1fr] gap-5 items-stretch">

        {/* Promo banner image. Non-interactive: nothing on the other side of
            "Explore Learning" exists yet (Learning Portal is still a "Coming
            soon" tile elsewhere on this page), so the button in the image
            is decorative, not a dead link. */}
        <div className="h-[120px] rounded-xl overflow-hidden shadow-sm">
          <img
            src="/plant-growth-banner.png"
            alt="A better you builds a brighter tomorrow. Learn, Grow, Belong."
            className="w-full h-full object-cover object-left block"
          />
        </div>

        {/* Quick Links — one row across the wider center column. */}
        <div className="min-w-0 h-[120px] bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm flex flex-col justify-center">
          <h4 className="text-[13px] font-bold text-slate-800 mb-2">Quick Links</h4>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-2 gap-y-2">
            {[
              { label: 'HR Policies', img: '/icons/dashboard/26-document-photo-navy.svg', to: '/policies' },
              { label: 'IT Support', img: '/icons/dashboard/25-monitor-navy.svg' },
              { label: 'Expense Claims', img: '/icons/dashboard/24-overlap-squares-navy.svg' },
              { label: 'Documents', img: '/icons/dashboard/23-document-navy.svg', to: '/documents' },
              { label: 'Internal Jobs', img: '/icons/dashboard/22-briefcase-navy.svg' },
              { label: 'Feedback', img: '/icons/dashboard/21-chat-bubbles-navy.svg' },
            ].map(link => (
              link.to ? (
                <button key={link.label} onClick={() => navigate(link.to)}
                  className="flex flex-col items-center gap-1 py-1 rounded-lg hover:bg-slate-50 transition-colors">
                  <img src={link.img} alt="" className="w-6 h-6" />
                  <span className="text-[10.5px] font-semibold text-slate-600 text-center leading-tight">{link.label}</span>
                </button>
              ) : (
                <div key={link.label} title="Coming soon"
                  className="flex flex-col items-center gap-1 py-1 rounded-lg cursor-not-allowed">
                  <img src={link.img} alt="" className="w-6 h-6" />
                  <span className="text-[10.5px] font-semibold text-slate-600 text-center leading-tight">{link.label}</span>
                </div>
              )
            ))}
          </div>
        </div>

        {/* Motivational quote */}
        <div className="min-w-0 h-[120px] bg-gradient-to-br from-emerald-50 to-sky-50 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center px-6">
          <p className="text-[15px] font-semibold text-slate-800 leading-snug">
            “Progress happens<br />when people grow together.”
          </p>
          <p className="text-[12px] text-slate-400 mt-2">— AltiusNxt</p>
          <svg width="36" height="9" viewBox="0 0 40 10" className="mt-1.5 text-[#4a7a2c]" aria-hidden="true">
            <path d="M2 7 Q 10 1, 20 5 T 38 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      </div>

      {applyLeaveType && (
        <LeaveRequestDialog
          mode="apply"
          initialLeaveType={applyLeaveType}
          types={leaveCards}
          selfOnly
          selfEmployeeId={user?._id}
          selfLabel={`${user?.firstName || ''} ${user?.lastName || ''} ${user?.employeeId || ''}`.trim()}
          onClose={() => setApplyLeaveType(null)}
          onSaved={() => {
            // The card just applied against should show its new balance
            // without a full page reload.
            api.get('/leaves/balance').then(r => setLeaveCards(r.data.data || [])).catch(() => {});
          }}
        />
      )}
       {/* Add Request menu — opened from the Attendance Weekly Log rows.
           RequestMenu owns its own positioning logic now; we just hand it
           the button's bounding rect. */}
       {showRequestMenu && (
         <RequestMenu
           buttonRect={showRequestMenu.buttonRect}
           canRegularize={!!showRequestMenu.canRegularize}
           onPick={(kind) => setRequestModal({ kind, date: showRequestMenu.date })}
           onClose={() => setShowRequestMenu(null)}
         />
       )}

       {/* The four request forms, opened in place from a day row. */}
       {requestModal?.kind === 'regularize' && (
         <RegularizeModal date={requestModal.date}
           onClose={() => setRequestModal(null)}
           onDone={() => { setRequestModal(null); fetchWeeklyAttendance(); }} />
       )}
       {requestModal?.kind === 'onduty' && (
         <OnDutyModal date={requestModal.date}
           onClose={() => setRequestModal(null)}
           onDone={() => { setRequestModal(null); fetchWeeklyAttendance(); }} />
       )}
       {(requestModal?.kind === 'leave' || requestModal?.kind === 'compoff') && (
         <ApplyLeaveModal date={requestModal.date}
           mode={requestModal.kind === 'compoff' ? 'compoff' : 'leave'}
           onClose={() => setRequestModal(null)}
           onDone={() => { setRequestModal(null); fetchWeeklyAttendance(); }} />
       )}

       {/* Department Members Modal */}
       {membersModalOpen && (
         <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
           <div className="bg-white rounded-xl w-full max-w-[500px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
             <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
               <h3 className="text-[16px] font-bold text-slate-800">Department Members</h3>
               <button onClick={() => { setMembersModalOpen(false); setMembersSearch(''); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
                 <X size={16}/>
               </button>
             </div>

             <div className="p-4 border-b border-slate-100">
               <div className="relative">
                 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input
                   type="text"
                   value={membersSearch}
                   onChange={e => setMembersSearch(e.target.value)}
                   placeholder="Search Employee"
                   className="w-full pl-9 pr-4 py-2 text-[15px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                 />
                 {membersSearch !== '' && (
                   <button onClick={() => setMembersSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                     <X size={14} />
                   </button>
                 )}
               </div>
             </div>

             <div className="flex-1 overflow-y-auto max-h-[60vh] p-4">
               <div className="flex flex-col">
                 {deptMembers
                   .filter(m => membersSearch ? `${m.firstName} ${m.lastName} ${m.employeeId}`.toLowerCase().includes(membersSearch.toLowerCase()) : true)
                   .map(member => (
                   <div key={member._id} onClick={() => { setMembersModalOpen(false); navigate(`/employees/${member._id}`); }}
                     className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors rounded-lg px-2 cursor-pointer">
                     <div className="relative flex-shrink-0">
                       <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 overflow-hidden">
                         <ImgWithFallback src={member.photoUrl} alt="avatar" className="w-full h-full object-cover"
                           fallback={<User size={24} />} />
                       </div>
                     </div>
                     <div className="min-w-0 flex-1 pt-0.5">
                       <p className="text-[15px] font-bold text-slate-700 truncate">{member.employeeId} - {member.firstName}</p>
                       <PresenceLabel person={member} />
                     </div>
                   </div>
                 ))}
                 {deptMembers.filter(m => membersSearch ? `${m.firstName} ${m.lastName} ${m.employeeId}`.toLowerCase().includes(membersSearch.toLowerCase()) : true).length === 0 && (
                   <p className="text-center text-slate-500 text-[15px] py-4">No employees found matching your search.</p>
                 )}
               </div>
             </div>
           </div>
         </div>
       )}

       {/* ─ Avatar lightbox (Zoho-People style) ─
        *  Triggered by clicking the profile photo above the check-in
        *  timer. Shows a large preview + a "Change Image" button which
        *  navigates to the Profile page where the cropper / upload UI
        *  already lives. Click anywhere outside the card or press Esc
        *  to close. */}
       {avatarOpen && (
         <div
           className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
           onClick={() => setAvatarOpen(false)}
           role="dialog"
           aria-modal="true"
         >
           <div
             className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
             onClick={(e) => e.stopPropagation()}
           >
             <button
               type="button"
               onClick={() => setAvatarOpen(false)}
               className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center"
               aria-label="Close"
             >
               <X size={16} />
             </button>
             <div className="flex flex-col items-center">
               <div className="w-64 h-64 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center mb-4">
                 <ImgWithFallback src={user?.photoUrl} alt={user?.firstName || 'avatar'} className="w-full h-full object-cover"
                   fallback={<UserIcon size={120} strokeWidth={1} className="text-slate-300" />} />
               </div>
               <p className="text-[15px] font-semibold text-slate-700">
                 {user?.employeeId} <span className="text-slate-400 font-normal">-</span> {user?.firstName} {user?.lastName}
               </p>
               {/* Open the OS file picker — the chosen file flows into
                   PhotoCropperModal (rendered below) where the user
                   can drag + zoom to position before upload. */}
               <button
                 type="button"
                 onClick={() => photoFileRef.current?.click()}
                 disabled={photoUploading}
                 className="mt-5 w-full border border-blue-500 text-blue-600 hover:bg-blue-50 font-semibold py-2.5 rounded-lg text-[15px] transition-colors disabled:opacity-60"
               >
                 {photoUploading ? 'Uploading…' : '✎ Change Image'}
               </button>
               <input
                 ref={photoFileRef}
                 type="file"
                 accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                 onChange={handleDashPhotoPicked}
                 className="hidden"
               />
             </div>
           </div>
         </div>
       )}

       {/* Shared crop modal — sits on top of the avatar lightbox so the
           user can position/zoom their picked photo, then on Save we
           upload and close both modals. */}
       <PhotoCropperModal
         src={cropSrc}
         uploading={photoUploading}
         onSave={handleDashCropSave}
         onCancel={() => setCropSrc(null)}
       />

       {readingAnnouncement && (
         <AnnouncementDetailModal
           announcement={readingAnnouncement}
           onClose={() => setReadingAnnouncement(null)}
         />
       )}
     </div>
   );
}
