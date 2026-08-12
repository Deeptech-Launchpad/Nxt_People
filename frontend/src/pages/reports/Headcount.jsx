import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import FilterToggleButton from './FilterToggleButton';

const PERIOD_OPTIONS = [5, 10, 15].map(y => ({ key: String(y), label: `Last ${y} Years`, value: y }));

export default function Headcount() {
  const [years, setYears] = useState(10);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = (y = years) => {
    setLoading(true);
    api.get(`/reports/employee/headcount-trend?years=${y}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(years), []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = filtersOpen ? (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={String(years)}
        onSubmit={(value) => { setYears(value); load(value); }}
      />
      <button onClick={() => { setYears(10); load(10); }} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors ml-auto">
        <RotateCcw size={14} /> Reset
      </button>
    </>
  ) : null;

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  return (
    <ReportShell title="Headcount" subtitle="Active employees at year-end, year over year" actions={actions} filters={filters} loading={loading} switcherCategory="Employee Information">
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
