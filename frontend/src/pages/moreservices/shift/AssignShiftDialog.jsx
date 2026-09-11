import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Trash2, Plus } from 'lucide-react';
import api from '../../../utils/api';
import EmployeePicker from '../leavetracker/EmployeePicker';
import { to12 } from './shiftGrid';

/* ── Assign shift ─────────────────────────────────────────────────────────
 *  The reference has this form twice, and they are not the same form:
 *
 *  User-specific Operations opens it as a centred dialog for the ONE person
 *  already on screen — shift, dates, reason, and no "who".
 *
 *  Employee Shift Mapping opens it as a right-hand panel with an "Applicable
 *  to" criteria builder on top, rows OR-ed together, because the point there
 *  is assigning to many people at once.
 *
 *  One component, `mode` picks which. The alternative was two forms that agree
 *  about the shift dropdown and the date range until the day one of them is
 *  changed.
 *
 *  Both post to /roster/assign-range, which writes one shift_roster row per
 *  person per day and reports back who it skipped rather than failing the
 *  whole range because one name was out of the caller's reach.
 * ────────────────────────────────────────────────────────────────────────── */

const FIELD = 'border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
const input = `w-full ${FIELD}`;
/* The criteria row's own select must NOT carry w-full as well as a fixed
 * width — two width declarations on one element, and whichever the compiled
 * stylesheet happened to emit last decided the layout. When w-full won, this
 * select took the whole flex row and squeezed the picker beside it down to
 * its icon; EmployeePicker's dropdown is `absolute w-full`, so the list
 * inherited that width and wrapped one character per line. */
const fieldSelect = `${FIELD} w-[140px] shrink-0 bg-white`;

const CRITERIA_FIELDS = [
  { id: 'employee', label: 'Employee' },
  { id: 'department', label: 'Department' },
  { id: 'designation', label: 'Designation' },
  { id: 'location', label: 'Location' },
];

