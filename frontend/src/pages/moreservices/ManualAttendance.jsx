import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === fromUrl) ? fromUrl : 'mark');

  const go = (id) => { setTab(id); setParams({ tab: id }, { replace: true }); };

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-4 border-b border-slate-200 mb-5 overflow-x-auto">
        <button
          onClick={() => navigate('/more-services/operations')}
          title="Back to Operations"
          className="flex items-center gap-1.5 flex-shrink-0 text-slate-500 hover:text-slate-700 pb-2.5"
        >
          <ArrowLeft size={16} />
          <span className="font-display font-semibold text-slate-800 text-[17px]">Attendance Marking</span>
        </button>

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
