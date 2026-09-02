import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Copy, X, Star, ArrowUpDown } from 'lucide-react';
import api from '../utils/api';

// Manage Shifts. One editor for one table — this screen is what both
// /shifts and Settings → Shifts → Manage Shifts open, because two editors for
// one table is how the two drift apart.
//
// A shift is more than a start and an end. The reference's Add Shift form adds
// the shift margin (the boundary payable hours are counted within), core
// working hours, where weekends come from, and who the shift may be given to.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The reference's palette: two rows of eight.
const COLORS = [
  '#E2E8F0', '#FCA5A5', '#FDBA74', '#FDE047', '#86EFAC', '#7DD3FC', '#C4B5FD', '#F9A8D4',
  '#94A3B8', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899',
];

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
const select = `${input} bg-white`;

const blank = () => ({
  name: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15,
  workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], color: '#7DD3FC',
  marginEnabled: false, marginBefore: '00:30', marginAfter: '00:30',
  coreEnabled: false, coreStart: '10:00', coreEnd: '16:00',
  weekendSource: 'location', allowanceEnabled: false, eligibility: [],
});

const to12 = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${String(hr).padStart(2, '0')} : ${String(m).padStart(2, '0')} ${period}`;
};

function Editor({ value, meta, onChange, onClose, onSave, busy }) {
  const set = patch => onChange({ ...value, ...patch });
  const field = meta.eligibilityFields || [];

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">{value.id ? 'Edit Shift' : 'Add Shift'}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="flex items-start gap-6 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                Shift name<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input value={value.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Color</label>
              <div className="grid grid-cols-8 gap-1.5 max-w-[260px]">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => set({ color: c })}
                    aria-label={`Colour ${c}`}
                    className={`w-6 h-6 rounded ${value.color === c ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                From<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input type="time" value={value.startTime} onChange={e => set({ startTime: e.target.value })} className={input} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                To<span className="text-red-500 ml-0.5">*</span>
              </label>
              <input type="time" value={value.endTime} onChange={e => set({ endTime: e.target.value })} className={input} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Grace period</label>
              <input type="number" min={0} max={120} value={value.graceMinutes}
                onChange={e => set({ graceMinutes: Number(e.target.value) })} className={input} />
              <p className="text-[12px] text-slate-500 mt-1">Minutes before someone counts as late.</p>
            </div>
          </div>
          {value.endTime <= value.startTime && (
            <p className="text-[12.5px] text-amber-700">
              This shift ends on the following day.
            </p>
          )}

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={value.marginEnabled}
              onChange={e => set({ marginEnabled: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-blue-600" />
            <span>
              <span className="block text-[14px] text-slate-800">Shift Margin</span>
              <span className="block text-[13px] text-slate-500">Define boundaries within which payable hours will be calculated</span>
            </span>
          </label>
          {value.marginEnabled && (
            <div className="ml-7 flex items-center gap-3 flex-wrap bg-slate-50 rounded-lg px-4 py-3">
              <span className="text-[13.5px] text-slate-700">From</span>
              <input type="time" value={value.marginBefore} onChange={e => set({ marginBefore: e.target.value })}
                className={`${input} w-32`} />
              <span className="text-[13.5px] text-slate-700">before, to</span>
              <input type="time" value={value.marginAfter} onChange={e => set({ marginAfter: e.target.value })}
                className={`${input} w-32`} />
              <span className="text-[13.5px] text-slate-700">after the shift.</span>
              <span className="text-[12px] text-amber-700 w-full">Saved, but not applied to payable hours yet.</span>
            </div>
          )}

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={value.coreEnabled}
              onChange={e => set({ coreEnabled: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-blue-600" />
            <span>
              <span className="block text-[14px] text-slate-800">Core Working Hours</span>
              <span className="block text-[13px] text-slate-500">Define the time frames during which employees in this shift are required to be present for work</span>
            </span>
          </label>
          {value.coreEnabled && (
            <div className="ml-7 flex items-center gap-3 flex-wrap bg-slate-50 rounded-lg px-4 py-3">
              <input type="time" value={value.coreStart} onChange={e => set({ coreStart: e.target.value })} className={`${input} w-32`} />
              <span className="text-[13.5px] text-slate-700">to</span>
              <input type="time" value={value.coreEnd} onChange={e => set({ coreEnd: e.target.value })} className={`${input} w-32`} />
              <span className="text-[12px] text-amber-700 w-full">Saved, but not enforced yet.</span>
            </div>
          )}

          <div>
            <p className="text-[14px] text-slate-800 mb-2">Weekends are based on</p>
            <div className="flex items-center gap-6">
              {[['location', 'Location'], ['shift', 'Shift']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="weekendSource" checked={value.weekendSource === k}
                    onChange={() => set({ weekendSource: k })} className="w-4 h-4 accent-blue-600" />
                  <span className="text-[14px] text-slate-700">{l}</span>
                </label>
              ))}
            </div>
            {/* Until this was a choice, the working-days picker below decided
                nothing: weekends came from the location work calendar either
                way. Saying which is in charge is the point of the radio. */}
            <p className="text-[12.5px] text-slate-500 mt-2">
              {value.weekendSource === 'location'
                ? 'The location work calendar decides — Sunday, plus the 1st and 3rd Saturday. The working days below are ignored.'
                : 'This shift decides. The working days below override the location calendar.'}
            </p>
          </div>

          <div className={value.weekendSource === 'shift' ? '' : 'opacity-50'}>
            <p className="text-[13px] font-medium text-slate-700 mb-2">Working days</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(d => (
                <button key={d} type="button"
                  disabled={value.weekendSource !== 'shift'}
                  onClick={() => set({
                    workingDays: value.workingDays.includes(d)
                      ? value.workingDays.filter(x => x !== d) : [...value.workingDays, d],
                  })}
                  className={`px-3 py-1.5 rounded-lg text-[13.5px] font-medium ${
                    value.workingDays.includes(d) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  } ${value.weekendSource !== 'shift' ? 'cursor-not-allowed' : ''}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={value.allowanceEnabled}
              onChange={e => set({ allowanceEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 accent-blue-600" />
            <span className="text-[14px] text-slate-800">Provide shift allowance</span>
            <span className="text-[12px] text-amber-700">Saved, but not paid out yet</span>
          </label>

          <div>
            <p className="text-[14px] text-slate-800">Eligibility criteria</p>
            <p className="text-[13px] text-slate-500 mt-0.5 mb-2">
              Who this shift may be assigned to. With none, anybody.
            </p>
            <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-2">
              {value.eligibility.map((c, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <select value={c.field}
                    onChange={e => set({ eligibility: value.eligibility.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}
                    className={`${select} max-w-[190px]`}>
                    {field.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <span className="text-[13.5px] text-slate-600">is</span>
                  <input value={c.value}
                    onChange={e => set({ eligibility: value.eligibility.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    placeholder="Select" className={`${input} max-w-[240px]`} />
                  <button onClick={() => set({ eligibility: value.eligibility.filter((_, j) => j !== i) })}
                    aria-label="Remove criterion" className="text-slate-400 hover:text-red-500 p-1.5">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => set({ eligibility: [...value.eligibility, { field: field[0]?.key || 'location', value: '' }] })}
                className="text-[13.5px] text-blue-600 hover:underline">
                Add Criteria
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={onSave} disabled={busy || !value.name.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shifts() {
  const [shifts, setShifts] = useState(null);
  const [meta, setMeta] = useState({ eligibilityFields: [] });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });

  const load = useCallback(() => (
    api.get('/shifts')
      .then(r => setShifts(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load shifts'); setShifts([]); })
  ), []);

  useEffect(() => {
    load();
    api.get('/shifts/meta').then(r => setMeta(r.data.data)).catch(() => {});
  }, [load]);

  if (shifts === null) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const save = () => {
    setBusy(true);
    const call = editing.id ? api.put(`/shifts/${editing.id}`, editing) : api.post('/shifts', editing);
    call
      .then(() => { toast.success(`Shift ${editing.id ? 'saved' : 'added'}`); setEditing(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const remove = s => {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    api.delete(`/shifts/${s.id}`)
      .then(() => { toast.success('Shift deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const duplicate = s => api.post(`/shifts/${s.id}/duplicate`)
    .then(() => { toast.success('Shift copied'); load(); })
    .catch(err => toast.error(err.response?.data?.message || 'Could not duplicate'));

  const makeDefault = s => api.patch(`/shifts/${s.id}/default`, {})
    .then(() => { toast.success(`${s.name} is now the default`); load(); })
    .catch(err => toast.error(err.response?.data?.message || 'Could not change the default'));

  const sorted = [...shifts].sort((a, b) => {
    const va = sort.key === 'name' ? a.name : a.startTime;
    const vb = sort.key === 'name' ? b.name : b.startTime;
    return String(va).localeCompare(String(vb)) * sort.dir;
  });
  const toggleSort = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));

  return (
    <div className="px-5 pt-5 pb-4">
      <div className="flex items-center justify-end mb-4">
        <button onClick={() => setEditing(blank())}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Shift
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">
                <button onClick={() => toggleSort('name')} className="flex items-center gap-1.5 hover:text-slate-800">
                  Shift name <ArrowUpDown size={13} className="text-slate-400" />
                </button>
              </th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">
                <button onClick={() => toggleSort('startTime')} className="flex items-center gap-1.5 hover:text-slate-800">
                  Shift time <ArrowUpDown size={13} className="text-slate-400" />
                </button>
              </th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employees</th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Weekends</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-6 py-3">
                  <button onClick={() => setEditing({ ...s, eligibility: s.eligibility || [], workingDays: s.workingDays || [] })}
                    className="flex items-center gap-2.5 text-left">
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-blue-600 hover:underline font-medium">{s.name}</span>
                    {s.isDefault && (
                      <span className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        Default
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-6 py-3 text-slate-700 whitespace-nowrap">
                  {to12(s.startTime)} - {to12(s.endTime)}
                </td>
                <td className="px-6 py-3 text-slate-700">{s.employeeCount}</td>
                <td className="px-6 py-3 text-slate-600">
                  {s.weekendSource === 'shift' ? 'This shift' : 'Location calendar'}
                </td>
                <td className="px-6 py-3">
                  <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {!s.isDefault && (
                      <button onClick={() => makeDefault(s)} title="Make this the default shift"
                        className="text-slate-400 hover:text-amber-500 p-1.5 rounded"><Star size={15} /></button>
                    )}
                    <button onClick={() => duplicate(s)} title="Duplicate"
                      className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Copy size={15} /></button>
                    {/* No delete on the default: it is what a new employee is
                        put on, which is why the reference does not offer one. */}
                    {!s.isDefault && (
                      <button onClick={() => remove(s)} title={`Delete ${s.name}`}
                        className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={15} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shifts.length === 0 && (
          <div className="px-6 py-14 text-center"><p className="text-[14px] text-slate-600">No shifts yet.</p></div>
        )}
      </div>

      {editing && (
        <Editor value={editing} meta={meta} busy={busy}
          onChange={setEditing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}
