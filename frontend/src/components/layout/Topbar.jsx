import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus, CheckCircle, X, MoreHorizontal } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { isApprover, roleLabel } from '../../utils/roles';
import api from '../../utils/api';

/* ── Section detection ─────────────────────────────────────────────── */
function getSection(pathname) {
  if (pathname.startsWith('/attendance')) return 'attendance';
  if (pathname.startsWith('/time-tracker')) return 'timetracker';
  if (pathname.startsWith('/leave-tracker') || pathname === '/leave' ||
      pathname.startsWith('/wfh') || pathname.startsWith('/comp-off') ||
      pathname.startsWith('/leave-calendar') || pathname.startsWith('/leave-encashment')) return 'leavetracker';
  if (pathname.startsWith('/performance')) return 'performance';
  if (pathname.startsWith('/more-services') || pathname.startsWith('/documents')) return 'moreservices';
  if (pathname.startsWith('/employees') || pathname.startsWith('/registrations')) return 'employeemaster';
  if (pathname.startsWith('/reports') || pathname.startsWith('/payroll') ||
      pathname.startsWith('/shifts') || pathname.startsWith('/shift-roster') ||
      pathname.startsWith('/daily-attendance')) return 'reports';
  return 'home';
}

/* ── Which Home sub-tab is active ─────────────────────────────────── */
function getHomeTab(pathname) {
  if (['/team-space', '/team/', '/approvals', '/attendance/team'].some(p => pathname.startsWith(p))) return 'team';
  if (['/organization', '/org-chart', '/dept-tree', '/announcements', '/policies',
       '/birthdays', '/new-hires', '/directory', '/companies', '/holidays'].some(p => pathname.startsWith(p))) return 'organization';
  return 'myspace';
}

