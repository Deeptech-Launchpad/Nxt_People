import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, CheckCircle, XCircle, Clock, AlertTriangle, Eye } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import BackButton from '../../components/BackButton';
import { isApprover } from '../../utils/roles';
import LeaveDetailModal from '../../components/LeaveDetailModal';
import { useFormat } from '../../utils/datetime';
import RegularizeModal from '../../components/requests/RegularizeModal';

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function Regularization() {
  const { user } = useAuth();
  const fmt = useFormat();
  const location = useLocation();
  const navigate = useNavigate();
  const [myRequests, setMyRequests] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [actionLoading, setActionLoading] = useState('');
  const [detailReq, setDetailReq] = useState(null);  // request shown in the detail/timeline modal
  const [tab, setTab] = useState(user?.role === 'team_member' ? 'my' : 'pending');

  const load = () => {
    setLoading(true);
    const calls = [api.get('/regularizations/my')];
    if (isApprover(user)) calls.push(api.get('/regularizations/pending'));
    Promise.all(calls).then(([myRes, pendingRes]) => {
      setMyRequests(myRes.data.data || []);
      if (pendingRes) setPending(pendingRes.data.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { if (user !== undefined) load(); }, [user?.role]);
  useEffect(() => { if (user?.role === 'team_member') setTab('my'); }, [user?.role]);

  /* Arriving from Add Request on My Attendance. An approver opens this screen
     on Team Pending, which is not where a request you are filing belongs: land
     on your own requests, open the form, and start it on the day that was
     pressed rather than on today. The date stays editable. The state is
     cleared so a refresh does not open the form again. */
  useEffect(() => {
    if (!location.state?.openNew) return;
    const { date } = location.state;
    setTab('my');
    if (date) setFormDate(date);
    setModal(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]);

  const handleAction = async (id, action, reason) => {
    setActionLoading(id);
    try {
      await api.put(`/regularizations/${id}/action`, { action, rejectionReason: reason });
      toast.success(`Request ${action}`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/attendance" label="Attendance" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Attendance Regularization</h3>
            <p className="text-slate-400 text-base mt-0.5">Request correction for missed check-in or check-out</p>
          </div>
          <button onClick={() => {
            setFormDate(new Date().toLocaleDateString('en-CA'));
            setModal(true);
          }} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> New Request
          </button>
        </div>

        {isApprover(user) && (
          <div className="flex border-b border-slate-100">
            {[['my', 'My Requests'], ['pending', `Team Pending (${pending.length})`]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-6 py-3.5 text-base font-medium border-b-2 transition-colors ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="divide-y divide-slate-50">
            {(tab === 'my' ? myRequests : pending).length === 0 ? (
              <div className="text-center py-16"><AlertTriangle size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No requests found</p></div>
            ) : (tab === 'my' ? myRequests : pending).map(r => (
              <div key={r._id} className="p-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 flex-shrink-0">
                    <Clock size={18} />
                  </div>
                  <div>
                    {tab === 'pending' && <p className="font-semibold text-slate-700">{r.employee?.firstName} {r.employee?.lastName} <span className="text-sm text-slate-400">({r.employee?.employeeId})</span></p>}
                    <p className="font-medium text-slate-700 text-base">{new Date(String(r.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {r.checkIn ? `Check-in: ${fmt.time(r.checkIn)}` : 'No check-in specified'}
                      {r.checkOut ? ` · Check-out: ${fmt.time(r.checkOut)}` : ''}
                    </p>
                    <p className="text-sm text-slate-400 mt-0.5 max-w-sm truncate">Reason: {r.reason}</p>
                    {r.rejectionReason && <p className="text-sm text-red-500 mt-0.5">Rejected: {r.rejectionReason}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-sm px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  <button onClick={() => setDetailReq(r)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors">
                    <Eye size={13} /> View
                  </button>
                  {tab === 'pending' && r.status === 'pending' && r.canAct && r.employee?._id !== user?._id && (
                    <>
                      <button onClick={() => { if (confirm('Approve this attendance correction?')) handleAction(r._id, 'approved'); }} disabled={!!actionLoading}
                        className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                        <CheckCircle size={13} /> Approve
                      </button>
                      <button onClick={() => { if (confirm('Reject this attendance correction?')) handleAction(r._id, 'rejected'); }} disabled={!!actionLoading}
                        className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                        <XCircle size={13} /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The one regularization form in the product — the same dialog Home and
          My Attendance open, so a request looks the same wherever it is raised. */}
      {modal && (
        <RegularizeModal
          date={formDate}
          onClose={() => setModal(false)}
          onDone={() => { setModal(false); load(); }}
        />
      )}

      {/* Request details + approval timeline modal */}
      {detailReq && (
        <LeaveDetailModal
          leave={detailReq}
          kind="regularization"
          onClose={() => setDetailReq(null)}
          canAct={tab === 'pending' && detailReq.status === 'pending' && !!detailReq.canAct && detailReq.employee?._id !== user?._id}
          defaultView={tab === 'my' ? 'timeline' : 'details'}
          onApprove={(x, comment) => { if (confirm('Approve this attendance correction?')) { setDetailReq(null); handleAction(x._id, 'approved', comment); } }}
          onReject={(x, comment) => { if (confirm('Reject this attendance correction?')) { setDetailReq(null); handleAction(x._id, 'rejected', comment); } }}
        />
      )}
    </div>
  );
}