export default function AssignShiftDialog({
  mode = 'single',            // 'single' (one employee) | 'criteria' (bulk)
  employeeId = null,          // required when mode === 'single'
  employeeName = '',
  people = [],
  peopleLoading = false,
  defaultFrom = '',
  defaultTo = '',
  onClose,
  onSaved,
}) {
  const [shifts, setShifts] = useState([]);
  const [shiftId, setShiftId] = useState('');
  /* 'standing' is the common case and the one the form had no way to say:
   * change somebody's shift until it is changed again. It writes
   * employees.shift_id through /shifts/:id/assign — one row per person.
   *
   * 'range' writes one shift_roster row per person per day, which is the
   * right shape for "night shift for the next fortnight" and the wrong shape
   * for "from now on": expressing a permanent change that way means picking
   * an arbitrary far-future end date and writing thousands of rows that all
   * have to be unpicked to change it back. */
  const [duration, setDuration] = useState('standing');
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo || defaultFrom);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState([{ field: 'employee', values: [] }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/shifts').then(r => setShifts(r.data.data || [])).catch(() => setShifts([]));
  }, []);

  // Distinct values for the non-employee criteria, read off the same employee
  // list the picker uses rather than a second endpoint that could disagree
  // with it about which departments exist.
  const optionsFor = (field) => {
    const key = { department: 'department', designation: 'designation', location: 'workLocation' }[field];
    if (!key) return [];
    return [...new Set(people.map(p => p[key]).filter(Boolean))].sort();
  };

  const setRow = (i, patch) =>
    setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const submit = async (e) => {
    e.preventDefault();
    if (!shiftId) return toast.error('Choose a shift');
    if (duration === 'range') {
      if (!fromDate || !toDate) return toast.error('Choose the dates this applies to');
      if (toDate < fromDate) return toast.error('The end date cannot be before the start date');
    }

    // Who it applies to is the same question either way, so it is built once
    // and handed to whichever endpoint the duration picked.
    const who = {};
    if (mode === 'single') {
      who.employeeIds = [employeeId];
    } else {
      const criteria = rows
        .map(r => ({ field: r.field, values: r.values.filter(Boolean) }))
        .filter(r => r.values.length);
      if (!criteria.length) return toast.error('Choose who this shift applies to');
      who.criteria = criteria;
    }

    setSaving(true);
    try {
      if (duration === 'standing') {
        const r = await api.post(`/shifts/${shiftId}/assign`, who);
        toast.success(r.data.message || 'Shift assigned');
      } else {
        const r = await api.post('/roster/assign-range', {
          ...who, shiftId, fromDate, toDate, reason: reason.trim(),
        });
        toast.success(r.data.message || 'Shift assigned');
        /* Somebody the caller may not roster is reported, not swallowed. A
         * bulk assign that silently covered 40 of 45 people would read as
         * success. */
        const skipped = r.data.skipped || [];
        if (skipped.length) {
          toast(`${skipped.length} employee(s) were skipped: ${skipped[0].reason}`, { icon: '⚠️' });
        }
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not assign that shift');
    } finally { setSaving(false); }
  };

  const body = (
    <form onSubmit={submit} className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
        <h3 className="text-[16px] font-semibold text-slate-800">Assign shift</h3>
        <button type="button" onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {mode === 'single' ? (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
            <p className="text-[12px] text-slate-500">Applicable to</p>
            <p className="text-[14px] font-medium text-slate-800">{employeeName || '—'}</p>
          </div>
        ) : (
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
              Applicable to <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-start gap-2">
                  <select className={fieldSelect} value={row.field}
                    onChange={e => setRow(i, { field: e.target.value, values: [] })}>
                    {CRITERIA_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <span className="text-[13px] text-slate-500 pt-2.5 shrink-0">is</span>
                  {/* min-w-0 because a flex item defaults to min-width:auto and
                      will not shrink below its content — without it the picker
                      pushes the row wider than the panel instead of fitting. */}
                  <div className="flex-1 min-w-0">
                    {row.field === 'employee' ? (
                      <EmployeePicker people={people} loading={peopleLoading}
                        value={row.values[0] || ''}
                        placeholder="Search name or code"
                        onChange={id => setRow(i, { values: id ? [id] : [] })} />
                    ) : (
                      <select className={`${input} bg-white`} value={row.values[0] || ''}
                        onChange={e => setRow(i, { values: e.target.value ? [e.target.value] : [] })}>
                        <option value="">Select</option>
                        {optionsFor(row.field).map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </div>
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setRows(rs => rs.filter((_, n) => n !== i))}
                      className="p-2 shrink-0 text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button type="button"
                onClick={() => setRows(rs => [...rs, { field: 'department', values: [] }])}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-blue-600 hover:text-blue-700">
                <Plus size={13} /> Add Criteria
              </button>
              {rows.length > 1 && (
                /* Stated, because a builder that looks like a filter usually
                 * means AND — this one is OR, the way the reference's own
                 * bubble between the rows says. */
                <span className="text-[12px] text-slate-500">Rows are matched with <b>OR</b></span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
            Shift name <span className="text-red-500">*</span>
          </label>
          <select className={`${input} bg-white`} value={shiftId} onChange={e => setShiftId(e.target.value)} required>
            <option value="">Select</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}  ·  {to12(s.startTime)} - {to12(s.endTime)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
            For how long <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 border border-slate-200 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-slate-50">
              <input type="radio" name="duration" className="mt-1" checked={duration === 'standing'}
                onChange={() => setDuration('standing')} />
              <span>
                <span className="block text-[14px] font-medium text-slate-800">Until I change it</span>
                <span className="block text-[12px] text-slate-500">
                  Becomes their shift from now on. This is what most changes are.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 border border-slate-200 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-slate-50">
              <input type="radio" name="duration" className="mt-1" checked={duration === 'range'}
                onChange={() => setDuration('range')} />
              <span>
                <span className="block text-[14px] font-medium text-slate-800">For a set period</span>
                <span className="block text-[12px] text-slate-500">
                  A day, a week, a month — they go back to their usual shift afterwards.
                </span>
              </span>
            </label>
          </div>
        </div>

        {duration === 'range' && (
          <>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                Dates <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" className={input} value={fromDate}
                  onChange={e => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} required />
                <input type="date" className={input} value={toDate} min={fromDate}
                  onChange={e => setToDate(e.target.value)} required />
              </div>
              <p className="text-[12px] text-slate-500 mt-1.5">
                For a single day, put the same date in both. Every day in the range is assigned —
                whether a day is worked at all stays with the weekend rules and the holiday calendar.
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Reason</label>
              <textarea className={`${input} h-20 resize-none`} value={reason}
                onChange={e => setReason(e.target.value)} placeholder="Reason" />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
        <button type="submit" disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2 rounded-md text-[14px] font-semibold">
          {saving ? 'Submitting…' : 'Submit'}
        </button>
        <button type="button" onClick={onClose}
          className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-5 py-2 rounded-md text-[14px] font-semibold">
          Cancel
        </button>
      </div>
    </form>
  );

  // Centred for one person, right-hand panel for the bulk form — the two
  // shapes the reference uses, and they carry meaning: the panel keeps the
  // schedule you are assigning against visible beside it.
  if (mode === 'criteria') {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
        <div className="bg-white w-full max-w-[520px] h-full shadow-2xl flex flex-col"
          onMouseDown={e => e.stopPropagation()}>{body}</div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="bg-white w-full max-w-[560px] max-h-[90vh] rounded-xl shadow-2xl flex flex-col"
        onMouseDown={e => e.stopPropagation()}>{body}</div>
    </div>
  );
}
