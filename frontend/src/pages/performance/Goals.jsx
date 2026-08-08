import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Star, CheckCircle, Clock, Target, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_MAP = {
  not_started: { label: 'Not Started', cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-100 text-emerald-700' },
};
const STATUS_OPTIONS = Object.keys(STATUS_MAP);

export default function PerformanceGoals() {
  const [goals, setGoals]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ title: '', target: '' });
  const [busyId, setBusyId]     = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/performance/goals/my')
      .then(r => setGoals(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load goals'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleAdd = async () => {
    if (!form.title.trim()) return toast.error('Goal title is required');
    setSaving(true);
    try {
      await api.post('/performance/goals', form);
      toast.success('Goal added');
      setForm({ title: '', target: '' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id, status) => {
    setBusyId(id);
    try {
      await api.put(`/performance/goals/${id}`, { status });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setBusyId(null);
    }
  };

  const handleRating = async (id, rating) => {
    try {
      await api.put(`/performance/goals/${id}`, { rating });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to rate');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this goal?')) return;
    try {
      await api.delete(`/performance/goals/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const inProgress = goals.filter(g => g.status === 'in_progress').length;
  const notStarted = goals.filter(g => g.status === 'not_started').length;
  const completed  = goals.filter(g => g.status === 'completed').length;

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'In Progress', val: inProgress, icon: Target,       color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: 'Not Started', val: notStarted, icon: Clock,        color: 'text-slate-600',   bg: 'bg-slate-50' },
          { label: 'Completed',   val: completed,  icon: CheckCircle,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
        ].map(({ label, val, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}><Icon size={17} className={color}/></div>
            <p className={`text-[26px] font-bold ${color}`}>{val}</p>
            <p className="text-[14px] text-slate-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-[15px] font-bold text-slate-800">My Goals</h3>
          <button onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
            <Plus size={13}/> {showForm ? 'Close' : 'Add Goal'}
          </button>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex gap-3">
            <input placeholder="Goal title…" value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 bg-white"/>
            <input placeholder="Target / KPI…" value={form.target}
              onChange={e => setForm({ ...form, target: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 bg-white"/>
            <button onClick={handleAdd} disabled={saving}
              className="bg-blue-600 text-white text-[14px] font-semibold px-3.5 py-2 rounded-md hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        <div className="divide-y divide-slate-50">
          {loading ? (
            <div className="px-5 py-10 text-center text-[15px] text-slate-400">Loading…</div>
          ) : goals.length === 0 ? (
            <div className="px-5 py-10 text-center text-[15px] text-slate-400">No goals yet. Click "Add Goal" to set your first one.</div>
          ) : goals.map(g => (
            <div key={g._id} className="px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Target size={16} className="text-blue-500"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-slate-800">{g.title}</p>
                {g.target && <p className="text-[13px] text-blue-600 mt-0.5">Target: {g.target}</p>}
                {g.dueDate && (() => {
                  const overdue = g.status !== 'completed' && new Date(g.dueDate) < new Date();
                  return (
                    <p className={`text-[13px] mt-0.5 ${overdue ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                      Due: {new Date(g.dueDate).toLocaleDateString('en-IN')}{overdue && ' · Overdue'}
                    </p>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <select value={g.status}
                  onChange={e => handleStatus(g._id, e.target.value)}
                  disabled={busyId === g._id}
                  className={`text-[13px] font-semibold px-2 py-1 rounded-full border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${STATUS_MAP[g.status]?.cls || ''}`}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_MAP[s].label}</option>)}
                </select>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => handleRating(g._id, s)} title={`Rate ${s}/5`}>
                      <Star size={14} className={s <= (g.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-200 hover:text-amber-200'}/>
                    </button>
                  ))}
                </div>
                <button onClick={() => handleDelete(g._id)} title="Delete"
                  className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                  <Trash2 size={13}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
