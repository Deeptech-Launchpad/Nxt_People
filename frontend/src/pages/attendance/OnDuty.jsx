import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import useSortable from '../../components/table/useSortable';
import SortableTh from '../../components/table/SortableTh';
import { useLocaleFormat, formatTime } from '../../utils/datetime';
import OnDutyModal from '../../components/requests/OnDutyModal';

const TYPES = [
  { key: 'client_visit', label: 'Client visit' },
  { key: 'work_from_home', label: 'Work from home' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.key, t.label]));

// The reference filters by request state, defaulting to what you have sent in
// rather than to everything.
const STATUSES = [
  { key: 'pending', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

const monthLabel = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// On Duty is work done away from the usual place of work — a client visit, or
// a day worked from home. It is not leave: the day is payable and counts as
// worked, which is why every attendance report has an On Duty column.
export default function OnDuty() {
  const { timeFormat } = useLocaleFormat();
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  /* Arriving from Add Request on My Attendance: open the form on the day that
     was pressed. Cleared afterwards so a refresh does not reopen it. */
  useEffect(() => {
    if (!location.state?.openNew) return;
    setFormDate(location.state.date || null);
    setFormOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]);

  const range = (() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return { from: start.toLocaleDateString('en-CA'), to: end.toLocaleDateString('en-CA') };
  })();

  const load = () => {
    setLoading(true);
    api.get(`/on-duty/my?status=${status}&from=${range.from}&to=${range.to}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load on-duty requests'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [status, range.from, range.to]);

  const withdraw = async (id) => {
    try {
      await api.delete(`/on-duty/${id}`);
      toast.success('Request withdrawn');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not withdraw'); }
  };

  const sort = useSortable(rows, {
    id: 'on-duty-my',
    columns: {
      period: { get: r => (r.startDate ? String(r.startDate).slice(0, 10) : null), type: 'date' },
      unit: { get: r => (r.unit === 'hours' ? `Hours ${r.startTime || ''}` : 'Days'), type: 'text' },
      requestType: { get: r => TYPE_LABEL[r.requestType] || r.requestType, type: 'text' },
      reason: { get: r => r.reason, type: 'text' },
      status: { get: r => (r.status === 'pending' ? 'Submitted' : r.status), type: 'text' },
    },
  });

  const stepMonth = n => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="w-full max-w-full min-w-0 px-4 space-y-4 pb-4">
      <div className="flex items-center gap-3 pt-5">
        <div>
          <h1 className="text-[17px] font-semibold text-slate-800">On Duty</h1>
          <p className="text-sm text-slate-500">Work done away from your usual place of work</p>
        </div>

        <div className="flex-1 flex justify-center min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={() => stepMonth(-1)} aria-label="Previous month" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-[14px] text-slate-700 whitespace-nowrap">{monthLabel(month)}</span>
            <button onClick={() => stepMonth(1)} aria-label="Next month" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={status} onChange={e => setStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-blue-400"
          >
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button
            onClick={() => { setFormDate(null); setFormOpen(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors"
          >
            <Plus size={15} /> Add Request
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-slate-400">No on duty requests have been raised currently</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px] border-collapse">
              <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
                <tr className="border-b border-slate-200">
                  <SortableTh sort={sort} k="period" className="text-left px-4 py-2.5 border-r border-slate-200">Period</SortableTh>
                  <SortableTh sort={sort} k="unit" className="text-left px-4 py-2.5 border-r border-slate-200">Units</SortableTh>
                  <SortableTh sort={sort} k="requestType" className="text-left px-4 py-2.5 border-r border-slate-200">Type</SortableTh>
                  <SortableTh sort={sort} k="reason" className="text-left px-4 py-2.5 border-r border-slate-200">Reason</SortableTh>
                  <SortableTh sort={sort} k="status" className="text-left px-4 py-2.5 border-r border-slate-200">Status</SortableTh>
                  <th className="text-left px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map(r => (
                  <tr key={r._id} className="border-b border-slate-200">
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-200">
                      {r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} - ${fmt(r.endDate)}`}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-200">
                      {r.unit === 'hours' ? `${formatTime(r.startTime, timeFormat)} - ${formatTime(r.endTime, timeFormat)}` : 'Days'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-200">{TYPE_LABEL[r.requestType] || r.requestType}</td>
                    <td className="px-4 py-2.5 max-w-xs truncate border-r border-slate-200" title={r.reason || ''}>{r.reason || '—'}</td>
                    <td className="px-4 py-2.5 border-r border-slate-200">
                      <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.status === 'pending' ? 'Submitted' : r.status}
                      </span>
                      {r.status === 'rejected' && r.rejectionReason && (
                        <span className="ml-2 text-[12px] text-slate-500">{r.rejectionReason}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'pending' && (
                        <button onClick={() => withdraw(r._id)} title="Withdraw request" className="text-slate-400 hover:text-rose-600 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[13px] text-slate-500">Total Record Count : <span className="text-blue-600 font-medium">{rows.length}</span></p>

      {formOpen && (
        <OnDutyModal date={formDate}
          onClose={() => setFormOpen(false)}
          onDone={() => { setFormOpen(false); load(); }} />
      )}
    </div>
  );
}
