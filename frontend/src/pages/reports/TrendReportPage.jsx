import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import ComboTrendChart from './ComboTrendChart';
import ChartExportMenu from './ChartExportMenu';

// Month-by-month combo chart report page — covers Employee addition trend
// and Employee attrition trend, whose endpoints return
// [{month, year, count, growth}].
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

  // `endpoint` in the deps for the same reason as TableReportPage — this
  // component instance is reused across sibling reports navigated to via
  // the ReportShell switcher, so a fetch keyed only on `months` would never
  // re-run when the report itself changes.
  useEffect(load, [endpoint, months]);

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
