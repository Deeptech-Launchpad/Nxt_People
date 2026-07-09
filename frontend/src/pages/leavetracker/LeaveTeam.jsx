import React, { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import api from '../../utils/api';

export default function LeaveTeam() {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/leaves/team-pending').then(r => setLeaves(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'long' });

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-slate-700">Team Leave Overview</h3>
          <span className="text-[13px] text-slate-500">{today}</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-5 h-5 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>
        ) : leaves.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Calendar size={32} className="text-slate-200 mb-3"/>
            <p className="text-[15px] font-semibold text-slate-500">No pending team leave requests</p>
          </div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-slate-100">
              {['Employee','Type','From','To','Days','Status'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {leaves.map(l => (
                <tr key={l._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-[14px] font-medium text-slate-800">
                    {l.employee?.firstName} {l.employee?.lastName}
                  </td>
                  <td className="px-5 py-3 text-[14px] text-slate-600 capitalize">{l.leaveType}</td>
                  <td className="px-5 py-3 text-[14px] text-slate-600">{new Date(l.startDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</td>
                  <td className="px-5 py-3 text-[14px] text-slate-600">{new Date(l.endDate + 'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</td>
                  <td className="px-5 py-3 text-[14px] font-bold text-slate-700">{l.totalDays}</td>
                  <td className="px-5 py-3">
                    <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">{l.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
