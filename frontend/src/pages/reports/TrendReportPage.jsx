import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';
import PeriodFilter from './PeriodFilter';
import EmploymentTypeFilter from './EmploymentTypeFilter';

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

  const filters = (
    <>
      <PeriodFilter
        options={PERIOD_OPTIONS}
        selectedKey={String(months)}
        onSubmit={(value) => { setMonths(value); load(value, employmentType); }}
      />
      {showEmploymentType && (
        <EmploymentTypeFilter value={employmentType} onChange={v => { setEmploymentType(v); load(months, v); }} />
      )}
    </>
  );

  return (
    <ReportShell title={title} subtitle={subtitle} filters={filters} loading={loading} switcherCategory={switcherCategory}>
      {data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="p-4">
          <div className="flex justify-end mb-1">
            <ChartExportMenu
              rows={data}
              columns={[{ key: 'month', header: 'Month' }, { key: 'year', header: 'Year' }, { key: 'count', header: 'Count' }, { key: 'growth', header: 'Growth %' }]}
              fileStub={title.toLowerCase().replace(/\s+/g, '-')}
            />
          </div>
          <ComboTrendChart data={data} xKey="month" barColor={barColor} />
        </div>
      )}
    </ReportShell>
  );
}
