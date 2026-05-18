import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Plus, CheckCircle, X, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';

/* ── Section detection ─────────────────────────────────────────────── */
function getSection(pathname) {
  if (pathname.startsWith('/attendance')) return 'attendance';
  if (pathname.startsWith('/time-tracker')) return 'timetracker';
  if (pathname.startsWith('/leave-tracker') || pathname === '/leave' ||
      pathname.startsWith('/wfh') || pathname.startsWith('/comp-off') ||
      pathname.startsWith('/leave-calendar') || pathname.startsWith('/leave-encashment')) return 'leavetracker';
  if (pathname.startsWith('/performance')) return 'performance';
  if (pathname.startsWith('/more-services') || pathname.startsWith('/documents')
    || pathname.startsWith('/my-apps') || pathname.startsWith('/api-connections')) return 'moreservices';
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
        { to: '/team-space',    label: 'Team Space' },
        { to: '/team/projects', label: 'Projects'   },
        { to: '/team/peers',    label: 'Peers'      },
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
    primaryTabs: [
      { key: 'mydata', label: 'My Data', to: '/attendance/my' },
      // Team Attendance is admin / manager only — backend role-gates GET /api/attendance/team
      // and App.jsx blocks the route. Hiding the tab here prevents employees from clicking
      // it and getting bounced home.
      { key: 'team',   label: 'Team',    to: '/attendance/team', roles: ['admin', 'manager'] },
    ],
    getActiveTab: p => p.startsWith('/attendance/team') ? 'team' : 'mydata',
    subNav: {
      mydata: [
        { to: '/attendance/my',             label: 'My Attendance'  },
        { to: '/attendance/checkin',        label: 'Check In'       },
        { to: '/attendance/regularization', label: 'Regularization' },
      ],
      team: [{ to: '/attendance/team', label: 'Team Members' }],
    },
  },
  timetracker: {
    label: 'Time Tracker',
    primaryTabs: [
      { key: 'mydata', label: 'My Data', to: '/time-tracker/timelogs' },
    ],
    getActiveTab: () => 'mydata',
    subNav: {
      mydata: [
        { to: '/time-tracker/timelogs',   label: 'Time Logs'    },
        { to: '/time-tracker/timesheets', label: 'Timesheets'   },
        { to: '/time-tracker/projects',   label: 'Projects'     },
        { to: '/time-tracker/schedule',   label: 'Job Schedule' },
      ],
    },
  },
  leavetracker: {
    label: 'Leave Tracker',
    primaryTabs: [
      { key: 'mydata',   label: 'My Data',  to: '/leave-tracker/summary'  },
      { key: 'team',     label: 'Team',     to: '/approvals'     },
      { key: 'holidays', label: 'Holidays', to: '/leave-tracker/holidays' },
    ],
    getActiveTab: p => {
      if (p.startsWith('/leave-tracker/team') || p.startsWith('/approvals')) return 'team';
      if (p.startsWith('/leave-tracker/holidays') || p.startsWith('/holidays')
        || p.startsWith('/leave-tracker/weekends')) return 'holidays';
      return 'mydata';
    },
    subNav: {
      mydata: [
        { to: '/leave-tracker/summary',  label: 'Leave Summary'        },
        { to: '/leave-tracker/balance',  label: 'Leave Balance'        },
        { to: '/leave-tracker/requests', label: 'Leave Requests'       },
        { to: '/leave-tracker/comp-off', label: 'Compensatory Request' },
      ],
      team:     [{ to: '/approvals',     label: 'Approvals' }],
      holidays: [
        { to: '/leave-tracker/holidays', label: 'Holidays' },
        { to: '/leave-tracker/weekends', label: 'Weekends', roles: ['admin'] },
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
      { key: 'files',        label: 'Files',               to: '/more-services/files'        },
      { key: 'travel',       label: 'Travel',              to: '/more-services/travel'       },
      { key: 'compensation', label: 'Compensation',        to: '/more-services/compensation' },
      { key: 'hrletters',    label: 'HR Letters',          to: '/more-services/hr-letters'   },
      { key: 'apps',         label: 'Apps',                to: '/my-apps'                    },
    ],
    getActiveTab: p => {
      if (p.startsWith('/more-services/travel'))       return 'travel';
      if (p.startsWith('/more-services/compensation')) return 'compensation';
      if (p.startsWith('/more-services/hr-letters'))   return 'hrletters';
      if (p.startsWith('/my-apps') || p.startsWith('/api-connections')) return 'apps';
      return 'files';
    },
    subNav: {
      files:        [{ to: '/more-services/files',        label: 'Document Storage' }],
      travel:       [{ to: '/more-services/travel',       label: 'Travel Requests'  }],
      compensation: [{ to: '/more-services/compensation', label: 'Claims'           }],
      hrletters:    [{ to: '/more-services/hr-letters',   label: 'Letter Requests'  }],
      apps: [
        { to: '/my-apps',         label: 'My Apps'        },
        { to: '/api-connections', label: 'Manage Apps & API Connections', roles: ['admin'] },
      ],
    },
  },
  employeemaster: {
    label: 'Employee Master',
    primaryTabs: [
      { key: 'employees', label: 'Employees', to: '/employees' },
      { key: 'registrations', label: 'Registrations', to: '/registrations' },
    ],
    getActiveTab: p => p.startsWith('/registrations') ? 'registrations' : 'employees',
    subNav: {
      employees: [{ to: '/employees', label: 'Employees' }],
      registrations: [{ to: '/registrations', label: 'Registrations' }],
    },
  },
  reports: {
    label: 'Reports',
    primaryTabs: [
      { key: 'reports', label: 'Reports', to: '/reports' },
    ],
    getActiveTab: () => 'reports',
    subNav: {
      // Whole Reports section is admin / manager only — also enforced by
      // App.jsx ProtectedRoute on each /reports, /payroll, /shifts, /shift-roster,
      // /daily-attendance route and by Sidebar.jsx (the Reports icon is gated).
      reports: [
        { to: '/reports',                label: 'Attendance Report', exact: true, roles: ['admin', 'manager'] },
        { to: '/daily-attendance',       label: 'Daily Attendance',                   roles: ['admin', 'manager'] },
        { to: '/payroll',                label: 'Payroll Report',                     roles: ['admin', 'manager'] },
        { to: '/payroll/setup',          label: 'Salary Setup',                       roles: ['admin']             },
        { to: '/payroll/run',            label: 'Payroll Run',                        roles: ['admin']             },
        { to: '/payroll/team',           label: 'Team Payroll',                       roles: ['admin', 'manager'] },
        { to: '/payroll/declarations',   label: 'Tax Declarations',                   roles: ['admin']             },
        { to: '/payroll/compliance',     label: 'Compliance',                         roles: ['admin']             },
        { to: '/payroll/adjustments',    label: 'Adjustments',                        roles: ['admin']             },
        { to: '/payroll/loans',          label: 'Loans & Advances',                   roles: ['admin']             },
        { to: '/payroll/tax-slabs',      label: 'Tax Slabs',                          roles: ['admin']             },
        { to: '/shifts',                 label: 'Shifts',                             roles: ['admin']             },
        { to: '/shift-roster',           label: 'Shift Roster',                       roles: ['admin', 'manager'] },
      ],
    },
  },
};

