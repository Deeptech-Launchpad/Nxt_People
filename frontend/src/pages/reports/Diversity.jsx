import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import ChartExportMenu from './ChartExportMenu';

export default function Diversity() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/reports/employee/diversity')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, []);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // "Unspecified" is the existing catch-all the backend already uses for a
  // NULL gender — surfacing it explicitly as its own stat, not just another
  // donut slice, is what makes a data-quality gap visible instead of hidden.
  const withoutGender = rows.find(r => r.label === 'Unspecified')?.count || 0;

  return (
    <ReportShell title="Diversity" subtitle="Active employees by gender" loading={loading} switcherCategory="Employee Information">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <>
          <div className="flex justify-end px-4 pt-4">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: 'Gender' }, { key: 'count', header: 'Count' }]} fileStub="diversity" />
          </div>
          <DonutWithStats
            data={rows}
            stats={[
              { label: 'Total Employee Count', value: total },
              { label: 'Employees without gender specified', value: `${total ? ((withoutGender / total) * 100).toFixed(2) : 0}% (${withoutGender})` },
            ]}
          />
        </>
      )}
    </ReportShell>
  );
}
