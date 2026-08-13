import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Info } from 'lucide-react';
import api from '../../utils/api';

const RAISABLE = [
  ['full_day', 'Full day'], ['half_day', 'Half day'],
  ['quarter_day', 'Quarter day'], ['hourly', 'Hourly'],
];
const EXPIRY_UNITS = [
  ['calendar_days', 'calendar days'],
  ['business_days', 'business days'],
  ['months', 'months'],
];

function Card({ title, description, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      {description && <p className="text-[13.5px] text-slate-500 mt-1.5">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function Check({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600 mt-0.5 flex-shrink-0" />
      <span className="min-w-0">
        <span className="block text-[14px] text-slate-700">{label}</span>
        {hint && <span className="block text-[13px] text-slate-500 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

// Compensatory Off configuration. These settings gate the request form — what
// durations it offers, whether a reason is required, whether a future date is
// allowed — and decide how much credit a weekend or holiday shift earns, so a
// change here changes what everyone can request tomorrow.
//
// The whole policy saves as one object, because the parts constrain each other:
// disabling every duration, or every way of requesting, would leave comp-off
// switched on but unusable.
export default function CompOffPolicy() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get('/comp-off/config')
      .then(r => setConfig(r.data.data || {}))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load comp-off settings'))
      .finally(() => setLoading(false));
  }, []);

  const set = changes => { setConfig(c => ({ ...c, ...changes })); setDirty(true); };
  const setIn = (key, changes) => set({ [key]: { ...(config[key] || {}), ...changes } });

  const save = () => {
    setSaving(true);
    api.patch('/comp-off/config', config)
      .then(r => { setConfig(r.data.data); setDirty(false); toast.success('Compensatory Off settings saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save those settings'))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!config) return null;

  const expiry = config.expiry || {};

  return (
    <div className="space-y-4 pb-20">
      <Card
        title="Compensatory Off"
        description="Compensatory Off is an entitled leave that an employee can take on a regular working day as compensation for working on a holiday or weekend"
      />

      <Card title="Mode of requests" description="Select the allowed ways of requesting for compensatory off">
        <p className="text-[14px] text-slate-700 mb-3">Compensatory off can be requested</p>
        <div className="space-y-2.5">
          <Check label="manually by raising a request"
            checked={config.requestModes?.manual}
            onChange={v => setIn('requestModes', { manual: v })} />
          <Check label="automatically through a scheduler"
            checked={config.requestModes?.scheduler}
            onChange={v => setIn('requestModes', { scheduler: v })} />
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mt-4">
          <ul className="list-disc pl-4 space-y-1.5 text-[13px] text-slate-600">
            {/* The reference product links these to its own scheduler and
                approval builders. Neither exists here, so the note says what
                the setting depends on instead of offering a dead link. */}
            <li>Automatic conversion of overtime to comp-off runs on the nightly job when the scheduler mode is on.</li>
            <li>Comp-off requests follow the approval chain configured for leave.</li>
          </ul>
        </div>
      </Card>

      <Card title="Restrictions" description="Define settings related to compensatory off restrictions">
        <p className="text-[14px] text-slate-700 mb-3">Compensatory off can be raised for</p>
        <div className="flex flex-wrap gap-x-8 gap-y-2.5 mb-5">
          {RAISABLE.map(([key, label]) => (
            <Check key={key} label={label}
              checked={config.raisableFor?.[key]}
              onChange={v => setIn('raisableFor', { [key]: v })} />
          ))}
        </div>
        <div className="space-y-4">
          <Check label="Allow requests for future dates"
            hint="When enabled, employees can take comp off leave first and later compensate by working overtime"
            checked={config.allowFutureDates} onChange={v => set({ allowFutureDates: v })} />
          <Check label="Include time input when raising a request"
            hint="When enabled, compensated from and to time can be logged"
            checked={config.includeTimeInput} onChange={v => set({ includeTimeInput: v })} />
          <Check label="Make reason mandatory"
            hint="When enabled, reason is mandatory to raise a request"
            checked={config.reasonMandatory} onChange={v => set({ reasonMandatory: v })} />
        </div>
      </Card>

      <Card
        title="Entitlement"
        description="Define the compensatory entitlement when worked overtime on weekend or holiday. When worked on working days the same hours of OT will be given as entitlement"
      >
        <p className="text-[14px] text-slate-700 mb-3">Leave credited when employee works on weekend or holiday</p>
        <div className="bg-slate-50 rounded-lg p-4 inline-block">
          {[['weekend', 'Weekend'], ['holiday', 'Holiday']].map(([key, label]) => (
            <div key={key} className="flex items-center gap-3 py-1.5">
              <span className="text-[14px] text-slate-700 w-[80px]">{label}</span>
              <input
                type="number" min="0" max="5" step="0.5"
                value={config.entitlement?.[key] ?? ''}
                onChange={e => setIn('entitlement', { [key]: e.target.value })}
                aria-label={`${label} entitlement`}
                className="w-20 text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white text-right"
              />
              <span className="text-[13px] text-slate-500">unit</span>
              <span title="One unit is one full day of comp-off credit." className="text-amber-500">
                <Info size={14} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Expiry" description="Define when the compensatory off leave balance expires">
        <p className="text-[14px] text-slate-700 mb-3">Credited leave expires</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2.5 cursor-pointer text-[14px] text-slate-700">
            <input type="radio" name="expiryMode" checked={expiry.mode === 'calendar_year_end'}
              onChange={() => set({ expiry: { mode: 'calendar_year_end' } })}
              className="w-4 h-4 accent-blue-600" />
            by calendar year end
          </label>
          <div className="flex items-center gap-2.5">
            <input type="radio" name="expiryMode" checked={expiry.mode === 'after'}
              onChange={() => set({ expiry: { mode: 'after', amount: expiry.amount || 2, unit: expiry.unit || 'months' } })}
              aria-label="expires after a period"
              className="w-4 h-4 accent-blue-600" />
            <span className="text-[14px] text-slate-700">after</span>
            <input
              type="number" min="1" max="365"
              value={expiry.amount ?? ''}
              disabled={expiry.mode !== 'after'}
              onChange={e => setIn('expiry', { amount: e.target.value })}
              aria-label="expiry period"
              className="w-20 text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white disabled:bg-slate-100"
            />
            <select
              value={expiry.unit || 'months'}
              disabled={expiry.mode !== 'after'}
              onChange={e => setIn('expiry', { unit: e.target.value })}
              aria-label="expiry unit"
              className="text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white disabled:bg-slate-100 min-w-[160px]"
            >
              {EXPIRY_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {/* The bar only appears once something changed, so it never covers content
          on a screen nobody is editing. */}
      {dirty && (
        <div className="sticky bottom-0 bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex items-center gap-3 shadow-lg">
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <span className="text-[13px] text-slate-500">Unsaved changes</span>
        </div>
      )}
    </div>
  );
}
