import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Toggle, Note, Spinner, SaveBar } from '../configKit';

// Auto Shift Assignment.
//
// When it is on, a check-in with no rostered shift is put on whichever shift
// starts nearest the check-in time. It only ever decides today — the same
// limit the reference states, and the reason is the same: rewriting a past
// day would change what attendance has already been calculated against.
//
// An explicit answer always wins. A day rostered by hand, or one a shift
// pattern generated, is a decision somebody made; this only fills the gap.

export default function AutoShiftAssignment() {
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/shift-config/general')
      .then(r => {
        const c = r.data.data?.autoShiftAssignment || { enabled: false };
        setConfig(c); setSaved(c);
      })
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setConfig({ enabled: false }); });
    api.get('/shifts').then(r => setShifts(r.data.data || [])).catch(() => {});
  }, []);

  if (!config) return <Spinner />;

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

  const save = () => {
    setSaving(true);
    api.patch('/shift-config/general', { autoShiftAssignment: config })
      .then(r => {
        const c = r.data.data?.autoShiftAssignment || config;
        setConfig(c); setSaved(c);
        toast.success('Saved');
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-4 pb-24">
      <Card
        title="Auto shift assignment"
        description="Automatically assign shifts to employees in real time based on their check-in time. It operates only for current date entries, without impacting past data."
      >
        <Note>
          An explicit answer always wins. A day rostered by hand, or one a shift pattern generated,
          is left alone — this only fills the gap where nothing has decided.
        </Note>

        <div className="mt-4">
          <Toggle
            checked={!!config.enabled}
            onChange={v => setConfig({ ...config, enabled: v })}
            label="Auto shift assignment"
            hint="Picks the shift whose start time is nearest the check-in, measured around the clock so a late-night check-in matches a night shift rather than a morning one."
          />
        </div>

        {/* With one shift there is nothing to choose between, and saying so
            beats a switch that appears to do something. */}
        {shifts.length < 2 && (
          <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mt-4">
            There {shifts.length === 1 ? 'is one shift' : 'are no shifts'} defined, so there is nothing to
            choose between. Add another shift under Manage Shifts before this can do anything.
          </p>
        )}

        {shifts.length >= 2 && config.enabled && (
          <div className="mt-4 bg-slate-50 rounded-lg px-4 py-3">
            <p className="text-[13px] text-slate-600 mb-2">A check-in would be matched against:</p>
            <div className="flex flex-wrap gap-2">
              {shifts.map(s => (
                <span key={s.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2.5 py-1 text-[13px] text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.name} <span className="text-slate-400">starts {s.startTime}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
