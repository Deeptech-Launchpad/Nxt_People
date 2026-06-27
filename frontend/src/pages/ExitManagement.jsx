import React, { useState, useEffect } from 'react';
import { LogOut, CheckCircle, XCircle, Clock, Shield, AlertTriangle, X, Send, ChevronDown } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-emerald-100 text-emerald-700',
  withdrawn: 'bg-slate-100 text-slate-500',
};

const ClearanceItem = ({ label, checked, onChange, disabled }) => (
  <label className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'} ${disabled ? 'opacity-60 cursor-default' : ''}`}>
    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`}>
      {checked && <CheckCircle size={12} className="text-white" />}
    </div>
    <span className="text-base font-medium text-slate-700">{label}</span>
    {!disabled && <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="hidden" />}
  </label>
);

export default function ExitManagement() {
  const { user } = useAuth();
  const [myExit, setMyExit] = useState(null);
  const [allExits, setAllExits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [selectedExit, setSelectedExit] = useState(null);
  const [clearance, setClearance] = useState({});
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form, setForm] = useState({ resignationDate: '', lastWorkingDate: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = () => {
    setLoading(true);
    const calls = [api.get('/exit/my')];
    if (isFullAccess(user)) calls.push(api.get('/exit/all'));
    Promise.all(calls).then(([myRes, allRes]) => {
      setMyExit(myRes.data.data);
      if (allRes) setAllExits(allRes.data.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/exit', form);
      toast.success('Resignation submitted successfully');
      setModal(false); setForm({ resignationDate: '', lastWorkingDate: '', reason: '' }); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id, action, reason) => {
    setActionLoading(true);
    try {
      await api.put(`/exit/${id}/action`, { action, rejectionReason: reason });
      toast.success(`Resignation ${action}`);
      setRejectModal(null); setRejectReason(''); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const handleClearance = async (id) => {
    setActionLoading(true);
    try {
      await api.put(`/exit/${id}/clearance`, clearance);
      toast.success('Clearance updated');
      setSelectedExit(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const openClearance = (ex) => {
    setSelectedExit(ex);
    setClearance({ itClearance: ex.itClearance, hrClearance: ex.hrClearance, financeClearance: ex.financeClearance, managerClearance: ex.managerClearance, exitInterviewNotes: ex.exitInterviewNotes || '' });
  };

  return (
    <div className="space-y-5">
      {/* Employee's own exit status */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">My Exit Request</h3>
            <p className="text-slate-400 text-base mt-0.5">Submit your resignation and track clearance status</p>
          </div>
          {!myExit && (
            <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-red-400/25">
              <LogOut size={16} /> Submit Resignation
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : !myExit ? (
          <div className="text-center py-16">
            <LogOut size={32} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No active exit request</p>
            <p className="text-slate-300 text-base mt-1">Click "Submit Resignation" to begin the exit process</p>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-base text-slate-500">Resignation Date: <span className="font-medium text-slate-700">{new Date(myExit.resignationDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span></p>
                {myExit.lastWorkingDate && <p className="text-base text-slate-500 mt-0.5">Last Working Day: <span className="font-medium text-slate-700">{new Date(myExit.lastWorkingDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span></p>}
                <p className="text-base text-slate-500 mt-0.5">Reason: <span className="text-slate-600">{myExit.reason}</span></p>
              </div>
              <span className={`text-sm px-3 py-1.5 rounded-full font-semibold capitalize ${STATUS_STYLE[myExit.status]}`}>{myExit.status}</span>
            </div>
            {myExit.status === 'approved' && (
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2"><Shield size={12} /> Clearance Checklist</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[['IT', myExit.itClearance], ['HR', myExit.hrClearance], ['Finance', myExit.financeClearance], ['Manager', myExit.managerClearance]].map(([label, done]) => (
                    <div key={label} className={`flex items-center gap-2 p-3 rounded-xl border ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                      {done ? <CheckCircle size={16} className="text-emerald-500" /> : <Clock size={16} className="text-slate-300" />}
                      <span className={`text-base font-medium ${done ? 'text-emerald-700' : 'text-slate-500'}`}>{label}</span>
                    </div>
                  ))}
                </div>
                {myExit.exitInterviewNotes && (
                  <div className="mt-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <p className="text-sm font-semibold text-slate-500 mb-1">Exit Interview Notes</p>
                    <p className="text-base text-slate-600">{myExit.exitInterviewNotes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin view — all resignations */}
      {isFullAccess(user) && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h3 className="font-display font-semibold text-slate-800">All Resignations</h3>
            <p className="text-slate-400 text-base mt-0.5">{allExits.length} total exit request{allExits.length !== 1 ? 's' : ''}</p>
          </div>
          {allExits.length === 0 ? (
            <div className="text-center py-12 text-slate-300 text-base">No exit requests yet</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {allExits.map(ex => (
                <div key={ex._id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 flex-shrink-0">
                        <LogOut size={18} />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{ex.employee?.firstName} {ex.employee?.lastName}</p>
                        <p className="text-sm text-slate-400">{ex.employee?.designation} · {ex.employee?.department} · {ex.employee?.employeeId}</p>
                        <p className="text-base text-slate-500 mt-1">Resigned: {new Date(ex.resignationDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="text-sm text-slate-400 mt-0.5 max-w-sm">{ex.reason}</p>
                        {ex.status === 'approved' && (
                          <div className="flex gap-2 mt-2">
                            {[['IT', ex.itClearance], ['HR', ex.hrClearance], ['Finance', ex.financeClearance], ['Mgr', ex.managerClearance]].map(([l, d]) => (
                              <span key={l} className={`text-[12px] px-2 py-0.5 rounded-full font-medium ${d ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{l}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-col sm:flex-row">
                      <span className={`text-sm px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[ex.status]}`}>{ex.status}</span>
                      {ex.status === 'pending' && (
                        <>
                          <button onClick={() => handleAction(ex._id, 'approved')} disabled={actionLoading} className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                            <CheckCircle size={13} /> Accept
                          </button>
                          <button onClick={() => { setRejectModal(ex._id); setRejectReason(''); }} className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                            <XCircle size={13} /> Reject
                          </button>
                        </>
                      )}
                      {ex.status === 'approved' && (
                        <button onClick={() => openClearance(ex)} className="flex items-center gap-1.5 bg-brand-50 text-brand-600 hover:bg-brand-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                          <Shield size={13} /> Clearance
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submit resignation modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Submit Resignation</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 text-base text-amber-700">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>This action will initiate your exit process. Please confirm with HR before submitting.</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Resignation Date *</label>
                <input type="date" value={form.resignationDate} onChange={e => setForm({ ...form, resignationDate: e.target.value })} required
                  min={new Date().toLocaleDateString('en-CA')} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Proposed Last Working Day</label>
                <input type="date" value={form.lastWorkingDate} onChange={e => setForm({ ...form, lastWorkingDate: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Reason *</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={4}
                  placeholder="Please state your reason for resignation..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <Send size={14} />{saving ? 'Submitting...' : 'Submit Resignation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 mb-4">Reject Resignation</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Reason for rejection..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleAction(rejectModal, 'rejected', rejectReason)} disabled={actionLoading}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Clearance modal */}
      {selectedExit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Clearance — {selectedExit.employee?.firstName} {selectedExit.employee?.lastName}</h3>
              <button onClick={() => setSelectedExit(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-3">
              <ClearanceItem label="IT Clearance (Device return, account deactivation)" checked={!!clearance.itClearance} onChange={v => setClearance(c => ({ ...c, itClearance: v }))} />
              <ClearanceItem label="HR Clearance (Documents, F&F settlement)" checked={!!clearance.hrClearance} onChange={v => setClearance(c => ({ ...c, hrClearance: v }))} />
              <ClearanceItem label="Finance Clearance (Expense reports, advances)" checked={!!clearance.financeClearance} onChange={v => setClearance(c => ({ ...c, financeClearance: v }))} />
              <ClearanceItem label="Manager Clearance (Knowledge transfer done)" checked={!!clearance.managerClearance} onChange={v => setClearance(c => ({ ...c, managerClearance: v }))} />
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Exit Interview Notes</label>
                <textarea value={clearance.exitInterviewNotes || ''} onChange={e => setClearance(c => ({ ...c, exitInterviewNotes: e.target.value }))} rows={3}
                  placeholder="Notes from exit interview..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setSelectedExit(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={() => handleClearance(selectedExit._id)} disabled={actionLoading}
                  className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <CheckCircle size={14} />{actionLoading ? 'Saving...' : 'Save Clearance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
