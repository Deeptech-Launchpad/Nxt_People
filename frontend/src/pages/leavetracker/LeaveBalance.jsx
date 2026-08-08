import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay',
  permission: 'Permission',
  sick: 'Sick Leave',
  earned: 'Earned Leave',
};
const COLORS = {
  casual: 'from-blue-400 to-blue-600',
  comp_off: 'from-green-400 to-green-600',
  unpaid: 'from-slate-400 to-slate-600',
  permission: 'from-purple-400 to-purple-600',
  sick: 'from-rose-400 to-rose-600',
  earned: 'from-teal-400 to-teal-600',
};
const DEFAULT_COLOR = 'from-slate-400 to-slate-600';

export default function LeaveBalance() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/leaves/balance').then(r => {
      setCards(r.data.data || []);
    }).catch(() => toast.error('Failed to load leave balance')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 flex justify-center py-20"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-[17px] font-bold text-slate-800 mb-5">Leave Balance</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(c => {
          const isUnlimited = c.available === null && c.code === 'unpaid';
          return (
            <div key={c.code} className={`rounded-xl p-6 bg-gradient-to-br ${COLORS[c.code] || DEFAULT_COLOR} text-white shadow-lg`}>
              <p className="text-[13px] font-semibold uppercase tracking-wider opacity-80 mb-3">{c.name || LEAVE_TYPE_LABELS[c.code] || c.code}</p>
              <p className="text-[40px] font-bold leading-none">{isUnlimited ? '∞' : (c.available ?? '—')}</p>
              <p className="text-[15px] opacity-80 mt-2">days remaining</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
