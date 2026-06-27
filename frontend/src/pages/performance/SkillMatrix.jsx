import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const SKILLS = ['JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Python', 'Communication', 'Leadership'];
const LEVELS = ['', 'Beginner', 'Intermediate', 'Expert'];
const LEVEL_COLOR = { '': 'bg-slate-100', Beginner: 'bg-yellow-100 text-yellow-700', Intermediate: 'bg-blue-100 text-blue-700', Expert: 'bg-emerald-100 text-emerald-700' };

export default function SkillMatrix() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/employees?limit=30&status=active')
      .then(r => setEmployees(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="p-6 max-w-6xl">
      <h2 className="text-[15px] font-bold text-slate-800 mb-5">Skill Set Matrix</h2>
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-600 uppercase w-48 sticky left-0 bg-slate-50">Employee</th>
              {SKILLS.map(s => <th key={s} className="px-4 py-3 text-[11px] font-semibold text-slate-500 text-center min-w-[110px]">{s}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {employees.map(e => (
              <tr key={e._id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 sticky left-0 bg-white">
                  <div className="flex items-center gap-2.5">
                    <img src={`https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName}&size=28&background=e0e7ff&color=4f46e5`}
                      className="w-7 h-7 rounded-full flex-shrink-0" alt={e.firstName}/>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
                      <p className="text-[10.5px] text-slate-400 truncate">{e.designation || '—'}</p>
                    </div>
                  </div>
                </td>
                {SKILLS.map(s => {
                  const level = LEVELS[Math.floor(Math.random() * 4)];
                  return (
                    <td key={s} className="px-4 py-3 text-center">
                      {level && <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${LEVEL_COLOR[level]}`}>{level}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">* Skill levels shown are for demonstration. Actual skill data requires employee self-assessment.</p>
    </div>
  );
}