/* ── Full nav config ─────────────────────────────────────────────── */
const NAV = {
  home: {
    primaryTabs: [
      { key: 'myspace',      label: 'My Space',     to: '/' },
      { key: 'team',         label: 'Team',         to: '/team-space' },
      { key: 'organization', label: 'Organization', to: '/organization' },
    ],
    subNav: {
      myspace: [
        { to: '/',          label: 'Overview',   exact: true },
        { to: '/dashboard', label: 'Dashboard'               },
        { to: '/calendar',  label: 'Calendar'                },
        { to: '/profile',   label: 'Profile'                 },
      ],
      team: [
        { to: '/team-space',      label: 'Team Space' },
        { to: '/team/department', label: 'Department' },
        { to: '/team/projects',   label: 'Projects'   },
        { to: '/team/peers',      label: 'Peers'      },
        { to: '/team/approvals',  label: 'Approvals'  },
      ],
      organization: [
        { to: '/organization', label: 'Overview'          },
        { to: '/org-chart',    label: 'Employee Tree'     },
        { to: '/dept-tree',    label: 'Department Tree'   },
        { to: '/announcements',label: 'Announcements'     },
        { to: '/policies',     label: 'Policies'          },
        { to: '/birthdays',    label: 'Birthday Folks'    },
        { to: '/new-hires',    label: 'New Hires'         },
        { to: '/directory',    label: 'Directory'         },
      ],
    },
  },
  attendance: {
    label: 'Attendance',
    isLanding: true,
    landingPath: '/attendance',
  },
  timetracker: {
    label: 'Time Tracker',
    isLanding: true,
    landingPath: '/time-tracker',
  },
  leavetracker: {
    label: 'Leave Tracker',
    primaryTabs: [
      { key: 'mydata',   label: 'My Data',  to: '/leave-tracker/summary'  },
      { key: 'team',     label: 'Team',     to: '/leave-tracker/team',    roles: ['admin','director','manager'] },
      { key: 'holidays', label: 'Holidays', to: '/leave-tracker/holidays' },
    ],
    // '__landing__' signals "we're on the root /leave-tracker page" — no tab highlighted,
    // and subNav['__landing__'] is undefined so the white sub-nav bar stays hidden.
    getActiveTab: p => {
      if (p === '/leave-tracker')                                              return '__landing__';
      if (p.startsWith('/leave-tracker/team') || p.startsWith('/leave-tracker/all')) return 'team';
      if (p.startsWith('/leave-tracker/holidays') || p.startsWith('/leave-tracker/weekends')) return 'holidays';
      return 'mydata';
    },
    subNav: {
      mydata: [
        { to: '/leave-tracker/summary',  label: 'Leave Summary'  },
        { to: '/leave-tracker/requests', label: 'Leave Requests' },
        { to: '/leave-tracker/comp-off', label: 'Comp-Off'       },
      ],
      team: [
        { to: '/leave-tracker/team', label: 'Team Approvals', roles: ['admin','director','manager'] },
        { to: '/leave-tracker/all',  label: 'All Requests',   roles: ['admin','director','hr_admin'] },
      ],
      holidays: [
        { to: '/leave-tracker/holidays', label: 'Holidays'                                   },
        { to: '/leave-tracker/weekends', label: 'Weekend Rules', roles: ['admin','director'] },
      ],
    },
  },
  performance: {
    label: 'Performance',
    primaryTabs: [
      { key: 'mydata',  label: 'My Data',          to: '/performance/goals'  },
      { key: 'skills',  label: 'Skill Set Matrix',  to: '/performance/skills' },
    ],
    getActiveTab: p => p.startsWith('/performance/skills') ? 'skills' : 'mydata',
    subNav: {
      mydata:  [
        { to: '/performance/goals',   label: 'Goals'   },
        { to: '/performance',         label: 'Reviews', exact: true },
      ],
      skills: [{ to: '/performance/skills', label: 'Skill Matrix' }],
    },
  },
  moreservices: {
    label: 'More Services',
    primaryTabs: [
      // Operations was relocated to the left sidebar rail (Sidebar.jsx). Its
      // sub-nav + active detection below still drive the white sub-bar when the
      // user lands on /more-services/operations from the sidebar.
      { key: 'files',        label: 'Files',               to: '/more-services/files'        },
      // Travel + Compensation are intentionally disabled — the underlying
      // workflows aren't fully built out yet. Visible so users see what's
      // planned, but the click is a no-op until each is implemented.
      { key: 'travel',       label: 'Travel',              to: '/more-services/travel',       disabled: true },
      { key: 'compensation', label: 'Compensation',        to: '/more-services/compensation', disabled: true },
      { key: 'hrletters',    label: 'HR Letters',          to: '/more-services/hr-letters'   },
    ],
    getActiveTab: p => {
      if (p.startsWith('/more-services/operations'))   return 'operations';
      if (p.startsWith('/more-services/travel'))       return 'travel';
      if (p.startsWith('/more-services/compensation')) return 'compensation';
      if (p.startsWith('/more-services/hr-letters'))   return 'hrletters';
      return 'files';
    },
    subNav: {
      operations:   [
        { to: '/more-services/operations',               label: 'Services'      },
        { to: '/more-services/operations/leave-tracker', label: 'Leave Tracker' },
      ],
      files:        [{ to: '/more-services/files',        label: 'Document Storage' }],
      travel:       [{ to: '/more-services/travel',       label: 'Travel Requests'  }],
      compensation: [{ to: '/more-services/compensation', label: 'Claims'           }],
      hrletters:    [{ to: '/more-services/hr-letters',   label: 'Letter Requests'  }],
    },
  },
  employeemaster: {
    label: 'Employees',
    primaryTabs: [
      // Employee management is HR / Super Admin only (Team Leads excluded).
      { key: 'employees', label: 'Employees', to: '/employees', roles: ['admin', 'director'] },
      { key: 'registrations', label: 'Registrations', to: '/registrations', roles: ['admin', 'director'] },
    ],
    getActiveTab: p => p.startsWith('/registrations') ? 'registrations' : 'employees',
    subNav: {
      employees: [{ to: '/employees', label: 'Employees' }],
      registrations: [{ to: '/registrations', label: 'Registrations' }],
    },
  },
  reports: {
    label: 'Reports',
    isLanding: true,
    landingPath: '/reports',
  },
};

/* ── SubNavLink ──────────────────────────────────────────────────── */
// Active-state is now decided by the parent (SubNav) so we can pick a
// single best-match — preventing the case where `/payroll/setup` lit up
// both "Payroll Report" (/payroll) and "Salary Setup" (/payroll/setup).
const SubNavLink = React.memo(function SubNavLink({ to, label, isActive }) {
  return (
    <NavLink to={to}
      className={`h-full flex items-center px-1 border-b-2 text-[16px] whitespace-nowrap transition-all duration-150 mt-[2px] tracking-[-0.01em]
        ${isActive
          ? 'border-[#1a73e8] text-[#1a73e8] font-bold'
          : 'border-transparent text-slate-500 dark:text-slate-300 font-semibold hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500'
        }`}>
      {label}
    </NavLink>
  );
});

