import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Clock, Calendar, CheckCircle, Users, BarChart2, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Role gates mirroring App.jsx's ProtectedRoute for the routes the tour visits.
const ROUTE_ROLES = {
  '/team/approvals': ['admin', 'director', 'hr_admin', 'manager', 'team_incharge'],
  '/reports': ['admin', 'director', 'hr_admin', 'manager'],
};

const ALL_STEPS = [
  {
    icon: Clock,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    title: 'Check In & Out',
    desc: 'Click the "Check In" button on your Dashboard to start your day. A live timer tracks your hours. Click "Check Out" when done to save your total working hours.',
    tip: 'Your location is captured automatically for attendance records.',
    route: '/',
    selector: '[data-tour="checkin-btn"]',
    position: 'right',
  },
  {
    icon: Calendar,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    title: 'Apply for Leave',
    desc: 'Click "Leave Tracker" in the left sidebar to apply for Casual, Permission, Comp-Off, or Unpaid leave. Track your requests and see the approval status.',
    tip: 'Your manager gets a notification and must approve each request.',
    route: '/leave-tracker',
    selector: 'a[href="/leave-tracker"]',
    position: 'right',
  },
  {
    icon: Clock,
    iconColor: 'text-sky-600',
    iconBg: 'bg-sky-100',
    title: 'Work From Home',
    desc: 'Click the blue + button (top-right corner) to open Quick Actions. From there you can apply for WFH, Leave, Comp-Off, and more — all in one place.',
    tip: 'WFH requests should be submitted before or on the day of work.',
    route: '/',
    selector: '[data-tour="quick-actions"]',
    position: 'bottom-left',
  },
  {
    icon: CheckCircle,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    title: 'Approvals',
    desc: 'Managers: click Home → Team → Approvals to see all pending requests — leaves, permissions, regularizations, WFH, Comp-Off, and timesheets.',
    tip: 'Notification links take you directly to the specific request waiting for action.',
    route: '/team/approvals',
    selector: 'a[href="/team/approvals"]',
    position: 'bottom',
  },
  {
    icon: Users,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
    title: 'Team & Organization',
    desc: 'Click "Team" in the top navigation to see your team members, their attendance status, and manage approvals. "Organization" shows the full org chart and directory.',
    tip: 'The Peers view shows your reporting chain based on your role.',
    route: '/team-space',
    selector: '[data-tour="topbar-team"]',
    position: 'bottom',
  },
  {
    icon: FileText,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-100',
    title: 'Documents',
    desc: 'Click "More Services" in the left sidebar to access document storage, HR letters, payslips, and company files. Upload personal documents or download company ones.',
    tip: 'HR letters are processed and approved by HR before they can be downloaded.',
    route: '/more-services/files',
    selector: 'a[href="/more-services/files"]',
    position: 'right',
  },
  {
    icon: BarChart2,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    title: 'Reports (Admin)',
    desc: 'Admins and HR: access detailed attendance and payroll reports under the Reports section in the sidebar. Filter by date, department, or employee and export as CSV.',
    tip: 'For leave admin view, go to Leave Tracker → Team → All Requests.',
    route: '/reports',
    selector: 'a[href="/reports"]',
    position: 'right',
  },
];

const TOOLTIP_W = 350;
const SPOT_PAD = 8;

const TOOLTIP_H = 390; // conservative height estimate so clamp never cuts off footer

function computeTooltipPos(rect, position) {
  const gap = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (position === 'right') {
    let left = rect.right + gap;
    if (left + TOOLTIP_W > vw - 10) left = rect.left - TOOLTIP_W - gap;
    // Center on the element, then clamp so the whole card fits in the viewport
    let top = rect.top + rect.height / 2 - TOOLTIP_H / 2;
    if (top < 10) top = 10;
    if (top + TOOLTIP_H > vh - 10) top = Math.max(10, vh - TOOLTIP_H - 10);
    // Arrow offset: where element center falls relative to tooltip top
    const arrowTop = Math.max(20, Math.min(TOOLTIP_H - 20, rect.top + rect.height / 2 - top));
    return { left, top, arrow: 'left', arrowTop };
  }

  if (position === 'bottom' || position === 'bottom-left') {
    let left = position === 'bottom-left'
      ? rect.right - TOOLTIP_W
      : rect.left + rect.width / 2 - TOOLTIP_W / 2;
    const top = rect.bottom + gap;
    if (left < 10) left = 10;
    if (left + TOOLTIP_W > vw - 10) left = vw - TOOLTIP_W - 10;
    const arrowOffset = Math.max(12, Math.min(TOOLTIP_W - 20, rect.left + rect.width / 2 - left));
    return { left, top, arrow: 'top', arrowOffset };
  }

  return { left: vw / 2 - TOOLTIP_W / 2, top: vh / 2 - TOOLTIP_H / 2, arrow: null };
}

