import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import AttendanceMethods from '../settings/attendance/AttendanceMethods';
import AttendancePolicy from '../settings/attendance/AttendancePolicy';
import CheckInOutConfig from '../settings/attendance/CheckInOutConfig';
import RegularizationConfig from '../settings/attendance/RegularizationConfig';
import OnDutyConfig from '../settings/attendance/OnDutyConfig';
import PayPeriods from '../settings/PayPeriods';
import AttendanceReportsConfig from '../settings/attendance/AttendanceReportsConfig';
import AttendanceAdditionalOptions from '../settings/attendance/AttendanceAdditionalOptions';

// Attendance → Configuration, built to the same shape as the Leave Tracker's:
// one screen, a left rail that stays put, one section per screen.
//
// Pay Period is the existing screen, not a copy. The reference lists it under
// both services because there is one set of pay periods either way, and two
// editors for one table is how they drift apart.
//
// Three of the reference's sections are deliberately absent rather than stubbed:
// Overtime Policies, Specific Policies and the Hourly Permission policy list.
// Each needs an engine that does not exist here yet, and a policy builder whose
// output nothing reads is worse than no builder at all.
const SECTIONS = [
  { key: 'methods', label: 'Methods', element: <AttendanceMethods /> },
  { key: 'attendance-policy', label: 'Attendance Policy', element: <AttendancePolicy /> },
  { key: 'check-in-out', label: 'Check In and Check Out', element: <CheckInOutConfig /> },
  { key: 'regularization', label: 'Regularization', element: <RegularizationConfig /> },
  { key: 'on-duty', label: 'On Duty', element: <OnDutyConfig /> },
  { key: 'pay-periods', label: 'Pay Period', element: <PayPeriods /> },
  { key: 'reports', label: 'Reports', element: <AttendanceReportsConfig /> },
  { key: 'additional-options', label: 'Additional Options', element: <AttendanceAdditionalOptions /> },
];

// Mounted on a splat route, where a relative link resolves against the whole
// matched path — including the splat — and appends rather than replaces. Every
// link and redirect here is absolute for that reason.
const BASE = '/attendance/configuration';

export default function AttendanceConfiguration() {
  return (
    <div className="w-full max-w-full min-w-0 flex items-start gap-5 px-4 py-5">
      <nav className="w-[210px] flex-shrink-0 hidden md:block">
        {SECTIONS.map(s => (
          <NavLink
            key={s.key}
            to={`${BASE}/${s.key}`}
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

      {/* On narrow screens the rail becomes a horizontal scroller; a 210px
          column would leave the content pane unusable. */}
      <div className="md:hidden w-full overflow-x-auto border-b border-slate-200 pb-2 mb-3">
        <div className="flex gap-1 w-max">
          {SECTIONS.map(s => (
            <NavLink
              key={s.key}
              to={`${BASE}/${s.key}`}
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
          <Route index element={<Navigate to={`${BASE}/methods`} replace />} />
          {SECTIONS.map(s => (
            <Route key={s.key} path={s.key} element={s.element} />
          ))}
          <Route path="*" element={<Navigate to={`${BASE}/methods`} replace />} />
        </Routes>
      </div>
    </div>
  );
}
