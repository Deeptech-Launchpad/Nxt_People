import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, CalendarDays, Gift, CalendarCheck, Scale, SlidersHorizontal, CalendarPlus } from 'lucide-react';
import BackButton from '../../components/BackButton';
import CompOff from '../CompOff';
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
  { id: 'user',      label: 'User-specific Operations', icon: Users },
  { id: 'requests',  label: 'Leave Requests',           icon: CalendarDays },
  { id: 'compoff',   label: 'Compensatory Request',     icon: Gift },
  { id: 'holidays',  label: 'Holidays',                 icon: CalendarCheck },
  { id: 'balance',   label: 'Customize Balance',        icon: Scale },
  { id: 'policy',    label: 'Customize Policy',         icon: SlidersHorizontal },
  { id: 'workdays',  label: 'Exceptional Working days',  icon: CalendarPlus },
];

export default function OperationsLeaveTracker() {
  // The tab lives in the URL so a link to Customize Balance opens Customize
  // Balance, and the back button steps through tabs the way it looks like it
  // should. Zoho does the same thing with its own hash routes.
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === fromUrl) ? fromUrl : 'user');

  const go = (id) => { setTab(id); setParams({ tab: id }, { replace: true }); };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <BackButton to="/more-services/operations" label="Operations" />

      <div className="mt-4 mb-6">
        <h1 className="font-display text-2xl font-semibold text-slate-800">Leave Tracker</h1>
        <p className="text-[15px] text-slate-500 mt-1">
          Acting on other people&rsquo;s leave. Your own is under{' '}
          <span className="font-medium text-slate-600">Leave Tracker</span> in the sidebar.
        </p>
      </div>

      <div className="border-b border-slate-200 mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={`flex items-center gap-2 px-4 py-3 text-[15px] font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Each tab is its own component rather than a branch in one giant file,
          so a change to Customize Balance cannot break Compensatory Request. */}
      {tab === 'user'     && <OpsUserSpecific />}
      {tab === 'requests' && <OpsLeaveRequests />}
      {tab === 'compoff'  && <CompOff scope="operations" />}
      {tab === 'holidays' && <OpsHolidays />}
      {tab === 'balance'  && <OpsCustomizeBalance />}
      {tab === 'policy'   && <OpsCustomizePolicy />}
      {tab === 'workdays' && <OpsWorkingDays />}
    </div>
  );
}
