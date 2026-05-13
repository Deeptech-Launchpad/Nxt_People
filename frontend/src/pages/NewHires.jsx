import React, { useState, useEffect } from 'react';
import { UserPlus } from 'lucide-react';
import api from '../utils/api';

export default function NewHires() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/employees?limit=200&status=active')
      .then(r => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const data = (r.data.data || [])
          .filter(e => e.joiningDate && new Date(e.joiningDate) >= cutoff)
          .sort((a, b) => new Date(b.joiningDate) - new Date(a.joiningDate));
        setEmployees(data);
      }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
          <UserPlus size={16} className="text-emerald-500"/>
        </div>
        <h2 className="text-[15px] font-bold text-slate-800">New Hires (Last 30 days)</h2>
        <span className="ml-auto text-[12px] font-bold text-slate-500">{employees.length} joined</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-emerald-400 border-t-transparent rounded-full animate-spin"/></div>
      ) : employees.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center shadow-sm">
          <UserPlus size={36} className="text-slate-200 mx-auto mb-3"/>
          <p className="text-[13px] font-semibold text-slate-500">No new hires in the last 30 days</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {employees.map(e => (
            <div key={e._id} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all text-center">
              <img src={`https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName}&background=d1fae5&color=065f46&size=56`}
                className="w-14 h-14 rounded-full mx-auto mb-3 border-2 border-white shadow" alt={e.firstName}/>
              <p className="text-[12.5px] font-semibold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{e.designation || '—'}</p>
              <p className="text-[10.5px] text-slate-400 truncate">{e.department || '—'}</p>
              <span className="inline-block mt-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                Joined {new Date(e.joiningDate).toLocaleDateString('en-IN', {day:'2-digit', month:'short'})}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
