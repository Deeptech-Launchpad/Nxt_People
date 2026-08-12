import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import EmploymentTypeFilter from './EmploymentTypeFilter';
import FilterToggleButton from './FilterToggleButton';

const PERIOD_OPTIONS = [3, 6, 12, 24].map(m => ({ key: String(m), label: `Last ${m === 12 ? 'Twelve' : m} Months`, value: m }));

// Month-by-month combo chart report page — covers Employee addition trend
// and Employee attrition trend, whose endpoints return
// [{month, year, count, growth}]. `showEmploymentType` is only passed for
// Attrition Trend — Zoho's own Addition Trend has no such filter either.
export default function TrendReportPage({ title, subtitle, endpoint, barColor = '#2563eb', switcherCategory, showEmploymentType = false }) {
  const [months, setMonths] = useState(12);
  const [employmentType, setEmploymentType] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = (m = months, et = employmentType) => {
    setLoading(true);
    const params = new URLSearchParams({ months: m, ...(et ? { employmentType: et } : {}) });
    api.get(`${endpoint}?${params}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // `endpoint` in the deps for the same reason as TableReportPage — this
  // component instance is reused across sibling reports navigated to via
  // the ReportShell switcher, so a fetch keyed only on `endpoint` alone
  // wouldn't re-run for a fresh report; months/employmentType changes are
  // applied explicitly via Submit, not auto-reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(months, employmentType), [endpoint]);

  const filters = filtersOpen ? (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={String(months)}
        onSubmit={(value) => { setMonths(value); load(value, employmentType); }}
      />
      {showEmploymentType && (
        <EmploymentTypeFilter value={employmentType} onChange={v => { setEmploymentType(v); load(months, v); }} />
      )}
      <button
        onClick={() => { setMonths(12); setEmploymentType(''); load(12, ''); }}
        className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors ml-auto"
      >
        <RotateCcw size={14} /> Reset
      </button>
    </>
  ) : null;

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  return (
    <ReportShell title={title} subtitle={subtitle} actions={actions} filters={filters} loading={loading} switcherCategory={switcherCategory}>
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="p-4">
          <div className="flex justify-end mb-1">
            <ChartExportMenu
              rows={data}
              columns={[{ key: 'month', header: 'Month' }, { key: 'year', header: 'Year' }, { key: 'count', header: 'Count' }, { key: 'growth', header: 'Percentage' }]}
              fileStub={title.toLowerCase().replace(/\s+/g, '-')}
            />
          </div>
          {/* growth is each month's count as a % of that month's active
              headcount (an addition/attrition rate), not a month-over-month
              change — see monthlySeriesWithGrowth() on the backend. */}
          <ComboTrendChart data={data} xKey="month" barColor={barColor} lineLabel="Percentage" />
        </div>
      )}
    </ReportShell>
  );
}
