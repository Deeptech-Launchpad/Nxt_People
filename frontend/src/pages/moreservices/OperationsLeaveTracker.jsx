import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { LEAVE_TRACKER_TABS } from './operationsWorkspaces';
import OpsCompOff from './leavetracker/OpsCompOff';
import OpsLeaveRequests from './leavetracker/OpsLeaveRequests';
import OpsUserSpecific from './leavetracker/OpsUserSpecific';
import OpsCustomizeBalance from './leavetracker/OpsCustomizeBalance';
import OpsCustomizePolicy from './leavetracker/OpsCustomizePolicy';
import OpsHolidays from './leavetracker/OpsHolidays';
import OpsWorkingDays from './leavetracker/OpsWorkingDays';

/* ── Operations → Leave Tracker ─────────────────────────────────────────────
 *  The administrative door onto leave, and the counterpart to the personal
 *  Leave Tracker in the sidebar.
 *
 *  Zoho reaches the same features through two doors and the difference is the
 *  whole point: My Data acts on you and offers no employee field anywhere,
 *  Operations acts on anybody and puts a selector on top. Building the
 *  administrative capability into the personal page — which is what happened
 *  first here — leaves an admin picking "Myself" from a dropdown in their own
 *  workspace, and leaves HR with nowhere to go to act on somebody else.
 *
 *  So the components are shared and the CONTEXT is what differs. Comp-Off is
 *  literally the same component the sidebar renders, handed scope="operations".
 *  Two copies would drift, and then a fix to one would silently miss the other.
 *
 *  Tab order follows Zoho's exactly, so somebody moving across from it does not
 *  have to relearn where anything lives.
 * ────────────────────────────────────────────────────────────────────────── */

export default function OperationsLeaveTracker() {
  // The tab lives in the URL so a link to Customize Balance opens Customize
  // Balance, and the back button steps through tabs the way it looks like it
  // should. Zoho does the same thing with its own hash routes.
  //
  // Back, the "Leave Tracker" name and the tab strip are all in the navy bar
  // now — see ../operationsWorkspaces.js and components/layout/Topbar.jsx.
  // Drawn here as well, they sat under an empty navy bar and a white bar
  // repeating the Operations sub-nav: three rows before any content.
  const [params] = useSearchParams();
  const fromUrl = params.get('tab');
  const tab = LEAVE_TRACKER_TABS.some(t => t.id === fromUrl) ? fromUrl : 'user';

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Each tab is its own component rather than a branch in one giant file,
          so a change to Customize Balance cannot break Compensatory Request. */}
      {tab === 'user'     && <OpsUserSpecific />}
      {tab === 'requests' && <OpsLeaveRequests />}
      {tab === 'compoff'  && <OpsCompOff />}
      {tab === 'holidays' && <OpsHolidays />}
      {tab === 'balance'  && <OpsCustomizeBalance />}
      {tab === 'policy'   && <OpsCustomizePolicy />}
      {tab === 'workdays' && <OpsWorkingDays />}
    </div>
  );
}
