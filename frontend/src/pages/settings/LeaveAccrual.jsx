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

  const jm = settings.leaveAccrualConfig?.joiningMonth || {};

  // Written back nested, so the rest of leaveAccrualConfig survives the edit.
  const setJm = changes => set({
    leaveAccrualConfig: {
      ...(settings.leaveAccrualConfig || {}),
      joiningMonth: { ...jm, ...changes },
    },
  });

  /* The boundary the number in the box actually produces, rather than a
     restatement of the rule. August because it is 31 days and February
     because it is the month where a day-of-the-month rule would drift. */
  const minDays = jm.minDaysRemaining ?? 7;
  const cutoffExample = {
    lastCounted: 31 - minDays,
    firstSkipped: 31 - minDays + 1,
    febFirstSkipped: 28 - minDays + 1,
  };

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
              Leave this off. Balances are worked out from the joining date and the leave actually
              taken — this job instead adds days to an older column that most employees are no longer
              read from, so switching it on would credit some people twice and others not at all.
            </Note>
          )}
        </div>
      </Card>

      {/* Joining month — how much of the year somebody who arrives mid-year
          earns. Casual accrues one day a month, so the only real question is
          whether the month they walked in on counts. */}
      <Card
        title="Joining Month"
        description="How much leave someone earns in the month they join"
      >
        <div className="space-y-5">
          <Check
            checked={jm.skipWhenShortMonth}
            onChange={v => setJm({ skipWhenShortMonth: v })}
            label="Skip the joining month when someone starts late in it"
            hint="Off means the joining month always counts in full, however late in it they arrived"
          />

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">
              Minimum days remaining
            </label>
            <input
              type="number" min={0} max={28} step={1}
              disabled={!jm.skipWhenShortMonth}
              value={jm.minDaysRemaining ?? 7}
              onChange={e => setJm({ minDaysRemaining: parseInt(e.target.value, 10) || 0 })}
              className="w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <p className="mt-1.5 text-[13px] text-slate-500">
              Counted from the joining day to the end of that month, the joining day included.
              7 means the last week does not earn. Days rather than a date, so the rule stays the
              same width in February as in August.
            </p>
          </div>

          {/* Worked through for the number actually in the box, in the month
              they are most likely to be looking at. A rule nobody can predict
              the effect of gets set once and mistrusted afterwards. */}
          {jm.skipWhenShortMonth && (
            <Note>
              With {jm.minDaysRemaining ?? 7} day{(jm.minDaysRemaining ?? 7) === 1 ? '' : 's'}:
              joining <strong>{cutoffExample.lastCounted} August</strong> still earns August, joining{' '}
              <strong>{cutoffExample.firstSkipped} August</strong> starts from September.
              In February the same rule moves to the {cutoffExample.febFirstSkipped}th.
            </Note>
          )}

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">
              Apply to employees joining on or after
            </label>
            <input
              type="date"
              value={(jm.appliesToJoinersFrom || '').slice(0, 10)}
              onChange={e => setJm({ appliesToJoinersFrom: e.target.value || null })}
              className="w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <p className="mt-1.5 text-[13px] text-slate-500">
              Anyone who joined before this date keeps the full year's Casual Leave for their
              joining year. Moving it earlier reduces balances people have already been told
              they have, and may have booked against.
            </p>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
