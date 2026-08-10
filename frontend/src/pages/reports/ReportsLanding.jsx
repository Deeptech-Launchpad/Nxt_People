import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, DollarSign, Clock,
  Building2, CalendarDays,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess, isApprover } from '../../utils/roles';

// The categorized report catalog. Each entry navigates straight to that
// report's own dedicated page — the list itself only ever lives here, never
// re-appears on the destination page. Three Attendance reports deep-link
// into the existing Attendance Reports page's tabs instead of duplicating
// them as separate pages.
const REPORT_CATALOG = [
  {
    category: 'Employee Information', icon: Building2,
    reports: [
      { label: 'Dashboard',                  to: '/reports/employee/dashboard' },
      { label: 'Headcount',                  to: '/reports/employee/headcount' },
      { label: 'Employee addition trend',    to: '/reports/employee/addition-trend' },
      { label: 'Employee attrition trend',   to: '/reports/employee/attrition-trend' },
      { label: 'Distribution',               to: '/reports/employee/distribution' },
      { label: 'Diversity',                  to: '/reports/employee/diversity' },
      { label: 'Experience wise exit',       to: '/reports/employee/experience-exit' },
    ],
  },
  {
    category: 'Leave Tracker', icon: CalendarDays,
    reports: [
      { label: 'Daily leave status',          to: '/reports/leave/daily-status' },
      { label: 'Resource availability',       to: '/reports/leave/resource-availability' },
      { label: 'Employee leave balance',      to: '/reports/leave/balance' },
      { label: 'Leave booked and balance',    to: '/reports/leave/booked-balance' },
      { label: 'Leave type wise summary',     to: '/reports/leave/type-summary' },
      { label: 'Leave encashment details',    to: '/reports/leave/encashment' },
      { label: 'Loss of pay details',         to: '/reports/leave/lop' },
      { label: 'Leave data for payroll',      to: '/reports/leave/payroll-export' },
    ],
  },
  {
    category: 'Attendance', icon: CalendarCheck,
    reports: [
      { label: 'Daily attendance status',              to: '/reports/attendance?tab=daily' },
      { label: 'Early/late check-in and check-out',    to: '/reports/attendance?tab=detail' },
      { label: 'Employee present/absent status',       to: '/reports/attendance?tab=summary' },
      { label: 'Presence hours break-up',               to: '/reports/attendance/hours-breakup' },
      { label: 'Attendance data for payroll',           to: '/reports/attendance/payroll-export' },
      { label: 'Muster roll',                            to: '/reports/attendance/muster-roll' },
      { label: 'Consecutive absences',                   to: '/reports/attendance/consecutive-absences' },
      { label: 'Expected vs Worked Hours',               to: '/reports/attendance/expected-vs-worked' },
      // Formerly duplicated as their own "Attendance" heading under Quick
      // Links — merged in here so the page only ever has one Attendance
      // section.
      { label: 'Attendance Report',                      to: '/reports/attendance' },
      { label: 'Daily Attendance',                        to: '/daily-attendance' },
    ],
  },
];

// Quick Links, restructured to match the report catalog's own look
// (category heading + plain dashed-row list) instead of the old icon-tile
// card grid. Each link keeps its original role restriction; a category
// with zero visible links for the current role simply doesn't render.
const QUICK_LINKS_CATALOG = [
  {
    category: 'Payroll', icon: DollarSign,
    links: [
      { label: 'Payroll Report',    to: '/payroll',                 roles: ['admin','director','hr_admin','manager'] },
      { label: 'Salary Setup',      to: '/payroll/setup',           roles: ['admin','director','hr_admin'] },
      { label: 'Payroll Run',       to: '/payroll/run',             roles: ['admin','director','hr_admin'] },
      { label: 'Team Payroll',      to: '/payroll/team',            roles: ['admin','director','hr_admin','manager'] },
      { label: 'Payslips',          to: '/payroll/my' },
      { label: 'Tax Declarations',  to: '/payroll/tax-declaration' },
      { label: 'Compliance',        to: '/payroll/compliance',      roles: ['admin','director','hr_admin'] },
    ],
  },
  {
    category: 'Shifts', icon: Clock,
    links: [
      { label: 'Shifts',       to: '/shifts',        roles: ['admin','director','hr_admin'] },
      { label: 'Shift Roster', to: '/shift-roster',  roles: ['admin','director','hr_admin','manager'] },
    ],
  },
];

export default function ReportsLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const quickLinkCategories = QUICK_LINKS_CATALOG
    .map(cat => ({ ...cat, links: cat.links.filter(l => !l.roles || l.roles.includes(user?.role)) }))
    .filter(cat => cat.links.length > 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-12rem)]">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="text-[18px] font-semibold text-slate-900">Reports</h2>
        <p className="text-[15px] text-slate-500 mt-1">Attendance, payroll, shifts, and compliance reports.</p>
      </div>

      <div className="px-6 pt-6 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-8">
        {REPORT_CATALOG.map(({ category, icon: Icon, reports }) => (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <Icon size={16} className="text-slate-500" />
              <h3 className="text-[15px] font-bold text-slate-800">{category}</h3>
            </div>
            <div className="space-y-0">
              {reports.map(r => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => navigate(r.to)}
                  className="w-full text-left py-2.5 border-b border-dashed border-slate-150 text-[14px] text-slate-700 hover:text-blue-600 transition-colors"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 pt-8 pb-6">
        <h3 className="text-[13px] font-bold text-slate-400 uppercase tracking-wide mb-4">Quick Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-8">
          {quickLinkCategories.map(({ category, icon: Icon, links }) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <Icon size={16} className="text-slate-500" />
                <h3 className="text-[15px] font-bold text-slate-800">{category}</h3>
              </div>
              <div className="space-y-0">
                {links.map(l => (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => navigate(l.to)}
                    className="w-full text-left py-2.5 border-b border-dashed border-slate-150 text-[14px] text-slate-700 hover:text-blue-600 transition-colors"
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
