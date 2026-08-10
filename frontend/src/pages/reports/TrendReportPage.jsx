import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

// Generic month-by-month bar-chart report page — covers Employee addition
// trend and Employee attrition trend, whose endpoints return [{month, count}].
export default function TrendReportPage({ title, subtitle, endpoint, barColor = '#2563eb', switcherCategory }) {
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);

  const load = () => {
    setLoading(true);
    api.get(`${endpoint}?months=${months}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [months]);

  const filters = (
    <div>
      <label className="block text-[13px] font-medium text-slate-600 mb-1">Range</label>
      <select value={months} onChange={e => setMonths(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
        {[6, 12, 24].map(m => <option key={m} value={m}>Last {m} months</option>)}
      </select>
    </div>
  );

  return (
    <ReportShell title={title} subtitle={subtitle} filters={filters} loading={loading} switcherCategory={switcherCategory}>
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="p-4">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill={barColor} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportShell>
  );
}
