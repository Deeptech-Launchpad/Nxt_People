import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { SlidersHorizontal, X, CalendarRange, Users, Gift, CalendarCheck, Copy, Trash2 } from 'lucide-react';
import api from '../../utils/api';

const PAY_TYPES = [['paid', 'Paid'], ['unpaid', 'Unpaid'], ['comp_off', 'Compensatory Off']];
const UNITS = [['days', 'Days'], ['hours', 'Hours']];
const ACCRUAL_MODES = [
  ['annual', 'Annual — granted once'],
  ['monthly', 'Monthly — accrues each month'],
  ['earned', 'Earned — credited as worked'],
  ['none', 'None — no entitlement'],
];
const POLICY_TYPES = [
  ['fixed', 'Fixed entitlement'],
  ['experience', 'Experience based'],
  ['grant', 'Grant based'],
  ['attendance', 'Attendance based'],
];

// Step one of Add Leave Policy: how the policy decides its amount. Only Fixed
// entitlement is buildable end to end today — the other three need their own
// forms (service slabs, a request workflow, an attendance rule) that this
// screen does not have, so they are offered but say what they need.
const POLICY_KINDS = [
  { key: 'fixed', icon: CalendarRange, title: 'Fixed entitlement', desc: 'A simple policy with a fixed amount of leaves, such as 12 days per year', ready: true },
  { key: 'experience', icon: Users, title: 'Experience based entitlement', desc: "An advanced policy with a variable amount of leave based on the employee's years of experience" },
  { key: 'grant', icon: Gift, title: 'Grant based entitlement', desc: 'A policy that credits special leave to specific employees based on a request, such as maternity leave' },
  { key: 'attendance', icon: CalendarCheck, title: 'Attendance based entitlement', desc: 'A policy that credits leave to employees based on their worked hours or days' },
];

const selectClass = 'w-full text-[13.5px] rounded-md border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

