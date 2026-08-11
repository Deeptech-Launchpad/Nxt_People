import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import EmploymentTypeFilter from './EmploymentTypeFilter';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

// Date-range presets matching Zoho's Period dropdown on Experience Wise
// Exit. "Custom" (an arbitrary picked range) isn't offered here — only
// these fixed presets — to keep the filter panel a straightforward preset
// list rather than adding a separate date-picker sub-form.
const PERIOD_OPTIONS = [
  { key: 'yesterday', label: 'Yesterday', value: range(new Date(y, m, now.getDate() - 1), new Date(y, m, now.getDate() - 1)) },
  { key: 'today', label: 'Today', value: range(now, now) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastYear', label: 'Last Year', value: range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)) },
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
];

export default function ExperienceExit() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [periodKey, setPeriodKey] = useState('thisYear');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisYear').value);
  const [employmentType, setEmploymentType] = useState('');

  const load = (range = dateRange, et = employmentType) => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: range.start, endDate: range.end, ...(et ? { employmentType: et } : {}) });
    api.get(`/reports/employee/experience-exit?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(dateRange, employmentType), []); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={periodKey}
        onSubmit={(value, key) => { setPeriodKey(key); setDateRange(value); load(value, employmentType); }}
      />
      <EmploymentTypeFilter value={employmentType} onChange={v => { setEmploymentType(v); load(dateRange, v); }} />
    </>
  );

  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;
  const pointLabel = ({ x, y, index }) => {
    const r = rows[index];
    return (
      <text x={x} y={y - 10} textAnchor="middle" fontSize={11} fill="#b91c1c">
        {`${((r.count / total) * 100).toFixed(2)}% (${r.count})`}
      </text>
    );
  };

  return (
    <ReportShell title="Experience Wise Exit" subtitle="Exited employees banded by years of experience at exit" filters={filters} loading={loading} switcherCategory="Employee Information">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <div className="p-4">
          <div className="flex justify-end mb-1">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: 'Experience' }, { key: 'count', header: 'Count' }]} fileStub="experience-wise-exit" />
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={rows} margin={{ top: 30, right: 20, left: 10, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} label={{ value: 'Experience (years)', position: 'bottom', offset: 8, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} label={{ value: 'Users Count', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12 }} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#ef4444" fill="#fecaca" strokeWidth={2}>
                <LabelList dataKey="count" content={pointLabel} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportShell>
  );
}
