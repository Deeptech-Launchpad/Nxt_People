import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Home, CalendarCheck, Clock, CalendarDays, Trophy,
  LayoutGrid, PieChart, Users
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',                         icon: Home,         label: 'Home',         end: true,
    matches: p => p === '/' || ['/dashboard','/calendar','/team-space','/team/','/organization','/org-chart','/dept-tree','/announcements','/policies','/birthdays','/new-hires','/directory','/companies','/profile','/approvals','/employees','/registrations','/chat','/exit','/api-connections','/settings'].some(x => p.startsWith(x)) },
  { to: '/attendance/my',            icon: CalendarCheck,label: 'Attendance',
    matches: p => p.startsWith('/attendance') },
  { to: '/time-tracker/timelogs',    icon: Clock,        label: 'Time\nTracker',
    matches: p => p.startsWith('/time-tracker') },
  { to: '/leave-tracker/summary',    icon: CalendarDays, label: 'Leave\nTracker',
    matches: p => p.startsWith('/leave-tracker') || p === '/leave' || p.startsWith('/wfh') || p.startsWith('/comp-off') || p.startsWith('/leave-calendar') || p.startsWith('/leave-encashment') },
  { to: '/performance/goals',        icon: Trophy,       label: 'Performance',
    matches: p => p.startsWith('/performance') },
  { to: '/more-services/files',      icon: LayoutGrid,   label: 'More\nServices',
    matches: p => p.startsWith('/more-services') || p.startsWith('/documents') },
];

const labelStyle = {
  fontFamily: "'Lato', sans-serif",
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: '1.3',
  textAlign: 'center',
  whiteSpace: 'pre-line',
  padding: '0 3px',
  textTransform: 'uppercase',
};

const NavItem = ({ item }) => {
  const location = useLocation();
  const isActive = item.matches(location.pathname);

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
  const canSeeReports = user?.role === 'admin' || user?.role === 'manager';

  // Reports icon should also highlight on /daily-attendance, /payroll,
  // /shifts, /shift-roster — they all live under the Reports section.
  const isReportsActive = ['/reports', '/daily-attendance', '/payroll', '/shifts', '/shift-roster']
    .some(p => location.pathname.startsWith(p));

  return (
    <aside className="fixed top-0 left-0 h-screen w-[72px] bg-[#1a2040] flex flex-col z-50 shadow-xl">
      {/* Logo */}
      <div className="flex items-center justify-center h-[48px] flex-shrink-0 bg-[#151a35]">
        <div className="w-8 h-8 rounded-lg bg-[#1a73e8] flex items-center justify-center shadow-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col overflow-y-auto scrollbar-none py-1">
        {NAV_ITEMS.map(item => <NavItem key={item.to} item={item}/>)}

        {/* Admin/Manager sections appended to the scrolling nav to prevent them taking fixed bottom space */}
        {canSeeReports && (
          <div className="flex flex-col border-t border-white/10 mt-1 pt-1">
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
                    <span style={labelStyle} className={isEmpActive ? 'text-white' : 'text-white/70 group-hover:text-white'}>Employee<br/>Master</span>
                  </>
                );
              }}
            </NavLink>

            <NavLink to="/reports"
              className="group relative flex flex-col items-center justify-center gap-1 w-full py-2 transition-all duration-150"
            >
              <div className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${isReportsActive ? 'bg-[#1a73e8] text-white shadow-lg' : 'text-white/70 group-hover:text-white group-hover:bg-white/10'}`}>
                <PieChart size={18} strokeWidth={isReportsActive ? 2 : 1.6}/>
              </div>
              <span style={labelStyle} className={isReportsActive ? 'text-white' : 'text-white/70 group-hover:text-white'}>Reports</span>
            </NavLink>
        </div>
        )}
      </nav>
    </aside>
  );
}
