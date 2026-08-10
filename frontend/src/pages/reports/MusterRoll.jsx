import React, { useState, useEffect } from 'react';
import { Filter } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

const CODE_STYLE = {
  P: 'bg-emerald-100 text-emerald-700',
  HD: 'bg-blue-100 text-blue-700',
  A: 'bg-red-100 text-red-700',
  L: 'bg-purple-100 text-purple-700',
  WO: 'bg-slate-100 text-slate-500',
  H: 'bg-amber-100 text-amber-700',
  '-': 'text-slate-300',
};

const now = new Date();

export default function MusterRoll() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/reports/attendance/muster-roll?month=${month}&year=${year}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Month</label>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Year</label>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
          {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
      <div className="flex items-center gap-3 text-[12px] text-slate-500 ml-auto flex-wrap">
        {Object.entries({ P: 'Present', HD: 'Half-day', A: 'Absent', L: 'Leave', WO: 'Weekly Off', H: 'Holiday' }).map(([code, label]) => (
          <span key={code} className="flex items-center gap-1"><span className={`px-1.5 py-0.5 rounded font-semibold ${CODE_STYLE[code]}`}>{code}</span>{label}</span>
        ))}
      </div>
    </>
  );

  return (
    <ReportShell title="Muster Roll" subtitle="Day-by-day attendance grid for the selected month" filters={filters} loading={loading}>
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this month</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-10 whitespace-nowrap">Employee</th>
                {Array.from({ length: data.daysInMonth }, (_, i) => i + 1).map(d => (
                  <th key={d} className="px-2 py-2.5 text-center w-9">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.data.map(emp => (
                <tr key={emp._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 sticky left-0 bg-white whitespace-nowrap">
                    <p className="font-medium text-slate-700">{emp.firstName} {emp.lastName}</p>
                    <p className="text-[11px] text-slate-400">{emp.department || '—'}</p>
                  </td>
                  {emp.days.map((code, i) => (
                    <td key={i} className="px-1 py-2 text-center">
                      <span className={`inline-block w-7 rounded text-[11px] font-semibold py-0.5 ${CODE_STYLE[code] || ''}`}>{code}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
