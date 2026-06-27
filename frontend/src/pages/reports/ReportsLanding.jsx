import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart2, CalendarCheck, DollarSign, Settings, Play,
  Users, Receipt, FileText, ShieldCheck, Clock, CalendarClock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess, isApprover } from '../../utils/roles';

const GRID_COLS = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' };

const ALL_CARDS = [
  { key: 'attendance',     label: 'Attendance Report',  icon: BarChart2,      color: 'text-blue-600',    to: '/reports/attendance', roles: ['admin','director','manager'] },
  { key: 'daily',          label: 'Daily Attendance',   icon: CalendarCheck,  color: 'text-emerald-600', to: '/daily-attendance',   roles: ['admin','director','manager'] },
  { key: 'payroll',        label: 'Payroll Report',     icon: DollarSign,     color: 'text-violet-600',  to: '/payroll',            roles: ['admin','director','manager'] },
  { key: 'salary-setup',   label: 'Salary Setup',       icon: Settings,       color: 'text-slate-600',   to: '/payroll/setup',      roles: ['admin','director'] },
  { key: 'payroll-run',    label: 'Payroll Run',        icon: Play,           color: 'text-green-600',   to: '/payroll/run',        roles: ['admin','director'] },
  { key: 'team-payroll',   label: 'Team Payroll',       icon: Users,          color: 'text-sky-600',     to: '/payroll/team',       roles: ['admin','director','manager'] },
  { key: 'payslips',       label: 'Payslips',           icon: Receipt,        color: 'text-amber-600',   to: '/payroll/my' },
  { key: 'tax-decl',       label: 'Tax Declarations',   icon: FileText,       color: 'text-orange-600',  to: '/payroll/tax-declaration' },
  { key: 'compliance',     label: 'Compliance',         icon: ShieldCheck,    color: 'text-rose-600',    to: '/payroll/compliance', roles: ['admin','director'] },
  { key: 'shifts',         label: 'Shifts',             icon: Clock,          color: 'text-indigo-600',  to: '/shifts',             roles: ['admin','director'] },
  { key: 'shift-roster',   label: 'Shift Roster',       icon: CalendarClock,  color: 'text-teal-600',    to: '/shift-roster',       roles: ['admin','director','manager'] },
];

export default function ReportsLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const items = ALL_CARDS.filter(c => !c.roles || c.roles.includes(user?.role));
  const colsLg = Math.min(6, Math.max(3, items.length));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-12rem)]">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="text-[16px] font-semibold text-slate-900">Reports</h2>
        <p className="text-[13px] text-slate-500 mt-1">Attendance, payroll, shifts, and compliance reports.</p>
      </div>

      <div className="p-6">
        <div className={`grid grid-cols-3 sm:grid-cols-4 ${GRID_COLS[colsLg] || 'lg:grid-cols-5'} gap-4`}>
          {items.map(({ key, label, icon: Icon, color, to }) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(to)}
              title={`Open ${label}`}
              className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-300 hover:shadow-md p-5 transition-all cursor-pointer"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100">
                <Icon size={24} className={color} strokeWidth={1.8} />
              </div>
              <span className="text-[12px] font-semibold text-center leading-tight text-slate-900">
                {label}
              </span>
              <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Open</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
