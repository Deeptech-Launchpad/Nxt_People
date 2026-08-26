import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../../utils/api';
import ScopePicker, { useScopeOptions, scopeLabel } from './ScopePicker';

/* ── Holidays and Exceptional Working days ──────────────────────────────────
 *  Two tabs, one table. They are the same record — a row in `holidays` — and
 *  the only difference is which way it points:
 *
 *    a closing type  the office shuts. Nobody is judged, and working it can
 *                    earn a comp-off.
 *    working_day     the opposite. A weekend the company worked, so everyone
 *                    IS judged on it and working it earns nothing.
 *
 *  Zoho separates them into two tabs and so do we, but writing the table twice
 *  would leave two places to fix the day a column changes.
 *
 *  Location and Shifts are real now: a holiday can belong to the office and not
 *  to WFH. Empty means everyone, which is what every existing row is.
 * ────────────────────────────────────────────────────────────────────────── */
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
};
const isWeekend = (ymd) => {
  if (!ymd) return false;
  const day = new Date(String(ymd).slice(0, 10) + 'T00:00:00').getDay();
  return day === 0 || day === 6;
};

// Zoho shows one word in its Classification column. Ours carries more types
// than that, and they behave differently, so each says what it does.
const CLASSIFICATIONS = [
  ['company',    'Holiday',            'The office is shut. Nobody is judged on this day.'],
  ['national',   'National Holiday',   'The office is shut. Nobody is judged on this day.'],
  ['restricted', 'Restricted Holiday', 'Optional — offered, not imposed. The day stays a working day for anyone who does not take it.'],
];
const CLASS_LABEL = Object.fromEntries(CLASSIFICATIONS.map(([v, l]) => [v, l]));

export default function HolidayTable({ mode }) {
  const workingDays = mode === 'working_day';
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // the row, or {} for a new one
  const [saving, setSaving] = useState(false);
  const { locations, shifts } = useScopeOptions();

  const load = () => {
    setLoading(true);
    api.get(`/holidays?year=${year}`)
      .then(r => setRows((r.data.data || []).filter(h =>
        workingDays ? h.type === 'working_day' : h.type !== 'working_day')))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the calendar'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year, mode]);

  const blank = {
    name: '', date: '', description: '',
    type: workingDays ? 'working_day' : 'company',
    locationIds: [], shiftIds: [],
  };

  const weekendOk = !workingDays || isWeekend(editing?.date);

  const save = async (e) => {
    e.preventDefault();
    if (workingDays && !weekendOk) {
      toast.error('That is already a working day. Pick a Saturday or Sunday.');
      return;
    }
    setSaving(true);
    const body = {
      name: editing.name, date: editing.date, description: editing.description,
      type: editing.type, year: parseInt(String(editing.date).slice(0, 4), 10) || year,
      locationIds: editing.locationIds || [], shiftIds: editing.shiftIds || [],
    };
    try {
      if (editing._id) await api.put(`/holidays/${editing._id}`, body);
      else await api.post('/holidays', body);
      toast.success(editing._id ? 'Saved' : (workingDays ? 'Working day added' : 'Holiday added'));
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that');
    } finally { setSaving(false); }
  };

  const remove = async (h) => {
    const consequence = workingDays
      ? 'That date goes back to being a weekend — nobody will be judged on it, and working it can earn a comp-off again.'
      : 'Attendance on that day will be judged as a normal working day.';
    if (!window.confirm(`Remove "${h.name}" on ${fmt(h.date)}?\n\n${consequence}`)) return;
    try {
      await api.delete(`/holidays/${h._id}`);
      toast.success('Removed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that');
    }
  };

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];
  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => setEditing(blank)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-[15px] font-medium">
          <Plus size={16} /> {workingDays ? 'Add Working Day' : 'Add Holiday'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">
          {workingDays ? `No exceptional working days for ${year}.` : `No holidays for ${year}.`}
        </p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Shifts</th>
                {!workingDays && <th className="px-4 py-3 font-medium">Classification</th>}
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(h => (
                <tr key={h._id} className="border-t border-slate-50 hover:bg-slate-50/60 group">
                  <td className="px-4 py-3 text-slate-700">{h.name}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(h.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] px-2 py-0.5 rounded-md ${
                      h.locationIds?.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}>{scopeLabel(h.locationIds, locations)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] px-2 py-0.5 rounded-md ${
                      h.shiftIds?.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}>{scopeLabel(h.shiftIds, shifts)}</span>
                  </td>
                  {!workingDays && (
                    <td className="px-4 py-3">
                      <span className={`text-[13px] px-2 py-0.5 rounded-md ${
                        h.type === 'restricted' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                      }`}>{CLASS_LABEL[h.type] || h.type}</span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-slate-400 max-w-[320px] truncate" title={h.description || ''}>
                    {h.description || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditing({ ...h, locationIds: h.locationIds || [], shiftIds: h.shiftIds || [], date: String(h.date).slice(0, 10) })}
                        title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(h)} title="Remove"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={save} className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="font-display font-semibold text-slate-800 text-xl">
              {editing._id ? 'Edit' : 'Add'} {workingDays ? 'Working Day' : 'Holiday'}
            </h3>

            <div>
              <label className={label}>Name *</label>
              <input value={editing.name} required className={field}
                placeholder={workingDays ? 'e.g. March Month Project Delivery' : 'e.g. Pongal Thirunal'}
                onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </div>

            <div>
              <label className={label}>Date *</label>
              <input type="date" value={editing.date || ''} required className={field}
                onChange={e => setEditing({ ...editing, date: e.target.value })} />
              {workingDays && editing.date && !weekendOk && (
                <p className="text-[13px] text-rose-600 mt-1">
                  {fmt(editing.date)} is already a working day. Only a Saturday or Sunday can be declared one.
                </p>
              )}
            </div>

            {!workingDays && (
              <div>
                <label className={label}>Classification *</label>
                <select value={editing.type} className={field}
                  onChange={e => setEditing({ ...editing, type: e.target.value })}>
                  {CLASSIFICATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <p className="text-[13px] text-slate-400 mt-1">
                  {(CLASSIFICATIONS.find(c => c[0] === editing.type) || [])[2]}
                </p>
              </div>
            )}

            <ScopePicker
              locationIds={editing.locationIds}
              shiftIds={editing.shiftIds}
              locations={locations}
              shifts={shifts}
              onChange={(next) => setEditing({ ...editing, ...next })}
            />

            <div>
              <label className={label}>Description</label>
              <input value={editing.description || ''} className={field}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </div>

            <p className="text-[13px] text-amber-600">
              {workingDays
                ? 'Everyone in scope is judged on this day as a normal working day, and working it will no longer earn a comp-off.'
                : 'Nobody in scope is marked absent on this day, and working it can earn a comp-off.'}
            </p>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setEditing(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving || (workingDays && !weekendOk)}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