/* ── SubNavLink ──────────────────────────────────────────────────── */
// Active-state is now decided by the parent (SubNav) so we can pick a
// single best-match — preventing the case where `/payroll/setup` lit up
// both "Payroll Report" (/payroll) and "Salary Setup" (/payroll/setup).
const SubNavLink = ({ to, label, isActive }) => (
  <NavLink to={to}
    className={`h-full flex items-center px-1 border-b-2 text-[14px] whitespace-nowrap transition-all duration-150 mt-[2px] tracking-[-0.01em]
      ${isActive
        ? 'border-[#1a73e8] text-[#1a73e8] font-bold'
        : 'border-transparent text-slate-500 font-semibold hover:text-slate-800 hover:border-slate-300'
      }`}>
    {label}
  </NavLink>
);

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
          <span key={`m-${item.to}`} className="text-[14px] font-semibold whitespace-nowrap px-1">{item.label}</span>
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
                  className={`flex items-center px-4 py-2 text-[13px] transition-colors
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
    const t = setInterval(loadNotifications, 60000);
    return () => clearInterval(t);
  }, [loadNotifications]);

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
  const primaryTabs  = (config.primaryTabs || []).filter(canSee);
  const activeTab    = isHome ? homeTab : (config.getActiveTab?.(location.pathname) || primaryTabs[0]?.key);
  const subNavItems  = (config.subNav[activeTab] || []).filter(canSee);

  return (
    <div className="flex flex-col sticky top-0 z-40">
      {/* ── Navy primary bar ─────────────────────────────────────────── */}
      <div className="h-[48px] bg-[#1a2040] flex items-center justify-between px-5 shadow-sm flex-shrink-0">
        <div className="flex items-center h-full gap-1">
          {!isHome && (
            <span className="text-white/70 text-[13.5px] font-bold mr-3 border-r border-white/20 pr-4">
              {config.label}
            </span>
          )}          {primaryTabs.map(({ key, label, to }) => {
            const active = isHome ? homeTab === key : activeTab === key;
            return (
              <button key={key} onClick={() => navigate(to)}
                className={`h-full px-4 flex items-center text-[14px] border-b-[3px] transition-all duration-150 tracking-[-0.01em]
                  ${active ? 'border-white text-white font-bold' : 'border-transparent text-white/70 font-semibold hover:text-white'}`}>
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
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl z-50 border border-slate-100 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-700 uppercase tracking-wider">Quick Actions</span>
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
                      className="w-full text-left px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
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
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-2xl z-50 border border-slate-100 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
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
                    className="flex-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  />
                  <button onClick={() => setShowSearch(false)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button>
                </div>
                <div className="py-1">
                  {[
                    { label: 'Employees', to: '/employees' },
                    { label: 'Attendance', to: '/attendance/my' },
                    { label: 'Leave Tracker', to: '/leave-tracker/summary' },
                    { label: 'Reports', to: '/reports' },
                    { label: 'Announcements', to: '/announcements' },
                  ].filter(item => !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase()))
                   .map(({ label, to }) => (
                    <button key={label} onClick={() => { navigate(to); setShowSearch(false); }}
                      className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2">
                      <Search size={12} className="text-slate-300" />{label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notifications */}
          <div className="relative flex items-center" ref={notifRef}>
            <button onClick={() => setShowNotifs(!showNotifs)}
              className="hover:bg-white/10 transition-colors p-1 rounded">
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center ring-2 ring-[#1a2040]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl z-50 border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h3 className="font-semibold text-sm text-slate-800">Notifications</h3>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-[11px] text-blue-600 font-medium hover:underline flex items-center gap-1">
                        <CheckCircle size={11}/> Mark all read
                      </button>
                    )}
                    <button onClick={() => setShowNotifs(false)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button>
                  </div>
                </div>
                <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      <Bell size={28} className="mx-auto mb-2 opacity-30"/>No new notifications
                    </div>
                  ) : notifications.map(n => (
                    <div key={n._id} onClick={() => handleNotifClick(n)}
                      className={`px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors ${!n.isRead ? 'bg-blue-50/40' : ''}`}>
                      <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{n.title}</p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{n.message}</p>
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
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-white/20">
                  {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || ''}
                </div>
              )}
            </button>
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-2xl z-50 border border-slate-100 overflow-hidden">
                <div className="px-4 py-3.5 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-indigo-50">
                  <p className="font-semibold text-[13px] text-slate-800">{user?.firstName} {user?.lastName}</p>
                  <p className="text-[11px] text-slate-500 capitalize mt-0.5">{user?.designation || user?.role}</p>
                  {user?.employeeId && <p className="text-[10px] text-blue-600 font-mono mt-1">{user.employeeId}</p>}
                </div>
                <div className="py-1">
                  <button onClick={() => { navigate('/profile'); setShowUserMenu(false); }} className="w-full text-left px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50">My Profile</button>
                  <button onClick={() => { navigate('/settings'); setShowUserMenu(false); }} className="w-full text-left px-4 py-2.5 text-[13px] text-slate-700 hover:bg-slate-50">Settings</button>
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button onClick={logout} className="w-full text-left px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 font-medium">Sign Out</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── White sub-nav ─────────────────────────────────────────────── */}
      <div className="h-[42px] bg-white border-b border-slate-200 flex items-center px-5 shadow-sm relative">
        <SubNav items={subNavItems} />
      </div>
    </div>
  );
}
