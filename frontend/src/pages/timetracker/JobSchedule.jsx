import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BackButton from '../../components/BackButton';

const HOURS = Array.from({length: 9}, (_, i) => i + 9); // 9 AM – 5 PM
const DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function JobSchedule() {
  const [view, setView] = useState('week');

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <BackButton to="/time-tracker" label="Time Tracker" />
      <div className="flex items-center gap-3">
        <button disabled title="Not available yet" className="w-7 h-7 border border-slate-200 rounded flex items-center justify-center text-slate-300 cursor-not-allowed"><ChevronLeft size={14}/></button>
        <span className="text-[15px] font-semibold text-slate-700">This Week</span>
        <button disabled title="Not available yet" className="w-7 h-7 border border-slate-200 rounded flex items-center justify-center text-slate-300 cursor-not-allowed"><ChevronRight size={14}/></button>
        <div className="ml-auto flex border border-slate-200 rounded-md overflow-hidden">
          {['day','week'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-[14px] font-medium transition-colors capitalize ${view===v ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {v}
            </button>
          ))}
        </div>
        <button disabled title="Not available yet" className="bg-slate-200 text-slate-400 text-[14px] font-semibold px-3.5 py-1.5 rounded-md cursor-not-allowed">
          Publish
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-auto">
        {view === 'week' ? (
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-[13px] font-semibold text-slate-500 text-left w-16">Time</th>
              {DAYS.map(d => <th key={d} className="px-4 py-3 text-[13px] font-semibold text-slate-500 text-center">{d}</th>)}
            </tr></thead>
            <tbody>
              {HOURS.map(h => (
                <tr key={h} className="border-t border-slate-100 h-12">
                  <td className="px-4 text-[13px] text-slate-400 align-top pt-2">{h}:00</td>
                  {DAYS.map(d => <td key={d} className="border-l border-slate-100 relative hover:bg-blue-50/20 transition-colors cursor-pointer"/>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col items-center py-20 text-center text-slate-400">
            <p className="text-[15px]">Day view — no jobs scheduled</p>
          </div>
        )}
      </div>
    </div>
  );
}
