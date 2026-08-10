import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, Clock,
  Building2, CalendarDays, CalendarCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess, isApprover } from '../../utils/roles';
import { REPORT_CATALOG } from './catalogData';

// Icons live here (not in catalogData.js) so that shared file stays a plain
// data module usable from both this page and ReportShell without pulling
// in an icon library dependency there.
const CATEGORY_ICONS = { 'Employee Information': Building2, 'Leave Tracker': CalendarDays, 'Attendance': CalendarCheck };

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
        {REPORT_CATALOG.map(({ category, reports }) => {
          const Icon = CATEGORY_ICONS[category];
          return (
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
          );
        })}
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