function FilterPanel({ value, onChange, onClose, options }) {
  const [draft, setDraft] = useState(value);
  const set = c => setDraft(d => ({ ...d, ...c }));

  const Row = ({ label: l, children }) => (
    <div>
      <label className="block text-[13px] text-slate-600 mb-1.5">{l}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onClick={e => e.stopPropagation()}
        className="relative bg-white w-full max-w-[320px] h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Filter</h3>
          <button onClick={onClose} aria-label="Close filter" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Row label="Status">
            <select value={draft.status} onChange={e => set({ status: e.target.value })} className={selectClass}>
              <option value="active">Active (Enabled &amp; Disabled)</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </Row>
          <Row label="Unit">
            <select value={draft.unit} onChange={e => set({ unit: e.target.value })} className={selectClass}>
              <option value="">All</option>
              {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          <Row label="Type">
            <select value={draft.payType} onChange={e => set({ payType: e.target.value })} className={selectClass}>
              <option value="">All</option>
              {PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          <Row label="Policy type">
            <select value={draft.policyType} onChange={e => set({ policyType: e.target.value })} className={selectClass}>
              <option value="">All</option>
              {POLICY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          {/* Department, Designation and Location come from the employee
              directory rather than being hard-coded, so a filter can never
              offer a value nobody has. */}
          {[['department', 'Department', 'All Departments'], ['designation', 'Designation', 'All Designations'], ['location', 'Location', 'All Locations']].map(([key, l, all]) => (
            <Row key={key} label={l}>
              <select value={draft[key]} onChange={e => set({ [key]: e.target.value })} className={selectClass}>
                <option value="">{all}</option>
                {(options[key] || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Row>
          ))}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200">
          <button onClick={() => { onChange(draft); onClose(); }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium">Apply</button>
          <button onClick={() => { const reset = emptyFilters(); setDraft(reset); onChange(reset); }}
            className="text-[14px] text-slate-600 px-4 py-2 rounded border border-slate-300 hover:bg-slate-50">Reset</button>
        </div>
      </div>
    </div>
  );
}

const emptyFilters = () => ({ status: 'active', unit: '', payType: '', policyType: '', department: '', designation: '', location: '' });

function AddPolicyDialog({ onClose, onCreated }) {
  const [kind, setKind] = useState('fixed');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', code: '', unit: 'days', payType: 'paid', accrualMode: 'annual', accrualAmount: 12, color: '#1a73e8' });
  const [saving, setSaving] = useState(false);
  const set = c => setForm(f => ({ ...f, ...c }));
  const ready = POLICY_KINDS.find(k => k.key === kind)?.ready;

  const create = () => {
    if (!form.name.trim()) return toast.error('Leave policy name is required');
    const code = (form.code || form.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!code) return toast.error('Leave policy name must contain letters or numbers');
    setSaving(true);
    // Creation and configuration are two endpoints: POST makes the type, PATCH
    // sets the policy fields that only the policies screen knows about.
    api.post('/leave-types', { name: form.name.trim(), code, color: form.color })
      .then(r => api.patch(`/leave-types/policies/${r.data.data._id}`, {
        payType: form.payType, unit: form.unit,
        accrualMode: form.accrualMode, accrualAmount: Number(form.accrualAmount),
        policyType: kind,
      }))
      .then(() => { toast.success(`${form.name.trim()} created`); onCreated(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not create that leave policy'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg w-full max-w-[560px] my-8 shadow-xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-6 py-4">
          <h3 className="text-[16px] font-semibold text-slate-800">Add Leave Policy</h3>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center">✕</button>
        </div>

        <div className="px-6 pb-4 overflow-y-auto flex-1">
          {step === 1 ? (
            <>
              <div className="space-y-3">
                {POLICY_KINDS.map(k => (
                  <label key={k.key}
                    className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                      kind === k.key ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'
                    }`}>
                    <input type="radio" name="kind" checked={kind === k.key} onChange={() => setKind(k.key)}
                      className="w-4 h-4 accent-blue-600 mt-1 flex-shrink-0" />
                    <span className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <k.icon size={17} className="text-slate-500" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-medium text-slate-800">{k.title}</span>
                      <span className="block text-[13px] text-slate-500 mt-0.5">{k.desc}</span>
                      {!k.ready && <span className="block text-[12px] text-amber-700 mt-1.5">Not built yet</span>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="bg-slate-50 rounded-lg px-4 py-3 mt-4 text-[13px] text-slate-500">
                Country-wise compliance policies are not available in this project.
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] text-slate-600 mb-1.5">Leave policy name <span className="text-rose-500">*</span></label>
                <input value={form.name} onChange={e => set({ name: e.target.value })}
                  placeholder="e.g. Casual Leave" className={selectClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] text-slate-600 mb-1.5">Type</label>
                  <select value={form.payType} onChange={e => set({ payType: e.target.value })} className={selectClass}>
                    {PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] text-slate-600 mb-1.5">Unit</label>
                  <select value={form.unit} onChange={e => set({ unit: e.target.value })} className={selectClass}>
                    {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] text-slate-600 mb-1.5">Accrual</label>
                  <select value={form.accrualMode} onChange={e => set({ accrualMode: e.target.value })} className={selectClass}>
                    {ACCRUAL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] text-slate-600 mb-1.5">Amount</label>
                  <input type="number" min="0" step="0.5" value={form.accrualAmount}
                    onChange={e => set({ accrualAmount: e.target.value })} className={selectClass} />
                </div>
              </div>
              <div>
                <label className="block text-[13px] text-slate-600 mb-1.5">Colour</label>
                <input type="color" value={form.color} onChange={e => set({ color: e.target.value })}
                  className="h-9 w-16 rounded border border-slate-300 cursor-pointer" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200">
          {step === 1 ? (
            <button onClick={() => (ready ? setStep(2) : toast.error('That policy type needs its own form, which is not built yet'))}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium">Next</button>
          ) : (
            <>
              <button onClick={create} disabled={saving}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setStep(1)} className="text-[14px] text-slate-600 px-4 py-2 rounded hover:bg-slate-100">Back</button>
            </>
          )}
          <button onClick={onClose} className="text-[14px] text-slate-600 px-4 py-2 rounded hover:bg-slate-100">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Leave Policy configuration. These rows are not cosmetic — accrual mode and
// amount are what the balance reports read to decide how a type grants, and
// unit decides whether a type appears in Day or Hour mode at all. Editing one
// changes reported balances, which is why each change saves individually and
// says so rather than batching behind a single Save.
export default function LeavePolicy() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [options, setOptions] = useState({});

  const load = () => {
    setLoading(true);
    api.get('/leave-types/policies')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load leave policies'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // The employee-dimension filters are only meaningful against real values, so
  // they are populated from the directory rather than a hard-coded list.
  useEffect(() => {
    api.get('/reports/employee/filter-options')
      .then(r => {
        const d = r.data.data || {};
        setOptions({ department: d.department, designation: d.designation, location: d.workLocation });
      })
      .catch(() => setOptions({}));
  }, []);

  const patch = (row, changes) => {
    // Optimistic: the row is a single record and the request is small, so
    // reverting on failure is cheaper than making every edit feel laggy.
    const previous = rows;
    setRows(rs => rs.map(r => (r._id === row._id ? { ...r, ...changes } : r)));
    setSavingId(row._id);
    api.patch(`/leave-types/policies/${row._id}`, changes)
      .then(() => toast.success(`${row.name} updated`))
      .catch(err => {
        setRows(previous);
        toast.error(err.response?.data?.message || 'Could not save that change');
      })
      .finally(() => setSavingId(null));
  };

  const filtered = useMemo(() => rows.filter(r => {
    if (filters.unit && r.unit !== filters.unit) return false;
    if (filters.payType && r.payType !== filters.payType) return false;
    if (filters.policyType && r.policyType !== filters.policyType) return false;
    if (filters.status === 'enabled' && !r.isActive) return false;
    if (filters.status === 'disabled' && r.isActive) return false;
    return true;
  }), [rows, filters]);

  const enabled = filtered.filter(r => r.isActive);
  const disabled = filtered.filter(r => !r.isActive);
  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => v && !(k === 'status' && v === 'active')).length;

  const clone = row => {
    api.post(`/leave-types/policies/${row._id}/clone`)
      .then(r => { toast.success(`${r.data.data.name} created, disabled`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not copy that policy'));
  };

  // The confirm names the policy rather than saying "this policy" — the rows
  // look alike enough that Casual Leave and Casual Leave2025 are easy to mix up.
  const remove = row => {
    if (!window.confirm(`Delete the ${row.name} leave policy? This cannot be undone.`)) return;
    api.delete(`/leave-types/policies/${row._id}`)
      .then(r => { toast.success(r.data.message || 'Deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete that policy'));
  };

  const Row = ({ row }) => (
    <tr className={`border-t border-slate-100 group hover:bg-slate-50/70 ${savingId === row._id ? 'opacity-60' : ''}`}>
      <td className="px-5 py-3.5">
        <span className="flex items-center gap-2.5">
          <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: row.color || '#94a3b8' }} />
          <span className="text-[14px] text-slate-800">{row.name}</span>
        </span>
      </td>
      <td className="px-5 py-3.5">
        <select
          value={row.payType} onChange={e => patch(row, { payType: e.target.value })}
          aria-label={`${row.name} type`}
          className="text-[12.5px] bg-slate-100 text-slate-600 rounded px-2 py-1 border-0 cursor-pointer hover:bg-slate-200"
        >
          {PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-5 py-3.5">
        <select
          value={row.policyType || ''} onChange={e => patch(row, { policyType: e.target.value || null })}
          aria-label={`${row.name} policy type`}
          className={`text-[12.5px] rounded px-2 py-1 border-0 cursor-pointer ${row.policyType ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'text-slate-300'}`}
        >
          <option value="">—</option>
          {POLICY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-5 py-3.5">
        <select
          value={row.unit} onChange={e => patch(row, { unit: e.target.value })}
          aria-label={`${row.name} unit`}
          className="text-[14px] text-slate-700 bg-transparent border-0 cursor-pointer"
        >
          {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-5 py-3.5">
        <span className="flex items-center gap-2">
          <select
            value={row.accrualMode} onChange={e => patch(row, { accrualMode: e.target.value })}
            aria-label={`${row.name} accrual`}
            className="text-[12.5px] rounded border border-slate-200 px-2 py-1 max-w-[190px]"
          >
            {ACCRUAL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {/* An earned or entitlement-free type has no fixed amount to set. */}
          {['annual', 'monthly'].includes(row.accrualMode) ? (
            <>
              <input
                type="number" min="0" step="0.5" defaultValue={row.accrualAmount}
                aria-label={`${row.name} amount`}
                onBlur={e => {
                  const v = Number(e.target.value);
                  if (v !== row.accrualAmount) patch(row, { accrualAmount: v });
                }}
                className="w-16 text-[12.5px] rounded border border-slate-200 px-2 py-1 text-right"
              />
              <span className="text-[12px] text-slate-400">{row.unit === 'hours' ? 'hrs' : 'days'}</span>
            </>
          ) : <span className="text-slate-300">—</span>}
        </span>
      </td>
      <td className="px-5 py-3.5 text-center">
        <button
          onClick={() => patch(row, { isActive: !row.isActive })}
          role="switch" aria-checked={row.isActive}
          title={row.isActive ? 'Disable this policy' : 'Enable this policy'}
          className={`w-10 h-5 rounded-full transition-colors relative ${row.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${row.isActive ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button onClick={() => clone(row)} title={`Copy ${row.name}`}
            className="text-slate-400 hover:text-slate-700"><Copy size={15} /></button>
          <button onClick={() => remove(row)} title={`Delete ${row.name}`}
            className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
  );

  const Table = ({ items }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead className="bg-slate-50 text-[13px] font-semibold text-slate-600">
          <tr>
            <th className="text-left px-5 py-3">Leave policy</th>
            <th className="text-left px-5 py-3">Type</th>
            <th className="text-left px-5 py-3">Policy type</th>
            <th className="text-left px-5 py-3">Unit</th>
            <th className="text-left px-5 py-3">Accrual</th>
            <th className="text-center px-5 py-3 w-[90px]">Status</th>
            <th className="w-[80px]" />
          </tr>
        </thead>
        <tbody>{items.map(r => <Row key={r._id} row={r} />)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2.5">
        <button onClick={() => setAddOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[14px] font-medium">
          Add Leave Policy
        </button>
        <button onClick={() => setFilterOpen(true)}
          aria-label="Filter leave policies"
          className="relative border border-slate-300 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded">
          <SlidersHorizontal size={16} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] font-semibold rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {enabled.length
              ? <Table items={enabled} />
              : <p className="text-center py-14 text-[14px] text-slate-400">No enabled leave policies match these filters</p>}
          </div>

          {disabled.length > 0 && (
            <div>
              <p className="text-[13px] text-slate-500 mb-2">
                Not in use — enable one to make it available when applying for leave.
              </p>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden opacity-75">
                <Table items={disabled} />
              </div>
            </div>
          )}
        </>
      )}

      {filterOpen && (
        <FilterPanel value={filters} options={options} onChange={setFilters} onClose={() => setFilterOpen(false)} />
      )}
      {addOpen && (
        <AddPolicyDialog onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />
      )}
    </div>
  );
}
