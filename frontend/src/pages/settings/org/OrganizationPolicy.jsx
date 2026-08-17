import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Note, SaveBar, Spinner } from '../configKit';
import { roleLabel } from '../../../utils/roles';

// Organization Policy — the org-wide security rules. This was the Security tab
// on the old Settings page. The reference keeps no such tab, but it does keep
// an Organization Policy section under Manage Accounts, and that is the closest
// true home rather than inventing a tab of our own.
//
// Only the MFA list is editable. The three below it are facts about how the
// deployment is configured, shown because an admin asking "is MFA enough?"
// wants them on the same screen — they are labelled as read-only, not dressed
// up as controls.
const MFA_ROLES = ['admin', 'director', 'manager', 'team_member'];

export default function OrganizationPolicy() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings')
      .then(r => { if (!cancelled) setSettings(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load organization policy'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = () => {
    setSaving(true);
    api.put('/settings', settings)
      .then(r => { setSettings(r.data.data); setDirty(false); toast.success('Organization policy saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !settings) return <Spinner />;

  const selected = Array.isArray(settings.mfaRequiredRoles) ? settings.mfaRequiredRoles : [];
  const toggle = role => {
    const next = selected.includes(role) ? selected.filter(r => r !== role) : [...selected, role];
    setSettings(s => ({ ...s, mfaRequiredRoles: next }));
    setDirty(true);
  };

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Multi-factor authentication"
        description="Users in the selected roles are taken through MFA enrolment on their next sign-in"
      >
        <div className="flex flex-wrap gap-2">
          {MFA_ROLES.map(r => {
            const on = selected.includes(r);
            return (
              <button
                key={r} type="button" onClick={() => toggle(r)}
                aria-pressed={on}
                className={`px-3.5 py-1.5 rounded-full text-[13.5px] font-medium border transition-colors ${
                  on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                }`}
              >
                {roleLabel(r)}
              </button>
            );
          })}
        </div>
        {selected.length === 0 && (
          <Note>No role requires MFA. Anyone may still enrol voluntarily from their own profile.</Note>
        )}
      </Card>

      <Card title="Deployment policy" description="Set where the application is configured, not on this screen">
        <dl className="divide-y divide-slate-100 text-[14px]">
          {[
            ['Session expiry', 'Access tokens last 7 days — set by JWT_EXPIRE in the environment file'],
            ['Password policy', 'A minimum of 6 characters, applied to every account'],
            ['Roles', 'Super Admin · HR · Team Lead · Employee'],
          ].map(([term, detail]) => (
            <div key={term} className="py-3 flex flex-wrap gap-x-6 gap-y-1">
              <dt className="text-slate-700 font-medium w-[150px] flex-shrink-0">{term}</dt>
              <dd className="text-slate-500 min-w-0">{detail}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
