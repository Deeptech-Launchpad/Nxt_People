import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { DollarSign, Clock, CheckCircle, XCircle } from 'lucide-react';

export default function LeaveEncashment() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(null);
  const [form, setForm] = useState({ leaveType: 'casual', days: '', reason: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
    api.get('/leaves/balance')
      .then(r => {
        const balMap = {};
        (r.data.data || []).forEach(c => { balMap[c.code] = c.available; });
        setBalance(balMap);
      })
      .catch(() => {});
  }, []);

  const loadData = async () => {
    try {
      const r = await api.get('/encashments/my');
      setData(r.data.data);
    } catch (e) {
      toast.error('Failed to load encashments');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/encashments', form);
      toast.success('Encashment requested successfully');
      setForm({ leaveType: 'casual', days: '', reason: '' });
      loadData();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-2"><DollarSign className="text-brand-500" /> Leave Encashment</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-fit">
          <h3 className="font-semibold mb-4 text-slate-800">Request Encashment</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-600">Leave Type</label>
              <select value={form.leaveType} onChange={e=>setForm({...form, leaveType: e.target.value})} className="w-full mt-1 p-2 border rounded-lg text-base">
                <option value="casual">Casual Leave</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Number of Days</label>
              <input type="number" min="1" required value={form.days} onChange={e=>setForm({...form, days: e.target.value})} className="w-full mt-1 p-2 border rounded-lg text-base" />
              {balance && (
                <p className="text-sm text-slate-500 mt-1">
                  Available: <span className="font-semibold text-brand-600">{balance[form.leaveType] ?? 0} day(s)</span>
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Reason</label>
              <textarea required value={form.reason} onChange={e=>setForm({...form, reason: e.target.value})} className="w-full mt-1 p-2 border rounded-lg text-base" rows="3"></textarea>
            </div>
            <button type="submit" disabled={saving} className="w-full bg-brand-600 text-white py-2 rounded-lg font-medium hover:bg-brand-500 transition disabled:opacity-60">{saving ? 'Submitting...' : 'Submit Request'}</button>
          </form>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="font-semibold text-slate-800">My Requests</h3>
          {loading ? <p>Loading...</p> : data.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800 capitalize">{item.leave_type} Leave - {item.days} days</p>
                <p className="text-base text-slate-500">{item.reason}</p>
                <p className="text-sm text-slate-400 mt-1">{new Date(item.created_at).toLocaleDateString()}</p>
              </div>
              <div>
                {item.status === 'pending' && <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1"><Clock size={12}/> Pending</span>}
                {item.status === 'approved' && <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1"><CheckCircle size={12}/> Approved</span>}
                {item.status === 'rejected' && <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1"><XCircle size={12}/> Rejected</span>}
              </div>
            </div>
          ))}
          {!loading && data.length === 0 && <p className="text-slate-500 text-base py-4 text-center border rounded-xl border-dashed">No requests found</p>}
        </div>
      </div>
    </div>
  );
}
