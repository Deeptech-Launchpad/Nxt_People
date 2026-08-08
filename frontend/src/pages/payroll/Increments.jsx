/**
 * Payroll → Increments & Arrears (admin)
 * Propose a salary raise → another admin/HR approves (self-approval
 * blocked) → the raise is applied proportionally to every salary component,
 * and any already-locked/paid months since the effective date get queued
 * as arrears, auto-consumed into the next payroll run's lock step.
 */
import React, { useEffect, useState } from 'react';
import { Plus, CheckCircle2, XCircle, X, TrendingUp } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR } from './_shared';
import { useAuth } from '../../context/AuthContext';

function ProposeModal({ onClose, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [proposedGross, setProposedGross] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load employees'));
  }, []);

  const selectedEmployee = employees.find(e => e._id === employeeId);
  const currentGross = selectedEmployee?.structure?.monthlyGross ?? null;
  const isPayCut = currentGross != null && proposedGross !== '' && Number(proposedGross) < currentGross;

  const save = async (e) => {
    e.preventDefault();
    if (!employeeId || !proposedGross || Number(proposedGross) <= 0) {
      return toast.error('Select an employee and enter a proposed gross greater than 0');
    }
    if (isPayCut && !window.confirm(
      `The proposed gross (${fmtINR(proposedGross)}) is LESS than this employee's current gross (${fmtINR(currentGross)}) — this is a pay cut, not an increment. Continue?`
    )) return;
    setSaving(true);
    try {
      const r = await api.post('/payroll/increments', { employeeId, proposedGross: Number(proposedGross), effectiveDate });
      if (r.data.arrears) {
        toast.success(`Proposed — estimated arrears: ${fmtINR(r.data.arrears.totalArrears)} across ${r.data.arrears.affectedMonths.length} already-closed month(s)`, { duration: 6000 });
      } else {
        toast.success('Proposed');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Propose failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-800">Propose Increment</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={save} className="p-6 space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">Employee</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] bg-white">
              <option value="">Select…</option>
              {employees.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName} — {e.structure ? fmtINR(e.structure.monthlyGross) + '/mo' : 'no structure'}</option>)}
            </select>
            {currentGross != null && (
              <p className="text-[12px] text-slate-500 mt-1">Current monthly gross: <strong>{fmtINR(currentGross)}</strong></p>
            )}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">New Monthly Gross</label>
            <input type="number" min={0} value={proposedGross} onChange={e => setProposedGross(e.target.value)} required
              className={`w-full border rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400 text-right ${isPayCut ? 'border-rose-300' : 'border-slate-200'}`} />
            {isPayCut && <p className="text-[12px] text-rose-600 mt-1">This is lower than the current gross — a pay cut, not an increment.</p>}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">Effective From</label>
            <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px]" />
            <p className="text-[12px] text-slate-400 mt-1">A date in a past month that's already locked/paid will queue arrears automatically.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-[15px] text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
              {saving ? 'Proposing…' : 'Propose'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Increments() {
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [actingId, setActingId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/payroll/increments?status=${status}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load increments'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  const act = async (id, action) => {
    if (actingId) return;
    let reason = null;
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (visible to employee):', '');
      if (reason === null) return;
      if (!reason.trim()) return toast.error('A rejection reason is required');
    } else if (action === 'approve') {
      if (!window.confirm("Approve this increment? It will proportionally rescale this employee's salary components and queue any applicable arrears immediately.")) return;
    }
    setActingId(id);
    try {
      if (action === 'approve') await api.put(`/payroll/increments/${id}/approve`);
      else await api.put(`/payroll/increments/${id}/reject`, { reason });
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Action failed'); }
    finally { setActingId(null); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Payroll · Increments & Arrears</h1>
          <p className="text-[15px] text-slate-500 mt-1">Propose and approve salary raises. Approval scales every salary component proportionally.</p>
        </div>
        <button onClick={() => setProposing(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold">
          <Plus size={14} /> Propose Increment
        </button>
      </div>

      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-0.5 w-fit">
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1 text-[13px] font-semibold rounded transition-colors capitalize ${status === s ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <TrendingUp size={32} className="mx-auto text-slate-300 mb-2" />
            No {status} increments.
          </div>
        ) : rows.map(r => (
          <div key={r.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">{r.employee.firstName} {r.employee.lastName}</p>
              <p className="text-[13px] text-slate-500">
                {fmtINR(r.currentGross)} → <span className={`font-bold ${Number(r.proposedGross) < Number(r.currentGross) ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtINR(r.proposedGross)}</span>/mo
                <span className="text-slate-400"> · effective {new Date(r.effectiveDate).toLocaleDateString('en-GB')}</span>
              </p>
              {r.arrearsJson?.totalArrears > 0 && (
                <p className="text-[13px] text-blue-700 mt-0.5">Arrears: {fmtINR(r.arrearsJson.totalArrears)} across {r.arrearsJson.affectedMonths.length} month(s){r.arrearsPaid ? ' — consumed' : ' — pending consumption at next lock'}</p>
              )}
              {r.rejectionReason && <p className="text-[13px] text-rose-600 mt-0.5">Reason: {r.rejectionReason}</p>}
            </div>
            {status === 'pending' && (
              r.proposedBy?._id && String(r.proposedBy._id) === String(user?._id) ? (
                <span className="text-[13px] text-slate-400 italic" title="You proposed this — another admin must approve or reject it">
                  Awaiting another admin
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => act(r.id, 'reject')} disabled={actingId === r.id} className="flex items-center gap-1.5 border border-rose-300 text-rose-700 hover:bg-rose-50 text-[14px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
                    <XCircle size={13} /> Reject
                  </button>
                  <button onClick={() => act(r.id, 'approve')} disabled={actingId === r.id} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
                    <CheckCircle2 size={13} /> Approve
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {proposing && <ProposeModal onClose={() => setProposing(false)} onSaved={load} />}
    </div>
  );
}
