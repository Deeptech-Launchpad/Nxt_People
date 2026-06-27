import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const LEAVE_TYPES = ['casual', 'comp_off', 'unpaid'];
const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay'
};
const COLORS = { 
  casual: 'from-blue-400 to-blue-600', 
  comp_off: 'from-green-400 to-green-600',
  unpaid: 'from-slate-400 to-slate-600' 
};

export default function LeaveBalance() {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/leaves/balance').then(r => {
      const cards = r.data.data || [];
      const balMap = {};
      cards.forEach(c => {
        balMap[c.code] = c.available;
      });
      setBalance(balMap);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-[15px] font-bold text-slate-800 mb-5">Leave Balance</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {LEAVE_TYPES.map(t => {
          const val = balance?.[t];
          const isUnlimited = val === null && t === 'unpaid';
          return (
            <div key={t} className={`rounded-xl p-6 bg-gradient-to-br ${COLORS[t]} text-white shadow-lg`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-3">{LEAVE_TYPE_LABELS[t]}</p>
              <p className="text-[40px] font-bold leading-none">{isUnlimited ? '∞' : (val ?? '—')}</p>
              <p className="text-[13px] opacity-80 mt-2">days remaining</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
