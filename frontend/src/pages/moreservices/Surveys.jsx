import React, { useState } from 'react';
import { ClipboardList } from 'lucide-react';

const TABS = ['All', 'Pending', 'Completed', 'Expired', 'Opted Out'];
const SAMPLE = [
  { id: 1, title: 'Employee Satisfaction Survey Q2 2026', questions: 10, deadline: '2026-05-31', status: 'pending' },
  { id: 2, title: 'Onboarding Feedback',                  questions: 5,  deadline: '2026-04-30', status: 'completed' },
  { id: 3, title: 'Work Culture Assessment',              questions: 8,  deadline: '2026-03-31', status: 'expired' },
];
const STATUS_COLOR = {
  pending:   'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  expired:   'bg-red-100 text-red-600',
  opted_out: 'bg-slate-100 text-slate-500',
};

export default function Surveys() {
  const [tab, setTab] = useState('All');
  const filtered = tab === 'All' ? SAMPLE : SAMPLE.filter(s => s.status.toLowerCase() === tab.toLowerCase().replace(' ', '_'));

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <h2 className="text-[17px] font-bold text-slate-800">Employee Engagement — Surveys</h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[14px] font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-12 text-center shadow-sm">
            <ClipboardList size={32} className="text-slate-200 mx-auto mb-3"/>
            <p className="text-[15px] font-semibold text-slate-500">No surveys in this category</p>
          </div>
        ) : filtered.map(s => (
          <div key={s.id} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
              <ClipboardList size={18} className="text-purple-500"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-slate-800">{s.title}</p>
              <p className="text-[13px] text-slate-400 mt-0.5">{s.questions} questions · Deadline: {s.deadline}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[s.status]}`}>{s.status}</span>
              {s.status === 'pending' && (
                <button className="bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-3 py-1 rounded-md transition-colors">
                  Start Survey
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
