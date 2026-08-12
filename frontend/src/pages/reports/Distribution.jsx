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
import SliceDrilldown from './SliceDrilldown';

const TYPES = [['designation', 'Designation'], ['department', 'Department'], ['location', 'Location']];

// The "Type" selector sits in the breadcrumb trail in Zoho, reading
// "Distribution › Type : Location", not in the filter panel below.
function TypeChip({ by, setBy }) {
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
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1 rounded text-[13px] font-medium border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition-colors">
        Type : {label} <ChevronDown size={13} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {TYPES.map(([k, l]) => (
            <button key={k} onClick={() => { setBy(k); setOpen(false); }} className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${by === k ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// "by" ("Type") maps to work_location for the 'location' option — same
// key extraEmployeeFilters() uses on the backend for the dimension filter
// row, so the row correctly excludes whichever dimension is the current Type.
const BY_TO_FILTER_KEY = { department: 'department', designation: 'designation', location: 'workLocation' };

export default function Distribution() {
  const [searchParams] = useSearchParams();
  const initialBy = TYPES.some(([k]) => k === searchParams.get('by')) ? searchParams.get('by') : 'department';
  const [by, setBy] = useState(initialBy);
  // `draft` is what the chips edit; `applied` is what's actually queried.
  // Zoho only runs the query when Submit is pressed.
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [totalActive, setTotalActive] = useState(0);
  const [without, setWithout] = useState(0);
  // Zoho shows this filter row on load rather than behind the funnel.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ by });
    Object.entries(applied).forEach(([k, vals]) => (vals || []).forEach(v => params.append(k, v)));
    api.get(`/reports/employee/distribution?${params}`)
      .then(r => {
        setRows(Array.isArray(r.data.data) ? r.data.data : []);
        setTotalActive(r.data.totalActive || 0);
        setWithout(r.data.without || 0);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [by, applied]);

  const assigned = rows.reduce((s, r) => s + Number(r.count), 0);
  const total = totalActive || assigned;
  const top3 = [...rows].sort((a, b) => b.count - a.count).slice(0, 3).reduce((s, r) => s + Number(r.count), 0);
  const typeLabel = TYPES.find(([k]) => k === by)[1];

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = filtersOpen ? (
    <>
      <FilterRow
        value={draft}
        onChange={(k, v) => setDraft(f => ({ ...f, [k]: v }))}
        exclude={[BY_TO_FILTER_KEY[by]]}
      />
      <button
        onClick={() => setApplied(draft)}
        className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-6 py-1.5 rounded text-[13px] font-medium transition-colors"
      >
        Submit
      </button>
    </>
  ) : null;

  return (
    <ReportShell
      title="Distribution"
      subtitle="Active employees split by department, designation, or location"
      breadcrumbChip={<TypeChip by={by} setBy={setBy} />}
      actions={actions}
      filters={filters}
      loading={loading}
      switcherCategory="Employee Information"
    >
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <>
          <div className="flex px-4 pt-4">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: typeLabel }, { key: 'count', header: 'Count' }]} fileStub={`distribution-${by}`} />
          </div>
          {/* Distribution draws a solid pie in Zoho; Diversity draws a donut. */}
          <DonutWithStats
            data={rows}
            donut={false}
            total={total}
            onSliceClick={label => setDrill(label)}
            stats={[
              { label: `Employees in Top 3 ${typeLabel}s`, value: `${total ? ((top3 / total) * 100).toFixed(2) : 0}% (${top3})` },
              ...(without > 0
                ? [{ label: `Employees without ${typeLabel.toLowerCase()}`, value: `${total ? ((without / total) * 100).toFixed(2) : 0}% (${without})` }]
                : []),
              { label: `Total no. of ${typeLabel}s`, value: rows.length },
              { label: 'Total Employee Count', value: total },
            ]}
          />
          <SliceDrilldown by={by} value={drill} label={typeLabel} onClose={() => setDrill(null)} />
        </>
      )}
    </ReportShell>
  );
}
