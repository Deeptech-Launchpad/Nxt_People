import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import DonutWithStats from './DonutWithStats';
import ChartExportMenu from './ChartExportMenu';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';
import SliceDrilldown from './SliceDrilldown';

const TYPES = [['age', 'Age'], ['gender', 'Gender'], ['experience', 'Experience']];

// Zoho's Type selector lives in the breadcrumb trail, reading
// "Diversity › Type : Gender".
function TypeChip({ type, setType }) {
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
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1 rounded text-[13px] font-medium border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition-colors">
        Type : {label} <ChevronDown size={13} className="text-slate-400" />
      </button>
      {/* whitespace-normal + block below: the breadcrumb bar sets
          whitespace-nowrap, which inherits in here and stops inline-block
          items wrapping, so the options spilled sideways instead of stacking. */}
      {open && (
        <div className="absolute z-50 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1 whitespace-normal">
          {TYPES.map(([k, l]) => (
            <button key={k} onClick={() => { setType(k); setOpen(false); }} className={`block w-full text-left px-4 py-2 text-[13px] transition-colors ${type === k ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// The dimension chip row never offers the dimension the chart is already
// grouped by — Zoho drops Gender from the row when Type is Gender.
const TYPE_TO_FILTER_KEY = { gender: 'gender', experience: 'experience', age: null };

export default function Diversity() {
  const [searchParams] = useSearchParams();
  const initialType = TYPES.some(([k]) => k === searchParams.get('type')) ? searchParams.get('type') : 'gender';
  const [type, setType] = useState(initialType);
  // `draft` is what the chips edit; `applied` is what's actually queried —
  // Zoho only runs the query when Submit is pressed.
  const [draft, setDraft] = useState({});
  const [applied, setApplied] = useState({});
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [totalActive, setTotalActive] = useState(0);
  // Zoho shows this filter row on load rather than behind the funnel.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drill, setDrill] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type });
    appendDimensionFilters(params, applied);
    api.get(`/reports/employee/diversity?${params}`)
      .then(r => {
        setRows(Array.isArray(r.data.data) ? r.data.data : []);
        setTotalActive(r.data.totalActive || 0);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [type, applied]);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  // "Unspecified" only applies to the gender view — that's the existing
  // catch-all the backend already uses for a NULL gender.
  const withoutGender = rows.find(r => r.label === 'Unspecified')?.count || 0;
  // For age/experience, "without" = total active employees minus those
  // that appear in the buckets (missing date_of_birth or joining_date).
  const withoutData = (type === 'age' || type === 'experience') ? (totalActive || total) - total : 0;
  const typeLabel = TYPES.find(([k]) => k === type)[1];

  const WITHOUT_LABELS = { age: 'Employees without date of birth', experience: 'Employees without joining date' };

  const buildStats = () => {
    const stats = [{ label: 'Total Employee Count', value: totalActive || total }];
    if (type === 'gender') {
      stats.push({ label: 'Employees without gender specified', value: `${total ? ((withoutGender / total) * 100).toFixed(2) : 0}% (${withoutGender})` });
    } else if (withoutData > 0) {
      const pct = totalActive ? ((withoutData / totalActive) * 100).toFixed(2) : 0;
      stats.push({ label: WITHOUT_LABELS[type], value: `${pct}% (${withoutData})` });
    }
    return stats;
  };

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filterPanel = filtersOpen ? (
    <>
      <FilterRow
        value={draft}
        onChange={(k, v) => setDraft(f => ({ ...f, [k]: v }))}
        experience={draft.experience}
        onExperienceChange={v => setDraft(f => ({ ...f, experience: v }))}
        exclude={[TYPE_TO_FILTER_KEY[type]].filter(Boolean)}
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
      title="Diversity"
      subtitle="Active employees by gender, age, or experience"
      breadcrumbChip={<TypeChip type={type} setType={setType} />}
      actions={actions}
      filters={filterPanel}
      loading={loading}
      switcherCategory="Employee Information"
    >
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data</div>
      ) : (
        <>
          <div className="flex px-4 pt-4">
            <ChartExportMenu rows={rows} columns={[{ key: 'label', header: typeLabel }, { key: 'count', header: 'Count' }]} fileStub={`diversity-${type}`} />
          </div>
          {/* Age and Experience only bucket people who have a date of birth /
              joining date, but the percentages divide by the full headcount —
              18 of 58 reads 31.03%, matching the stat panel beside it. */}
          {/* Only Gender drills down — Age and Experience group by a computed
              band, so a slice there has no column value to look up. */}
          <DonutWithStats
            data={rows} total={totalActive || total} stats={buildStats()}
            onSliceClick={type === 'gender' ? (label => setDrill(label)) : undefined}
          />
          {type === 'gender' && (
            <SliceDrilldown by="gender" value={drill} label="Gender" onClose={() => setDrill(null)} />
          )}
        </>
      )}
    </ReportShell>
  );
}
