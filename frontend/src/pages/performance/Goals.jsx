import React, { useState } from 'react';
import { Plus, Star, CheckCircle, Clock, Target } from 'lucide-react';

const SAMPLE = [
  { id: 1, title: 'Complete Q2 Performance Review', target: 'Submit by June 30', status: 'in_progress', rating: 0 },
  { id: 2, title: 'Improve code review turnaround', target: '< 24 hours avg', status: 'not_started', rating: 0 },
];

const STATUS_MAP = { in_progress: { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' }, completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700' }, not_started: { label: 'Not Started', cls: 'bg-slate-100 text-slate-600' } };

export default function PerformanceGoals() {
  const [goals]    = useState(SAMPLE);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', target: '' });

  const thisMonth = goals.filter(g => g.status !== 'completed').length;
  const lastMonth = 0;

  return (
    <div className="p-6 max-w-4xl space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'This Month', val: thisMonth, icon: Target,       color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: 'Last Month', val: lastMonth, icon: Clock,        color: 'text-slate-600',   bg: 'bg-slate-50' },
          { label: 'Completed',  val: goals.filter(g=>g.status==='completed').length, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        ].map(({ label, val, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}><Icon size={17} className={color}/></div>
            <p className={`text-[26px] font-bold ${color}`}>{val}</p>
            <p className="text-[12px] text-slate-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Goals list */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-[13px] font-bold text-slate-800">Goals</h3>
          <button onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
            <Plus size={13}/> Add Goal
          </button>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex gap-3">
            <input placeholder="Goal title…" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 bg-white"/>
            <input placeholder="Target / KPI…" value={form.target} onChange={e=>setForm({...form,target:e.target.value})}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 bg-white"/>
            <button className="bg-blue-600 text-white text-[12.5px] font-semibold px-3.5 py-2 rounded-md hover:bg-blue-700">Save</button>
          </div>
        )}

        <div className="divide-y divide-slate-50">
          {goals.map(g => (
            <div key={g.id} className="px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Target size={16} className="text-blue-500"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">{g.title}</p>
                {g.target && <p className="text-[11.5px] text-blue-600 mt-0.5">Target: {g.target}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_MAP[g.status]?.cls}`}>
                  {STATUS_MAP[g.status]?.label}
                </span>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(s => <Star key={s} size={13} className={s<=g.rating?'text-amber-400 fill-amber-400':'text-slate-200'}/>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
