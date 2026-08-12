import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import EmploymentTypeFilter from './EmploymentTypeFilter';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';

// Zoho groups these under a MONTH(S) heading, with the year-scale presets
// ungrouped above it.
const PERIOD_OPTIONS = [
  { key: 'lastYear', label: 'Last Year', value: 12 },
  { key: 'quarterly', label: 'quarterly', value: 3 },
  { key: '3', label: 'Last Three Months', value: 3, group: 'Month(s)' },
  { key: '6', label: 'Last Six Months', value: 6, group: 'Month(s)' },
  { key: '12', label: 'Last Twelve Months(incl. current month)', value: 12, group: 'Month(s)' },
  { key: '24', label: 'Last Twenty Four Months', value: 24, group: 'Month(s)' },
];

// Month-by-month combo chart page — covers Employee addition trend and
// Employee attrition trend, whose endpoints return
// [{month, year, count, growth}]. `showEmploymentType` is only passed for
// Attrition Trend — Zoho's own Addition Trend has no such filter either.
export default function TrendReportPage({ title, subtitle, endpoint, barColor = '#8b8fd4', lineColor = '#a5c249', switcherCategory, showEmploymentType = false }) {
  const [periodKey, setPeriodKey] = useState('12');
  const [months, setMonths] = useState(12);
  const [employmentType, setEmploymentType] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  // Zoho shows this filter row on load rather than behind the funnel.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});

  const load = (m = months, et = employmentType, dims = applied) => {
    setLoading(true);
    const params = new URLSearchParams({ months: String(m), ...(et ? { employmentType: et } : {}) });
    appendDimensionFilters(params, dims);
    api.get(`${endpoint}?${params}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // `endpoint` in the deps because this component instance is reused across
  // sibling reports navigated to via the ReportShell switcher, so a fetch
  // keyed on nothing wouldn't re-run for a fresh report.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(months, employmentType, applied), [endpoint]);

  const filters = (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={periodKey}
        onChange={(value, key) => { setPeriodKey(key); setMonths(value); load(value, employmentType, applied); }}
      />
      {showEmploymentType && (
        <EmploymentTypeFilter value={employmentType} onChange={v => { setEmploymentType(v); load(months, v, applied); }} />
      )}
      <button
        onClick={() => { setApplied(draft); load(months, employmentType, draft); }}
        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-6 py-1.5 rounded text-[13px] font-medium transition-colors"
      >
        Submit
      </button>
      {filtersOpen && (
        <div className="w-full flex flex-wrap items-center gap-2 pt-1 order-first">
          <FilterRow value={draft} onChange={(k, v) => setDraft(f => ({ ...f, [k]: v }))} exclude={showEmploymentType ? ['employmentType'] : []} />
        </div>
      )}
    </>
  );

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  return (
    <ReportShell title={title} subtitle={subtitle} actions={actions} filters={filters} loading={loading} switcherCategory={switcherCategory}>
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="p-4">
          <div className="flex mb-1">
            <ChartExportMenu
              rows={data}
              columns={[{ key: 'month', header: 'Month' }, { key: 'year', header: 'Year' }, { key: 'count', header: 'Count' }, { key: 'growth', header: 'Percentage' }]}
              fileStub={title.toLowerCase().replace(/\s+/g, '-')}
            />
          </div>
          {/* growth is each month's count as a % of that month's active
              headcount (an addition/attrition rate), not a month-over-month
              change — see monthlySeriesWithGrowth() on the backend. */}
          <ComboTrendChart data={data} xKey="month" barColor={barColor} lineColor={lineColor} lineLabel="Percentage" />
        </div>
      )}
    </ReportShell>
  );
}
