import React, { useState, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import BackButton from '../../components/BackButton';

function weekStart(offset = 0) {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function TimeLogs() {
  const [week, setWeek] = useState(0);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], project: '', task: '', hours: '', description: '' });
  const [saving, setSaving] = useState(false);

  const ws = weekStart(week);
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  const weekLabel = `${ws.toLocaleDateString('en-IN', {day:'2-digit',month:'short'})} – ${we.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}`;

  useEffect(() => {
    setLoading(true);
    api.get('/timesheets/my').then(r => setLogs(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [week]);

  const handleAdd = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/timesheets', { weekStartDate: ws, weekEndDate: we, entries: [form], status: 'draft' });
      toast.success('Time log added!');
      setForm({ date: new Date().toISOString().split('T')[0], project: '', task: '', hours: '', description: '' });
      setLoading(true);
      api.get('/timesheets/my').then(r => setLogs(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
    } catch { toast.error('Failed to add log'); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <BackButton to="/time-tracker" label="Time Tracker" />
      {/* Week nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => setWeek(w => w - 1)} className="w-7 h-7 border border-slate-200 rounded hover:bg-slate-50 flex items-center justify-center text-slate-500">
          <ChevronLeft size={14}/>
        </button>
        <span className="text-[15px] font-semibold text-slate-700">{weekLabel}</span>
        <button onClick={() => setWeek(w => w + 1)} className="w-7 h-7 border border-slate-200 rounded hover:bg-slate-50 flex items-center justify-center text-slate-500">
          <ChevronRight size={14}/>
        </button>
        <button onClick={() => setWeek(0)} className="text-[14px] text-blue-600 hover:underline ml-1">Today</button>
      </div>

      {/* Add log form */}
      <form onSubmit={handleAdd} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        <p className="text-[15px] font-semibold text-slate-700 mb-3">Add Time Log</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
          <input placeholder="Project" value={form.project} onChange={e => setForm({...form, project: e.target.value})}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
          <input placeholder="Task" value={form.task} onChange={e => setForm({...form, task: e.target.value})}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
          <input type="number" placeholder="Hours" min="0" max="24" step="0.5" value={form.hours} onChange={e => setForm({...form, hours: e.target.value})}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
          <button type="submit" disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-[14px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
            <Plus size={13}/> Add
          </button>
        </div>
      </form>

      {/* Logs table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {['Date','Project','Task','Hours','Description'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={5} className="py-12 text-center"><div className="w-5 h-5 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"/></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-[15px] text-slate-400">No time logs for this week</td></tr>
            ) : logs.flatMap(ts => ts.entries || []).map((e, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-[14px] text-slate-600">{new Date(e.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</td>
                <td className="px-4 py-3 text-[14px] font-medium text-slate-700">{e.project}</td>
                <td className="px-4 py-3 text-[14px] text-slate-600">{e.task}</td>
                <td className="px-4 py-3 text-[14px] font-bold text-blue-600">{e.hours}h</td>
                <td className="px-4 py-3 text-[14px] text-slate-400">{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
