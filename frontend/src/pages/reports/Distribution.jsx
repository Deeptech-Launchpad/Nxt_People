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

const TYPES = [['department', 'Department'], ['designation', 'Designation'], ['location', 'Location']];

function TypeDropdown({ by, setBy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const label = TYPES.find(([k]) => k === by)[1];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors">
        Type: {label} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {TYPES.map(([k, l]) => (
            <button key={k} onClick={() => { setBy(k); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${by === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// "by" ("Type") maps to work_location for the 'location' option — same
// key extraEmployeeFilters() uses on the backend for the secondary filter
// row, so the row correctly excludes whichever dimension is the current Type.
const BY_TO_FILTER_KEY = { department: 'department', designation: 'designation', location: 'workLocation' };

export default function Distribution() {
  const [searchParams] = useSearchParams();
  const initialBy = TYPES.some(([k]) => k === searchParams.get('by')) ? searchParams.get('by') : 'department';
  const [by, setBy] = useState(initialBy);
  const [filters, setFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ by, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    api.get(`/reports/employee/distribution?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [by, filters]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  const top3 = [...rows].sort((a, b) => b.count - a.count).slice(0, 3).reduce((s, r) => s + Number(r.count), 0);
  const typeLabel = TYPES.find(([k]) => k === by)[1];

  const actions = (
    <div className="flex items-center gap-2">
      <TypeDropdown by={by} setBy={setBy} />
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  return (
    <ReportShell title="Distribution" subtitle="Active employees split by department, designation, or location" actions={actions} loading={loading} switcherCategory="Employee Information">
      {filtersOpen && (
        <FilterRow value={filters} onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))} exclude={[BY_TO_FILTER_KEY[by]]} />
      )}
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
