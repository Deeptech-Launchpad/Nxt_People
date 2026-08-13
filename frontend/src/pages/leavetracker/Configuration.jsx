import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import LeavePolicy from '../settings/LeavePolicy';
import CompOffPolicy from '../settings/CompOffPolicy';
import PayPeriods from '../settings/PayPeriods';
import WorkCalendar from '../settings/WorkCalendar';
import LeaveMethods from '../settings/LeaveMethods';
import HolidayConfig from '../settings/HolidayConfig';
import LeaveReportsConfig from '../settings/LeaveReportsConfig';
import LeaveRequestConfig from '../settings/LeaveRequestConfig';
import LeaveAdditionalOptions from '../settings/LeaveAdditionalOptions';

// Leave Tracker → Configuration. One screen with a persistent left nav, not a
// hub that navigates away: the reference product keeps the nav in place so
// moving between sections never loses your place, and several of these settings
// are read together when deciding a policy.
//
// Every section has a screen. Where a setting's feature is not built yet, the
// control still saves and says so inline — the alternative, hiding it, made a
// partial configuration look finished.
const SECTIONS = [
  { key: 'methods', label: 'Methods', element: <LeaveMethods /> },
  { key: 'leave-policy', label: 'Leave Policy', element: <LeavePolicy /> },
  { key: 'comp-off-policy', label: 'Compensatory Off', element: <CompOffPolicy /> },
  { key: 'work-calendar', label: 'Work Calendar', element: <WorkCalendar /> },
  { key: 'pay-periods', label: 'Pay Period', element: <PayPeriods /> },
  { key: 'reports', label: 'Reports', element: <LeaveReportsConfig /> },
  { key: 'leave-request', label: 'Leave Request', element: <LeaveRequestConfig /> },
  { key: 'holidays', label: 'Holidays', element: <HolidayConfig /> },
  { key: 'additional-options', label: 'Additional Options', element: <LeaveAdditionalOptions /> },
];

export default function LeaveTrackerConfiguration() {
  return (
    <div className="w-full max-w-full min-w-0 flex items-start gap-5 px-4 py-5">
      <nav className="w-[200px] flex-shrink-0 hidden md:block">
        {SECTIONS.map(s => (
          <NavLink
            key={s.key}
            to={s.key}
            className={({ isActive }) =>
              `block px-4 py-2.5 text-[14px] rounded-lg transition-colors ${
                isActive ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600 hover:bg-slate-50'
              }`
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>

      {/* The nav is a horizontal scroller on narrow screens, where a 200px
          rail would leave the content pane unusable. */}
      <div className="md:hidden w-full overflow-x-auto border-b border-slate-200 pb-2 mb-3">
        <div className="flex gap-1 w-max">
          {SECTIONS.map(s => (
            <NavLink
              key={s.key}
              to={s.key}
              className={({ isActive }) =>
                `px-3 py-2 text-[13.5px] rounded-lg whitespace-nowrap ${
                  isActive ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600'
                }`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <Routes>
          <Route index element={<Navigate to="methods" replace />} />
          {SECTIONS.map(s => (
            <Route
              key={s.key}
              path={s.key}
              element={s.element}
            />
          ))}
          <Route path="*" element={<Navigate to="methods" replace />} />
        </Routes>
      </div>
    </div>
  );
}
