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
 *  Zoho's model does not have a place for.
 *
 *  Three of the six are links out, not tabs rendered here:
 *
 *    Attendance Marking   its own page (ManualAttendance.jsx), already built
 *                          and tested.
 *    Regularization        the org-wide regularization queue Zoho describes
 *    On Duty               here already exists — it is the Approvals page,
 *                          under a different door (Operations -> Leave
 *                          Approvals routes here too). Rebuilding a second
 *                          admin table for the same `attendance_regularizations`
 *                          / `on_duty_requests` rows would be exactly the
 *                          "two places to fix" trap OperationsLeaveTracker.jsx
 *                          was written to avoid — a divergent copy is worse
 *                          than a door to the real one.
 *
 *  Built inline: Biometric ID mapping. Still placeholders: User-specific
 *  Operations and Check-in/out Import & Export — see OpsNotBuilt.
 * ────────────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'user', label: 'User-specific Operations',
    description: 'Search any employee and drill into their attendance summary, expected-vs-worked hours, regularizations and on-duty requests.' },
  { id: 'regularization', label: 'Regularization', link: '/approvals?tab=regularizations' },
  { id: 'onduty', label: 'On Duty', link: '/approvals?tab=onduty' },
  { id: 'biometric', label: 'Biometric ID mapping' },
  { id: 'import-export', label: 'Check-in/out Import & Export',
    description: 'Bulk import or export raw check-in/out records, including source and location.' },
  { id: 'marking', label: 'Attendance Marking', link: '/more-services/operations/attendance-marking' },
];

export default function OperationsAttendance() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab');
  const inPageTabs = TABS.filter(t => !t.link);
  const [tab, setTab] = useState(inPageTabs.some(t => t.id === fromUrl) ? fromUrl : 'user');

  const go = (t) => {
    if (t.link) { navigate(t.link); return; }
    setTab(t.id);
    setParams({ tab: t.id }, { replace: true });
  };

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
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t)}
              title={t.link ? `Opens ${t.label}, its own page` : undefined}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                !t.link && tab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'user' && (
        <OpsNotBuilt title="User-specific Operations" description={TABS.find(t => t.id === 'user').description} />
      )}
      {tab === 'biometric' && <OpsBiometricMapping />}
      {tab === 'import-export' && (
        <OpsNotBuilt title="Check-in/out Import & Export" description={TABS.find(t => t.id === 'import-export').description} />
      )}
    </div>
  );
}
