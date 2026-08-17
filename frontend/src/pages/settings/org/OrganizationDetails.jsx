import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Note, SaveBar, Spinner } from '../configKit';

// Organization Details — the company's own record. This was the Company tab on
// the old single-page Settings screen; the fields and the endpoint are the
// same, they have just moved to the place the reference keeps them.
//
// Work start and end times used to sit alongside these. They are gone: nothing
// read them, and the 09:00–18:00 they showed contradicted the real shift. The
// shift owns the timing, and Attendance → Configuration owns expected hours.
export default function OrganizationDetails() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings')
      .then(r => { if (!cancelled) setSettings(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load organization details'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setSettings(s => ({ ...s, ...changes })); setDirty(true); };

  // The whole settings row goes back, not just these fields — the endpoint
  // replaces it, and sending a subset would blank everything else on it.
  const save = () => {
    setSaving(true);
    api.put('/settings', settings)
      .then(r => { setSettings(r.data.data); setDirty(false); toast.success('Organization details saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !settings) return <Spinner />;

  const field = 'w-full max-w-md border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

  return (
    <div className="space-y-4 pb-4">
      <Card title="Basic Details" description="Your organization's own record">
        <div className="space-y-5">
          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Name</label>
            <input value={settings.companyName || ''} onChange={e => set({ companyName: e.target.value })} className={field} />
          </div>
          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Contact email</label>
            <input type="email" value={settings.companyEmail || ''} onChange={e => set({ companyEmail: e.target.value })} className={field} />
          </div>
          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Time zone</label>
            <input value="Asia/Kolkata" disabled readOnly className={`${field} bg-slate-100 text-slate-500 cursor-not-allowed`} />
            <Note>
              This deployment is India-only. Attendance, payroll and cron scheduling all assume Asia/Kolkata
              throughout the system, so the zone is not safe to change on its own.
            </Note>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
