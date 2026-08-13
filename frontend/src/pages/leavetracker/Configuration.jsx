import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarDays, Repeat, Gift, Wallet, ChevronRight } from 'lucide-react';

// Leave Tracker → Configuration. The settings that decide how leave behaves
// were scattered: leave accrual on its own route nothing linked to, weekend
// rules inside the general Settings page, holidays under the reports nav.
// This is the one place that gathers them, matching where the reference
// product puts them.
//
// Rows are only listed once the thing they configure exists. A configuration
// entry that opens nothing reads as broken, so unbuilt items are absent
// rather than greyed out.
const SECTIONS = [
  {
    key: 'leave-policy',
    icon: CalendarCheck,
    title: 'Leave Policy',
    description: 'How each leave type is paid, measured and granted. Accrual mode and amount drive every balance figure in the Leave Tracker reports.',
    to: '/reports/configuration/leave-policy',
  },
  {
    key: 'work-calendar',
    icon: Repeat,
    title: 'Work Calendar',
    description: 'Which days are weekends, using recurrence rules, plus working-day exceptions that override them.',
    to: '/leave-tracker/weekends',
    also: [
      { label: 'Work week, hours and day-length thresholds', to: '/settings?tab=attendance' },
    ],
  },
  {
    key: 'holidays',
    icon: CalendarDays,
    title: 'Holidays',
    description: 'The holiday calendar. Holidays are excluded from leave day counts and from working-day totals across attendance and payroll.',
    to: '/leave-tracker/holidays',
  },
  {
    key: 'comp-off',
    icon: Gift,
    title: 'Compensatory Off',
    description: 'How long a comp-off credit stays usable, and the work-calendar rules that decide when one can be earned or taken.',
    to: '/reports/configuration/comp-off-policy',
    also: [
      { label: 'Comp-off requests and balances', to: '/leave-tracker/comp-off' },
    ],
  },
  {
    key: 'pay-periods',
    icon: Wallet,
    title: 'Pay Period',
    description: 'The named ranges payroll runs over. Loss of pay, Leave encashment and Leave data for payroll can be run against a period instead of a hand-picked date range.',
    to: '/reports/configuration/pay-periods',
  },
];

export default function LeaveTrackerConfiguration() {
  return (
    <div className="w-full max-w-full min-w-0 px-4 py-5 space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold text-slate-800">Configuration</h1>
        <p className="text-sm text-slate-500 mt-1">
          The rules behind the Leave Tracker. Changes here affect balances, day counts
          and the figures reported across every Leave Tracker report.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
        {SECTIONS.map(({ key, icon: Icon, title, description, to, also }) => (
          <div key={key} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
            <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon size={18} className="text-blue-600" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <Link to={to} className="text-[14.5px] font-semibold text-slate-800 hover:text-blue-700">
                {title}
              </Link>
              <p className="text-[13px] text-slate-500 mt-0.5">{description}</p>
              {also?.map(a => (
                <Link key={a.to} to={a.to} className="inline-block text-[12.5px] text-blue-600 hover:underline mt-1.5">
                  {a.label} →
                </Link>
              ))}
            </div>
            <Link to={to} aria-label={`Open ${title}`} className="text-slate-300 hover:text-slate-500 mt-1">
              <ChevronRight size={18} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
