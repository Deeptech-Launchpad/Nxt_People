import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';

export default function Headcount() {
  const [years, setYears] = useState(10);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);

  const load = () => {
    setLoading(true);
    api.get(`/reports/employee/headcount-trend?years=${years}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [years]);

  const filters = (
    <div>
      <label className="block text-[13px] font-medium text-slate-600 mb-1">Range</label>
      <select value={years} onChange={e => setYears(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
        {[5, 10, 15].map(y => <option key={y} value={y}>Last {y} years</option>)}
      </select>
    </div>
  );

  return (
    <ReportShell title="Headcount" subtitle="Active employees at year-end, year over year" filters={filters} loading={loading} switcherCategory="Employee Information">
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <div className="p-4">
          <div className="flex justify-end mb-1">
            <ChartExportMenu
              rows={data}
              columns={[{ key: 'year', header: 'Year' }, { key: 'count', header: 'Count' }, { key: 'growth', header: 'Growth %' }]}
              fileStub="headcount-trend"
            />
          </div>
          <ComboTrendChart data={data} xKey="year" barColor="#6366f1" />
        </div>
      )}
    </ReportShell>
  );
}
