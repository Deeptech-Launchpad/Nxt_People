import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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

const TABS = [
  { id: 'user',     label: 'User-specific Operations' },
  { id: 'requests', label: 'Leave Requests' },
  { id: 'compoff',  label: 'Compensatory Request' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'balance',  label: 'Customize Balance' },
  { id: 'policy',   label: 'Customize Policy' },
  { id: 'workdays', label: 'Exceptional Working days' },
];

export default function OperationsLeaveTracker() {
  // The tab lives in the URL so a link to Customize Balance opens Customize
  // Balance, and the back button steps through tabs the way it looks like it
  // should. Zoho does the same thing with its own hash routes.
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === fromUrl) ? fromUrl : 'user');

  const go = (id) => { setTab(id); setParams({ tab: id }, { replace: true }); };

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* One bar, the way Zoho does it: back, title and every tab on a single
          line. This used to be three stacked layers — the section sub-nav, a
          back link, a heading and a paragraph — above a tab strip that then
          did not fit and grew its own scrollbar. Four rows of chrome before
          any content is four rows nobody asked for. */}
      <div className="flex items-center gap-4 border-b border-slate-200 mb-5 overflow-x-auto">
        <button
          onClick={() => navigate('/more-services/operations')}
          title="Back to Operations"
          className="flex items-center gap-1.5 flex-shrink-0 text-slate-500 hover:text-slate-700 pb-2.5"
        >
          <ArrowLeft size={16} />
          <span className="font-display font-semibold text-slate-800 text-[17px]">Leave Tracker</span>
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
