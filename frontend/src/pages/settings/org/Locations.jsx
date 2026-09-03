import React, { useState, lazy, Suspense } from 'react';
import toast from 'react-hot-toast';
import { Crosshair, MapPin, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import RecordList from './RecordList';
import api from '../../../utils/api';

// Locations — where people work. Until now this was free text on each employee,
// which is why the two-locations rule was only ever a convention: nothing
// stopped a third spelling appearing. These are now records people are assigned
// to, so the list is the rule.
//
// A location also carries the geofence. The company's real coordinates belong
// to the place, not to the instance: there was a single settings.office_latitude
// before this, it was NULL, and so nothing was ever geofenced at all.
//
// The time zone column the reference shows is fixed at Asia/Kolkata here and
// not editable: attendance, payroll and cron scheduling all assume it, so a
// per-location zone would be a setting the rest of the system ignores.
/* Leaflet and its stylesheet are ~155 kB, and only somebody editing a
 * location ever needs them. Loaded on demand so the settings bundle everybody
 * else downloads does not carry a map they will never open. */
const LocationMapPicker = lazy(() => import('../../../components/LocationMapPicker'));

const COLUMNS = [
  { key: 'name', label: 'Location name' },
  { key: 'mailAlias', label: 'Email' },
  { key: 'address', label: 'Address', render: r => (
      [r.addressLine1, r.addressLine2, r.city, r.state, r.postalCode, r.country]
        .filter(Boolean).join(', ') || null
    ) },
  /* Whether this place can place a punch is the thing an admin most wants to
     see at a glance, so it is a column rather than something you open a
     record to discover. */
  { key: 'geofence', label: 'Geofence', render: r => (
      r.latitude === null || r.latitude === undefined
        ? <span className="text-amber-600 text-[13px]">Not set</span>
        : <span className="text-[13px] text-slate-600">
            {Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)}
            <span className="text-slate-400"> · {r.radiusMeters || 'default'} m</span>
          </span>
    ) },
  { key: 'timezone', label: 'Time zone' },
];

/* Capture, radius, and a way to prove the pin before it starts deciding how
 * people's days are recorded. */
