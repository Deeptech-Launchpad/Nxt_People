/**
 * Admin → Tax Declaration Approvals
 * Reviews submitted declarations for the current FY. Each row expands
 * to show the line items; approve or reject (with reason) inline.
 */
import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ChevronDown, FileText, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR, currentFY } from './_shared';

export default function DeclarationApprovals() {
  const [fy, setFy] = useState(currentFY());
  const [status, setStatus] = useState('submitted');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/payroll/admin/declarations?status=${status}&fy=${fy}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status, fy]);

  const act = async (id, action) => {
    let reason = null;
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (visible to employee):', '');
      if (reason === null) return;  // cancelled
    }
    try {
      await api.put(`/payroll/admin/declarations/${id}/action`, { action, reason });
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Action failed'); }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Tax Declaration Approvals</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Employee tax declarations for {fy}. Approve to feed TDS computation; reject with a note to send back for revision.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-0.5">
            {['submitted', 'approved', 'rejected'].map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-2.5 py-1 text-[11.5px] font-semibold rounded transition-colors capitalize ${
                  status === s ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}>{s}</button>
            ))}
          </div>
          <select value={fy} onChange={e => setFy(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[13px] font-semibold bg-white">
            <option value={currentFY()}>{currentFY()}</option>
            <option value="2025-26">2025-26</option>
            <option value="2024-25">2024-25</option>
          </select>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <FileText size={32} className="mx-auto text-slate-300 mb-2" />
            No {status} declarations for {fy}.
          </div>
        ) : rows.map(d => {
          const total = Number(d.hraAnnualRent || 0) + Number(d.section80c || 0) + Number(d.section80d || 0)
                      + Number(d.section80e || 0) + Number(d.homeLoanInterest || 0) + Number(d.otherDeductions || 0);
          const isOpen = expanded === d.id;
          return (
            <div key={d.id}>
              <button onClick={() => setExpanded(isOpen ? null : d.id)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[13px]">
                    {(d.firstName?.[0] || '?') + (d.lastName?.[0] || '')}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{d.firstName} {d.lastName}</p>
                    <p className="text-[11.5px] text-slate-400">
                      <span className="font-mono">{d.employeeCode}</span> · {d.designation || '—'} · Regime: <strong>{d.regime}</strong>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Total claimed</p>
                    <p className="text-[14px] font-bold text-blue-700">{fmtINR(total)}</p>
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="bg-slate-50 px-4 py-4 border-t border-slate-100">
                  {d.regime === 'new' ? (
                    <p className="text-[12.5px] text-slate-600 italic">Employee chose the new regime — no exemptions to declare.</p>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-2 text-[12.5px]">
                      <Row k="HRA — Annual rent"      v={d.hraAnnualRent} />
                      <Row k="Section 80C"            v={d.section80c} />
                      <Row k="Section 80D"            v={d.section80d} />
                      <Row k="Section 80E"            v={d.section80e} />
                      <Row k="Home loan interest"     v={d.homeLoanInterest} />
                      <Row k="Other deductions"       v={d.otherDeductions} />
                    </div>
                  )}
                  {status === 'submitted' && (
                    <div className="flex items-center justify-end gap-2 mt-3">
                      <button onClick={() => act(d.id, 'reject')} className="flex items-center gap-1.5 border border-rose-300 text-rose-700 hover:bg-rose-50 text-[12px] font-semibold px-3 py-1.5 rounded-lg">
                        <XCircle size={13} /> Reject
                      </button>
                      <button onClick={() => act(d.id, 'approve')} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg">
                        <CheckCircle2 size={13} /> Approve
                      </button>
                    </div>
                  )}
                  {status === 'rejected' && d.rejectionReason && (
                    <p className="text-[11.5px] text-rose-700 mt-3">Rejection note: {d.rejectionReason}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="bg-white rounded px-3 py-2 flex items-center justify-between">
      <span className="text-slate-500">{k}</span>
      <span className="font-semibold text-slate-800">{fmtINR(v)}</span>
    </div>
  );
}
