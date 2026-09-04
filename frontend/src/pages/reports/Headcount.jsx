import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';

import usePersistedOpen from './usePersistedOpen';
const PERIOD_OPTIONS = [
  ...[5, 10, 15].map(y => ({ key: String(y), label: `Last ${y} Years`, value: y, group: 'Year' })),
];

export default function Headcount() {
  const [years, setYears] = useState(10);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  // Zoho shows this filter row on load rather than behind the funnel.
  const [filtersOpen, setFiltersOpen] = usePersistedOpen(false);
  // Chips edit `draft`; Submit promotes it to `applied`, which is what runs.
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});

  const load = (y = years, dims = applied) => {
    setLoading(true);
    const params = new URLSearchParams({ years: String(y) });
    appendDimensionFilters(params, dims);
    api.get(`/reports/employee/headcount-trend?${params}`)
      .then(r => setData(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(years, applied), []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => { setApplied(draft); load(years, draft); };

  // The Period row is always visible in Zoho; the funnel reveals the extra
  // dimension chips above it.
  const filters = (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={String(years)}
        onChange={(value) => { setYears(value); load(value, applied); }}
      />
      <button
        onClick={submit}
        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-6 py-1.5 rounded text-[13px] font-medium transition-colors"
      >
        Submit
      </button>
      {filtersOpen && (
        <div className="w-full flex flex-wrap items-center gap-2 pt-1 order-first">
          <FilterRow value={draft} onChange={(k, v) => setDraft(f => ({ ...f, [k]: v }))} experience={draft.experience} onExperienceChange={v => setDraft(f => ({ ...f, experience: v }))} />
        </div>
      )}
    </>
  );

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  return (
    <ReportShell title="Headcount" subtitle="Active employees at year-end, year over year" actions={actions} filters={filters} loading={loading} switcherCategory="Employee Information">
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <div className="p-4">
          <div className="flex mb-1">
            <ChartExportMenu
              rows={data}
              columns={[{ key: 'year', header: 'Period' }, { key: 'count', header: 'Count' }, { key: 'growth', header: 'Percentage' }]}
              fileStub="headcount-trend"
            />
          </div>
          <ComboTrendChart data={data} xKey="year" barColor="#8b8fd4" lineLabel="Percentage" />
        </div>
      )}
    </ReportShell>
  );
}
