/**
 * Admin → Loans & Advances
 * Salary advances and longer-running loans, recovered automatically from
 * the employee's monthly payslip. The run-month engine reads active loans
 * and subtracts `monthly_recovery` capped at the outstanding balance.
 * Once recovered = principal, the loan flips to 'closed'.
 */
import React, { useEffect, useState } from 'react';
import { Plus, Wallet, TrendingDown, CheckCircle2, IndianRupee, FileText, X } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR, StatCard } from './_shared';

export default function Loans() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    const qs = filter === 'all' ? '' : `?status=${filter}`;
    api.get(`/payroll/admin/loans${qs}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filter]);
  useEffect(() => {
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(() => {});
  }, []);

  const totals = rows.reduce((s, l) => ({
    principal:    s.principal    + Number(l.principal),
    outstanding:  s.outstanding  + Number(l.outstanding),
    active:       s.active       + (l.status === 'active' ? 1 : 0),
    closed:       s.closed       + (l.status === 'closed' ? 1 : 0),
  }), { principal: 0, outstanding: 0, active: 0, closed: 0 });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800 flex items-center gap-2">
            <Wallet size={20} className="text-blue-500" /> Loans & Advances
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Salary advances and longer loans, auto-recovered from monthly payroll.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-[13px] font-semibold px-4 py-2 rounded-lg shadow-sm"
        >
          <Plus size={16} /> Issue Loan
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active Loans" value={totals.active}  icon={Wallet} />
        <StatCard label="Closed Loans" value={totals.closed}  icon={CheckCircle2} color="text-emerald-700" />
        <StatCard label="Total Outstanding" value={fmtINR(totals.outstanding)} icon={TrendingDown} color="text-rose-700" />
        <StatCard label="Cumulative Issued"  value={fmtINR(totals.principal)} />
      </div>

      <div className="flex items-center gap-2">
        {[
          { v: 'active', label: 'Active' },
          { v: 'closed', label: 'Closed' },
          { v: 'all',    label: 'All'    },
        ].map(f => (
          <button key={f.v} onClick={() => setFilter(f.v)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              filter === f.v ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}>{f.label}</button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
            <p>No loans found.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50">
              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Principal</th>
                <th className="text-right px-4 py-2.5">Recovered</th>
                <th className="text-right px-4 py-2.5">Outstanding</th>
                <th className="text-right px-4 py-2.5">Monthly EMI</th>
                <th className="text-center px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(l => {
                const pct = Number(l.principal) > 0 ? (Number(l.recovered) / Number(l.principal)) * 100 : 0;
                return (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{l.firstName} {l.lastName}</p>
                      <p className="text-[11px] text-slate-500">{l.employeeCode} · {l.department}</p>
                    </td>
                    <td className="text-right px-4 py-3 font-bold">{fmtINR(l.principal)}</td>
                    <td className="text-right px-4 py-3">
                      <div>
                        {fmtINR(l.recovered)}
                        <div className="mt-1 h-1 w-20 ml-auto bg-slate-100 rounded">
                          <div className="h-1 bg-emerald-500 rounded" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="text-right px-4 py-3 font-bold text-rose-700">{fmtINR(l.outstanding)}</td>
                    <td className="text-right px-4 py-3">{fmtINR(l.monthlyRecovery)}</td>
                    <td className="text-center px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        l.status === 'active' ? 'bg-blue-50 text-blue-700'
                        : l.status === 'closed' ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                      }`}>{l.status}</span>
                    </td>
                    <td className="text-right px-4 py-3">
                      {l.status === 'active' && (
                        <button onClick={async () => {
                          if (!window.confirm('Mark this loan as closed?')) return;
                          try {
                            await api.put(`/payroll/admin/loans/${l.id}`, { status: 'closed' });
                            toast.success('Closed'); load();
                          } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
                        }} className="text-[11.5px] font-semibold text-emerald-700 hover:underline">
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <IssueModal onClose={() => setShowAdd(false)} onSaved={load} employees={employees} />}
    </div>
  );
}

function IssueModal({ onClose, onSaved, employees }) {
  const [employeeId, setEmployeeId] = useState('');
  const [principal,  setPrincipal]  = useState('');
  const [monthly,    setMonthly]    = useState('');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);

  const save = async () => {
    if (!employeeId || !principal) return toast.error('Employee and principal required');
    setSaving(true);
    try {
      await api.post('/payroll/admin/loans', {
        employeeId, principal: Number(principal),
        monthlyRecovery: Number(monthly) || 0, notes,
      });
      toast.success('Loan issued');
      onSaved(); onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold opacity-90">Issue Loan / Advance</p>
            <p className="text-[16px] font-bold mt-0.5">Recovered monthly via payslip</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">Employee</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px]">
              <option value="">— Select —</option>
              {employees.map(e => (
                <option key={e._id} value={e._id}>{e.firstName} {e.lastName} · {e.employeeId}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">Principal Amount (₹)</label>
            <div className="mt-1 flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3">
              <IndianRupee size={14} className="text-slate-400" />
              <input type="number" value={principal} onChange={e => setPrincipal(e.target.value)}
                placeholder="50000" className="flex-1 bg-transparent py-2 text-[13px] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">Monthly Recovery (₹)</label>
            <div className="mt-1 flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3">
              <IndianRupee size={14} className="text-slate-400" />
              <input type="number" value={monthly} onChange={e => setMonthly(e.target.value)}
                placeholder="5000" className="flex-1 bg-transparent py-2 text-[13px] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-wider">
              <FileText size={11} className="inline mr-1" /> Notes (optional)
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Medical emergency, festival advance, etc." rows={2}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
          </div>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-[13px] font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : 'Issue Loan'}
          </button>
        </div>
      </div>
    </div>
  );
}
