import React, { useState, useEffect, useRef } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// 32 is the "Last day" sentinel the backend uses, so a rule can name the last
// day of the month without knowing which month it will be applied to.
const LAST_DAY = 32;
const ordinal = n =>
  n === LAST_DAY ? 'Last day'
    : `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const DAY_OPTIONS = [...Array(31).keys()].map(i => i + 1).concat(LAST_DAY);

const CYCLES = [
  ['monthly', 'Monthly'],
  ['semi_monthly', 'Semi-monthly'],
  ['fortnightly', 'Fortnightly'],
  ['weekly', 'Weekly'],
];
const APPLICABLE_FIELDS = [
  ['location', 'Location'],
  ['department', 'Department'],
  ['employee_type', 'Employee Type'],
];

const fmt = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

const blank = () => ({
  name: '', cycle: 'monthly',
  startDay: 1, endDay: LAST_DAY, processingDay: LAST_DAY, reportDay: 1,
  processEncashment: false, pendingAction: null,
  convertAbsences: false, lockAfterProcessing: false,
  applicableTo: {},
});

const selectClass = 'w-full text-[14px] rounded-md border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400';

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-[13px] text-slate-600 mb-1.5">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

// Multi-select with removable chips. A pay period applies to a set of real
// values, so the options come from the employee directory rather than free
// text — a typo'd department would silently match nobody.
function ChipSelect({ options, values, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const remaining = options.filter(o =>
    !values.includes(o) && o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={boxRef} className="relative flex-1 min-w-[220px]">
      <div
        onClick={() => setOpen(true)}
        className="flex flex-wrap items-center gap-1.5 min-h-[34px] rounded border border-slate-300 bg-white px-2 py-1.5 cursor-text"
      >
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-[12.5px] rounded px-2 py-0.5">
            {v}
            <button
              onClick={e => { e.stopPropagation(); onChange(values.filter(x => x !== v)); }}
              aria-label={`Remove ${v}`} className="text-slate-400 hover:text-slate-700"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          placeholder={values.length ? '' : placeholder}
          className="flex-1 min-w-[80px] text-[13.5px] outline-none bg-transparent"
        />
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-[200px] overflow-y-auto">
          {remaining.length === 0 ? (
            <p className="px-3 py-2.5 text-[13px] text-slate-400">
              {options.length ? 'No matches' : 'No values available'}
            </p>
          ) : remaining.map(o => (
            <button
              key={o}
              onClick={() => { onChange([...values, o]); setQuery(''); }}
              className="block w-full text-left px-3 py-2 text-[13.5px] text-slate-700 hover:bg-slate-50"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Check({ checked, onChange, disabled, children }) {
  return (
    <label className={`flex items-start gap-2.5 text-[14px] ${disabled ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </label>
  );
}

