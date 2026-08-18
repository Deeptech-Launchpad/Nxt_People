import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X, Play, History } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';

// Shift Rotation — "to automatically change the assigned shift for employees
// based on the specified frequency", in the reference's words.
//
// Distinct from a shift pattern. A pattern rosters specific days; a rotation
// changes the STANDING shift, so on its scheduled day everybody on shift A
// moves to shift B.
//
// It reassigns real people, so it previews before it runs and refuses to save
// with no scope at all — an empty scope treated as "everybody" would move the
// whole organization onto a different shift.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
const select = `${input} bg-white`;

const blank = () => ({
  name: '', isActive: true, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1,
  runAt: '00:00', periodFrom: 0, criteria: [], employeeIds: [], steps: [],
});

function Editor({ value, shifts, meta, employees, onChange, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const set = patch => onChange({ ...value, ...patch });
  const fields = meta.criteriaFields || [];

  const save = () => {
    setBusy(true);
    const call = value.id
      ? api.put(`/shift-rotation/${value.id}`, value)
      : api.post('/shift-rotation', value);
    call
      .then(() => { toast.success(`Rotation ${value.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const runPreview = () => {
    if (!value.id) return toast.error('Save the rotation first, then preview who would move.');
    api.get(`/shift-rotation/${value.id}/preview`)
      .then(r => setPreview(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not preview'));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            {value.id ? 'Edit Shift Rotation' : 'Add Shift Rotation'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          <div>
            <p className="text-[15px] font-semibold text-slate-800 mb-3">Scheduler details</p>
            <div className="space-y-4">
              <div className="max-w-md">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Scheduler name<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input value={value.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Schedule frequency<span className="text-red-500 ml-0.5">*</span>
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={value.frequency} onChange={e => set({ frequency: e.target.value })}
                    className={`${select} max-w-[150px]`}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  {value.frequency === 'weekly' ? (
                    <>
                      <select value={value.dayOfWeek} onChange={e => set({ dayOfWeek: Number(e.target.value) })}
                        className={`${select} max-w-[170px]`}>
                        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                      <span className="text-[14px] text-slate-600">of every week</span>
                    </>
                  ) : (
                    <>
                      <select value={value.dayOfMonth} onChange={e => set({ dayOfMonth: Number(e.target.value) })}
                        className={`${select} max-w-[120px]`}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {/* Capped at 28 so a rotation cannot silently skip
                          February. */}
                      <span className="text-[14px] text-slate-600">of every month</span>
                    </>
                  )}
                </div>
              </div>

              <div className="max-w-[200px]">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Time of schedule<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input type="time" value={value.runAt} onChange={e => set({ runAt: e.target.value })} className={input} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-[15px] font-semibold text-slate-800 mb-3">Rotation of shifts</p>
            {shifts.length < 2 ? (
              <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                A rotation needs at least two shifts to move people between. Add another under Manage Shifts.
              </p>
            ) : (
              <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-2">
                {value.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select value={s.fromShiftId || ''}
                      onChange={e => set({ steps: value.steps.map((x, j) => (j === i ? { ...x, fromShiftId: e.target.value } : x)) })}
                      className={`${select} max-w-[220px]`}>
                      <option value="">Select</option>
                      {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                    </select>
                    <span className="text-[14px] text-slate-600">to</span>
                    <select value={s.toShiftId || ''}
                      onChange={e => set({ steps: value.steps.map((x, j) => (j === i ? { ...x, toShiftId: e.target.value } : x)) })}
                      className={`${select} max-w-[220px]`}>
                      <option value="">Select</option>
                      {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                    </select>
                    <button onClick={() => set({ steps: value.steps.filter((_, j) => j !== i) })}
                      aria-label="Remove rotation" className="text-slate-400 hover:text-red-500 p-1.5">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button onClick={() => set({ steps: [...value.steps, { fromShiftId: '', toShiftId: '' }] })}
                  className="text-[13.5px] text-blue-600 hover:underline">Add Rotation</button>
                {/* Every step is read before any is written, so A to B and B to
                    A swap a pair rather than landing everybody on one shift. */}
                <p className="text-[12.5px] text-slate-500 pt-1">
                  All the moves are worked out before any is applied, so two rotations can swap a pair of shifts.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-[15px] font-semibold text-slate-800">
              Applicable for<span className="text-red-500 ml-0.5">*</span>
            </p>
            <p className="text-[13px] text-slate-500 mt-0.5 mb-3">
              Criteria, named employees, or both. With neither, the rotation moves nobody — it will not save.
            </p>
            <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-3">
              <div className="space-y-2">
                {value.criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select value={c.field}
                      onChange={e => set({ criteria: value.criteria.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}
                      className={`${select} max-w-[190px]`}>
                      {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <span className="text-[13.5px] text-slate-600">is</span>
                    <input value={c.value}
                      onChange={e => set({ criteria: value.criteria.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                      placeholder="Select" className={`${input} max-w-[240px]`} />
                    <button onClick={() => set({ criteria: value.criteria.filter((_, j) => j !== i) })}
                      aria-label="Remove criterion" className="text-slate-400 hover:text-red-500 p-1.5">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => set({ criteria: [...value.criteria, { field: fields[0]?.key || 'location', value: '' }] })}
                  className="text-[13.5px] text-blue-600 hover:underline">Add Criteria</button>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <p className="text-[13px] text-slate-600 mb-1.5">
                  Or named employees ({value.employeeIds.length} selected)
                </p>
                <select
                  value=""
                  onChange={e => {
                    if (e.target.value && !value.employeeIds.includes(e.target.value)) {
                      set({ employeeIds: [...value.employeeIds, e.target.value] });
                    }
                  }}
                  className={`${select} max-w-sm`}>
                  <option value="">Add Employee</option>
                  {employees.filter(x => !value.employeeIds.includes(x.id))
                    .map(x => <option key={x.id} value={x.id}>{x.employeeId} - {x.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {value.employeeIds.map(id => {
                    const e = employees.find(x => x.id === id);
                    return (
                      <span key={id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1 text-[13px]">
                        {e ? `${e.employeeId} - ${e.name}` : 'Unknown'}
                        <button onClick={() => set({ employeeIds: value.employeeIds.filter(x => x !== id) })}
                          aria-label="Remove" className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {value.id && (
            <div className="border-t border-slate-100 pt-5">
              <button onClick={runPreview}
                className="flex items-center gap-1.5 border border-blue-500 text-blue-600 hover:bg-blue-50 px-3.5 py-1.5 rounded text-[13.5px]">
                <Play size={14} /> Preview who would move
              </button>
              {preview && (
                <div className="mt-3 bg-slate-50 rounded-lg px-4 py-3">
                  <p className="text-[13.5px] text-slate-700 mb-2">
                    {preview.moved} employee(s) would move, {preview.unchanged} would stay.
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {preview.moves.map(m => (
                      <p key={m.employeeId} className="text-[13px] text-slate-600">
                        {m.name}: {m.fromName} → {m.toName}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
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
    </div>
  );
}

export default function ShiftRotation() {
  const [rotations, setRotations] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [meta, setMeta] = useState({ criteriaFields: [] });
  const [editing, setEditing] = useState(null);
  const [runs, setRuns] = useState(null);

  const load = useCallback(() => (
    api.get('/shift-rotation')
      .then(r => setRotations(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRotations([]); })
  ), []);

  useEffect(() => {
    load();
    api.get('/shifts').then(r => setShifts(r.data.data || [])).catch(() => {});
    api.get('/shift-rotation/meta').then(r => setMeta(r.data.data)).catch(() => {});
    api.get('/access/assignable-users').then(r => setEmployees(r.data.data || [])).catch(() => {});
  }, [load]);

  if (rotations === null) return <Spinner />;

  const remove = r => {
    if (!window.confirm(`Delete ${r.name}?`)) return;
    api.delete(`/shift-rotation/${r.id}`)
      .then(() => { toast.success('Rotation deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const toggle = r => api.patch(`/shift-rotation/${r.id}/status`, { isActive: !r.isActive })
    .then(() => load())
    .catch(err => toast.error(err.response?.data?.message || 'Could not change the status'));

  const runNow = r => {
    if (!window.confirm(`Run ${r.name} now? This reassigns shifts immediately.`)) return;
    api.post(`/shift-rotation/${r.id}/run`, {})
      .then(res => { toast.success(`${res.data.data.moved} employee(s) moved`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not run'));
  };

  const showRuns = () => {
    api.get('/shift-rotation/runs')
      .then(r => setRuns(r.data.data || []))
      .catch(() => setRuns([]));
  };

  return (
    <div className="pb-4">
      <div className="flex items-center justify-end gap-2 mb-4">
        <button onClick={showRuns}
          className="flex items-center gap-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 px-3.5 py-2 rounded text-[13.5px]">
          <History size={14} /> History
        </button>
        <button onClick={() => setEditing(blank())}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Shift Rotation
        </button>
      </div>

      {rotations.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-16 text-center">
          <p className="text-[15px] text-slate-700">No shift rotations are configured currently</p>
          <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-lg mx-auto">
            To automatically change the assigned shift for employees based on the specified frequency,
            use shift rotation.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Scheduler name</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Frequency</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Rotations</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Next change</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Status</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {rotations.map(r => (
                <tr key={r.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-6 py-3">
                    <button onClick={() => setEditing({ ...r, criteria: r.criteria || [], employeeIds: r.employeeIds || [], steps: r.steps || [] })}
                      className="text-blue-600 hover:underline font-medium text-left">{r.name}</button>
                  </td>
                  <td className="px-6 py-3 text-slate-700">
                    {r.frequency === 'weekly'
                      ? `Every ${DAYS[r.dayOfWeek]}`
                      : `Day ${r.dayOfMonth} of each month`}
                    <span className="text-slate-400"> at {r.runAt}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-600">
                    {(r.steps || []).map(s => `${s.fromName} → ${s.toName}`).join(', ') || '—'}
                  </td>
                  <td className="px-6 py-3 text-slate-600">
                    {r.nextRun}
                    <span className="block text-[12px] text-slate-400">holds to {r.periodEnd}</span>
                  </td>
                  <td className="px-6 py-3">
                    <button onClick={() => toggle(r)} aria-label={`${r.name} is ${r.isActive ? 'on' : 'off'}`}
                      className={`w-9 h-5 rounded-full transition-colors relative ${r.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${r.isActive ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => runNow(r)} title="Run now"
                        className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Play size={15} /></button>
                      <button onClick={() => remove(r)} title={`Delete ${r.name}`}
                        className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runs && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[15px] font-semibold text-slate-800">What the rotations have done</p>
              <button onClick={() => setRuns(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto">
              {runs.length === 0 ? (
                <p className="px-6 py-10 text-center text-[14px] text-slate-500">
                  Nothing has rotated yet. A shift that changes under somebody is recorded here.
                </p>
              ) : (
                <table className="w-full text-[14px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">When</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(r => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-6 py-2.5 text-slate-600">{new Date(r.ranAt).toLocaleString('en-GB')}</td>
                        <td className="px-6 py-2.5 text-slate-700">{r.employeeName || '—'}</td>
                        <td className="px-6 py-2.5 text-slate-600">
                          {r.fromShift && r.toShift ? `${r.fromShift} → ${r.toShift}` : (r.message || '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Editor value={editing} shifts={shifts} meta={meta} employees={employees}
          onChange={setEditing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
