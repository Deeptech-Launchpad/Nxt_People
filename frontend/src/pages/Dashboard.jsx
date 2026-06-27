import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';
import { useAttendance } from '../context/AttendanceContext';
import { useWeekendRules } from '../context/WeekendRulesContext';
import { useNavigate } from 'react-router-dom';

import {
  Megaphone, Clock, ExternalLink, User as UserIcon,
  MoreHorizontal, LogIn, LogOut,
  Calendar, Star, CheckCircle,
  MessageSquare, Briefcase, Filter, X, Activity, Settings, User, Search,
  ChevronLeft, ChevronRight
} from 'lucide-react';

import api from '../utils/api';
import toast from 'react-hot-toast';
import PhotoCropperModal from '../components/PhotoCropperModal';

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

      if (exception) {
        if (exception.type === 'working_day') {
          isWeekend = false;
        } else {
          isWeekend = true; // Treat holidays as weekends for absent-mark prevention.
        }
      }

      week.push({
        dateStr,
        day: dayStr,
        dateNum: day,
        isWeekend,
        isHoliday: !!exception && exception.type !== 'working_day',
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
const PresenceLabel = ({ person }) => {
  const p = presenceOf(person);
  if (!p) return null;
  return <span className={`text-[13px] font-medium ${PRESENCE_COLOR[p]}`}>{PRESENCE_LABEL[p]}</span>;
};

/* ─ Tab button ─ */
const Tab = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`py-3.5 px-1 text-[15px] font-medium border-b-[2.5px] transition-all whitespace-nowrap mt-[2px] cursor-pointer
      ${active
        ? 'border-[#3b82f6] text-[#1a1d35] font-semibold'
        : 'border-transparent text-[#777] hover:text-[#333]'
      }`}
  >
    {children}
  </button>
);