function PeriodDialog({ initial, options, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...blank(), ...initial }));
  const [saving, setSaving] = useState(false);
  const set = changes => setForm(f => ({ ...f, ...changes }));
  const editing = !!initial?._id;

  // A monthly cycle always begins on the 1st — the start day is shown so the
  // rule reads completely, but it is not the user's to choose.
  const startFixed = form.cycle === 'monthly';
  const startDay = startFixed ? 1 : form.startDay;

  const save = () => {
    if (!form.name.trim()) return toast.error('Pay period name is required');
    setSaving(true);
    const body = { ...form, startDay };
    const req = editing ? api.patch(`/pay-periods/${initial._id}`, body) : api.post('/pay-periods', body);
    req
      .then(() => { toast.success(editing ? 'Pay period updated' : 'Pay period added'); onSaved(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save the pay period'))
      .finally(() => setSaving(false));
  };

  const applicable = form.applicableTo || {};

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-[#f1f3f7] rounded-lg w-full max-w-[760px] my-6 shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4">
          <h3 className="text-[16px] font-semibold text-slate-800">{editing ? 'Edit' : 'Add'} Pay Period</h3>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center">✕</button>
        </div>

        <div className="px-6 pb-4 overflow-y-auto flex-1">
          <div className="bg-white rounded-lg p-5 space-y-4">
            <Field label="Pay period name" required>
              <input value={form.name} onChange={e => set({ name: e.target.value })}
                placeholder="e.g. Monthly pay period" className={selectClass} />
            </Field>

            <Field label="Pay period cycle">
              <select value={form.cycle} onChange={e => set({ cycle: e.target.value })} className={selectClass}>
                {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Start day">
                <select value={startDay} disabled={startFixed}
                  onChange={e => set({ startDay: Number(e.target.value) })} className={selectClass}>
                  {DAY_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
                </select>
              </Field>
              <Field label="End day" required>
                <select value={form.endDay} onChange={e => set({ endDay: Number(e.target.value) })} className={selectClass}>
                  {DAY_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Payroll processing day" required>
              <select value={form.processingDay} onChange={e => set({ processingDay: Number(e.target.value) })} className={selectClass}>
                {DAY_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
              </select>
            </Field>

            <Field label="Payroll report generation day" required>
              <select value={form.reportDay} onChange={e => set({ reportDay: Number(e.target.value) })} className={selectClass}>
                {DAY_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
              </select>
            </Field>

            <div className="space-y-3.5 pt-1">
              <Check checked={form.processEncashment} onChange={v => set({ processEncashment: v })}>
                Process leave encashment
              </Check>

              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked={!!form.pendingAction}
                  onChange={e => set({ pendingAction: e.target.checked ? 'auto_reject' : null })}
                  className="w-4 h-4 accent-blue-600 mt-0.5 flex-shrink-0" />
                <select
                  value={form.pendingAction || 'auto_reject'}
                  disabled={!form.pendingAction}
                  onChange={e => set({ pendingAction: e.target.value })}
                  className="text-[13.5px] rounded border border-slate-300 px-2 py-1 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="auto_reject">Auto Reject</option>
                  <option value="auto_approve">Auto Approve</option>
                </select>
                <span className={`text-[14px] ${form.pendingAction ? 'text-slate-700' : 'text-slate-400'}`}>
                  Any pending approval requests by the end of the payroll processing day
                </span>
              </div>

              <Check checked={form.convertAbsences} onChange={v => set({ convertAbsences: v })}>
                <span className="font-medium">Automatically convert absences to leave</span>
                <span className="ml-2 text-[11.5px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 whitespace-nowrap">
                  Saved, but not enforced yet
                </span>
                <span className="block text-[13px] text-slate-500 mt-0.5">
                  Absences will be converted to approved leave on the scheduled date, utilizing the
                  leave balances in the specified order defined below.
                </span>
              </Check>

              <Check checked={form.lockAfterProcessing} onChange={v => set({ lockAfterProcessing: v })}>
                Lock (Any modifications to attendance, leave and timesheet entries for the period
                mentioned above will be locked after the processing day)
              </Check>
            </div>

            <div className="pt-1">
              <p className="text-[13px] text-slate-600 mb-2">Applicable to</p>
              <div className="bg-slate-50 rounded-lg p-3 flex flex-wrap items-center gap-2.5">
                <select
                  value={applicable.field || ''}
                  onChange={e => set({ applicableTo: e.target.value ? { field: e.target.value, values: [] } : {} })}
                  className="text-[13.5px] rounded border border-slate-300 px-2 py-1.5 bg-white"
                >
                  <option value="">Everyone</option>
                  {APPLICABLE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {applicable.field && (
                  <>
                    <span className="text-[13.5px] text-slate-500">is</span>
                    <ChipSelect
                      options={options[applicable.field] || []}
                      values={applicable.values || []}
                      placeholder="Select"
                      onChange={values => set({ applicableTo: { field: applicable.field, values } })}
                    />
                  </>
                )}
              </div>
            </div>

            {editing && initial.upcoming && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 mt-1">
                <p className="text-[13.5px] font-semibold text-amber-700 mb-2">Pay period summary</p>
                <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-slate-700">
                  <li>Upcoming pay cycle : {fmt(initial.upcoming.startDate)} - {fmt(initial.upcoming.endDate)}</li>
                  <li>
                    Loss of pay details report &amp; Expected vs worked hours report of the period
                    will be processed on {fmt(initial.summary?.processedOn)} by 11:59 PM.
                  </li>
                  <li>
                    Leave data for payroll report will be generated on {fmt(initial.summary?.reportOn)} 00:00 AM.
                    Loss of pay details report of that period will be locked once Leave data for
                    payroll report is generated.
                  </li>
                </ul>
              </div>
            )}
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

// Pay Period configuration. A period is a recurring rule, not a fixed range —
// the three payroll-facing leave reports (Loss of pay, Leave encashment and
// Leave data for payroll) offer it as a chip and run over the cycle it resolves
// to, instead of a hand-picked date range.
//
// "Process leave encashment" is what the Leave encashment report checks: with
// it off, that report says so and links back here rather than rendering an
// empty table that looks like missing data.
export default function PayPeriods() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [options, setOptions] = useState({});

  // The Applicable-to values are real directory values, so a period can never
  // be scoped to a department or location that does not exist.
  useEffect(() => {
    api.get('/reports/employee/filter-options')
      .then(r => {
        const d = r.data.data || {};
        setOptions({
          location: d.workLocation || [],
          department: d.department || [],
          employee_type: d.employmentType || [],
        });
      })
      .catch(() => setOptions({}));
  }, []);

  const load = () => {
    setLoading(true);
    api.get('/pay-periods')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load pay periods'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = row => {
    if (!window.confirm(`Delete the “${row.name}” pay period?`)) return;
    api.delete(`/pay-periods/${row._id}`)
      .then(() => { toast.success('Pay period deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete that pay period'));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <h1 className="text-[16px] font-semibold text-slate-800">Pay Period</h1>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Creating a pay period can help you automate the payroll process, generate payroll
          reports, and ensure that employees are paid on time
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setDialog({})}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[14px] font-medium">
          Add Pay Period
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50 text-[13px] font-semibold text-slate-600">
                <tr>
                  <th className="text-left px-5 py-3">Pay period name</th>
                  <th className="text-left px-5 py-3">Pay period cycle</th>
                  <th className="text-left px-5 py-3">Payroll processing day</th>
                  <th className="w-[90px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row._id} className="border-t border-slate-100 hover:bg-slate-50 group">
                    <td className="px-5 py-3.5 text-[14px] text-slate-800">{row.name}</td>
                    <td className="px-5 py-3.5 text-[14px] text-slate-700">{row.cycleLabel}</td>
                    <td className="px-5 py-3.5 text-[14px] text-slate-700">{row.processingLabel}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button onClick={() => setDialog(row)} title="Edit" className="text-slate-400 hover:text-slate-700"><Pencil size={15} /></button>
                        <button onClick={() => remove(row)} title="Delete" className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={4} className="text-center py-14 text-[14px] text-slate-400">No pay periods yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <PeriodDialog
          initial={dialog}
          options={options}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}
