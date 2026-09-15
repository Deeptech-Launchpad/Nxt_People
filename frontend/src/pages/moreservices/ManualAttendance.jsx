import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import MarkDay from './manualattendance/MarkDay';
import StaffShifts from './manualattendance/StaffShifts';
import MarkSummary from './manualattendance/MarkSummary';

/* ── Home → Marking Present / Absent ────────────────────────────────────────
 *  Attendance for people who cannot punch: housekeeping today, and anyone else
 *  on a short shift with no device.
 *
 *  This is HR, or a role an administrator has delegated marking to, acting on
 *  somebody else. Marking is not something the person themselves could ever do
 *  here, so there is no personal counterpart and no "Myself" anywhere on the page.
 *
 *  Three tabs, in the order the work happens: mark today, set up who and when,
 *  read the month back. Staff & Shifts is full access only, because the API
 *  keeps deciding who is on the list full-access only — a delegated marker is
 *  not shown a tab that would refuse every request.
 *
 *  `embedded` is the Home tab. There the Home card supplies the padding, and
 *  the sub-tab lives in local state: a ?tab= on the Home URL would collide with
 *  the Home page's own query parameters.
 * ────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'mark',    label: 'Mark Attendance' },
  { id: 'staff',   label: 'Staff & Shifts', fullOnly: true },
  { id: 'summary', label: 'Summary' },
];

export default function ManualAttendance({ embedded = false }) {
  const { user } = useAuth();
  const tabs = TABS.filter(t => !t.fullOnly || isFullAccess(user));
  const [params, setParams] = useSearchParams();
  const fromUrl = embedded ? null : params.get('tab');
  const [tab, setTab] = useState(tabs.some(t => t.id === fromUrl) ? fromUrl : 'mark');

  const go = (id) => {
    setTab(id);
    if (!embedded) setParams({ tab: id }, { replace: true });
  };

  return (
    <div className={embedded ? '' : 'p-4 lg:p-6 max-w-[1600px] mx-auto'}>
      <div className="flex items-center gap-4 border-b border-slate-200 mb-5 overflow-x-auto">
        <div className="flex gap-0.5 flex-shrink-0">
          {tabs.map(({ id, label }) => (
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
      {tab === 'staff'   && tabs.some(t => t.id === 'staff') && <StaffShifts />}
      {tab === 'summary' && <MarkSummary />}
    </div>
  );
}
