import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid'];
const COLORS = { casual: 'from-blue-400 to-blue-600', sick: 'from-red-400 to-red-600', earned: 'from-emerald-400 to-emerald-600', unpaid: 'from-slate-400 to-slate-600' };

export default function LeaveBalance() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/employees/${user._id}`).then(r => {
      const e = r.data.data;
      setBalance({ casual: e?.casualLeave, sick: e?.sickLeave, earned: e?.earnedLeave, unpaid: e?.unpaidLeave });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user._id]);

  if (loading) return <div className="p-6 flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-[15px] font-bold text-slate-800 mb-5">Leave Balance</h2>
      <div className="grid grid-cols-2 gap-4">
        {LEAVE_TYPES.map(t => {
          const val = balance?.[t];
          const isUnlimited = val === 999;
          return (
            <div key={t} className={`rounded-xl p-6 bg-gradient-to-br ${COLORS[t]} text-white shadow-lg`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-3">{t} Leave</p>
              <p className="text-[40px] font-bold leading-none">{isUnlimited ? '∞' : (val ?? '—')}</p>
              <p className="text-[13px] opacity-80 mt-2">days remaining</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
