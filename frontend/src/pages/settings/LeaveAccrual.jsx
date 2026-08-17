import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { Card, Check, Note, SaveBar, Spinner } from './configKit';

// Leave Accrual — how much leave is credited each month, and whether the
// monthly credit runs at all. This was the Leave Accrual tab on the old
// Settings page, moved beside the Leave Policy it belongs with.
//
// Only Casual is listed. Earned and Sick exist as leave types but are inactive,
// and Casual is granted whole each January rather than accrued monthly, so this
// switch is off for this org. It stays because the accrual job reads it.
export default function LeaveAccrual() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings')
      .then(r => { if (!cancelled) setSettings(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load accrual settings'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setSettings(s => ({ ...s, ...changes })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.put('/settings', settings)
      .then(r => { setSettings(r.data.data); setDirty(false); toast.success('Accrual settings saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !settings) return <Spinner />;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Monthly Leave Accrual"
        description="Credit leave balances to every active employee each month"
      >
        <div className="space-y-5">
          <Check
            checked={settings.leaveAccrualEnabled}
            onChange={v => set({ leaveAccrualEnabled: v })}
            label="Enable monthly accrual"
            hint="Leave is credited when the accrual job runs"
          />
          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">
              Casual Leave per month (days)
            </label>
            <input
              type="number" min={0} max={5} step={0.25}
              disabled={!settings.leaveAccrualEnabled}
              value={settings.casualAccrualPerMonth ?? ''}
              onChange={e => set({ casualAccrualPerMonth: parseFloat(e.target.value) || 0 })}
              className="w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          {!settings.leaveAccrualEnabled && (
            <Note>
              Accrual is off, which matches how this org grants leave: Casual Leave is credited whole once
              in January rather than a portion each month. Leave this off unless that changes.
            </Note>
          )}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