function Geofence({ record, set }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const hasPoint = record.latitude !== null && record.latitude !== undefined && record.latitude !== '';

  /* One helper for both buttons: the browser's position, once, at the best
   * accuracy it can manage. maximumAge 0 because a cached fix from the last
   * building is exactly the wrong answer here. */
  const fix = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot report a location'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        latitude: p.coords.latitude, longitude: p.coords.longitude,
        accuracy: Math.round(p.coords.accuracy),
      }),
      e => reject(new Error(e.message || 'Could not read your location')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });

  const capture = async () => {
    setBusy(true); setResult(null);
    try {
      const p = await fix();
      set('latitude', p.latitude.toFixed(7));
      set('longitude', p.longitude.toFixed(7));
      toast.success(`Captured to ${p.accuracy} m accuracy`);
      if (p.accuracy > 100) {
        toast('That fix is rough. Step outside and capture again for a tighter one.', { icon: '📍' });
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  /* Stand where you want a punch to count and press this. It answers with the
   * distance and the verdict the real check-in would give — which is the only
   * cheap moment to find a pin on the wrong side of the road.
   *
   * It measures the values ON SCREEN, not the saved ones. Testing the stored
   * pin while the form shows a new one answers a question nobody asked: the
   * first use of this reported "the 200 m fence" with 500 typed in front of
   * the person reading it. */
  const test = async () => {
    setBusy(true); setResult(null);
    try {
      const p = await fix();
      const r = await api.post('/org-setup/geofence/test', {
        ...p,
        against: hasPoint ? {
          id: record.id || null,
          name: record.name || 'this location',
          latitude: record.latitude,
          longitude: record.longitude,
          radiusMeters: record.radiusMeters || null,
        } : undefined,
      });
      setResult({ ...r.data.data, accuracy: p.accuracy });
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  const Btn = ({ onClick, icon: Icon, children }) => (
    <button type="button" onClick={onClick} disabled={busy}
      className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-1.5 text-[13.5px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {children}
    </button>
  );

  const num = 'w-full border border-slate-200 rounded px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400';

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/60">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <h4 className="text-[14px] font-semibold text-slate-800 flex items-center gap-1.5">
            <MapPin size={15} className="text-slate-400" /> Geofence
          </h4>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            A check-in inside this circle is recorded as office. Outside it, as working from home.
          </p>
        </div>
        <div className="flex gap-2">
          <Btn onClick={capture} icon={Crosshair}>Use my current location</Btn>
          {hasPoint && <Btn onClick={test} icon={CheckCircle2}>Test from where I am</Btn>}
        </div>
      </div>

      {/* The map, above the numbers, because it is the thing that catches a
          wrong pin. This office was typed as 11.0308 when the building is at
          11.0257 — 564 m out, indistinguishable in a text box, and it marked
          everybody at the office as working from home. On a map it would have
          been obvious in a second. */}
      <div className="mt-3">
        <Suspense fallback={
          <div className="h-[320px] rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
            <span className="text-[13px] text-slate-400">Loading the map…</span>
          </div>
        }>
          <LocationMapPicker
            latitude={record.latitude}
            longitude={record.longitude}
            radiusMeters={record.radiusMeters}
            onPick={(la, ln) => { set('latitude', la); set('longitude', ln); }}
          />
        </Suspense>
        <p className="text-[12px] text-slate-500 mt-1.5">
          Drag the pin to your entrance, or click the map. The shaded circle is the fence
          — anybody checking in inside it is recorded as office.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Latitude</label>
          <input className={num} value={record.latitude ?? ''} placeholder="11.0168000"
            onChange={e => set('latitude', e.target.value)} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Longitude</label>
          <input className={num} value={record.longitude ?? ''} placeholder="76.9558000"
            onChange={e => set('longitude', e.target.value)} />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Radius (metres)</label>
          <input className={num} value={record.radiusMeters ?? ''} placeholder="300 (default)"
            onChange={e => set('radiusMeters', e.target.value)} />
          <p className="text-[12px] text-slate-500 mt-1">
            Leave blank to follow the organisation default. The circle above redraws as you type.
          </p>
        </div>
      </div>

      {!hasPoint && (
        <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
          No coordinates yet, so nothing punched here is classified. Stand at the entrance and
          press <strong>Use my current location</strong>.
        </p>
      )}

      {result && (
        <div className={`mt-3 rounded-lg px-3.5 py-2.5 border text-[13.5px] flex items-start gap-2 ${
          result.verdict === 'inside' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : result.verdict === 'too-vague' ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
          {result.verdict === 'inside' ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />}
          <div>
            <p>{result.message}</p>
            {result.accuracy !== null && (
              <p className="text-[12.5px] opacity-80 mt-0.5">Your fix is accurate to about {result.accuracy} m.</p>
            )}
            <p className="text-[12px] opacity-70 mt-1">
              Measured against the coordinates and radius shown above, saved or not.
            </p>
            {result.accuracy !== null && result.verdict === 'too-vague' && (
              /* The likeliest cause, said plainly. A desktop browser has no
                 GPS: it places you from wifi or your IP address, which in
                 practice can be kilometres out. Nobody should conclude their
                 pin is wrong from that. */
              <p className="text-[12.5px] mt-1.5">
                This is usually the browser, not the pin — a desktop has no GPS and places you by
                wifi or IP address. Try again on a phone with location on, or widen the radius past
                the accuracy shown.
              </p>
            )}
          </div>
        </div>
      )}

      {record.coordinatesSetBy && (
        <p className="text-[12px] text-slate-400 mt-2">
          Point set by {record.coordinatesSetBy}
          {record.coordinatesSetAt ? ` on ${new Date(record.coordinatesSetAt).toLocaleDateString('en-IN')}` : ''}.
        </p>
      )}
    </div>
  );
}

const FIELDS = [
  { key: 'name', label: 'Location name', required: true, placeholder: 'e.g. Saibaba Colony, Coimbatore' },
  { key: 'mailAlias', label: 'Email' },
  { key: 'description', label: 'Description', type: 'textarea', wide: true, maxLength: 500 },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country', placeholder: 'India' },
  {
    key: 'timezone', label: 'Time zone', readOnly: true, placeholder: 'Asia/Kolkata',
    hint: 'Fixed. Attendance, payroll and the schedulers all assume this zone.',
  },
  { key: 'geofence', type: 'custom', wide: true, render: Geofence },
];

export default function Locations() {
  return (
    <RecordList
      resource="locations"
      title="Locations"
      singular="Location"
      description="The places people work from. An employee is assigned to one of these, and its geofence decides whether a check-in counts as office or working from home."
      columns={COLUMNS}
      fields={FIELDS}
      emptyHint="Add the office, and set its coordinates so check-ins can be placed."
    />
  );
}
