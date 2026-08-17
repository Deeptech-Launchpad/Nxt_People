import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Check, Note, Toggle, selectClass, SaveBar, Spinner } from '../configKit';

// Absent Scheduler — closes off the day for anyone who never checked in.
//
// Without it, a day with no attendance row is simply missing, and every report
// has to infer what it was. With it the row exists and says 'absent', which is
// the same conclusion written down once instead of re-derived everywhere.
//
// It never touches a day that is already accounted for: approved leave,
// approved on duty, a holiday, or a weekend. Those are not absences, and the
// classifier already decides them.
export default function AbsentScheduler() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/automation/scheduler')
      .then(r => { if (!cancelled) setConfig(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load the scheduler'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setConfig(c => ({ ...c, ...changes })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.put('/automation/scheduler', config)
      .then(r => { setConfig(r.data.data); setDirty(false); toast.success('Absent scheduler saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !config) return <Spinner />;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Absent Scheduler"
        description="Mark anyone who never checked in as absent, once the day is over"
      >
        <div className="space-y-5">
          <Toggle
            checked={config.enabled}
            onChange={v => set({ enabled: v })}
            label="Run the absent scheduler"
            hint="Off by default — turning it on starts writing attendance rows every working day"
          />

          {config.enabled && (
            <>
              <div>
                <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Run at</label>
                <input type="time" value={config.runAt || '21:00'}
                  onChange={e => set({ runAt: e.target.value })} className={selectClass} />
                <p className="text-[13px] text-slate-500 mt-1.5 max-w-[560px]">
                  Late enough that anyone who forgot has had the whole day to notice. Asia/Kolkata.
                </p>
              </div>

              <Check
                checked={config.markAbsentWhenNoCheckIn}
                onChange={v => set({ markAbsentWhenNoCheckIn: v })}
                label="Mark a day with no check-in at all as absent"
              />

              <Note>
                Approved leave, approved on duty, holidays and weekends are never touched — a day already
                accounted for is not an absence. Anyone who checked in, however briefly, keeps the day
                they recorded.
              </Note>
            </>
          )}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
