/**
 * Payroll → Salary Setup (admin only)
 *
 * Phase 1 of the payroll module. Admin sees a table of active employees
 * with their current monthly gross + annual CTC; clicks Edit to open a
 * modal with the full component breakdown (basic / HRA / conveyance /
 * medical / special / other allowances + PF/ESI/PT deductions). Save
 * writes a new versioned row; the previous "open" row is closed.
 *
 * No payslip generation here — that's Phase 2. This page is only about
 * storing the canonical salary structure per employee.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { Search, Pencil, History, X, IndianRupee, Info } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// Component definitions — keeps the form + the editable rows in sync.
const EARNINGS = [
  { key: 'basic',            label: 'Basic',             hint: 'Typically 30–50% of CTC' },
  { key: 'hra',              label: 'HRA',               hint: 'House Rent Allowance — usually 40–50% of Basic' },
  { key: 'conveyance',       label: 'Conveyance',        hint: 'Travel allowance, ₹1,600/month is tax-free' },
  { key: 'medical',          label: 'Medical',           hint: 'Medical allowance, ₹1,250/month is tax-free' },
  { key: 'specialAllowance', label: 'Special Allowance', hint: 'Balancing component to reach target gross' },
  { key: 'otherAllowances',  label: 'Other Allowances',  hint: 'Phone, internet, role-specific top-ups' },
];

const DEDUCTIONS = [
  { key: 'pfEmployee',      label: 'PF (Employee)',  hint: '12% of Basic, capped at ₹1,800/mo for statutory PF' },
  { key: 'esiEmployee',     label: 'ESI (Employee)', hint: '0.75% of gross if gross ≤ ₹21,000/mo' },
  { key: 'professionalTax', label: 'Professional Tax', hint: 'State-specific. Tamil Nadu: ₹208/mo for gross > ₹15,000' },
];

const EMPLOYER_CONTRIBS = [
  { key: 'pfEmployer', label: 'PF (Employer)', hint: '12% of Basic from employer — adds to CTC, not deducted' },
];

const FLAGS = [
  { key: 'pfApplicable',  label: 'PF applicable',  defaultValue: true },
  { key: 'esiApplicable', label: 'ESI applicable', defaultValue: false },
];

const fmtINR = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

/* ── Modal — edit / set up one employee's salary structure ─────────────── */
function StructureModal({ employee, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const blank = {};
    EARNINGS.forEach(c => { blank[c.key] = 0; });
    DEDUCTIONS.forEach(c => { blank[c.key] = 0; });
    EMPLOYER_CONTRIBS.forEach(c => { blank[c.key] = 0; });
    FLAGS.forEach(f => { blank[f.key] = f.defaultValue; });
    blank.notes = '';
    return blank;
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!employee?._id) return;
    setLoading(true);
    api.get(`/payroll/admin/employees/${employee._id}/structure`)
      .then(r => {
        const cur = r.data.data?.current;
        if (cur) {
          setForm({
            basic: cur.basic || 0,
            hra: cur.hra || 0,
            conveyance: cur.conveyance || 0,
            medical: cur.medical || 0,
            specialAllowance: cur.specialAllowance || 0,
            otherAllowances: cur.otherAllowances || 0,
            pfEmployee: cur.pfEmployee || 0,
            esiEmployee: cur.esiEmployee || 0,
            professionalTax: cur.professionalTax || 0,
            pfEmployer: cur.pfEmployer || 0,
            pfApplicable: cur.pfApplicable !== false,
            esiApplicable: !!cur.esiApplicable,
            notes: cur.notes || '',
          });
        }
        setHistory(r.data.data?.history || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [employee?._id]);

  // Live totals — match the backend's withTotals() math exactly.
  const totals = useMemo(() => {
    const gross =
      Number(form.basic || 0) +
      Number(form.hra || 0) +
      Number(form.conveyance || 0) +
      Number(form.medical || 0) +
      Number(form.specialAllowance || 0) +
      Number(form.otherAllowances || 0);
    const ded = Number(form.pfEmployee || 0) + Number(form.esiEmployee || 0) + Number(form.professionalTax || 0);
    return { gross, ded, net: gross - ded, ctc: gross * 12 + Number(form.pfEmployer || 0) * 12 };
  }, [form]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const r = await api.put(`/payroll/admin/employees/${employee._id}/structure`, form);
      toast.success('Salary structure saved');
      onSaved?.(r.data.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800">Salary Structure</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {employee.firstName} {employee.lastName}
              {employee.employeeId && <span className="font-mono text-slate-400 ml-2">{employee.employeeId}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(s => !s)}
                className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg"
                title="Show last 5 revisions"
              >
                <History size={13} /> History ({history.length})
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
              <X size={16} />
            </button>
          </div>
        </div>

        <form onSubmit={onSave} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6 p-6">

              {/* Earnings column */}
              <div>
                <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider mb-3">Monthly Earnings</p>
                <div className="space-y-3">
                  {EARNINGS.map(c => (
                    <FieldRow key={c.key} label={c.label} hint={c.hint} value={form[c.key]} onChange={v => set(c.key, v)} />
                  ))}
                </div>
              </div>

              {/* Deductions column */}
              <div>
                <p className="text-[11px] font-bold text-red-700 uppercase tracking-wider mb-3">Monthly Deductions</p>
                <div className="space-y-3">
                  {DEDUCTIONS.map(c => (
                    <FieldRow key={c.key} label={c.label} hint={c.hint} value={form[c.key]} onChange={v => set(c.key, v)} />
                  ))}
                </div>

                <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mt-6 mb-3">Employer Contribution</p>
                <div className="space-y-3">
                  {EMPLOYER_CONTRIBS.map(c => (
                    <FieldRow key={c.key} label={c.label} hint={c.hint} value={form[c.key]} onChange={v => set(c.key, v)} />
                  ))}
                </div>

                <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mt-6 mb-3">Eligibility</p>
                <div className="space-y-2">
                  {FLAGS.map(f => (
                    <label key={f.key} className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer select-none">
                      <input type="checkbox" checked={!!form[f.key]} onChange={e => set(f.key, e.target.checked)} className="rounded" />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes — full width */}
              <div className="md:col-span-2">
                <label className="block text-[11.5px] font-medium text-slate-600 mb-1.5">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="e.g. Effective from next payroll cycle, post-appraisal hike, etc."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-blue-400 resize-none"
                />
              </div>

              {/* Live totals */}
              <div className="md:col-span-2 bg-slate-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <Totals label="Monthly Gross" value={totals.gross} color="text-slate-800" />
                <Totals label="Deductions"    value={totals.ded}   color="text-red-600" />
                <Totals label="Take-Home"     value={totals.net}   color="text-emerald-700" />
                <Totals label="Annual CTC"    value={totals.ctc}   color="text-blue-700" emphasis />
              </div>

              {/* History (lazy) */}
              {showHistory && history.length > 0 && (
                <div className="md:col-span-2 border-t border-slate-100 pt-4">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Recent Changes</p>
                  <div className="space-y-2 text-[12px]">
                    {history.map(h => (
                      <div key={h.id} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
                        <div className="text-slate-600">
                          <span className="font-medium">{new Date(h.effectiveFrom).toLocaleDateString('en-GB')}</span>
                          <span className="text-slate-400 mx-1.5">→</span>
                          <span className="font-medium">{new Date(h.effectiveTo).toLocaleDateString('en-GB')}</span>
                        </div>
                        <div className="text-slate-700 font-semibold">{fmtINR(h.monthlyGross)} / mo</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Structure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldRow({ label, hint, value, onChange }) {
  return (
    <div>
      <label className="flex items-center justify-between text-[12px] text-slate-600 mb-1">
        <span>{label}</span>
        {hint && (
          <span title={hint} className="text-slate-300 hover:text-slate-500 cursor-help">
            <Info size={11} />
          </span>
        )}
      </label>
      <div className="relative">
        <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="number"
          min={0}
          step="0.01"
          value={value || 0}
          onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-blue-400 text-right"
        />
      </div>
    </div>
  );
}

function Totals({ label, value, color, emphasis }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-[15px] font-bold ${color} ${emphasis ? 'text-[16px]' : ''}`}>{fmtINR(value)}</p>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function PayrollSetup() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load employees'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
        || (e.employeeId || '').toLowerCase().includes(q)
        || (e.designation || '').toLowerCase().includes(q)
        || (e.department  || '').toLowerCase().includes(q);
  });

  const stats = useMemo(() => {
    const withStructure = employees.filter(e => e.structure);
    const totalMonthly = withStructure.reduce((s, e) => s + (e.structure?.monthlyGross || 0), 0);
    const totalCTC     = withStructure.reduce((s, e) => s + (e.structure?.ctcAnnual    || 0), 0);
    return {
      total: employees.length,
      configured: withStructure.length,
      pending: employees.length - withStructure.length,
      totalMonthly,
      totalCTC,
    };
  }, [employees]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Payroll · Salary Setup</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Define the monthly salary structure for each employee. Components feed the payslip generation in Phase 2.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Employees"   value={stats.total} />
        <StatCard label="Structure Set"     value={stats.configured} color="text-emerald-700" />
        <StatCard label="Pending Setup"     value={stats.pending} color={stats.pending > 0 ? 'text-amber-700' : 'text-slate-500'} />
        <StatCard label="Annual Payroll"    value={fmtINR(stats.totalCTC)} color="text-blue-700" small />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name / ID / role / dept"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:border-blue-400"
          />
        </div>
        <p className="text-[11.5px] text-slate-500">
          Showing {filtered.length} of {employees.length}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-slate-50 text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5">Designation</th>
              <th className="px-4 py-2.5 text-right">Monthly Gross</th>
              <th className="px-4 py-2.5 text-right">Annual CTC</th>
              <th className="px-4 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">No employees match the filter.</td></tr>
            ) : filtered.map(emp => (
              <tr key={emp._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{emp.firstName} {emp.lastName}</div>
                  <div className="text-[11px] text-slate-400 font-mono">{emp.employeeId}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{emp.designation || '—'}</div>
                  <div className="text-[11px] text-slate-400">{emp.department || ''}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">
                  {emp.structure ? fmtINR(emp.structure.monthlyGross) : <span className="text-amber-600 text-[11.5px]">Not set up</span>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-blue-700">
                  {emp.structure ? fmtINR(emp.structure.ctcAnnual) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditing(emp)}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-800"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <StructureModal
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color = 'text-slate-800', small }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 font-bold ${color} ${small ? 'text-[15px]' : 'text-[20px]'}`}>{value}</p>
    </div>
  );
}
