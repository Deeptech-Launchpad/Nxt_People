import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isApprover, isFullAccess } from '../../utils/roles';
import {
  Home, CalendarCheck, Clock, CalendarDays, Trophy,
  LayoutGrid, PieChart, Users, AppWindow, Briefcase
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',                         icon: Home,         label: 'Home',         end: true,
    matches: p => p === '/' || ['/dashboard','/calendar','/team-space','/team/','/organization','/org-chart','/dept-tree','/announcements','/policies','/birthdays','/new-hires','/directory','/companies','/profile','/approvals','/employees','/registrations','/chat','/exit','/settings'].some(x => p.startsWith(x)) },
  { to: '/attendance',            icon: CalendarCheck,label: 'Attendance',
    matches: p => p.startsWith('/attendance') },
  { to: '/time-tracker',    icon: Clock,        label: 'Time\nTracker',
    matches: p => p.startsWith('/time-tracker') },
  { to: '/leave-tracker',    icon: CalendarDays, label: 'Leave\nTracker',
    matches: p => p.startsWith('/leave-tracker') || p === '/leave' || p.startsWith('/wfh') || p.startsWith('/comp-off') || p.startsWith('/leave-calendar') || p.startsWith('/leave-encashment') },
  // Performance is intentionally disabled — feature isn't built out yet.
  // Visible in the sidebar so users see it's planned, but the click is
  // a no-op until we wire up goals/reviews/skills properly.
  { to: '/performance/goals',        icon: Trophy,       label: 'Performance',
    matches: p => p.startsWith('/performance'), disabled: true },
  { to: '/more-services/files',      icon: LayoutGrid,   label: 'More\nServices',
    matches: p => (p.startsWith('/more-services') && !p.startsWith('/more-services/operations')) || p.startsWith('/documents') },
  // Operations workspace — relocated here from the More Services top tabs.
  // Super Admin / HR only (the page + its routes are already role-gated).
  { to: '/more-services/operations', icon: Briefcase,    label: 'Operations', roles: ['admin', 'director'],
    matches: p => p.startsWith('/more-services/operations') },
  { to: '/my-apps',                  icon: AppWindow,    label: 'NXT\nApps',
    matches: p => p.startsWith('/my-apps') || p.startsWith('/api-connections') },
];

const labelStyle = {
  fontFamily: "'Lato', sans-serif",
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: '1.2',
  textAlign: 'center',
  whiteSpace: 'pre-line',
  padding: '0 3px',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.8)',
};

const NavItem = ({ item }) => {
  const location = useLocation();
  const isActive = item.matches(location.pathname);

  // Disabled items render as a dim, non-clickable div with a tooltip —
  // we want users to see the item exists in the nav, but the click is
  // a no-op until the underlying feature is built out.
  if (item.disabled) {
    return (
      <div
        title="Coming soon"
        className="group relative flex flex-col items-center justify-center gap-1 w-full py-2 cursor-not-allowed opacity-40"
      >
        <div className="w-9 h-9 flex items-center justify-center rounded-full text-white/70">
          <item.icon size={18} strokeWidth={1.6} />
        </div>
        <span style={labelStyle} className="text-white/70">{item.label}</span>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={() =>
        `group relative flex flex-col items-center justify-center gap-1 w-full py-2 transition-all duration-150 cursor-pointer`
      }
    >
      <div className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${isActive ? 'bg-[#1a73e8] text-white shadow-lg' : 'text-white/70 group-hover:text-white group-hover:bg-white/10'}`}>
        <item.icon size={18} strokeWidth={isActive ? 2 : 1.6} />
      </div>
      <span style={labelStyle} className={isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}>{item.label}</span>
    </NavLink>
  );
};

export default function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const canSeeReports = isApprover(user);
  // Employee management (the admin Employees page) is HR / Super Admin only —
  // Team Leads view their team via Team Space / Org Chart, not this page.
  const canManageEmployees = isFullAccess(user);

  // Reports icon should also highlight on /daily-attendance, /payroll,
  // /shifts, /shift-roster — they all live under the Reports section.
  const isReportsActive = ['/reports', '/daily-attendance', '/payroll', '/shifts', '/shift-roster']
    .some(p => location.pathname.startsWith(p));

  return (
    <aside className="fixed top-0 left-0 h-screen w-[72px] bg-[#1a2040] flex flex-col z-50 shadow-xl">
      {/* Main nav — HOME is the first item, flush to the top of the sidebar. */}
      <nav className="flex-1 flex flex-col overflow-y-auto scrollbar-none py-1">
        {NAV_ITEMS.filter(item => !item.roles || item.roles.includes(user?.role)).map(item => <NavItem key={item.to} item={item}/>)}

        {/* Admin sections appended to the scrolling nav. Employees = HR/Super
            Admin only; Reports = any approver (incl. Team Leads). */}
        {(canManageEmployees || canSeeReports) && (
          <div className="flex flex-col border-t border-white/10 mt-1 pt-1">
            {canManageEmployees && (
            <NavLink to="/employees"
              className={({ isActive }) =>
                `group relative flex flex-col items-center justify-center gap-1 w-full py-2 transition-all duration-150`
              }
            >
              {({ isActive }) => {
                const isEmpActive = isActive || location.pathname.startsWith('/registrations');
                return (
                  <>
                    <div className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${isEmpActive ? 'bg-[#1a73e8] text-white shadow-lg' : 'text-white/70 group-hover:text-white group-hover:bg-white/10'}`}>
                      <Users size={18} strokeWidth={isEmpActive ? 2 : 1.6}/>
                    </div>
                    <span style={labelStyle} className={isEmpActive ? 'text-white' : 'text-white/70 group-hover:text-white'}>Employees</span>
                  </>
                );
              }}
            </NavLink>
            )}

            {canSeeReports && (
            <NavLink to="/reports"
              className="group relative flex flex-col items-center justify-center gap-1 w-full py-2 transition-all duration-150"
            >
              <div className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${isReportsActive ? 'bg-[#1a73e8] text-white shadow-lg' : 'text-white/70 group-hover:text-white group-hover:bg-white/10'}`}>
                <PieChart size={18} strokeWidth={isReportsActive ? 2 : 1.6}/>
              </div>
              <span style={labelStyle} className={isReportsActive ? 'text-white' : 'text-white/70 group-hover:text-white'}>Reports</span>
            </NavLink>
            )}
        </div>
        )}
      </nav>
    </aside>
  );
}
