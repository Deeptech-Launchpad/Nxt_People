import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import ChartExportMenu from './ChartExportMenu';

const TYPES = [['gender', 'Gender'], ['age', 'Age'], ['experience', 'Experience']];

export default function Diversity() {
  const [searchParams] = useSearchParams();
  const initialType = TYPES.some(([k]) => k === searchParams.get('type')) ? searchParams.get('type') : 'gender';
  const [type, setType] = useState(initialType);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/employee/diversity?type=${type}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [type]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // "Unspecified" only applies to the gender view — that's the existing
  // catch-all the backend already uses for a NULL gender.
  const withoutGender = rows.find(r => r.label === 'Unspecified')?.count || 0;
  const typeLabel = TYPES.find(([k]) => k === type)[1];

  const actions = (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
      {TYPES.map(([k, l]) => (
        <button key={k} onClick={() => setType(k)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${type === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <ReportShell title="Diversity" subtitle="Active employees by gender, age, or experience" actions={actions} loading={loading} switcherCategory="Employee Information">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <>
          <div className="flex justify-end px-4 pt-4">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: typeLabel }, { key: 'count', header: 'Count' }]} fileStub={`diversity-${type}`} />
          </div>
          <DonutWithStats
            data={rows}
            stats={type === 'gender' ? [
              { label: 'Total Employee Count', value: total },
              { label: 'Employees without gender specified', value: `${total ? ((withoutGender / total) * 100).toFixed(2) : 0}% (${withoutGender})` },
            ] : [
              { label: 'Total Employee Count', value: total },
            ]}
          />
        </>
      )}
    </ReportShell>
  );
}
