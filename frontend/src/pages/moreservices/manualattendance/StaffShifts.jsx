import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, X, Clock, Users } from 'lucide-react';
import api from '../../../utils/api';
import toast from 'react-hot-toast';

/* ── Staff and their shifts ─────────────────────────────────────────────────
 *  Shifts are defined here rather than on the main Shifts screens, because
 *  these belong to this page. They are flagged is_manual in the database,
 *  which keeps three cleaners' shifts out of rotation, patterns, auto-assign
 *  and every shift dropdown the other 155 people see.
 *
 *  A manual shift carries its own working days. That is what lets housekeeping
 *  work Saturday while everybody else is off: the company weekend rules are
 *  global and have no scoping at all, so rather than teach them to exclude
 *  people, the shift simply says which days it runs and the company weekend
 *  never applies.
 * ────────────────────────────────────────────────────────────────────────── */

const DAYS = [
  { k: 'mon', l: 'Mon' }, { k: 'tue', l: 'Tue' }, { k: 'wed', l: 'Wed' },
  { k: 'thu', l: 'Thu' }, { k: 'fri', l: 'Fri' }, { k: 'sat', l: 'Sat' }, { k: 'sun', l: 'Sun' },
];

const BLANK = {
  name: '', startTime: '06:00', endTime: '10:00', payMode: 'fixed',
  daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], observesHolidays: false,
};

const hhmm = (t) => String(t || '').slice(0, 5);

