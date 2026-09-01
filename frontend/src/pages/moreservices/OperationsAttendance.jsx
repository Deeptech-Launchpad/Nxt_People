import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import OpsBiometricMapping from './attendance/OpsBiometricMapping';
import OpsNotBuilt from './attendance/OpsNotBuilt';

/* ── Operations → Attendance ──────────────────────────────────────────────
 *  Zoho's Attendance section has five tabs: User-specific Operations,
 *  Regularization, On Duty, Biometric ID mapping, and Check-in/out Import &
 *  Export. This is the sixth — Attendance Marking, for staff who have no
 *  login at all and so can never appear in any of the other five, which
 *  Zoho's model does not have a place for. It already exists as its own
 *  page (routes/manual-attendance.js, ManualAttendance.jsx); clicking it here
 *  navigates there rather than re-rendering it inline, so a page that already
 *  works and is tested is not touched to fit inside this one.
 *
 *  Built so far: Biometric ID mapping. The other four are placeholders —
 *  see OpsNotBuilt — rather than silently absent, so opening this section
 *  shows the real shape of what Zoho has here even before each tab is built.
 * ────────────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'user', label: 'User-specific Operations',
    description: 'Search any employee and drill into their attendance summary, expected-vs-worked hours, regularizations and on-duty requests.' },
  { id: 'regularization', label: 'Regularization',
    description: 'The organisation-wide regularization queue, with a visible approval chain and status filters.' },
  { id: 'onduty', label: 'On Duty',
    description: 'The organisation-wide on-duty queue, including date-range and half-day requests.' },
  { id: 'biometric', label: 'Biometric ID mapping' },
  { id: 'import-export', label: 'Check-in/out Import & Export',
    description: 'Bulk import or export raw check-in/out records, including source and location.' },
];

// A link out, not a tab switch — see the header comment.
const MARKING_LINK = { id: 'marking', label: 'Attendance Marking', path: '/more-services/operations/attendance-marking' };

export default function OperationsAttendance() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === fromUrl) ? fromUrl : 'user');

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
          <span className="font-display font-semibold text-slate-800 text-[17px]">Attendance</span>
        </button>

        <div className="flex gap-0.5 flex-shrink-0">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => navigate(MARKING_LINK.path)}
            title="Opens Attendance Marking, its own page"
            className="px-3 py-2.5 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700 whitespace-nowrap"
          >
            {MARKING_LINK.label}
          </button>
        </div>
      </div>

      {tab === 'user' && (
        <OpsNotBuilt title="User-specific Operations" description={TABS[0].description} />
      )}
      {tab === 'regularization' && (
        <OpsNotBuilt title="Regularization" description={TABS[1].description} />
      )}
      {tab === 'onduty' && (
        <OpsNotBuilt title="On Duty" description={TABS[2].description} />
      )}
      {tab === 'biometric' && <OpsBiometricMapping />}
      {tab === 'import-export' && (
        <OpsNotBuilt title="Check-in/out Import & Export" description={TABS[4].description} />
      )}
    </div>
  );
}
