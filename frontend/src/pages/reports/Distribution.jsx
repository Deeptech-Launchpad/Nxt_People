import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import ChartExportMenu from './ChartExportMenu';

const TYPES = [['department', 'Department'], ['designation', 'Designation'], ['location', 'Location']];

export default function Distribution() {
  const [by, setBy] = useState('department');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/employee/distribution?by=${by}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [by]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  const top3 = [...rows].sort((a, b) => b.count - a.count).slice(0, 3).reduce((s, r) => s + Number(r.count), 0);
  const typeLabel = TYPES.find(([k]) => k === by)[1];

  const actions = (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
      {TYPES.map(([k, l]) => (
        <button key={k} onClick={() => setBy(k)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${by === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <ReportShell title="Distribution" subtitle="Active employees split by department, designation, or location" actions={actions} loading={loading} switcherCategory="Employee Information">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <>
          <div className="flex justify-end px-4 pt-4">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: typeLabel }, { key: 'count', header: 'Count' }]} fileStub={`distribution-${by}`} />
          </div>
          <DonutWithStats
            data={rows}
            stats={[
              { label: `Employees in Top 3 ${typeLabel}s`, value: `${total ? ((top3 / total) * 100).toFixed(2) : 0}% (${top3})` },
              { label: `Total no. of ${typeLabel}s`, value: rows.length },
              { label: 'Total Employee Count', value: total },
            ]}
          />
        </>
      )}
    </ReportShell>
  );
}