/* ── SubNav (with overflow "More" dropdown) ──────────────────────── */
/** When the sub-nav has too many tabs to fit on one line, this component
 *  measures the row on mount + on resize, hides the tail that overflows,
 *  and stuffs the rest behind a 3-dot button on the right. If the active
 *  route is in the overflow set, the More button gets the active styling. */
function SubNav({ items }) {
  const location = useLocation();
  const containerRef = React.useRef(null);
  const measureRef   = React.useRef(null);
  const [visibleCount, setVisibleCount] = React.useState(items.length);
  const [showMore, setShowMore] = React.useState(false);
  const moreRef = React.useRef();

  // Close the dropdown on outside click + route change.
  React.useEffect(() => {
    const h = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  React.useEffect(() => { setShowMore(false); }, [location.pathname]);

  // Measure: render every tab off-screen, then walk the widths and pick
  // how many fit in the visible row (reserving ~52px for the More button).
  React.useEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      const measure   = measureRef.current;
      if (!container || !measure) return;
      const available = container.clientWidth - 56; // reserve for More button
      const children  = Array.from(measure.children);
      let used = 0, fit = 0;
      const gap = 20; // matches gap-5 (1.25rem)
      for (let i = 0; i < children.length; i++) {
        const w = children[i].offsetWidth + (i > 0 ? gap : 0);
        if (used + w > available) break;
        used += w;
        fit++;
      }
      // If everything fits, render normally (no More button).
      setVisibleCount(fit >= items.length ? items.length : Math.max(1, fit));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); };
  }, [items]);

  const visible  = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  // Best-match active rule: among all items whose `to` matches the current
  // pathname, pick the one with the LONGEST `to`. That way `/payroll/setup`
  // lights up "Salary Setup" only, not also "Payroll Report" (`/payroll`).
  const activeIndex = (() => {
    let best = -1, bestLen = -1;
    items.forEach((item, i) => {
      const matches = item.exact
        ? location.pathname === item.to
        : (item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to));
      if (matches && item.to.length > bestLen) { best = i; bestLen = item.to.length; }
    });
    return best;
  })();
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const activeInOverflow = activeItem && overflow.includes(activeItem) ? activeItem : null;

  // If the active route is in the overflow set, swap it into the END of the
  // visible row (just before the More button) — feels closer to "stays
  // where my eye expects it" and avoids pushing every other tab right.
  const finalVisible  = activeInOverflow
    ? [...visible.slice(0, -1), activeInOverflow]
    : visible;
  const finalOverflow = activeInOverflow
    ? [...overflow.filter(i => i !== activeInOverflow), visible[visible.length - 1]]
    : overflow;

  return (
    <div ref={containerRef} className="flex-1 h-full flex items-center justify-between gap-3 min-w-0">
      {/* Hidden measurement row — fixed to off-screen so it never contributes
          to layout or causes horizontal scroll. The kids still measure at
          their natural rendered widths. */}
      <div
        ref={measureRef}
        className="flex items-center gap-5"
        aria-hidden="true"
        style={{ position: 'fixed', top: '-9999px', left: '-9999px', visibility: 'hidden' }}
      >
        {items.map(item => (
          <span key={`m-${item.to}`} className="text-[16px] font-semibold whitespace-nowrap px-1">{item.label}</span>
        ))}
      </div>

      <div className="flex items-center gap-5 h-full min-w-0 overflow-hidden">
        {finalVisible.map(item => (
          <SubNavLink key={item.to} to={item.to} label={item.label} isActive={item === activeItem} />
        ))}
      </div>

      {finalOverflow.length > 0 && (
        <div ref={moreRef} className="relative flex-shrink-0">
          <button
            onClick={() => setShowMore(v => !v)}
            className={`h-7 w-9 rounded-md flex items-center justify-center transition-all
              ${activeInOverflow || showMore
                ? 'bg-slate-100 text-[#1a73e8]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            aria-label="More options"
            title={`${finalOverflow.length} more`}
          >
            <MoreHorizontal size={18} strokeWidth={2.2} />
          </button>
          {showMore && (
            <div className="absolute right-0 top-[36px] bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 min-w-[200px] z-50">
              {finalOverflow.map(item => (
                <NavLink key={item.to} to={item.to} onClick={() => setShowMore(false)}
                  className={`flex items-center px-4 py-2 text-[15px] transition-colors
                    ${item === activeItem
                      ? 'text-[#1a73e8] font-bold bg-blue-50/50'
                      : 'text-slate-600 font-semibold hover:text-slate-900 hover:bg-slate-50'
                    }`}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Topbar ──────────────────────────────────────────────────────── */
export default function Topbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [showNotifs, setShowNotifs]               = useState(false);
  const [notifications, setNotifications]         = useState([]);
  const [unreadCount, setUnreadCount]             = useState(0);
  // Real-time chat unread counter — driven by the WebSocket context so the
  // badge updates instantly when a new DM arrives, no polling needed.
  // notificationTick fires every time a 'notification' event lands on the
  // WS so the bell re-fetches without waiting for the 60-second poll.
  const { notificationTick } = useChat();
  const [showUserMenu, setShowUserMenu]           = useState(false);
  const [showQuickActions, setShowQuickActions]   = useState(false);
  const [showSearch, setShowSearch]               = useState(false);
  const [searchQuery, setSearchQuery]             = useState('');
  const notifRef       = useRef();
  const userMenuRef    = useRef();
  const quickActionsRef= useRef();
  const searchRef      = useRef();

  const loadNotifications = useCallback(() => {
    api.get('/notifications').then(r => {
      setNotifications(r.data.data || []);
      setUnreadCount(r.data.unreadCount || 0);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadNotifications();
    // Keep the 60-second poll as a safety net for clients whose WS dropped
    // briefly. The WS-driven refresh below covers the normal case instantly.
    const t = setInterval(loadNotifications, 60000);
    return () => clearInterval(t);
  }, [loadNotifications]);

  // Real-time refresh: every time the WebSocket layer reports a new
  // notification, re-fetch /api/notifications. Cheap because the bell is
  // already mounted globally.
  useEffect(() => {
    if (notificationTick > 0) loadNotifications();
  }, [notificationTick, loadNotifications]);

  // ── Document-title unread indicator ──────────────────────────────────────
  // Mirror the badge state into the browser tab title so users who have
  // NxtPeople in a background tab still notice incoming chats / notifs.
  // Prefix the existing title rather than overwriting it so per-page titles
  // (set elsewhere) keep working — restore on cleanup just in case.
  useEffect(() => {
    const base  = document.title.replace(/^\(\d+\)\s/, '');
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  useEffect(() => {
    const h = e => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
      if (quickActionsRef.current && !quickActionsRef.current.contains(e.target)) setShowQuickActions(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearch(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const markAllRead = async () => {
    await api.put('/notifications/read-all').catch(() => {});
    setNotifications(n => n.map(x => ({ ...x, isRead: true })));
    setUnreadCount(0);
  };

  const handleNotifClick = async (notif) => {
    if (!notif.isRead) {
      await api.put(`/notifications/${notif._id}/read`).catch(() => {});
      setNotifications(n => n.map(x => x._id === notif._id ? { ...x, isRead: true } : x));
      setUnreadCount(c => Math.max(0, c - 1));
    }
    if (notif.link) { setShowNotifs(false); navigate(notif.link); }
  };

  const section    = getSection(location.pathname);
  const config     = NAV[section];
  const isHome     = section === 'home';
  const homeTab    = isHome ? getHomeTab(location.pathname) : null;

  // Strip nav entries the current user isn't allowed to see — keeps employees
  // from seeing "Team" / "Daily Attendance" tabs that would just bounce them home.
  const canSee = (entry) => !entry.roles || entry.roles.includes(user?.role);
  const primaryTabs  = (config?.primaryTabs || []).filter(canSee);
  const activeTab    = isHome ? homeTab : (config?.getActiveTab?.(location.pathname) || primaryTabs[0]?.key);
  const subNavItems  = (config?.subNav?.[activeTab] || []).filter(canSee);

  return (
    <div className="flex flex-col sticky top-0 z-40">
      {/* ── Navy primary bar ─────────────────────────────────────────── */}
      <div className="h-[48px] bg-[#1a2040] flex items-center justify-between px-5 shadow-sm flex-shrink-0">
        <div className="flex items-center h-full gap-1">
          {!isHome && (
            <span className="text-white text-[16px] font-semibold mr-3 border-r border-white/20 pr-4">
              {config.label}
            </span>
          )}
          {!config.isLanding && primaryTabs.map(({ key, label, to, disabled }) => {
            const active = isHome ? homeTab === key : activeTab === key;
            // Disabled primary tabs (e.g. Travel / Compensation in More
            // Services) render visible but non-clickable until the
            // feature is wired up. Greyed text + cursor-not-allowed +
            // "Coming soon" tooltip.
            if (disabled) {
              return (
                <span key={key} title="Coming soon"
                  className="h-full px-4 flex items-center text-[16px] border-b-[3px] border-transparent text-white/30 font-semibold cursor-not-allowed">
                  {label}
                </span>
              );
            }
            const targetTo = (key === 'reports' && !isApprover(user)) ? '/payroll/my' : to;
            return (
              <button key={key} onClick={() => navigate(targetTo)}
                className={`h-full px-4 flex items-center text-[16px] border-b-[3px] transition-all duration-150 tracking-[-0.01em]
                  ${active ? 'border-blue-400 text-white font-semibold' : 'border-transparent text-white/60 font-medium hover:text-white'}`}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Right icons */}
        <div className="flex items-center gap-4 text-white">
          {/* Quick Actions + button */}
          <div className="relative" ref={quickActionsRef}>
            <button
              onClick={() => setShowQuickActions(v => !v)}
              className="w-7 h-7 bg-[#1a73e8] hover:bg-[#1557B0] text-white rounded flex items-center justify-center transition-colors"
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
            {showQuickActions && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#1f2937] rounded-xl shadow-2xl z-50 border border-slate-100 dark:border-[#374151] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-[#374151] bg-slate-50 dark:bg-[#111827] flex items-center justify-between">
                  <span className="text-[14px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Quick Actions</span>
                </div>
                <div className="py-1">
                  {[
                    { label: 'Leave',        to: '/leave-tracker/requests' },
                    { label: 'WFH Request',  to: '/wfh'                   },
                    { label: 'Comp-Off',     to: '/leave-tracker/comp-off' },
                    { label: 'Check In',     to: '/attendance/checkin'    },
                    { label: 'Documents',    to: '/more-services/files'   },
                  ].map(({ label, to }) => (
                    <button
                      key={label}
                      onClick={() => { navigate(to); setShowQuickActions(false); }}
                      className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#374151] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Search */}
          <div className="relative" ref={searchRef}>
            <button
              onClick={() => { setShowSearch(v => !v); setSearchQuery(''); }}
              className="hover:bg-white/10 transition-colors p-1 rounded"
            >
              <Search size={17} />
            </button>
            {showSearch && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-[#1f2937] rounded-xl shadow-2xl z-50 border border-slate-100 dark:border-[#374151] overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-[#374151]">
                  <Search size={15} className="text-slate-400 flex-shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search employees, pages..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && searchQuery.trim()) {
                        navigate(`/employees?search=${encodeURIComponent(searchQuery.trim())}`);
                        setShowSearch(false);
                      }
                      if (e.key === 'Escape') setShowSearch(false);
                    }}
                    className="flex-1 text-base text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400 bg-transparent"
                  />
                  <button onClick={() => setShowSearch(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={14}/></button>
                </div>
                <div className="py-1">
                  {[
                    { label: 'Employees', to: '/employees', roles: ['admin', 'director'] },
                    { label: 'Attendance', to: '/attendance/my' },
                    { label: 'Leave Tracker', to: '/leave-tracker/summary' },
                    { label: 'Reports', to: '/reports', roles: ['admin', 'director', 'manager'] },
                    { label: 'Announcements', to: '/announcements' },
                  ].filter(item => (!item.roles || item.roles.includes(user?.role)))
                   .filter(item => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase()))
                   .map(({ label, to }) => (
                    <button key={label} onClick={() => { navigate(to); setShowSearch(false); }}
                      className="w-full text-left px-4 py-2 text-[15px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#374151] transition-colors flex items-center gap-2">
                      <Search size={12} className="text-slate-300 dark:text-slate-500" />{label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notifications — bell with two indicators:
              • Blue pulsing dot at top-left  → "you have NEW activity"
                (visible whenever unreadCount > 0; same condition as the count
                badge, but pulses for a moment to draw the eye when a fresh
                event lands via the WebSocket).
              • Red count badge at top-right → exact number of unread items.
              Both share the same condition so the user always sees one if
              they see the other. */}
          <div className="relative flex items-center" ref={notifRef}>
            <button onClick={() => setShowNotifs(!showNotifs)}
              className="relative hover:bg-white/10 transition-colors p-1 rounded">
              <Bell size={17} />
              {unreadCount > 0 && (
                <>
                  <span className="absolute -top-0.5 -left-0.5 w-2 h-2 bg-[#0088FF] rounded-full ring-2 ring-[#1a2040] animate-pulse" />
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center ring-2 ring-[#1a2040]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                </>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-[#1f2937] rounded-xl shadow-2xl z-50 border border-slate-100 dark:border-[#374151] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-[#374151] flex justify-between items-center bg-slate-50 dark:bg-[#111827]">
                  <h3 className="font-semibold text-base text-slate-800 dark:text-slate-100">Notifications</h3>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-[13px] text-blue-400 font-medium hover:underline flex items-center gap-1">
                        <CheckCircle size={11}/> Mark all read
                      </button>
                    )}
                    <button onClick={() => setShowNotifs(false)} className="text-slate-400 hover:text-slate-300"><X size={14}/></button>
                  </div>
                </div>
                <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-50 dark:divide-[#374151]">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-base">
                      <Bell size={28} className="mx-auto mb-2 opacity-30"/>No new notifications
                    </div>
                  ) : notifications.map(n => (
                    <div key={n._id} onClick={() => handleNotifClick(n)}
                      className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#374151] cursor-pointer transition-colors ${!n.isRead ? 'bg-blue-50/40 dark:bg-blue-900/20' : ''}`}>
                      <p className={`text-base leading-snug ${!n.isRead ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{n.title}</p>
                      <p className="text-sm text-slate-400 truncate mt-0.5">{n.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-white/20"/>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
              {/* Profile photo if uploaded; falls back to initials. AuthContext
                  updates after Profile photo save, so this re-renders without
                  a page reload. */}
              {user?.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.firstName || 'Avatar'}
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] font-bold text-white ring-2 ring-white/20">
                  {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
                </div>
              )}
            </button>
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-[#1f2937] rounded-xl shadow-2xl z-50 border border-slate-100 dark:border-[#374151] overflow-hidden">
                <div className="px-4 py-3.5 border-b border-slate-100 dark:border-[#374151] bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-[#1e3a5f] dark:to-[#1e1b4b]">
                  <p className="font-semibold text-[15px] text-slate-800 dark:text-slate-100">{user?.firstName} {user?.lastName}</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 capitalize mt-0.5">{user?.designation || roleLabel(user?.role)}</p>
                  {user?.employeeId && <p className="text-[12px] text-blue-400 font-mono mt-1">{user.employeeId}</p>}
                </div>
                <div className="py-1">
                  <button onClick={() => { navigate('/profile'); setShowUserMenu(false); }} className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#374151]">My Profile</button>
                  <button onClick={() => { navigate('/settings'); setShowUserMenu(false); }} className="w-full text-left px-4 py-2.5 text-[15px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#374151]">Settings</button>
                  <div className="border-t border-slate-100 dark:border-[#374151] mt-1 pt-1">
                    <button onClick={logout} className="w-full text-left px-4 py-2.5 text-[15px] text-red-500 hover:bg-red-50 dark:hover:bg-[#450a0a] font-medium">Sign Out</button>
                    <button
                      onClick={async () => {
                        if (!window.confirm('Sign out from all devices? You will be logged out everywhere — laptops, phones, every browser.')) return;
                        try {
                          const r = await api.post('/auth/logout-everywhere');
                          alert(r.data.message || 'Signed out from all devices.');
                        } catch (_) { /* server bumped revoked_at — local session is dead anyway */ }
                        logout();
                      }}
                      className="w-full text-left px-4 py-2.5 text-[14px] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#374151]"
                    >
                      Sign out from all devices
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── White sub-nav — hidden on landing pages (subNavItems is empty) */}
      {!config.isLanding && subNavItems.length > 0 && (
        <div className="h-[42px] bg-white dark:bg-[#1a2040] border-b border-slate-200 dark:border-[#2d3748] flex items-center px-5 shadow-sm relative">
          <SubNav items={subNavItems} />
        </div>
      )}
    </div>
  );
}
