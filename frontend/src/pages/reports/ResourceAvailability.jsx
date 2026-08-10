import React, { useState, useEffect } from 'react';
import { Filter } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

const todayCA = () => new Date().toLocaleDateString('en-CA');

export default function ResourceAvailability() {
  const [date, setDate] = useState(todayCA());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/reports/leave/resource-availability?date=${date}`)
      .then(r => setData(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
    </>
  );

  return (
    <ReportShell title="Resource Availability" subtitle="Who's available to work on a given date" filters={filters} loading={loading}>
      {data && (
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          <div className="p-6 text-center"><p className="text-[13px] text-slate-500">Total Active</p><p className="text-[28px] font-bold text-slate-800 mt-1">{data.total}</p></div>
          <div className="p-6 text-center"><p className="text-[13px] text-slate-500">On Leave</p><p className="text-[28px] font-bold text-amber-600 mt-1">{data.onLeave}</p></div>
          <div className="p-6 text-center"><p className="text-[13px] text-slate-500">Available</p><p className="text-[28px] font-bold text-emerald-600 mt-1">{data.available}</p></div>
        </div>
      )}
    </ReportShell>
  );
}