/* ─ Feed card ─ */
const FeedCard = ({ icon, children }) => (
  <div className="bg-white rounded border border-slate-200 p-4 flex items-start gap-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow">
    {icon && (
      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-slate-50 border border-slate-100 text-slate-400">
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
const RequestMenu = ({ buttonRect, onClose, canRegularize = false }) => {
  const navigate = useNavigate();
  const menuRef  = useRef(null);
  // Start fully off-screen on first paint so the user doesn't see a
  // flash at the wrong position; useLayoutEffect re-positions before
  // the browser paints.
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
            onClick={() => { navigate(opt.path); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 transition-colors text-left group"
          >
            <span className="text-base bg-slate-50 group-hover:bg-blue-100/50 w-7 h-7 flex items-center justify-center rounded-lg border border-slate-100 group-hover:border-blue-200 transition-colors">{opt.icon}</span>
            <span className="text-[15px] font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const {
    isCheckedIn, isCheckedOut, timerDisplay,
    hrs, mins, secs,
    checkIn, checkOut,
    actionLoading: attActionLoading, record
  } = useAttendance();
  const { isWeekend: isWeekendByRule } = useWeekendRules();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('activities');
  const [feedTab, setFeedTab] = useState('all');

  /* ─ Dropdown state ─ */
  const [showPayrollMore, setShowPayrollMore] = useState(false);
  const [showRequestMenu, setShowRequestMenu] = useState(null);
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
   // Attendance tab — independent week navigation (0 = current, -1 = prev, +1 = next)
   // so browsing weeks here never disturbs the current-week Work Schedule widget.
   const [attWeekOffset, setAttWeekOffset] = useState(0);
   const [attWeekData, setAttWeekData] = useState([]);
   const [actionLoading, setActionLoading] = useState(false);

  /* Dashboard data */
   const [announcements, setAnnouncements] = useState([]);
   const [projects, setProjects] = useState([]);
   const [jobs, setJobs] = useState([]);
   const [holidays, setHolidays] = useState([]);

   /* Feeds data */
   const [feeds, setFeeds] = useState([]);

   /* ─ Full profile (fetched lazily when Profile tab is opened) */
   const [profileData, setProfileData] = useState(null);
   const [profileLoading, setProfileLoading] = useState(false);

   /* ─ Leave state */
   const [leaveModal, setLeaveModal] = useState(false);
   const [leaveForm, setLeaveForm] = useState({ type: 'casual', fromDate: '', toDate: '', teamEmail: '', reason: '', startTime: '', endTime: '' });
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

    /* ─ Department members state ─ */
    const [deptMembers, setDeptMembers] = useState([]);
    const [loadingDeptMembers, setLoadingDeptMembers] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(false);

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
   // Helper: log + report widget failures so a network blip doesn't leave the
   // Dashboard rendering stale empty arrays forever with no signal. We don't
   // toast each one (too noisy if the whole API is down), but we do log them
   // for Sentry/console and bump a banner counter that the UI can choose to
   // surface. Each widget keeps rendering — partial Dashboard is still useful.
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

    // Department Members = everyone in the same department as the logged-in user
    // (self excluded), sourced from the role-open org directory so it's complete
    // for every role — not just the viewer's direct reports.
    const fetchDeptMembers = () => {
      if (!profileData?.department) return;
      setLoadingDeptMembers(true);
      const myId = user?._id || profileData?.id;
      api.get('/org/directory')
        .then(r => {
          const members = (r.data.data || []).filter(m =>
            m.department === profileData.department && String(m._id) !== String(myId)
          );
          setDeptMembers(members);
        })
        .catch(() => setDeptMembers([]))
        .finally(() => setLoadingDeptMembers(false));
    };

    useEffect(() => {
      if (profileData?.department) {
        fetchDeptMembers();
      }
    }, [profileData?.department, profileData?.manager]);

   /* ─ load payslips when tab is active or FY changes */
  useEffect(() => {
    if (activeTab !== 'payslips') return;
    setPayslipsLoading(true);
    Promise.all([
      api.get('/payslips?fy=' + payslipFY),
      api.get('/payslips/fy-list').catch(() => ({ data: { data: [] } })),
    ]).then(([p, fl]) => {
      setPayslips(p.data.data || []);
      setFyList(fl.data.data || []);
    }).catch(() => {}).finally(() => setPayslipsLoading(false));
   }, [activeTab, payslipFY]);

   /* ─ load pending approvals when tab is active */
   useEffect(() => {
     if (activeTab !== 'approvals') return;
     setLoadingApprovals(true);
     api.get('/leaves/pending-approvals')
       .then(r => setPendingApprovals(r.data.data || []))
       .catch(err => toast.error('Failed to load pending approvals'))
       .finally(() => setLoadingApprovals(false));
   }, [activeTab]);

   /* ─ load all leave-type balances for the Leave tab (same source as
        Leave Tracker → Leave Summary, so every configured type shows). */
   useEffect(() => {
     api.get('/leaves/balance')
       .then(r => setLeaveCards(r.data.data || []))
       .catch(() => setLeaveCards([]));
   }, []);

   // Fetch weekly attendance (used by Work Schedule widget)
   const fetchWeeklyAttendance = () => {
     const now = new Date();
     api.get(`/attendance/my?month=${now.getMonth()}&year=${now.getFullYear()}`)
       .then(r => setWeeklyAttendance(r.data.data || []))
       .catch(() => setWeeklyAttendance([]));
   };

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
  const shiftName = shift?.name || 'General Shift';
  const shiftTime = (shift?.start_time && shift?.end_time)
    ? `${shift.start_time} - ${shift.end_time}`
    : '9:30 AM - 6:00 PM';

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

  /* ─ tabs ─ */
  const TABS = ['Activities', 'Feeds', 'Profile', 'Approvals', 'Leave', 'Attendance', 'Time Logs'];

  return (
    <div className="flex flex-col relative w-full min-h-full font-sans bg-[#f2f3f7]">

      {/* ─ Hero Banner ─ */}
      <div
        className="w-full h-[200px] relative flex-shrink-0"
        style={{
          backgroundImage: 'url("https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=2000&auto=format&fit=crop")',
          backgroundSize: 'cover',
          backgroundPosition: 'center 35%',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/10" />
        <div className="absolute top-4 right-6 flex items-center gap-2">
          {/* Access My Payroll */}
          <button
            onClick={() => navigate('/payroll/my')}
            className="bg-white/90 backdrop-blur-sm hover:bg-white text-slate-700 text-[14px] font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all shadow-sm border border-white/80"
          >
            <ExternalLink size={12} /> Access my payroll
          </button>

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

      {/* ─ Main content (overlaps banner by ~80px) ─ */}
      <div className="relative z-10 w-full px-6 -mt-[80px] pb-12">
        {/* Removed the 1200px cap — on wide monitors the right side was
            sitting empty. Let the row stretch with the parent so the
            activity panel fills available width. */}
        <div className="flex items-start gap-5 w-full">

          {/* ══ LEFT COLUMN ═══════════════════════════════════════════ */}
          <div className="w-[280px] flex-shrink-0 space-y-4">

            {/* Profile card */}
            <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.08)] border border-slate-200 overflow-visible text-center pb-5">
              {/* Avatar — larger, passport style. Clickable: opens a Zoho-
                  style modal showing the full photo plus a "Change Image"
                  button that navigates to the Profile page. */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setAvatarOpen(true)}
                  title="View profile photo"
                  className="w-[110px] h-[110px] rounded-xl bg-slate-50 border-4 border-white flex items-center justify-center text-slate-300 -mt-[55px] shadow-xl relative z-10 overflow-hidden hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer transition-colors"
                >
                  {user?.photoUrl
                    ? <img src={user.photoUrl} alt="avatar" className="w-full h-full object-cover" />
                    : <UserIcon size={60} strokeWidth={1} className="opacity-30" />
                  }
                </button>
              </div>

              <div className="mt-2 px-4">
                {/* Employee ID on top */}
                <p className="text-[13px] font-semibold text-slate-500 tracking-wider">
                  {user?.employeeId || 'ANXT260001'}
                </p>
                {/* Full name */}
                <h2 className="text-[17px] font-bold text-slate-800 tracking-tight mt-0.5">
                  {user?.firstName} {user?.lastName}
                </h2>
                {/* Designation */}
                <p className="text-[14px] text-slate-500 mt-0.5">
                  {user?.designation || 'Employee'}
                </p>
              </div>

              {/* Status + timer – Zoho clean style */}
              <div className="mt-4 flex flex-col items-center gap-2">
                {/* Status badge */}
                <span className={`text-[14px] font-bold px-3 py-0.5 rounded ${
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
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-[20px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2.5 py-1 min-w-[44px] text-center leading-none">{hrs}</span>
                  <span className="text-[18px] font-bold text-slate-400">:</span>
                  <span className="text-[20px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2.5 py-1 min-w-[44px] text-center leading-none">{mins}</span>
                  <span className="text-[18px] font-bold text-slate-400">:</span>
                  <span className="text-[20px] font-bold text-slate-800 tracking-tighter bg-slate-100 rounded-md px-2.5 py-1 min-w-[44px] text-center leading-none">{secs}</span>
                </div>
              </div>

              {/* Check-in / out button */}
              <div className="mt-4 px-6">
                {!isCheckedIn && !isCheckedOut && (
                  <button
                    onClick={handleCheckIn}
                    disabled={attActionLoading}
                    className="w-full bg-slate-700 hover:bg-slate-800 text-white text-[15px] font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
                  >
                    <LogIn size={15} /> Check-in
                  </button>
                )}
                {isCheckedIn && (
                  <button
                    onClick={handleCheckOut}
                    disabled={attActionLoading}
                    className="w-full border-2 border-rose-500 text-rose-500 hover:bg-rose-50 text-[15px] font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <LogOut size={15} /> Check-out
                  </button>
                )}
                {isCheckedOut && record?.checkOut && (
                  <div className="space-y-2">
                    <p className="text-[13px] text-slate-400 font-medium">
                      Checked out at <span className="text-slate-600 font-bold">{new Date(record.checkOut).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </p>
                    <button
                      onClick={handleCheckIn}
                      disabled={attActionLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      <LogIn size={15} /> Re-check-in
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reporting Manager Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-3">Reporting Person</h3>
              {(manager || profileData?.manager) ? (
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <img
                      src={`https://ui-avatars.com/api/?name=${(manager || profileData?.manager).firstName}+${(manager || profileData?.manager).lastName}&background=e0e7ff&color=4f46e5&size=44`}
                      className="w-12 h-12 rounded-lg border border-slate-100"
                      alt="manager"
                    />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${PRESENCE_DOT[presenceOf(manager || profileData?.manager)] || 'bg-slate-300'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-slate-700">Reporting Person</p>
                    <p className="text-[13px] text-slate-600 truncate">
                      {(manager || profileData?.manager).employeeId} - {(manager || profileData?.manager).firstName}
                    </p>
                    <PresenceLabel person={manager || profileData?.manager} />
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-slate-400 italic">No manager assigned</p>
              )}
            </div>

             {/* Department Members */}
             <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
               <h3 className="text-[14px] font-bold text-slate-800 mb-4">Department Members</h3>
               <div className="flex flex-col overflow-hidden">
                 {loadingDeptMembers ? (
                   <div className="flex items-center gap-2">
                     <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
                     <span className="text-[12px] text-slate-500">Loading...</span>
                   </div>
                 ) : deptMembers.length === 0 ? (
                   <span className="text-[12px] text-slate-500 italic">No team members found</span>
                 ) : (
                   <>
                     {deptMembers.slice(0, 3).map((member, idx) => (
                       <div key={member._id} className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
                         <div className="relative flex-shrink-0">
                           <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 overflow-hidden">
                             {member.photoUrl ? (
                               <img src={member.photoUrl} alt="avatar" className="w-full h-full object-cover" />
                             ) : (
                               <User size={24} />
                             )}
                           </div>
                         </div>
                         <div className="min-w-0 flex-1 pt-0.5">
                           <p className="text-[14px] font-medium text-slate-700 truncate">{member.employeeId} - {member.firstName}</p>
                           <PresenceLabel person={member} />
                         </div>
                       </div>
                     ))}
                     {deptMembers.length > 3 && (
                       <button 
                         onClick={() => setShowMembersModal(true)} 
                         className="text-[14px] font-bold text-blue-600 hover:text-blue-700 mt-2 text-left transition-colors"
                       >
                         +{deptMembers.length - 3} More
                       </button>
                     )}
                   </>
                 )}
               </div>
             </div>
          </div>

          {/* ══ RIGHT COLUMN ══════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 bg-white rounded-xl shadow-[0_4px_25px_rgba(0,0,0,0.05)] border border-slate-200 flex flex-col overflow-hidden min-h-[600px]">

            {/* Tabs row */}
            <div className="flex items-center border-b border-slate-100 bg-white sticky top-0 z-20">
              <div className="flex items-center gap-6 px-6 overflow-x-auto scrollbar-none flex-1">
                {TABS.map(tab => (
                  <Tab
                    key={tab}
                    active={activeTab === tab.toLowerCase().replace(' ', '')}
                    onClick={() => setActiveTab(tab.toLowerCase().replace(' ', ''))}
                  >
                    {tab}
                  </Tab>
                ))}
              </div>
            </div>

            {/* Tab body */}
            <div className="flex-1 bg-[#f8f9fc] overflow-y-auto p-6 space-y-4">

              {/* ─ Activities tab ─ */}
              {/* ─ Activities tab ─ */}
              {activeTab === 'activities' && (
                <div className="flex flex-col gap-4">
                  {/* Good Morning Banner */}
                  {/* Card itself is the sky — gradient changes through the day
                      (dawn / morning / afternoon / dusk / night). The sun
                      stays fixed in the right slot, only its tint + dots
                      adapt. Card stays light enough to keep dark text legible
                      around the clock. */}
                  <div className={`greeting-banner bg-gradient-to-r ${getTimeOfDaySky()} rounded-xl border border-slate-200 p-5 flex items-center gap-5 shadow-sm transition-colors duration-500`}>
                    {/* Branding — real AltiusNxt logo. File lives at
                        frontend/public/altius-logo.png so Vite serves it
                        from the root and no import is needed. */}
                    <div className="flex items-center">
                      <img
                        src="/altius-logo.png"
                        alt="AltiusNxt"
                        className="h-10 w-auto object-contain"
                      />
                    </div>
                    <div className="h-10 w-[1px] bg-slate-200"></div>
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
                                navigate('/announcements');
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
                                <p className="text-[14px] text-slate-500 mt-0.5 line-clamp-1">{a.body}</p>
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
                            const todayStr = new Date().toISOString().split('T')[0];
                            const isToday   = day.dateStr === todayStr;
                            const isFuture  = day.dateStr > todayStr;
                            const isPast    = day.dateStr < todayStr;
                            const isWeekend = day.isWeekend;

                            // Match Zoho People: every past working day carries a status label
                            // (Present / Half-day / Absent). Today shows Present once the user
                            // checks in. Future days show no status — just date.
                            // "Late" is never surfaced here — it lives in the detailed attendance view.
                            let label = null;        // text under the date
                            let labelColor = '';     // tailwind class
                            if (day.isHoliday) {
                              label = 'Holiday'; labelColor = 'text-teal-500';
                            } else if (isWeekend) {
                              label = 'Weekend'; labelColor = 'text-orange-500';
                            } else if (isPast) {
                              const wh = Number(record?.workingHours) || 0;
                              if (!record || (wh < 4 && record?.status !== 'half-day')) {
                                label = 'Absent'; labelColor = 'text-red-500';
                              } else if (record?.status === 'half-day' || (wh >= 4 && wh < 7.5)) {
                                label = 'Half-day'; labelColor = 'text-blue-500';
                              } else {
                                label = 'Present'; labelColor = 'text-emerald-600';
                              }
                            }
                            // Today: no Present/Absent label — Zoho People convention.
                            // The blue date pill + live hours below convey the state
                            // already; the status would be premature ("Present" before
                            // checkout / "Absent" before the day is over).
                            // Future: also no status label.

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
                        const upcoming = holidays.filter(h => new Date(h.date) >= today);
                        
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
                    {[['All', 'all'], ['Announcements', 'announcements'], ['Approvals', 'approvals'], ['Shifts', 'shifts']].map(([label, key]) => (
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
                              {new Date(f.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} • {f.type?.toUpperCase() || 'UPDATE'}
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
                            {approval.employee?.photoUrl ? (
                              <img src={approval.employee.photoUrl} alt="avatar" className="w-full h-full object-cover" />
                            ) : (
                              <User size={20} />
                            )}
                          </div>
                          <div>
                            <p className="text-[15px] font-bold text-slate-800">
                              {approval.employee?.firstName} {approval.employee?.lastName}
                            </p>
                            <p className="text-[14px] text-slate-500 capitalize">
                              {approval.leaveType} Leave • {approval.totalDays} Day(s)
                            </p>
                            <p className="text-[13px] text-slate-400 mt-0.5">
                              {new Date(approval.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {approval.startDate !== approval.endDate && ` - ${new Date(approval.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => navigate('/leave-tracker/requests')} 
                          className="text-[14px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ml-4"
                        >
                          Review
                        </button>
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
                            setLeaveForm({...leaveForm, type: l.code}); setLeaveModal(true);
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
                      <button onClick={() => setAttWeekOffset(o => o + 1)} title="Next week"
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700">
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
                      const isWeekend = row.isWeekend;
                      const todayCA   = new Date().toLocaleDateString('en-CA');
                      const isToday   = row.dateStr === todayCA;
                      const isPast    = row.dateStr < todayCA;
                      // Regularize only when there is something to correct:
                      // today, or a past day with an attendance record.
                      const canRegularize = !isWeekend && (isToday || (isPast && !!att));

                      // Pretty-print "09:48 AM" — Zoho's exact format.
                      const fmtClock = (iso) =>
                        iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : null;

                      const checkInTxt  = att?.checkIn  ? fmtClock(att.checkIn)  : 'No check-in';
                      const checkOutTxt = att?.checkOut ? fmtClock(att.checkOut) : 'No check-out';
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
                              if (isToday && isCheckedIn) {
                                /* Fallback: user is checked in but the weekly fetch hasn't
                                   caught up yet — still show the live timer. */
                                return (
                                  <>
                                    <p className="text-slate-700">
                                      <span>{record?.checkIn ? fmtClock(record.checkIn) : 'Checked in'}</span>
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
                              {['Month','Gross Pay','Reimbursements','Deductions','Take Home','Payslips','Tax Worksheet'].map(h => (
                                <th key={h} className="px-5 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {payslips.map(p => (
                              <tr key={p._id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-3.5">
                                  <button className="text-[15px] font-semibold text-[#1a73e8] hover:underline">
                                    {MONTHS[(p.month || 1) - 1]} {p.year}
                                  </button>
                                </td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700">{fmtINR(p.grossPay)}</td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700">{fmtINR(p.reimbursements)}</td>
                                <td className="px-5 py-3.5 text-[15px] text-slate-700">{fmtINR(p.deductions)}</td>
                                <td className="px-5 py-3.5 text-[13.5px] font-bold text-slate-800">{fmtINR(p.takeHome)}</td>
                                <td className="px-5 py-3.5">
                                  {p.payslipUrl
                                    ? <a href={p.payslipUrl} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-[#1a73e8] hover:underline">View</a>
                                    : <span className="text-[14px] text-slate-400">—</span>}
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

      {leaveModal && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#f8f9fc] rounded-md w-full max-w-[800px] shadow-xl flex flex-col max-h-[90vh]">
            <div className="bg-white flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800 text-[17px]">Apply Leave</h3>
              <button onClick={() => setLeaveModal(false)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-500"><X size={14}/></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="bg-white border border-slate-200 shadow-sm p-0 rounded-sm">
                <div className="p-4 border-b border-slate-100">
                  <h4 className="text-[15px] font-bold text-slate-800">Leave</h4>
                </div>
                <div className="p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <label className="text-[14px] font-medium text-slate-600 sm:w-32 flex-shrink-0">Leave type <span className="text-red-500">*</span></label>
                    <select value={leaveForm.type} onChange={e => setLeaveForm({...leaveForm, type: e.target.value})} className="flex-1 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500">
                      <option value="casual">Casual Leave</option>
                      <option value="unpaid">Leave Without Pay</option>
                      <option value="comp_off">Compensatory Off</option>
                      <option value="permission">Permission</option>
                    </select>
                  </div>
                  {leaveForm.type === 'permission' ? (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                        <label className="text-[14px] font-medium text-slate-600 sm:w-32 flex-shrink-0">Date <span className="text-red-500">*</span></label>
                        <input type="date" value={leaveForm.fromDate} onChange={e => setLeaveForm({...leaveForm, fromDate: e.target.value, toDate: e.target.value})} className="flex-1 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500" />
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                        <label className="text-[14px] font-medium text-slate-600 sm:w-32 flex-shrink-0">Time <span className="text-red-500">*</span></label>
                        <div className="flex-1 flex items-center gap-3">
                          <input type="time" value={leaveForm.startTime} onChange={e => setLeaveForm({...leaveForm, startTime: e.target.value})} className="w-1/2 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500" />
                          <input type="time" value={leaveForm.endTime} onChange={e => setLeaveForm({...leaveForm, endTime: e.target.value})} className="w-1/2 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500" />
                        </div>
                      </div>
                      <p className="text-[13px] text-purple-600 sm:ml-[9.5rem]">Permission is hourly — up to 4 hours per month.</p>
                    </>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                      <label className="text-[14px] font-medium text-slate-600 sm:w-32 flex-shrink-0">Date <span className="text-red-500">*</span></label>
                      <div className="flex-1 flex items-center gap-3">
                        <input type="date" value={leaveForm.fromDate} onChange={e => setLeaveForm({...leaveForm, fromDate: e.target.value})} className="w-1/2 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500" />
                        <input type="date" value={leaveForm.toDate} onChange={e => setLeaveForm({...leaveForm, toDate: e.target.value})} className="w-1/2 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500" />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                    <label className="text-[14px] font-medium text-slate-600 sm:w-32 flex-shrink-0 pt-2">Reason for leave</label>
                    <textarea value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})} rows={3} className="flex-1 bg-white border border-slate-300 text-slate-800 px-3 py-2 rounded text-[15px] focus:outline-none focus:border-blue-500 resize-none" />
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-white border-t border-slate-200 p-4 flex gap-3">
              <button onClick={async () => {
                const isPerm = leaveForm.type === 'permission';
                if (isPerm) {
                  if (!leaveForm.fromDate) return toast.error('Please select a date');
                  if (!leaveForm.startTime || !leaveForm.endTime) return toast.error('Please select start and end time');
                } else if (!leaveForm.fromDate || !leaveForm.toDate) {
                  return toast.error('Please select dates');
                }
                try {
                  await api.post('/leaves', isPerm ? {
                    leaveType: 'permission',
                    startDate: leaveForm.fromDate,
                    endDate: leaveForm.fromDate,
                    reason: leaveForm.reason,
                    startTime: leaveForm.startTime,
                    endTime: leaveForm.endTime,
                  } : {
                    leaveType: leaveForm.type,
                    startDate: leaveForm.fromDate,
                    endDate: leaveForm.toDate,
                    reason: leaveForm.reason
                  });
                  toast.success(isPerm ? 'Permission submitted to reporting person' : 'Leave request submitted to reporting person');
                  setLeaveModal(false);
                  setLeaveForm({ type: 'casual', fromDate: '', toDate: '', teamEmail: '', reason: '', startTime: '', endTime: '' });
                } catch (err) {
                  toast.error(err.response?.data?.message || 'Error applying leave');
                }
              }} className="bg-[#1a73e8] hover:bg-blue-600 text-white px-5 py-2 text-[15px] font-bold rounded shadow-sm transition-colors">Submit</button>
              <button onClick={() => setLeaveModal(false)} className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-5 py-2 text-[15px] font-bold rounded shadow-sm transition-colors">Cancel</button>
            </div>
</div>
         </div>
       )}
       {/* Add Request menu — opened from the Attendance Weekly Log rows.
           RequestMenu owns its own positioning logic now; we just hand it
           the button's bounding rect. */}
       {showRequestMenu && (
         <RequestMenu
           buttonRect={showRequestMenu.buttonRect}
           canRegularize={!!showRequestMenu.canRegularize}
           onClose={() => setShowRequestMenu(null)}
         />
       )}

       {/* Department Members Modal */}
       {showMembersModal && (
         <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
           <div className="bg-white rounded-xl w-full max-w-[500px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
             <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
               <h3 className="text-[16px] font-bold text-slate-800">Department Members</h3>
               <button onClick={() => setShowMembersModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
                 <X size={16}/>
               </button>
             </div>
             
             <div className="p-4 border-b border-slate-100">
               <div className="relative">
                 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input 
                   type="text" 
                   value={showMembersModal === true ? '' : showMembersModal} // Just using a local inline state pattern or I should just use the actual state
                   onChange={e => setShowMembersModal(e.target.value || true)}
                   placeholder="Search Employee" 
                   className="w-full pl-9 pr-4 py-2 text-[15px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                 />
                 {typeof showMembersModal === 'string' && showMembersModal !== '' && (
                   <button onClick={() => setShowMembersModal(true)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                     <X size={14} />
                   </button>
                 )}
               </div>
             </div>

             <div className="flex-1 overflow-y-auto max-h-[60vh] p-4">
               <div className="flex flex-col">
                 {deptMembers
                   .filter(m => typeof showMembersModal === 'string' ? `${m.firstName} ${m.lastName} ${m.employeeId}`.toLowerCase().includes(showMembersModal.toLowerCase()) : true)
                   .map(member => (
                   <div key={member._id} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors rounded-lg px-2">
                     <div className="relative flex-shrink-0">
                       <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 overflow-hidden">
                         {member.photoUrl ? (
                           <img src={member.photoUrl} alt="avatar" className="w-full h-full object-cover" />
                         ) : (
                           <User size={24} />
                         )}
                       </div>
                     </div>
                     <div className="min-w-0 flex-1 pt-0.5">
                       <p className="text-[15px] font-medium text-slate-700 truncate">{member.employeeId} - {member.firstName}</p>
                       <PresenceLabel person={member} />
                     </div>
                   </div>
                 ))}
                 {deptMembers.filter(m => typeof showMembersModal === 'string' ? `${m.firstName} ${m.lastName} ${m.employeeId}`.toLowerCase().includes(showMembersModal.toLowerCase()) : true).length === 0 && (
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
                 {user?.photoUrl
                   ? <img src={user.photoUrl} alt={user.firstName || 'avatar'} className="w-full h-full object-cover" />
                   : <UserIcon size={120} strokeWidth={1} className="text-slate-300" />
                 }
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
     </div>
   );
}
