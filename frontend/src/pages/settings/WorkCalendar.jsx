import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../../utils/api';

const DAYS = [
  ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'],
  ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'],
];
const WEEKS = [1, 2, 3, 4, 5];
// The two work locations this organisation actually has. A login recorded
// anywhere else is treated as WFH, so there is no third option to offer.
const LOCATIONS = ['Saibaba Colony, Coimbatore', 'WFH'];

const fmt = d => (d ? d.split('-').reverse().join('/') : '');

const EMPTY = {
  location: LOCATIONS[0],
  weekStartsOn: 0,
  workWeekStart: 1,
  workWeekEnd: 6,
  halfDayWeekend: false,
  yearMode: 'current',
  yearStart: '',
  yearEnd: '',
  statutoryWeekends: false,
  grid: {},
};

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[13px] text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const selectClass = 'w-full text-[14px] rounded-md border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

function WeekendGrid({ grid, onChange }) {
  // A day is a weekend either every week (empty array) or on named weeks.
  // Absent from the object means it is not a weekend at all.
  const isAll = code => Array.isArray(grid[code]) && grid[code].length === 0;
  const hasWeek = (code, w) => isAll(code) || (grid[code] || []).includes(w);

  const toggleAll = code => {
    const next = { ...grid };
    if (isAll(code)) delete next[code];
    else next[code] = [];
    onChange(next);
  };

  const toggleWeek = (code, w) => {
    const next = { ...grid };
    if (isAll(code)) {
      // Unticking one week off an every-week day leaves the other four.
      next[code] = WEEKS.filter(x => x !== w);
    } else {
      const weeks = new Set(next[code] || []);
      weeks.has(w) ? weeks.delete(w) : weeks.add(w);
      if (!weeks.size) delete next[code];
      else if (weeks.size === WEEKS.length) next[code] = [];
      else next[code] = [...weeks].sort((a, b) => a - b);
    }
    onChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate border-spacing-y-1">
        <thead>
          <tr className="text-[13px] text-slate-600">
            <th />
            {['All', ...WEEKS.map(w => `${w}${w === 1 ? 'st' : w === 2 ? 'nd' : w === 3 ? 'rd' : 'th'}`)].map(h => (
              <th key={h} className="font-normal px-2 pb-1 text-center">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map(([code, name]) => (
            <tr key={code}>
              <td className="bg-white border border-slate-200 rounded-md px-3 py-2.5 text-[14px] text-slate-700 w-[160px]">{name}</td>
              <td className="bg-white border border-slate-200 text-center px-2 py-2.5">
                <input type="checkbox" checked={isAll(code)} onChange={() => toggleAll(code)}
                  aria-label={`${name} every week`} className="w-4 h-4 accent-blue-600 cursor-pointer" />
              </td>
              {WEEKS.map(w => (
                <td key={w} className="bg-white border border-slate-200 text-center px-2 py-2.5">
                  <input type="checkbox" checked={hasWeek(code, w)} onChange={() => toggleWeek(code, w)}
                    aria-label={`${name} week ${w}`} className="w-4 h-4 accent-blue-600 cursor-pointer" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarDialog({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...initial, grid: { ...(initial?.grid || {}) } }));
  const [saving, setSaving] = useState(false);
  const set = changes => setForm(f => ({ ...f, ...changes }));
  const editing = !!initial?._id;

  const save = () => {
    if (form.yearMode === 'custom' && (!form.yearStart || !form.yearEnd)) {
      return toast.error('A custom year needs both a start and an end date');
    }
    setSaving(true);
    const body = { ...form };
    // The Default calendar has no location and cannot be given one — it is the
    // fallback for every location that has no calendar of its own.
    if (editing && !initial.location) body.location = null;
    const req = editing
      ? api.patch(`/work-calendars/${initial._id}`, body)
      : api.post('/work-calendars', body);
    req
      .then(() => { toast.success(editing ? 'Work calendar updated' : 'Work calendar added'); onSaved(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save the work calendar'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-[#f1f3f7] rounded-lg w-full max-w-[900px] my-6 shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4">
          <h3 className="text-[16px] font-semibold text-slate-800">{editing ? 'Edit' : 'Add'} Work Calendar</h3>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center">✕</button>
        </div>

        <div className="px-6 pb-4 space-y-4 overflow-y-auto flex-1">
          <div className="bg-white rounded-lg p-5">
            <Field label="Applicable location">
              <select
                value={form.location || ''}
                disabled={editing && !initial.location}
                onChange={e => set({ location: e.target.value })}
                className={`${selectClass} max-w-[360px] disabled:bg-slate-100 disabled:text-slate-500`}
              >
                {editing && !initial.location && <option value="">Default (all locations)</option>}
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div>

          <div className="bg-white rounded-lg p-5 space-y-4">
            <p className="text-[14.5px] font-semibold text-slate-800">Week definition</p>
            <Field label="Week starts on">
              <select value={form.weekStartsOn} onChange={e => set({ weekStartsOn: Number(e.target.value) })} className={`${selectClass} max-w-[360px]`}>
                {DAYS.map(([, name], i) => <option key={name} value={i}>{name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[520px]">
              <Field label="Work week starts on">
                <select value={form.workWeekStart} onChange={e => set({ workWeekStart: Number(e.target.value) })} className={selectClass}>
                  {DAYS.map(([, name], i) => <option key={name} value={i}>{name}</option>)}
                </select>
              </Field>
              <Field label="Work week ends on">
                <select value={form.workWeekEnd} onChange={e => set({ workWeekEnd: Number(e.target.value) })} className={selectClass}>
                  {DAYS.map(([, name], i) => <option key={name} value={i}>{name}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="bg-white rounded-lg p-5 space-y-4">
            <p className="text-[14.5px] font-semibold text-slate-800">Define weekend</p>
            <label className="flex items-center gap-2.5 text-[14px] text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.halfDayWeekend} onChange={e => set({ halfDayWeekend: e.target.checked })}
                className="w-4 h-4 accent-blue-600" />
              Half working day &amp; half weekend
            </label>
            <div className="bg-slate-50 rounded-lg p-3">
              <WeekendGrid grid={form.grid} onChange={grid => set({ grid })} />
            </div>
          </div>

          <div className="bg-white rounded-lg p-5 space-y-3">
            <p className="text-[14.5px] font-semibold text-slate-800">Calendar year definition</p>
            <label className="flex items-center gap-2.5 text-[14px] text-slate-700 cursor-pointer">
              <input type="radio" name="yearMode" checked={form.yearMode === 'current'} onChange={() => set({ yearMode: 'current' })}
                className="w-4 h-4 accent-blue-600" />
              Current year (January to December)
            </label>
            <label className="flex items-center gap-2.5 text-[14px] text-slate-700 cursor-pointer">
              <input type="radio" name="yearMode" checked={form.yearMode === 'custom'} onChange={() => set({ yearMode: 'custom' })}
                className="w-4 h-4 accent-blue-600" />
              Custom year
            </label>
            {form.yearMode === 'custom' && (
              <div className="bg-slate-50 rounded-lg p-4 space-y-3 max-w-[420px]">
                <div className="flex items-center gap-3">
                  <label className="text-[13px] text-slate-600 w-[100px]">Year starts on</label>
                  <input type="date" value={form.yearStart} onChange={e => set({ yearStart: e.target.value })} className={selectClass} />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[13px] text-slate-600 w-[100px]">Year ends on</label>
                  <input type="date" value={form.yearEnd} onChange={e => set({ yearEnd: e.target.value })} className={selectClass} />
                </div>
              </div>
            )}
            <label className="flex items-start gap-2.5 text-[14px] text-slate-700 cursor-pointer pt-1">
              <input type="checkbox" checked={form.statutoryWeekends} onChange={e => set({ statutoryWeekends: e.target.checked })}
                className="w-4 h-4 accent-blue-600 mt-0.5" />
              Define statutory weekends and track hours separately for payroll
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 bg-[#f1f3f7] border-t border-slate-200">
          <button onClick={save} disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="text-[14px] text-slate-600 px-4 py-2 rounded hover:bg-slate-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function WorkCalendar() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/work-calendars')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load work calendars'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = row => {
    if (!window.confirm(`Delete the work calendar for ${row.location}?`)) return;
    api.delete(`/work-calendars/${row._id}`)
      .then(() => { toast.success('Work calendar deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete that calendar'));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <h1 className="text-[16px] font-semibold text-slate-800">Work Calendar</h1>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Define the work days, weekends, year, and statutory weekends for your organization.
          Set up multiple calendar settings for each geographical location within your organization.
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setDialog({})}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[14px] font-medium">
          Add Work Calendar
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-slate-50 text-[13px] font-semibold text-slate-600">
                <tr>
                  <th className="text-left px-5 py-3">Location</th>
                  <th className="text-left px-5 py-3">Calendar year</th>
                  <th className="text-left px-5 py-3">Work week</th>
                  <th className="w-[90px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row._id} className="border-t border-slate-100 hover:bg-slate-50 group">
                    <td className="px-5 py-3.5 text-[14px] text-slate-800">{row.location || 'Default'}</td>
                    <td className="px-5 py-3.5 text-[14px] text-slate-700">{fmt(row.year?.start)} - {fmt(row.year?.end)}</td>
                    <td className="px-5 py-3.5 text-[14px] text-slate-700">{row.workWeekLabel}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button onClick={() => setDialog(row)} title="Edit" className="text-slate-400 hover:text-slate-700"><Pencil size={15} /></button>
                        {row.location && (
                          <button onClick={() => remove(row)} title="Delete" className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={4} className="text-center py-14 text-[14px] text-slate-400">No work calendars yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <CalendarDialog
          initial={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}
