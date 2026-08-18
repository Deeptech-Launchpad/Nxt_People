import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X, ArrowLeft, Filter, CalendarRange } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';

// Shift Patterns — a rotation, expressed as a grid of day to shift.
//
// A pattern is a recipe, not a second schedule: it generates rows into
// shift_roster, which attendance resolves against. So a pattern decides what
// somebody is actually expected to work rather than sitting in a table nobody
// reads, which is what the roster was until this went in.
//
// Preview writes nothing. A rota whose effect you cannot see before applying
// it is one nobody will trust.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thr', 'Fri', 'Sat'];

const TYPES = [
  { key: 'weekly', label: 'Weekly', hint: 'Shift schedule changes weekly according to the pattern set for the days of the week' },
  { key: 'monthly', label: 'Monthly', hint: 'Shift schedule follows the calendar weeks of each month' },
  { key: 'custom', label: 'Custom', hint: 'A cycle of your own length, repeating from the day somebody joins the pattern' },
];

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
const select = `${input} bg-white`;

const emptyWeek = n => ({ week: n, days: Object.fromEntries(DAY_KEYS.map(k => [k, null])) });
const blank = () => ({
  name: '', patternType: 'weekly', cycleMode: 'every', cycleWeeks: 1,
  weeks: [emptyWeek(1)], isActive: true,
});

