import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { MapPin, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Check, Note, SaveBar, Spinner } from '../configKit';

/* Geo Restriction — how a check-in is placed.
 *
 * This screen used to edit one office point on the settings row:
 * officeLatitude, officeLongitude, gpsRadiusMeters. Both coordinates were NULL
 * on live, and the check-in handler guards on them being set, so the branch
 * never ran and nobody was ever classified. An organisation with two offices
 * could not have expressed itself here at all.
 *
 * The point now belongs to the LOCATION, where it can differ per site and
 * where an admin can stand at the door and capture it. What is left here is
 * what genuinely is organisation-wide: whether classification runs at all,
 * the default radius a location inherits, and what to do with a punch that
 * cannot be placed.
 */
const RADIUS_HINT = (m) => {
  if (m <= 100) return 'Tight — a single building, and easily missed by a poor fix indoors.';
  if (m <= 400) return 'A building and its car park. This is the usual choice.';
  if (m <= 1000) return 'A campus or a block of streets.';
  return 'Wide enough to include neighbouring buildings — check that is what you mean.';
};

export default function GeoRestriction() {
  const [cfg, setCfg] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/org-setup/geofence/config'),
      api.get('/org-setup/locations').catch(() => ({ data: { data: [] } })),
    ])
      .then(([c, l]) => {
        if (cancelled) return;
        setCfg(c.data.data || {});
        setLocations(l.data.data || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load the geofence settings'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setCfg(c => ({ ...c, ...changes })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.put('/org-setup/geofence/config', cfg)
      .then(r => { setCfg(r.data.data); setDirty(false); toast.success('Geofence settings saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !cfg) return <Spinner />;

  const num = 'w-full max-w-xs border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
  const placed = locations.filter(l => l.latitude !== null && l.latitude !== undefined);
  const radius = Number(cfg.defaultRadiusMeters) || 300;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Where a check-in counts as office"
        description="A punch inside a location's circle is recorded as office. Outside every circle, as working from home."
      >
        <div className="space-y-5">
          {/* The points themselves live with the locations, so the screen says
              where to go rather than duplicating them here. */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
            <div className="flex items-start gap-2.5">
              <MapPin size={16} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[14px] text-slate-700">
                  {placed.length === 0
                    ? 'No location has coordinates yet.'
                    : `${placed.length} of ${locations.length} location${locations.length === 1 ? '' : 's'} ${placed.length === 1 ? 'has' : 'have'} coordinates set.`}
                </p>
                <ul className="mt-2 space-y-1">
                  {locations.map(l => (
                    <li key={l.id} className="text-[13.5px] text-slate-600 flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${l.latitude != null ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                      {l.name}
                      <span className="text-slate-400">
                        {l.latitude != null
                          ? `${Number(l.latitude).toFixed(5)}, ${Number(l.longitude).toFixed(5)} · ${l.radiusMeters || radius} m`
                          : 'no coordinates'}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link to="/settings/service/accounts/configuration/locations"
                  className="inline-block text-[13.5px] text-blue-600 hover:underline mt-2">
                  Set them under Organization Setup → Locations
                </Link>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Default radius (metres)</label>
            <input type="number" min={20} max={5000} step={10} value={cfg.defaultRadiusMeters ?? 300}
              onChange={e => set({ defaultRadiusMeters: parseInt(e.target.value, 10) || 300 })}
              className={num} />
            <p className="text-[13px] text-slate-500 mt-1.5">{RADIUS_HINT(radius)}</p>
            <p className="text-[13px] text-slate-500">
              Every location that has not set its own radius uses this, so changing it moves them all.
            </p>
          </div>

          <Check
            checked={!!cfg.requireAccuracy}
            onChange={v => set({ requireAccuracy: v })}
            label="Ignore a fix vaguer than the radius"
            hint="A phone indoors often reports a position good to ±300 m. Asked whether that punch is inside a 300 m circle, there is no honest answer — so it is recorded as unknown rather than guessed."
          />

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">
              A check-in we cannot place counts as
            </label>
            <select value={cfg.unknownCountsAs || 'unknown'}
              onChange={e => set({ unknownCountsAs: e.target.value })}
              className={num}>
              <option value="unknown">Unknown — flag it for HR</option>
              <option value="office">Office</option>
              <option value="wfh">Working from home</option>
            </select>
            <p className="text-[13px] text-slate-500 mt-1.5">
              Location is never required to check in — a refused prompt or a phone with no signal must
              not cost somebody their day. This decides what those punches are recorded as.
            </p>
          </div>

          <Check
            checked={!!cfg.blockOutsideFence}
            onChange={v => set({ blockOutsideFence: v })}
            label="Refuse a check-in from outside every location"
            hint="Off by default, and the usual choice: working from home is a legitimate answer, not an error. A punch that could not be placed at all is never refused either way."
          />

          {cfg.blockOutsideFence && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-2.5">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-[13.5px] text-amber-800">
                Anybody genuinely working from home will be unable to check in. Mark them
                <strong> Remote</strong> on their employee record, or leave this off.
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Switch it on"
        description="Until this is on, nothing is classified and check-in behaves exactly as it does today."
      >
        <Check
          checked={!!cfg.classifyEnabled}
          onChange={v => set({ classifyEnabled: v })}
          label="Record whether each check-in was office or working from home"
          hint="Applies from the moment it is saved. Days already recorded are not reclassified — the punch is the record of what happened."
        />
        {!cfg.classifyEnabled && placed.length > 0 && (
          <Note>
            {placed.length} location{placed.length === 1 ? ' has' : 's have'} coordinates, so this is ready
            to switch on. Test each one first from the Locations screen.
          </Note>
        )}
        {!placed.length && (
          <Note>
            Set coordinates on at least one location first. Switching this on with none would record every
            single check-in as unknown.
          </Note>
        )}
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
