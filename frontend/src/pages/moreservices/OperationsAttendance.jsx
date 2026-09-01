import React from 'react';
import { useSearchParams } from 'react-router-dom';
import OpsBiometricMapping from './attendance/OpsBiometricMapping';
import OpsCheckInOutImportExport from './attendance/OpsCheckInOutImportExport';
import OpsUserSpecific from './attendance/OpsUserSpecific';
import OpsRegularizationQueue from './attendance/OpsRegularizationQueue';
import OpsOnDutyQueue from './attendance/OpsOnDutyQueue';

/* ── Operations → Attendance ──────────────────────────────────────────────
 *  The five tabs the reference has, plus a sixth — Attendance Marking, for
 *  staff who have no login at all and so can never appear in any of the
 *  other five. That one is a route of its own (ManualAttendance.jsx) because
 *  it is a whole page with its own sub-tabs; the rest are panels here.
 *
 *  The tab strip itself is NOT drawn here. It lives in the navy bar with the
 *  back button and the workspace name, defined once in
 *  ../operationsWorkspaces.js and rendered by components/layout/Topbar.jsx —
 *  see that file for why. This component only decides which panel the active
 *  tab means.
 *
 *  Regularization and On Duty are the org-wide queues, rendered here rather
 *  than linking out to the Approvals page. They read the same endpoints
 *  Approvals does, so there is still one source of truth for the data and
 *  the actions; what differs is only the table, which follows the
 *  reference's Old/New column layout. Sending an admin to a page under a
 *  different section — with a different header, in a different part of the
 *  app — to act on a queue that belongs to Attendance was the wrong trade.
 * ────────────────────────────────────────────────────────────────────────── */
export default function OperationsAttendance() {
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'user';

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {tab === 'user' && <OpsUserSpecific />}
      {tab === 'regularization' && <OpsRegularizationQueue />}
      {tab === 'onduty' && <OpsOnDutyQueue />}
      {tab === 'biometric' && <OpsBiometricMapping />}
      {tab === 'import-export' && <OpsCheckInOutImportExport />}
    </div>
  );
}
