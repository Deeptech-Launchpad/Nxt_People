import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import EmploymentTypeFilter from './EmploymentTypeFilter';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';
import DateChip from './DateChip';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

// Zoho's Period list on Experience Wise Exit, in its own order. "Custom"
// hands control to the From/To chips instead of a preset range.
const PERIOD_OPTIONS = [
  { key: 'yesterday', label: 'Yesterday', value: range(new Date(y, m, now.getDate() - 1), new Date(y, m, now.getDate() - 1)) },
  { key: 'today', label: 'Today', value: range(now, now) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastYear', label: 'Last Year', value: range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)) },
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
  { key: 'custom', label: 'Custom', value: null },
];

export default function ExperienceExit() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [periodKey, setPeriodKey] = useState('thisYear');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisYear').value);
  const [employmentType, setEmploymentType] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});

  const isCustom = periodKey === 'custom';

  const load = (rng = dateRange, et = employmentType, dims = applied) => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: rng.start, endDate: rng.end, ...(et ? { employmentType: et } : {}) });
    appendDimensionFilters(params, dims);
    api.get(`/reports/employee/experience-exit?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(dateRange, employmentType, applied), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing Custom keeps whatever range is on screen and just unlocks the
  // date chips — it shouldn't blank the chart out.
  const pickPeriod = (value, key) => {
    setPeriodKey(key);
    if (value) { setDateRange(value); load(value, employmentType, applied); }
  };

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onChange={pickPeriod} />
      <DateChip
        label="From" value={dateRange.start} disabled={!isCustom}
        onChange={v => setDateRange(r => ({ ...r, start: v }))}
      />
      <DateChip
        label="To" value={dateRange.end} disabled={!isCustom}
        onChange={v => setDateRange(r => ({ ...r, end: v }))}
      />
      <EmploymentTypeFilter value={employmentType} onChange={v => { setEmploymentType(v); load(dateRange, v, applied); }} />
      <button
        onClick={() => { setApplied(draft); load(dateRange, employmentType, draft); }}
        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-6 py-1.5 rounded text-[13px] font-medium transition-colors"
      >
        Submit
      </button>
      {filtersOpen && (
        <div className="w-full flex flex-wrap items-center gap-2 pt-1 order-first">
          <FilterRow value={draft} onChange={(k, v) => setDraft(f => ({ ...f, [k]: v }))} exclude={['employmentType', 'experience']} />
        </div>
      )}
    </>
  );

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;
  const pointLabel = ({ x, y: py, index }) => {
    const r = rows[index];
    return (
      <text x={x} y={py - 10} textAnchor="middle" fontSize={11} fill="#b91c1c" fontWeight="600">
        {`${((r.count / total) * 100).toFixed(2)}% (${r.count})`}
      </text>
    );
  };

  return (
    <ReportShell title="Experience Wise Exit" subtitle="Exited employees banded by years of experience at exit" actions={actions} filters={filters} loading={loading} switcherCategory="Employee Information">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <div className="p-4">
          <div className="flex mb-1">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: 'Experience' }, { key: 'count', header: 'Count' }]} fileStub="experience-wise-exit" />
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={rows} margin={{ top: 30, right: 20, left: 10, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} label={{ value: 'Experience', position: 'bottom', offset: 8, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} label={{ value: 'Users Count', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12 }} />
              <Tooltip />
              <Area type="linear" dataKey="count" stroke="#ef4444" fill="#fecaca" strokeWidth={2}>
                <LabelList dataKey="count" content={pointLabel} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportShell>
  );
}
