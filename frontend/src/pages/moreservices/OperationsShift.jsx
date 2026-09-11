import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import Shifts from '../Shifts';
import OpsShiftUserSpecific from './shift/OpsShiftUserSpecific';
import OpsEmployeeShiftMapping from './shift/OpsEmployeeShiftMapping';
import OpsShiftGroups from './shift/OpsShiftGroups';

/* ── Operations → Shift ───────────────────────────────────────────────────
 *  The reference's four tabs, in its order.
 *
 *  Manage Shifts is the EXISTING /shifts screen rendered here as a panel, not
 *  a second copy of it. That screen already carries every field the
 *  reference's Add Shift form has — colour, shift margin, core working hours,
 *  where weekends come from, shift allowance, eligibility criteria — so
 *  rebuilding it for this tab would have produced two editors for one table
 *  that agree until the day one of them changes.
 *
 *  The other three are new, because nothing here answered their questions:
 *  one person's calendar, everybody's schedule at once, and a named group of
 *  people with an effective period.
 *
 *  The tab strip is NOT drawn here. It lives in the navy bar with the back
 *  button and the workspace title, defined once in ./operationsWorkspaces.js
 *  and rendered by components/layout/Topbar.jsx — the same arrangement
 *  Attendance, Leave Tracker and Employee Information already use.
 * ────────────────────────────────────────────────────────────────────────── */
export default function OperationsShift() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const tab = params.get('tab') || 'user';

  /* Creating and editing shifts is full-access only on the server
   * (routes/shifts.js WRITE). A manager gets the rest of this workspace,
   * because /roster and /shifts/:id/assign scope them to their own team
   * rather than refusing them — but showing them the shift editor would mean
   * an Add Shift button that 403s on save. Said here instead. */
  const mayEditShifts = isFullAccess(user?.role);

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {tab === 'user' && <OpsShiftUserSpecific />}
      {tab === 'manage' && (mayEditShifts ? <Shifts /> : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-slate-700">Shifts are managed by HR</p>
          <p className="text-[13px] text-slate-500 mt-1 max-w-[440px] mx-auto">
            You can put your team on an existing shift from User-specific Operations or
            Employee Shift Mapping — creating and editing the shifts themselves is an
            HR and administrator action.
          </p>
        </div>
      ))}
      {tab === 'mapping' && <OpsEmployeeShiftMapping />}
      {tab === 'groups' && <OpsShiftGroups />}
    </div>
  );
}
