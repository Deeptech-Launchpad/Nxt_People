import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';

const PERIOD_OPTIONS = [5, 10, 15].map(y => ({ key: String(y), label: `Last ${y} Years`, value: y }));

export default function Headcount() {
  const [years, setYears] = useState(10);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);

  const load = (y = years) => {
    setLoading(true);
    api.get(`/reports/employee/headcount-trend?years=${y}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(years), []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = (
    <PeriodFilter
      options={PERIOD_OPTIONS}
      selectedKey={String(years)}
      onSubmit={(value) => { setYears(value); load(value); }}
    />
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
