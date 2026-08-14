import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

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

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthLabel = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// On Duty is work done away from the usual place of work — a client visit, or
// a day worked from home. It is not leave: the day is payable and counts as
// worked, which is why every attendance report has an On Duty column.
export default function OnDuty() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

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
            onClick={() => setFormOpen(true)}
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
                  <th className="text-left px-4 py-2.5 border-r border-slate-200">Period</th>
                  <th className="text-left px-4 py-2.5 border-r border-slate-200">Units</th>
                  <th className="text-left px-4 py-2.5 border-r border-slate-200">Type</th>
                  <th className="text-left px-4 py-2.5 border-r border-slate-200">Reason</th>
                  <th className="text-left px-4 py-2.5 border-r border-slate-200">Status</th>
                  <th className="text-left px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r._id} className="border-b border-slate-200">
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-200">
                      {r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} - ${fmt(r.endDate)}`}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-200">
                      {r.unit === 'hours' ? `${r.startTime?.slice(0, 5)} - ${r.endTime?.slice(0, 5)}` : 'Days'}
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

      {formOpen && <RequestForm onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} />}
    </div>
  );
}

function RequestForm({ onClose, onSaved }) {
  const [startDate, setStartDate] = useState(todayCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [unit, setUnit] = useState('days');
  const [requestType, setRequestType] = useState('client_visit');
  const [startTime, setStartTime] = useState('09:30');
  const [endTime, setEndTime] = useState('13:30');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post('/on-duty', {
        startDate,
        // An hours request is a slice of one day, so the end follows the start.
        endDate: unit === 'hours' ? startDate : endDate,
        unit, requestType, reason: reason.trim() || null,
        ...(unit === 'hours' ? { startTime, endTime } : {}),
      });
      toast.success('On duty request submitted');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit request');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[17px] font-semibold text-slate-800">Request On Duty</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Period</label>
            <div className="flex items-center gap-3">
              <input
                type="date" value={startDate}
                onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"
              />
              <input
                type="date" value={unit === 'hours' ? startDate : endDate} min={startDate}
                disabled={unit === 'hours'}
                onChange={e => setEndDate(e.target.value)}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Units</label>
            <select
              value={unit} onChange={e => setUnit(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-blue-400"
            >
              <option value="days">Days</option>
              <option value="hours">Hours</option>
            </select>
          </div>

          {unit === 'hours' && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">From</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400" />
              </div>
              <div className="flex-1">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">To</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Type</label>
            <select
              value={requestType} onChange={e => setRequestType(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-blue-400"
            >
              {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Reason</label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
              placeholder="Where you'll be and why"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={submit} disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium transition-colors"
          >
            {saving ? 'Submitting…' : 'Submit'}
          </button>
          <button onClick={onClose} className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
