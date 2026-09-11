import React from 'react';
import { useNavigate } from 'react-router-dom';
import { leaveChipText } from '../moreservices/shift/shiftGrid';

/* ── Shared chrome for the three Team workspaces ──────────────────────────
 *  Home → Team, Attendance → Team and Leave Tracker → Team draw the same
 *  tab bar, the same person tile and the same today's-status badge. They live
 *  here once: three copies of a status badge is three chances for the same
 *  person to read "Absent" on one screen and "Casual Leave" on the next,
 *  which is the exact defect these screens were built to remove.
 *
 *  Every tab navigates WITHIN its own section. Nothing here links out to
 *  /approvals or /employees, because landing somewhere else is how the old
 *  orphaned /attendance/team was reached in the first place.
 * ────────────────────────────────────────────────────────────────────────── */

/** Route-driven tab bar. `tabs` is [{ key, label, to }]. */
export function TeamTabs({ tabs, active }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-6 px-5 border-b border-slate-200 bg-white overflow-x-auto scrollbar-none">
      {tabs.map(t => (
        <button key={t.key} onClick={() => navigate(t.to)}
          className={`py-3 px-1 text-[14px] border-b-2 transition-all whitespace-nowrap
            ${active === t.key
              ? 'border-blue-500 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* The reference has a "Direct | All" toggle over the whole downstream tree.
 * Our reporting model answers direct reports only, so the scope is stated
 * rather than offered as a choice one half of which would be a lie. */
export function DirectScopeNote({ className = '' }) {
  return (
    <p className={`text-[12px] text-slate-400 ${className}`}>
      Direct reports only — people whose reporting manager or approving authority is you.
    </p>
  );
}

export function WorkspaceHeader({ title, subtitle, right }) {
  return (
    <div className="px-5 py-3.5 border-b border-slate-100 bg-white flex items-center gap-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold text-slate-800 truncate">{title}</h2>
        {subtitle && <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Avatar({ person, size = 40 }) {
  const initials = `${person?.firstName?.[0] || ''}${person?.lastName?.[0] || ''}`.toUpperCase();
  if (person?.photoUrl) {
    return (
      <img src={person.photoUrl} alt=""
        className="rounded-full object-cover border border-slate-200 flex-shrink-0"
        style={{ width: size, height: size }} />
    );
  }
  return (
    <div className="rounded-full bg-slate-100 text-slate-500 border border-slate-200 flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.8) }}>
      {initials || '—'}
    </div>
  );
}

const PRESENCE_STYLE = {
  in:           { label: 'In',                 cls: 'bg-emerald-100 text-emerald-700' },
  out:          { label: 'Checked out',        cls: 'bg-slate-100 text-slate-600' },
  onLeave:      { label: 'On leave',            cls: 'bg-violet-100 text-violet-700' },
  yetToCheckIn: { label: 'Yet to check in',     cls: 'bg-amber-100 text-amber-700' },
};

/**
 * Today's status for one person, as the API derived it.
 *
 * `presence` comes from the server, where a punch beats an approved leave and
 * an approved leave beats silence. It is NOT read from attendance.status —
 * that column is written at check-in and never rewritten when a leave is
 * approved afterwards, which is why somebody on leave used to read as
 * "Not Yet Checked In".
 */
export function PresenceBadge({ person }) {
  const s = PRESENCE_STYLE[person?.presence] || PRESENCE_STYLE.yetToCheckIn;
  const label = person?.presence === 'onLeave' && person?.leaveType
    ? leaveChipText({
        leaveType: person.leaveType,
        isHalfDay: person.isHalfDay,
        halfDayType: person.halfDayType,
      })
    : s.label;
  return (
    <span className={`inline-flex items-center text-[12px] font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>
      {label}
    </span>
  );
}

export const fmtTime = (ts) => (ts
  ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  : null);

export const fmtDay = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', opts);
};

export function Spinner({ className = 'py-16' }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/* An empty state says which query came back empty, never just "nothing here".
 * A manager with no reports and a manager whose reports all turned up today
 * are different situations and the screen has to be able to tell them apart. */
export function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <Icon size={22} className="text-slate-400" />
        </div>
      )}
      <p className="text-[15px] font-semibold text-slate-600">{title}</p>
      {sub && <p className="text-[13px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}
