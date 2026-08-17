import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// Shared pieces for the Leave Tracker configuration sections. They all load one
// blob, edit it locally and save it whole, so the loading, dirty-tracking and
// save-bar behaviour lives here rather than being written three times slightly
// differently.

export function Card({ title, description, actions, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
          {description && <p className="text-[13.5px] text-slate-500 mt-1.5">{description}</p>}
        </div>
        {actions}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export function Check({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600 mt-0.5 flex-shrink-0 disabled:opacity-40" />
      <span className="min-w-0">
        <span className={`block text-[14px] ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>{label}</span>
        {hint && <span className="block text-[13px] text-slate-500 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-start gap-3">
      <button
        onClick={() => onChange(!checked)}
        role="switch" aria-checked={!!checked} aria-label={label}
        className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 mt-0.5 ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <div className="min-w-0">
        <p className="text-[14px] text-slate-700">{label}</p>
        {hint && <p className="text-[13px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

export function Note({ children }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-[13px] text-slate-600">
      {children}
    </div>
  );
}

// Marks a control whose feature is not built yet. The setting still saves — it
// is the switch the feature will read — but saying so beats a control that
// looks live and quietly does nothing.
export function NotWired({ children = 'Saved, but not enforced yet' }) {
  return <span className="ml-2 text-[11.5px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 whitespace-nowrap">{children}</span>;
}

export const selectClass = 'text-[14px] rounded-md border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400';

// Loads a config section and returns everything a section screen needs.
// `base` picks the service: leave-config or attendance-config. Both expose the
// same GET/PATCH-a-section shape, so the screens differ only in their fields.
export function useConfigSection(section, label, base = 'leave-config') {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/${base}/${section}`)
      .then(r => { if (!cancelled) setConfig(r.data.data || {}); })
      .catch(err => toast.error(err.response?.data?.message || `Failed to load ${label} settings`))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [section, label, base]);

  const set = changes => { setConfig(c => ({ ...c, ...changes })); setDirty(true); };
  // Merges into a nested object without losing the keys not being changed.
  const setIn = (key, changes) => set({ [key]: { ...(config?.[key] || {}), ...changes } });

  const save = () => {
    setSaving(true);
    api.patch(`/${base}/${section}`, config)
      .then(r => { setConfig(r.data.data); setDirty(false); toast.success(`${label} settings saved`); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save those settings'))
      .finally(() => setSaving(false));
  };

  return { config, setConfig, set, setIn, loading, saving, dirty, save };
}

export function SaveBar({ dirty, saving, onSave }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex items-center gap-3 shadow-lg">
      <button onClick={onSave} disabled={saving}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium">
        {saving ? 'Saving…' : 'Save'}
      </button>
      <span className="text-[13px] text-slate-500">Unsaved changes</span>
    </div>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
}
