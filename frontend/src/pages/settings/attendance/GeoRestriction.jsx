import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Check, Note, SaveBar, Spinner } from '../configKit';

// Geo Restriction — where an employee is allowed to check in from. This was the
// GPS & Location tab on the old Settings page; same fields, same endpoint, now
// under the tab the reference keeps it in.
//
// The reference draws a shape on a map and can scope the rule to specific users
// or several services. Ours is one office point with a radius, applied to
// attendance check-in and check-out, because that is what the check-in route
// actually enforces. A map picker and per-user scoping are worth having, but
// only alongside a rule engine that can hold more than one shape.
export default function GeoRestriction() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings')
      .then(r => { if (!cancelled) setSettings(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load location settings'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setSettings(s => ({ ...s, ...changes })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.put('/settings', settings)
      .then(r => { setSettings(r.data.data); setDirty(false); toast.success('Geo restriction saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !settings) return <Spinner />;

  const num = 'w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400';
  const hasPoint = settings.officeLatitude != null && settings.officeLongitude != null;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Geo Restriction"
        description="Employees can check in and out only from within the range set below"
      >
        <div className="space-y-5">
          <Check
            checked={settings.requireGps}
            onChange={v => set({ requireGps: v })}
            label="Require location on check-in"
            hint="Without it, a check-in with no location is still accepted"
          />
          <Check
            checked={settings.enforceGeofence}
            onChange={v => set({ enforceGeofence: v })}
            label="Block check-in from outside the range"
            hint="With this off, an out-of-range check-in is recorded and flagged rather than refused"
          />
          <Check
            checked={settings.allowRemoteCheckIn}
            onChange={v => set({ allowRemoteCheckIn: v })}
            label="Allow check-in from outside the office"
            hint="Anyone working from home needs this; without it only the office range is accepted"
          />

          <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
            <div>
              <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Office latitude</label>
              <input
                type="number" step="0.000001" placeholder="e.g. 11.0168"
                value={settings.officeLatitude ?? ''}
                onChange={e => set({ officeLatitude: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className={num}
              />
            </div>
            <div>
              <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Office longitude</label>
              <input
                type="number" step="0.000001" placeholder="e.g. 76.9558"
                value={settings.officeLongitude ?? ''}
                onChange={e => set({ officeLongitude: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className={num}
              />
            </div>
          </div>

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Allowed radius (metres)</label>
            <input
              type="number" min={50} max={5000} step={50}
              value={settings.gpsRadiusMeters ?? 200}
              onChange={e => set({ gpsRadiusMeters: parseInt(e.target.value, 10) || 200 })}
              className={num}
            />
            <p className="text-[13px] text-slate-500 mt-1.5">100–300 metres covers a building without catching the street.</p>
          </div>

          {!hasPoint && (settings.requireGps || settings.enforceGeofence) && (
            <Note>
              No office coordinates are set, so there is no range to be inside. Until they are filled in,
              a location requirement has nothing to check against.
            </Note>
          )}
          {!settings.requireGps && !settings.enforceGeofence && (
            <Note>
              Both switches are off, so location is recorded where the browser offers it and ignored otherwise.
            </Note>
          )}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
