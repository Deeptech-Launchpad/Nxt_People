import React, { useState, useEffect } from 'react';
import { Wallet } from 'lucide-react';
import api from '../../utils/api';

// "💼 Pay Period : ANXT Payroll" — the chip the payroll-facing leave reports
// carry. Picking one drives the report's date range from the period's dates,
// so the report covers exactly the period payroll runs over.
//
// It does not replace the date navigator. The reference has no way back to an
// arbitrary range once a period is picked; here "Custom range" hands control
// back to the From/To chips, because a range you can't get out of is a worse
// filter than one you can. Nothing is selected by default, so a report behaves
// exactly as it did before anyone created a period.
export default function PayPeriodChip({ value, onChange }) {
  const [periods, setPeriods] = useState([]);

  useEffect(() => {
    api.get('/pay-periods?activeOnly=true')
      .then(r => setPeriods(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(() => setPeriods([]));
  }, []);

  // Nothing to pick from yet — an empty dropdown reads as broken.
  if (periods.length === 0) return null;

  return (
    <label className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-[13px] whitespace-nowrap cursor-pointer">
      <Wallet size={13} className="text-slate-400 flex-shrink-0" />
      <span className="text-slate-500">Pay Period :</span>
      <select
        value={value?._id || ''}
        onChange={e => onChange(periods.find(p => p._id === e.target.value) || null)}
        className="border-none outline-none bg-transparent text-[13px] text-slate-700 p-0 max-w-[190px]"
      >
        <option value="">Custom range</option>
        {periods.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
      </select>
    </label>
  );
}
