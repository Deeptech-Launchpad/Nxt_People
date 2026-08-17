import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Note, SaveBar, Spinner, selectClass } from '../configKit';

// Organization Setup → Organization Details.
//
// One card, "Basic Details", with the label beside the field rather than above
// it — the reference's layout, and the reason a form of eleven fields still
// reads as one column rather than a long ladder.
//
// The time zone is not here. The reference keeps it under Organization Policy →
// Locale, which is also where the application reads it from, and two places to
// set one thing is how they end up disagreeing.
const STATES = [
  'Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Maharashtra',
  'Delhi', 'Gujarat', 'West Bengal', 'Uttar Pradesh', 'Rajasthan', 'Punjab', 'Haryana',
];
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Singapore', 'United Arab Emirates', 'Australia'];

function Field({ label, required, children, hint }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-6 py-2.5">
      <label className="text-[14px] text-slate-700 w-full sm:w-[170px] flex-shrink-0 sm:pt-2">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="min-w-0 flex-1 max-w-[380px]">
        {children}
        {hint && <p className="text-[12.5px] text-slate-500 mt-1">{hint}</p>}
      </div>
    </div>
  );
}

export default function OrganizationDetails() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/org-details/details')
      .then(r => { if (!cancelled) setData(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load organization details'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = changes => { setData(d => ({ ...d, ...changes })); setDirty(true); };

  const save = () => {
    setSaving(true);
    api.patch('/org-details/details', data)
      .then(r => { setData(r.data.data); setDirty(false); toast.success('Organization details saved'); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  if (loading || !data) return <Spinner />;

  const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-[15px] font-semibold text-slate-800">Basic Details</h2>
        </div>

        <div className="px-6 py-4">
          <Field label="Logo">
            <div className="w-[240px] h-[96px] border border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 overflow-hidden">
              {data.logoUrl
                ? <img src={data.logoUrl} alt="Organization logo" className="max-h-full max-w-full object-contain" />
                : <span className="text-[13px] text-slate-400">No logo</span>}
            </div>
            <input
              value={data.logoUrl || ''} onChange={e => set({ logoUrl: e.target.value })}
              placeholder="Logo image URL"
              className={`${input} mt-2`}
            />
          </Field>

          <Field label="Name" required>
            <input value={data.name || ''} onChange={e => set({ name: e.target.value })} className={input} />
          </Field>

          <Field label="Website">
            <input value={data.website || ''} onChange={e => set({ website: e.target.value })}
              placeholder="www.example.com" className={input} />
          </Field>

          <Field label="Type of organization">
            <select value={data.type || ''} onChange={e => set({ type: e.target.value })} className={`${selectClass} w-full`}>
              <option value="">Select</option>
              {(data.organizationTypes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Contact person">
            <input value={data.contactPerson || ''} onChange={e => set({ contactPerson: e.target.value })} className={input} />
          </Field>

          <Field label="Contact number">
            <input value={data.contactNumber || ''} onChange={e => set({ contactNumber: e.target.value })} className={input} />
          </Field>

          <Field label="Contact email" required>
            <input type="email" value={data.contactEmail || ''} onChange={e => set({ contactEmail: e.target.value })} className={input} />
          </Field>

          <Field label="Primary address">
            <div className="space-y-2.5">
              <input value={data.addressLine1 || ''} onChange={e => set({ addressLine1: e.target.value })}
                placeholder="Address line 1" className={input} />
              <input value={data.addressLine2 || ''} onChange={e => set({ addressLine2: e.target.value })}
                placeholder="Address line 2" className={input} />
              <div className="grid grid-cols-2 gap-2.5">
                <input value={data.city || ''} onChange={e => set({ city: e.target.value })}
                  placeholder="City" className={input} />
                <select value={data.state || ''} onChange={e => set({ state: e.target.value })} className={`${selectClass} w-full`}>
                  <option value="">Select State</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  {data.state && !STATES.includes(data.state) && <option value={data.state}>{data.state}</option>}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <select value={data.country || ''} onChange={e => set({ country: e.target.value })} className={`${selectClass} w-full`}>
                  <option value="">Select Country</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  {data.country && !COUNTRIES.includes(data.country) && <option value={data.country}>{data.country}</option>}
                </select>
                <input value={data.postalCode || ''} onChange={e => set({ postalCode: e.target.value })}
                  placeholder="Postal Code" className={input} />
              </div>
            </div>
          </Field>

          <Note>
            The organization&rsquo;s time zone is set under Organization Policy → Locale &amp; Display
            format, which is where the application reads it from.
          </Note>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
