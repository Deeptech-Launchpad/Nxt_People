import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MarkDay from './manualattendance/MarkDay';
import StaffShifts from './manualattendance/StaffShifts';
import MarkSummary from './manualattendance/MarkSummary';

/* ── Operations → Attendance Marking ────────────────────────────────────────
 *  Attendance for people who cannot punch: housekeeping today, and anyone else
 *  on a short shift with no device.
 *
 *  It sits in Operations for the same reason the admin Leave Tracker does —
 *  this is HR acting on somebody else, and Operations is that door. Marking is
 *  not something the person themselves could ever do here, so there is no
 *  personal counterpart and no "Myself" anywhere on the page.
 *
 *  Three tabs, in the order the work happens: mark today, set up who and when,
 *  read the month back.
 * ────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'mark',    label: 'Mark Attendance' },
  { id: 'staff',   label: 'Staff & Shifts' },
  { id: 'summary', label: 'Summary' },
];

export default function ManualAttendance() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === fromUrl) ? fromUrl : 'mark');

  const go = (id) => { setTab(id); setParams({ tab: id }, { replace: true }); };

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Back and the "Attendance Marking" name are in the navy bar now, with
          the rest of the Attendance workspace — see ../operationsWorkspaces.js.
          These three are this page's own tabs, a level below that. */}
      <div className="flex items-center gap-4 border-b border-slate-200 mb-5 overflow-x-auto">
        <div className="flex gap-0.5 flex-shrink-0">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'mark'    && <MarkDay />}
      {tab === 'staff'   && <StaffShifts />}
      {tab === 'summary' && <MarkSummary />}
    </div>
  );
}