export default function GuidedTour({ onClose }) {
  const { user } = useAuth();
  const STEPS = useMemo(() => ALL_STEPS.filter((s) => {
    const roles = ROUTE_ROLES[s.route];
    return !roles || roles.includes(user?.role);
  }), [user?.role]);

  const [step, setStep] = useState(0);
  const [spotRect, setSpotRect] = useState(null);
  const navigate = useNavigate();
  const timerRef = useRef(null);

  const current = STEPS[step];
  const Icon = current.icon;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const locateElement = useCallback((selector) => {
    if (!selector) { setSpotRect(null); return; }
    const el = document.querySelector(selector);
    setSpotRect(el ? el.getBoundingClientRect() : null);
  }, []);

  useEffect(() => {
    setSpotRect(null);
    if (current.route) navigate(current.route);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => locateElement(current.selector), 450);
    return () => clearTimeout(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    const onResize = () => locateElement(current.selector);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.selector]);

  const tooltipPos = spotRect
    ? computeTooltipPos(spotRect, current.position)
    : { left: window.innerWidth / 2 - TOOLTIP_W / 2, top: window.innerHeight / 2 - 150, arrow: null };

  return (
    <>
      {/* Click-catcher — closes tour when clicking outside spotlight/tooltip */}
      <div className="fixed inset-0 z-[9997]" onClick={onClose} />

      {/* Spotlight or solid overlay */}
      {spotRect ? (
        <div
          className="fixed z-[9998] rounded-lg pointer-events-none"
          style={{
            top: spotRect.top - SPOT_PAD,
            left: spotRect.left - SPOT_PAD,
            width: spotRect.width + SPOT_PAD * 2,
            height: spotRect.height + SPOT_PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
            outline: '2px solid rgba(255,255,255,0.75)',
          }}
        />
      ) : (
        <div
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="fixed z-[10000] bg-white rounded-2xl shadow-2xl"
        style={{ width: TOOLTIP_W, top: tooltipPos.top, left: tooltipPos.left }}
        onClick={e => e.stopPropagation()}
      >
        {/* Left arrow (tooltip to the right of element) — position tracks element center */}
        {tooltipPos.arrow === 'left' && spotRect && (
          <div
            className="absolute -left-[9px]"
            style={{ top: tooltipPos.arrowTop ?? '50%', transform: tooltipPos.arrowTop ? 'translateY(-50%)' : 'translateY(-50%)', width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderRight: '9px solid white' }}
          />
        )}
        {/* Top arrow (tooltip below element) */}
        {tooltipPos.arrow === 'top' && spotRect && (
          <div
            className="absolute -top-[9px]"
            style={{
              left: tooltipPos.arrowOffset,
              transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '9px solid transparent',
              borderRight: '9px solid transparent',
              borderBottom: '9px solid white',
            }}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
            Step {step + 1} / {STEPS.length}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] bg-slate-100">
          <div
            className="h-[3px] bg-blue-500 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="px-5 pt-4 pb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${current.iconBg}`}>
            <Icon size={20} className={current.iconColor} />
          </div>
          <h2 className="text-[15px] font-bold text-slate-900 mb-1.5">{current.title}</h2>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-3">{current.desc}</p>
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <p className="text-[12px] text-amber-700 font-medium">💡 {current.tip}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 pb-4 pt-3 border-t border-slate-100">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={isFirst}
            className="flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-30 transition-colors px-2 py-1.5"
          >
            <ChevronLeft size={13} /> Previous
          </button>
          {isLast ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              Next <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
