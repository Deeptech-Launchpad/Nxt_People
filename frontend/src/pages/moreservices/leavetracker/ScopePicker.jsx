import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../../utils/api';

/* ── "Applicable for" ───────────────────────────────────────────────────────
 *  Zoho's criteria builder: rows of `Locations is [WFH] [Saibaba Colony]` or
 *  `Shifts is [General]`, added and removed.
 *
 *  Selecting nothing means EVERYONE, and the panel says so rather than leaving
 *  it to be inferred from an empty box. That default is not cosmetic — it is
 *  what every holiday in the calendar already is, and a builder that read blank
 *  as "nobody" would empty the company's holidays the first time somebody
 *  opened one and pressed Save.
 * ────────────────────────────────────────────────────────────────────────── */
export function useScopeOptions() {
  const [locations, setLocations] = useState([]);
  const [shifts, setShifts] = useState([]);

  useEffect(() => {
    api.get('/org-setup/locations')
      .then(r => setLocations((r.data.data || []).filter(l => l.isActive !== false)))
      .catch(() => setLocations([]));
    api.get('/shifts')
      .then(r => setShifts((r.data.data || []).filter(s => s.isActive !== false)))
      .catch(() => setShifts([]));
  }, []);

  return { locations, shifts };
}

/** The names behind a set of ids, for a table cell. */
export function scopeLabel(ids, options, everyoneLabel = 'Everyone') {
  if (!ids || !ids.length) return everyoneLabel;
  const names = ids
    .map(id => options.find(o => String(o.id ?? o._id) === String(id))?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : everyoneLabel;
}

export default function ScopePicker({ locationIds, shiftIds, onChange, locations, shifts }) {
  // A criterion row exists once the kind is chosen, so an empty picker shows
  // nothing at all — matching Zoho, where you press Add Criteria to narrow.
  const rows = [];
  if (locationIds?.length) rows.push('location');
  if (shiftIds?.length) rows.push('shift');
  const [extra, setExtra] = useState([]);
  const shown = [...new Set([...rows, ...extra])];

  const toggle = (kind, id) => {
    const current = kind === 'location' ? (locationIds || []) : (shiftIds || []);
    const next = current.map(String).includes(String(id))
      ? current.filter(x => String(x) !== String(id))
      : [...current, id];
    onChange(kind === 'location' ? { locationIds: next, shiftIds } : { locationIds, shiftIds: next });
  };

  const removeRow = (kind) => {
    setExtra(e => e.filter(k => k !== kind));
    onChange(kind === 'location' ? { locationIds: [], shiftIds } : { locationIds, shiftIds: [] });
  };

  const options = (kind) => (kind === 'location' ? locations : shifts);
  const selected = (kind) => (kind === 'location' ? locationIds : shiftIds) || [];
  const available = ['location', 'shift'].filter(k => !shown.includes(k));

  return (
    <div>
      <label className="block text-sm font-medium text-slate-600 mb-1.5">Applicable for</label>
      <div className="border border-slate-200 rounded-xl p-3 space-y-3">
        {shown.length === 0 ? (
          <p className="text-sm text-slate-400">Everyone. Add a criterion to narrow it.</p>
        ) : shown.map(kind => (
          <div key={kind}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-medium text-slate-600">
                {kind === 'location' ? 'Locations' : 'Shifts'}
              </span>
              <span className="text-sm text-slate-400">is</span>
              <button type="button" onClick={() => removeRow(kind)} title="Remove this criterion"
                className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {options(kind).length === 0 ? (
                <span className="text-sm text-slate-400">None configured.</span>
              ) : options(kind).map(o => {
                const id = o.id ?? o._id;
                const on = selected(kind).map(String).includes(String(id));
                return (
                  <button key={id} type="button" onClick={() => toggle(kind, id)}
                    className={`px-2.5 py-1 rounded-lg text-sm border transition-colors ${
                      on ? 'bg-brand-50 border-brand-300 text-brand-700'
                         : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
                    {o.name}
                  </button>
                );
              })}
            </div>
            {selected(kind).length === 0 && (
              <p className="text-[13px] text-amber-600 mt-1">
                Nothing selected, so this criterion narrows nothing.
              </p>
            )}
          </div>
        ))}

        {available.length > 0 && (
          <div className="flex gap-2 pt-1">
            {available.map(k => (
              <button key={k} type="button" onClick={() => setExtra(e => [...e, k])}
                className="flex items-center gap-1.5 text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg text-sm font-medium">
                <Plus size={13} /> Add {k === 'location' ? 'Locations' : 'Shifts'}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[13px] text-slate-400 mt-1">
        Selecting nothing means everyone &mdash; which is what every holiday in the calendar is today.
      </p>
    </div>
  );
}