export default function StaffShifts() {
  const [shifts, setShifts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);          // null = closed, else the shift being edited
  const [saving, setSaving] = useState(false);
  const [assign, setAssign] = useState({ employeeId: '', shiftId: '' });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/manual-attendance/shifts'),
      api.get('/manual-attendance/staff'),
      api.get('/employees?limit=500&status=active'),
    ])
      .then(([s, st, e]) => {
        setShifts(s.data.data || []);
        setStaff(st.data.data || []);
        setEmployees(e.data.data || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveShift = async () => {
    setSaving(true);
    try {
      if (form.id) await api.put(`/manual-attendance/shifts/${form.id}`, form);
      else await api.post('/manual-attendance/shifts', form);
      toast.success(form.id ? 'Shift updated' : 'Shift added');
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save the shift');
    } finally { setSaving(false); }
  };

  const removeShift = async (s) => {
    try {
      await api.delete(`/manual-attendance/shifts/${s.id}`);
      toast.success('Shift removed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove the shift');
    }
  };

  const addAssignment = async () => {
    try {
      await api.post('/manual-attendance/staff', assign);
      toast.success('Added');
      setAssign({ employeeId: '', shiftId: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add');
    }
  };

  const removeAssignment = async (employeeId, shiftId) => {
    try {
      await api.delete(`/manual-attendance/staff/${employeeId}/${shiftId}`);
      toast.success('Removed from this shift');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove');
    }
  };

  /* The API stores these as working_days does — "Mon", "Tue" — and accepts any
   * case. Comparisons here are case-insensitive so a shift loaded for editing
   * shows the right days ticked. */
  const has = (list, k) => (list || []).some(d => String(d).slice(0, 3).toLowerCase() === k);
  const toggleDay = (k) => setForm(f => ({
    ...f,
    daysOfWeek: has(f.daysOfWeek, k) ? f.daysOfWeek.filter(d => String(d).slice(0, 3).toLowerCase() !== k) : [...f.daysOfWeek, k],
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* ── Shifts ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            <h3 className="text-[15px] font-semibold text-slate-800">Shifts</h3>
          </div>
          <button
            onClick={() => setForm({ ...BLANK })}
            className="flex items-center gap-1.5 text-[13.5px] font-medium text-brand-600 hover:text-brand-500"
          ><Plus size={15} /> Add shift</button>
        </div>

        {form && (
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-slate-700">
                {form.id ? 'Edit shift' : 'New shift'}
              </span>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>

            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Shift name, e.g. Housekeeping Morning"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"
            />

            <div className="flex items-center gap-2">
              <input type="time" value={form.startTime}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400" />
              <span className="text-slate-400 text-[13px]">to</span>
              <input type="time" value={form.endTime}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400" />
            </div>

            <div>
              <div className="text-[12px] font-medium text-slate-500 mb-1.5">Runs on</div>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(({ k, l }) => (
                  <button key={k} onClick={() => toggleDay(k)}
                    className={`px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors ${
                      has(form.daysOfWeek, k)
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>{l}</button>
                ))}
              </div>
              <p className="text-[11.5px] text-slate-400 mt-1.5">
                These days replace the company weekend for this shift.
              </p>
            </div>

            <div>
              <div className="text-[12px] font-medium text-slate-500 mb-1.5">Pay</div>
              <div className="flex gap-1.5">
                {[['fixed', 'Fixed shift'], ['actual', 'Actual hours']].map(([v, l]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, payMode: v }))}
                    className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors ${
                      form.payMode === v
                        ? 'bg-slate-800 border-slate-800 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>{l}</button>
                ))}
              </div>
              <p className="text-[11.5px] text-slate-400 mt-1.5">
                {form.payMode === 'fixed'
                  ? 'Marking present credits the whole shift. No hours are asked for.'
                  : 'Marking present asks for the hours actually worked.'}
              </p>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={form.observesHolidays}
                onChange={e => setForm(f => ({ ...f, observesHolidays: e.target.checked }))} />
              Off on company holidays
            </label>

            <button
              onClick={saveShift} disabled={saving}
              className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-slate-300 text-white rounded-lg py-2 text-[14px] font-medium transition-colors"
            >{saving ? 'Saving…' : form.id ? 'Save changes' : 'Add shift'}</button>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {loading && <div className="px-5 py-8 text-center text-slate-400 text-[14px]">Loading…</div>}
          {!loading && !shifts.length && !form && (
            <div className="px-5 py-8 text-center text-slate-400 text-[14px]">No shifts yet.</div>
          )}
          {shifts.map(s => (
            <div key={s.id} className="px-5 py-3.5 flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-800 text-[14px]">{s.name}</div>
                <div className="text-[12px] text-slate-400 mt-0.5">
                  {hhmm(s.startTime)}–{hhmm(s.endTime)} · {s.spanHours}h ·{' '}
                  {(s.daysOfWeek || []).map(d => d[0].toUpperCase() + d.slice(1, 3)).join(' ')}
                </div>
                <div className="text-[12px] text-slate-400">
                  {s.payMode === 'fixed' ? 'Fixed shift' : 'Actual hours'}
                  {s.observesHolidays ? ' · off on holidays' : ' · works holidays'}
                  {` · ${s.assignedCount} assigned`}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setForm({
                  id: s.id, name: s.name, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime),
                  payMode: s.payMode, daysOfWeek: s.daysOfWeek || [], observesHolidays: s.observesHolidays,
                })} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
                <button onClick={() => removeShift(s)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Staff ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <Users size={16} className="text-slate-400" />
          <h3 className="text-[15px] font-semibold text-slate-800">Staff on this page</h3>
        </div>

        <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <select
            value={assign.employeeId}
            onChange={e => setAssign(a => ({ ...a, employeeId: e.target.value }))}
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-blue-400"
          >
            <option value="">Select employee…</option>
            {employees.map(e => (
              <option key={e._id || e.id} value={e._id || e.id}>
                {e.firstName} {e.lastName} — {e.employeeId}
              </option>
            ))}
          </select>
          <select
            value={assign.shiftId}
            onChange={e => setAssign(a => ({ ...a, shiftId: e.target.value }))}
            className="flex-1 min-w-[140px] border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-blue-400"
          >
            <option value="">Select shift…</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={addAssignment}
            disabled={!assign.employeeId || !assign.shiftId}
            className="bg-brand-600 hover:bg-brand-500 disabled:bg-slate-200 disabled:text-slate-400 text-white px-3.5 py-2 rounded-lg text-[14px] font-medium transition-colors"
          >Add</button>
        </div>

        <p className="px-5 pt-3 text-[12px] text-slate-400">
          Add the same person to two shifts to give them a split day.
        </p>

        <div className="divide-y divide-slate-100">
          {!loading && !staff.length && (
            <div className="px-5 py-8 text-center text-slate-400 text-[14px]">Nobody added yet.</div>
          )}
          {staff.map(p => (
            <div key={p.employeeId} className="px-5 py-3.5">
              <div className="font-medium text-slate-800 text-[14px]">{p.name}</div>
              <div className="text-[12px] text-slate-400 mb-2">
                {p.code}{p.designation ? ` · ${p.designation}` : ''}{p.department ? ` · ${p.department}` : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(p.shifts || []).map(s => (
                  <span key={s.id}
                    className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg pl-2.5 pr-1.5 py-1 text-[12.5px] text-slate-700">
                    {s.name} <span className="text-slate-400">{hhmm(s.startTime)}–{hhmm(s.endTime)}</span>
                    <button
                      onClick={() => removeAssignment(p.employeeId, s.id)}
                      title="Remove from this shift"
                      className="text-slate-400 hover:text-red-600"
                    ><X size={13} /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
