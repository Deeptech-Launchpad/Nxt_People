/**
 * Admin → Payroll Adjustments
 * One-off per-month line items (bonus, overtime, deduction, other) that get
 * pulled into the next payroll run for the chosen employee + month. Use
 * this when an employee owes/is owed something that doesn't belong in their
 * salary structure (e.g. festival bonus, performance incentive, one-time
 * tool deduction).
 */
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles, Calendar, IndianRupee } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { MONTH_NAMES, fmtINR } from './_shared';

const TYPE_META = {
  bonus:     { label: 'Bonus',     fg: 'text-emerald-700', bg: 'bg-emerald-50' },
  overtime:  { label: 'Overtime',  fg: 'text-indigo-700',  bg: 'bg-indigo-50'  },
  deduction: { label: 'Deduction', fg: 'text-rose-700',    bg: 'bg-rose-50'    },
  other:     { label: 'Other',     fg: 'text-amber-700',   bg: 'bg-amber-50'   },
};

export default function Adjustments() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year,  setYear]  = useState(today.getFullYear());
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/payroll/admin/adjustments?month=${month}&year=${year}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [month, year]);
  useEffect(() => {
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(() => {});
  }, []);

  const del = async (id) => {
    if (!window.confirm('Delete this adjustment?')) return;
    try {
      await api.delete(`/payroll/admin/adjustments/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const total = rows.reduce((s, r) => s + (r.type === 'deduction' ? -Number(r.amount) : Number(r.amount)), 0);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800 flex items-center gap-2">
            <Sparkles size={20} className="text-amber-500" /> Payroll Adjustments
          </h1>
          <p className="text-[15px] text-slate-500 mt-1">
            One-off bonuses, overtime, or deductions added to the next payroll run for the chosen month.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-[15px] font-semibold px-4 py-2 rounded-lg shadow-sm"
        >
          <Plus size={16} /> Add Adjustment
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-slate-400" />
          <p className="text-[15px] font-bold text-slate-800">Period</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
            {MONTH_NAMES.slice(1).map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="bg-transparent text-[15px] font-semibold focus:outline-none">
            {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['bonus','overtime','deduction','other'].map(t => {
          const sub = rows.filter(r => r.type === t);
          const sum = sub.reduce((s, r) => s + Number(r.amount), 0);
          const meta = TYPE_META[t];
          return (
            <div key={t} className={`rounded-xl border border-slate-200 p-4 ${meta.bg}`}>
              <p className={`text-[12px] font-bold uppercase tracking-wider ${meta.fg}`}>{meta.label}</p>
              <p className="text-[18px] font-bold text-slate-800 mt-1">{fmtINR(sum)}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{sub.length} {sub.length === 1 ? 'entry' : 'entries'}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-slate-800">Entries for {MONTH_NAMES[month]} {year}</h3>
          <p className="text-[14px] font-semibold text-slate-700">Net: <span className="text-emerald-700">{fmtINR(total)}</span></p>
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Sparkles size={28} className="mx-auto text-slate-300 mb-2" />
            <p>No adjustments for this month yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => {
              const meta = TYPE_META[r.type] || TYPE_META.other;
              return (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-[13px] font-bold ${meta.bg} ${meta.fg}`}>{meta.label}</span>
                    <div>
                      <p className="text-[15px] font-bold text-slate-800">{r.firstName} {r.lastName}</p>
                      <p className="text-[13px] text-slate-500">{r.employeeCode}{r.reason ? ` · ${r.reason}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className={`text-[16px] font-bold ${r.type === 'deduction' ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {r.type === 'deduction' ? '−' : '+'}{fmtINR(r.amount)}
                    </p>
                    <button onClick={() => del(r.id)} className="text-slate-400 hover:text-rose-600 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={load} employees={employees} month={month} year={year} />}
    </div>
  );
}

function AddModal({ onClose, onSaved, employees, month, year }) {
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('bonus');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!employeeId || !amount) return toast.error('Pick an employee and enter an amount');
    setSaving(true);
    try {
      await api.post('/payroll/admin/adjustments', {
        employeeId, type, amount: Number(amount), reason, payMonth: month, payYear: year,
      });
      toast.success('Adjustment added');
      onSaved(); onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-4">
          <p className="text-[13px] uppercase tracking-wider font-bold opacity-90">Add Adjustment</p>
          <p className="text-[18px] font-bold mt-0.5">{MONTH_NAMES[month]} {year}</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Employee</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[15px]">
              <option value="">— Select —</option>
              {employees.map(e => (
                <option key={e._id} value={e._id}>{e.firstName} {e.lastName} · {e.employeeId}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Type</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button key={k} onClick={() => setType(k)}
                  className={`px-2 py-1.5 rounded-lg text-[14px] font-semibold border transition-all ${
                    type === k
                      ? `${m.bg} ${m.fg} border-current`
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Amount (₹)</label>
            <div className="mt-1 flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3">
              <IndianRupee size={14} className="text-slate-400" />
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0" className="flex-1 bg-transparent py-2 text-[15px] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Reason (optional)</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Q4 performance bonus"
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[15px]" />
          </div>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[15px] font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-[15px] font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
