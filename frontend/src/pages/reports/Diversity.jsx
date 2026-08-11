import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import ChartExportMenu from './ChartExportMenu';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';

const TYPES = [['gender', 'Gender'], ['age', 'Age'], ['experience', 'Experience']];

function TypeDropdown({ type, setType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const label = TYPES.find(([k]) => k === type)[1];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors">
        Type: {label} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {TYPES.map(([k, l]) => (
            <button key={k} onClick={() => { setType(k); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${type === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Diversity() {
  const [searchParams] = useSearchParams();
  const initialType = TYPES.some(([k]) => k === searchParams.get('type')) ? searchParams.get('type') : 'gender';
  const [type, setType] = useState(initialType);
  const [filters, setFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    api.get(`/reports/employee/diversity?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [type, filters]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // "Unspecified" only applies to the gender view — that's the existing
  // catch-all the backend already uses for a NULL gender.
  const withoutGender = rows.find(r => r.label === 'Unspecified')?.count || 0;
  const typeLabel = TYPES.find(([k]) => k === type)[1];

  const actions = (
    <div className="flex items-center gap-2">
      <TypeDropdown type={type} setType={setType} />
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  return (
    <ReportShell title="Diversity" subtitle="Active employees by gender, age, or experience" actions={actions} loading={loading} switcherCategory="Employee Information">
      {filtersOpen && (
        <div className="px-4 pt-4">
          <FilterRow value={filters} onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))} />
        </div>
      )}
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