function DayCell({ value, shifts, onPick }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const shift = shifts.find(s => s.id === value);
  const shown = term.trim()
    ? shifts.filter(s => s.name.toLowerCase().includes(term.trim().toLowerCase()))
    : shifts;

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(o => !o); setTerm(''); }}
        className={`w-full min-h-[52px] border rounded-lg px-2 py-2 text-left ${
          shift ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 hover:border-blue-400'
        }`}
      >
        {shift ? (
          <span className="flex items-start gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm mt-1 flex-shrink-0" style={{ backgroundColor: shift.color }} />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-slate-800 truncate">{shift.name}</span>
              <span className="block text-[11.5px] text-slate-500">{shift.startTime}</span>
            </span>
          </span>
        ) : (
          <span className="block text-center text-blue-500 text-[18px] leading-none pt-1.5">+</span>
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="px-2 py-2 border-b border-slate-100">
            <input autoFocus value={term} onChange={e => setTerm(e.target.value)}
              placeholder="Search" className="w-full text-[13px] outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button onClick={() => { onPick(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-[13px] text-slate-500 hover:bg-slate-50">
              Day off
            </button>
            {shown.map(s => (
              <button key={s.id} onClick={() => { onPick(s.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.name}</span>
                <span className="text-slate-400 ml-auto text-[12px]">{s.startTime}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Builder({ value, shifts, onChange, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const set = patch => onChange({ ...value, ...patch });
  const type = TYPES.find(t => t.key === value.patternType) || TYPES[0];

  const setDay = (wi, key, shiftId) => set({
    weeks: value.weeks.map((w, i) => (i === wi ? { ...w, days: { ...w.days, [key]: shiftId } } : w)),
  });

  const save = () => {
    setBusy(true);
    const call = value.id
      ? api.put(`/shift-patterns/${value.id}`, value)
      : api.post('/shift-patterns', value);
    call
      .then(() => { toast.success(`Pattern ${value.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const runPreview = () => {
    api.post('/shift-patterns/preview', { ...value, days: 28 })
      .then(r => setPreview(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not preview'));
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-100 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <button onClick={onClose} aria-label="Back" className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
        <p className="text-[16px] font-semibold text-slate-800">{value.id ? 'Edit Shift Pattern' : 'Add Shift Pattern'}</p>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>

      <div className="px-6 py-6 max-w-6xl mx-auto space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 space-y-4">
          <div className="max-w-sm">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Pattern name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input value={value.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
          </div>

          <div className="max-w-sm">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Pattern type</label>
            <select value={value.patternType}
              onChange={e => set({
                patternType: e.target.value,
                cycleMode: e.target.value === 'monthly' ? 'calendar_weeks' : 'every',
              })}
              className={select}>
              {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <p className="text-[12.5px] text-slate-500 mt-1">{type.hint}</p>
          </div>

          <div>
            <p className="text-[13px] font-medium text-slate-700 mb-2">Shift pattern changes</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name="cycleMode" checked={value.cycleMode === 'every'}
                  onChange={() => set({ cycleMode: 'every' })} className="w-4 h-4 accent-blue-600" />
                <span className="text-[14px] text-slate-700">Every</span>
                <select value={value.cycleWeeks} disabled={value.cycleMode !== 'every'}
                  onChange={e => set({ cycleWeeks: Number(e.target.value) })}
                  className={`${select} w-20`}>
                  {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-[14px] text-slate-700">Week</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="radio" name="cycleMode" checked={value.cycleMode === 'calendar_weeks'}
                  onChange={() => set({ cycleMode: 'calendar_weeks' })} className="w-4 h-4 accent-blue-600" />
                <span className="text-[14px] text-slate-700">Based on 1-6 calendar weeks in a month</span>
              </label>
            </div>
            <p className="text-[12.5px] text-slate-500 mt-2">
              {value.cycleMode === 'every'
                ? 'The cycle is anchored to the date somebody joins the pattern, not to a fixed calendar.'
                : 'The pattern resets with each month rather than running on.'}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <p className="text-[15px] font-semibold text-slate-800">Define Shift Pattern</p>
            <button onClick={runPreview}
              className="flex items-center gap-1.5 border border-blue-500 text-blue-600 hover:bg-blue-50 px-3.5 py-1.5 rounded text-[13.5px]">
              <CalendarRange size={14} /> Preview Pattern
            </button>
          </div>

          {shifts.length === 0 && (
            <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              No shifts exist yet. A pattern needs shifts to put people on — add them under Manage Shifts first.
            </p>
          )}

          <div className="space-y-4">
            {value.weeks.map((w, wi) => (
              <div key={wi} className="border border-slate-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[14px] font-medium text-slate-800">Week {wi + 1}</p>
                  {value.weeks.length > 1 && (
                    <button onClick={() => set({ weeks: value.weeks.filter((_, i) => i !== wi) })}
                      aria-label={`Remove week ${wi + 1}`} className="text-slate-400 hover:text-red-500 p-1">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {DAY_KEYS.map((k, di) => (
                    <div key={k}>
                      <p className="text-[12.5px] text-slate-500 mb-1">{DAY_LABELS[di]}</p>
                      <DayCell value={w.days[k]} shifts={shifts} onPick={id => setDay(wi, k, id)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {value.weeks.length < 6 && (
            <button onClick={() => set({ weeks: [...value.weeks, emptyWeek(value.weeks.length + 1)] })}
              className="mt-3 text-[13.5px] text-blue-600 hover:underline">
              + Add New Pattern
            </button>
          )}
        </div>

        {preview && (
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-[15px] font-semibold text-slate-800 mb-1">The next four weeks</p>
            <p className="text-[13px] text-slate-500 mb-3">Nothing is written until the pattern is saved and someone is assigned to it.</p>
            <div className="grid grid-cols-7 gap-2">
              {preview.map(d => (
                <div key={d.date} className="border border-slate-200 rounded p-2">
                  <p className="text-[11.5px] text-slate-500">{d.date.slice(5)}</p>
                  {d.shiftName ? (
                    <p className="text-[12px] text-slate-800 flex items-center gap-1 mt-1">
                      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="truncate">{d.shiftName}</span>
                    </p>
                  ) : <p className="text-[12px] text-slate-400 mt-1">Off</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-3">
        <button onClick={save} disabled={busy || !value.name.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose}
          className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ShiftPatterns() {
  const [patterns, setPatterns] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showGallery, setShowGallery] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showFilter, setShowFilter] = useState(false);

  const load = useCallback(() => (
    api.get(`/shift-patterns${filter === 'all' ? '' : `?patternType=${filter}`}`)
      .then(r => setPatterns(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setPatterns([]); })
  ), [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/shifts').then(r => setShifts(r.data.data || [])).catch(() => {});
    api.get('/shift-patterns/gallery').then(r => setGallery(r.data.data || [])).catch(() => {});
  }, []);

  if (patterns === null) return <Spinner />;

  const remove = p => {
    if (!window.confirm(`Delete ${p.name}? Future rostered days from it are removed.`)) return;
    api.delete(`/shift-patterns/${p.id}`)
      .then(r => { toast.success(r.data.message || 'Deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  // A gallery template is a starting grid, filled with whichever shifts exist.
  const useTemplate = t => {
    const a = shifts[0]?.id || null;
    const b = shifts[1]?.id || a;
    const week = (shiftId, workDays) => ({
      days: Object.fromEntries(DAY_KEYS.map((k, i) => [k, workDays.includes(i) ? shiftId : null])),
    });
    const weekdays = [1, 2, 3, 4, 5];
    const weeks = t.key === 'four_on_four_off'
      ? [week(a, [0, 1, 2, 3]), week(a, [4, 5, 6])]
      : Array.from({ length: t.weeks }, (_, i) => week(i % 2 === 0 ? a : b, weekdays));

    setEditing({
      ...blank(), name: t.name, patternType: t.patternType,
      cycleMode: t.cycleMode, cycleWeeks: t.cycleWeeks,
      weeks: weeks.map((w, i) => ({ week: i + 1, ...w })),
    });
    setShowGallery(false);
  };

  return (
    <div className="pb-4">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 mb-4">
        <h2 className="text-[15px] font-semibold text-slate-800">Shift Patterns</h2>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Define weekly, monthly or custom shift patterns. A pattern fills the roster, and the roster is
          what decides which shift somebody is on for a given day.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 mb-4">
        <button onClick={() => setEditing(blank())}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Shift Pattern
        </button>
        <button onClick={() => setShowGallery(true)}
          className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-3.5 py-2 rounded text-[13.5px]">
          Gallery
        </button>
        <button onClick={() => setShowFilter(f => !f)} aria-label="Filter"
          className="border border-slate-300 text-slate-500 hover:text-slate-700 rounded p-2"><Filter size={16} /></button>
      </div>

      {showFilter && (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-[13.5px] text-slate-600">Pattern type</span>
          <select value={filter} onChange={e => setFilter(e.target.value)} className={`${select} max-w-[200px]`}>
            <option value="all">All</option>
            {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      )}

      {patterns.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-16 text-center">
          <p className="text-[15px] text-slate-700">No shift patterns have been added yet</p>
          <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-lg mx-auto">
            Define shift patterns based on your organization's operational needs, which can be mapped to
            your employees for automatic shift scheduling.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Pattern name</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Type</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Cycle</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Assigned</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Rostered ahead</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {patterns.map(p => (
                <tr key={p.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-6 py-3">
                    <button
                      onClick={() => api.get(`/shift-patterns/${p.id}`)
                        .then(r => setEditing(r.data.data))
                        .catch(() => toast.error('Could not open'))}
                      className="text-blue-600 hover:underline font-medium text-left">{p.name}</button>
                  </td>
                  <td className="px-6 py-3 text-slate-700 capitalize">{p.patternType}</td>
                  <td className="px-6 py-3 text-slate-600">
                    {p.cycleMode === 'calendar_weeks' ? 'Calendar weeks' : `Every ${p.cycleWeeks} week(s)`}
                    <span className="text-slate-400"> · {p.weeks?.length || 0} week grid</span>
                  </td>
                  <td className="px-6 py-3 text-slate-700">{p.assignedCount}</td>
                  <td className="px-6 py-3 text-slate-700">{p.rosteredAhead}</td>
                  <td className="px-6 py-3">
                    <button onClick={() => remove(p)} aria-label={`Delete ${p.name}`}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showGallery && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30">
          <div className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Shift Pattern Gallery</p>
              <button onClick={() => setShowGallery(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-3 overflow-y-auto">
              {shifts.length === 0 && (
                <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  A template needs shifts to fill in. Add them under Manage Shifts first.
                </p>
              )}
              {gallery.map(t => (
                <button key={t.key} onClick={() => useTemplate(t)} disabled={!shifts.length}
                  className="w-full text-left border border-slate-200 rounded-lg px-4 py-3 hover:border-blue-400 disabled:opacity-50">
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-slate-800">{t.name}</span>
                    <span className="text-[12px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 capitalize">{t.patternType}</span>
                  </span>
                  <span className="block text-[13px] text-slate-500 mt-1">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Builder value={editing} shifts={shifts} onChange={setEditing}
          onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
