import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarDays, ChevronDown, Info, Users, ClipboardCheck, BadgeCheck, Gauge,
  Building2, CheckCircle2, XCircle, Briefcase, PieChart as PieIcon,
  CalendarRange, BarChart3, MessageSquare,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, LineChart, Line, LabelList, Cell, PieChart, Pie,
} from 'recharts';
import api from '../utils/api';
import ChartMenu from './hrDashboard/ChartMenu';

// Read-only HR-wide view: Admin sees the whole company, Manager sees their own
// reporting subtree (enforced server-side — see routes/hr-attendance-dashboard.js).
// Every number on this page comes from the one GET call in `load()` below;
// nothing here writes data anywhere. Each chart's own "⋯" menu calls the new
// GET /hr-attendance-dashboard/export endpoint for Excel/CSV, and builds its
// PNG straight from its own rendered SVG in the browser — see ChartMenu.jsx.

const ymd = (d) => d.toLocaleDateString('en-CA');
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const fmtDMY = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Order here is also the order the preset dropdown lists them in.
const PRESET_ORDER = ['today', 'thisMonth', 'lastMonth', 'last3Months', 'thisYear', 'monthYear', 'customRange'];
const PRESET_LABELS = {
  today: 'Today', thisMonth: 'This Month', lastMonth: 'Last Month',
  last3Months: 'Last 3 Months', thisYear: 'This Year',
  monthYear: 'Month & Year', customRange: 'Custom Range',
};

// The one place that turns a preset (+ its own inputs, for monthYear/customRange)
// into an actual [from, to] Date pair. `today` is passed in rather than read
// fresh here, so "Today"/"This Month" don't silently drift if this is called
// more than once in the same render.
function rangeForPreset(preset, { today, month, year, from, to }) {
  switch (preset) {
    case 'today': return [today, today];
    case 'thisMonth': return [firstOfMonth(today), today];
    case 'lastMonth': { const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1); return [firstOfMonth(lm), lastOfMonth(lm)]; }
    case 'last3Months': return [new Date(today.getFullYear(), today.getMonth() - 2, 1), today];
    case 'thisYear': return [new Date(today.getFullYear(), 0, 1), today];
    case 'monthYear': { const d = new Date(year, month, 1); return [firstOfMonth(d), lastOfMonth(d)]; }
    case 'customRange': return [new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`)];
    default: return [firstOfMonth(today), today];
  }
}

// Only Custom Range can actually be invalid (From after To) — every other
// preset is self-consistent by construction, including Month & Year, since
// the month dropdown and year dropdown always have a value once rendered.
function isDraftValid(preset, { from, to }) {
  if (preset !== 'customRange') return true;
  if (!from || !to) return false;
  return new Date(`${from}T00:00:00`) <= new Date(`${to}T00:00:00`);
}

// "Showing: ..." label for the applied range — a whole single month reads as
// "Oct 2026", anything else as "01 Oct 2026 – 17 Oct 2026".
function formatAppliedRange(preset, from, to, month, year) {
  if (preset === 'monthYear') return `${MONTH_NAMES[month]} ${year}`;
  const isWholeMonth = ymd(from) === ymd(firstOfMonth(from)) && ymd(to) === ymd(lastOfMonth(from))
    && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (isWholeMonth) return `${from.toLocaleDateString('en-US', { month: 'short' })} ${from.getFullYear()}`;
  if (ymd(from) === ymd(to)) return fmtDMY(from);
  return `${fmtDMY(from)} – ${fmtDMY(to)}`;
}
// Same idea, filename-safe (no spaces/slashes), for the client-built PNG name
// — the Excel/CSV filename always comes from the server's Content-Disposition
// header instead, so this is only ever used for the PNG path.
function periodFileLabel(from, to) {
  const isWholeMonth = ymd(from) === ymd(firstOfMonth(from)) && ymd(to) === ymd(lastOfMonth(from))
    && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (isWholeMonth) return from.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '-');
  return `${ymd(from)}_to_${ymd(to)}`;
}

// Rounds a chart's highest value up to a "nice" axis ceiling (1/2/5 × a power
// of ten) with headroom above the tallest point, so its value label never
// sits flush against the top edge. 0 still gets a real axis (0–4), not a
// degenerate 0–0 one.
function niceCeil(max) {
  if (!max || max <= 0) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const steps = [1, 2, 5, 10];
  for (const s of steps) {
    const candidate = s * magnitude;
    if (candidate > max) return candidate;
  }
  return 10 * magnitude;
}

// ── Visual system — one palette, used consistently everywhere. ─────────────
const PALETTE = {
  blue: '#4F6BED', purple: '#8B5CF6', teal: '#14B8A6', orange: '#F59E0B',
  pink: '#EC4899', gray: '#94A3B8', green: '#22C55E',
};
const PALETTE_SEQUENCE = [PALETTE.blue, PALETTE.purple, PALETTE.teal, PALETTE.orange, PALETTE.pink, PALETTE.gray];
// Restrained icon-chip accents — a soft tint background + matching icon
// color, reused by every KPI card and chart-card header so the whole page
// reads as one system rather than one-off colors per card.
const ACCENT = {
  blue:  { bg: 'bg-blue-50',   text: 'text-blue-600' },
  teal:  { bg: 'bg-teal-50',   text: 'text-teal-600' },
  amber: { bg: 'bg-amber-50',  text: 'text-amber-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
  green: { bg: 'bg-green-50',  text: 'text-green-600' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-500' },
};
const AXIS_TICK = { fontSize: 13, fill: '#475569' };
const AXIS_LINE = { stroke: '#e2e8f0' };
const DATA_LABEL = { fontSize: 12, fontWeight: 600, fill: '#1E293B' };
const TOOLTIP_PROPS = {
  contentStyle: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.10)', fontSize: 13, padding: '8px 12px' },
  labelStyle: { color: '#1E293B', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#475569' },
};

function Card({ title, children, className = '', tall = false }) {
  return (
    <div className={`bg-white rounded-[14px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-4 ${tall ? 'flex flex-col' : ''} ${className}`}>
      {title && <h3 className="text-[13px] font-semibold text-slate-700 mb-3">{title}</h3>}
      {children}
    </div>
  );
}

// Small, keyboard-accessible "i" tooltip — hover OR focus reveals it, Esc/
// blur hides it, and the explanation is also exposed via aria-label so a
// screen reader gets it even without the visual popover. Used next to a KPI
// label to explain exactly how that number is already calculated server-side
// — never to introduce a new figure.
function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={text}
        className="text-slate-300 hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-full"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-52 bg-[#0F1F4D] text-white text-[11px] leading-snug rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
}

// Thin pulsing bar standing in for a KPI's numeric value while it loads —
// swapped out for the real value (or a legitimate '—' when the metric is
// genuinely inapplicable, e.g. zero approved+rejected requests) the instant
// loading finishes, so a true empty result is never confused with "still
// loading".
function ValueSkeleton({ wide = false }) {
  return <span className={`inline-block h-6 ${wide ? 'w-20' : 'w-10'} bg-slate-100 rounded animate-pulse align-middle`} />;
}

function Kpi({ label, value, sub, icon: Icon, tooltip, accent = 'blue' }) {
  const a = ACCENT[accent] || ACCENT.blue;
  return (
    <Card className="flex items-center gap-3 py-4 min-h-[92px]">
      {Icon && (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${a.bg}`}>
          <Icon size={18} className={a.text} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="text-[13px] font-medium text-[#334155] truncate">{label}</div>
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
        <div className="text-2xl font-bold text-slate-800 leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[12px] text-[#475569] mt-0.5 truncate" title={sub}>{sub}</div>}
      </div>
    </Card>
  );
}

function TallStat({ title, children }) {
  return (
    <Card tall className="justify-center h-full">
      <div className="text-[13px] font-semibold text-slate-700 mb-3">{title}</div>
      <div className="flex-1 flex items-center justify-around gap-2">{children}</div>
    </Card>
  );
}

function StatBlock({ value, label, icon: Icon, accent = 'slate' }) {
  const a = ACCENT[accent] || ACCENT.slate;
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      {Icon && (
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${a.bg}`}>
          <Icon size={15} className={a.text} />
        </div>
      )}
      <div className="text-xl font-bold text-slate-800">{value}</div>
      <div className="text-[13px] text-[#334155]">{label}</div>
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded-[14px] ${className}`} />;
}

function EmptyChart({ message = 'No data for the selected period' }) {
  return <div className="flex items-center justify-center h-full text-[13px] text-[#475569] py-10">{message}</div>;
}

// Every chart card on the page shares this shell: bold 16px title + a
// lighter subtitle (usually the period) on the left, the "⋯" export menu on
// the right, equal card height within its row (h-full + flex-col), equal
// padding. `chartRef` is the DOM node ChartMenu reads the rendered <svg>
// out of for the PNG download — it wraps the chart body, not the whole card,
// so the PNG never includes the title row or the menu button.
function ChartCard({ title, subtitle, chart, exportParams, fileLabel, icon: Icon, accent = 'blue', className = '', children }) {
  const chartRef = useRef(null);
  const a = ACCENT[accent] || ACCENT.blue;
  return (
    <Card className={`h-full flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex items-start gap-2.5">
          {Icon && (
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${a.bg}`}>
              <Icon size={15} className={a.text} />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-[#0F1F4D] truncate">{title}</h3>
            {subtitle && <p className="text-[13px] text-[#475569] mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        <ChartMenu chart={chart} params={exportParams} chartRef={chartRef} fileLabel={fileLabel} />
      </div>
      <div ref={chartRef} className="flex-1 min-h-0">{children}</div>
    </Card>
  );
}

export default function HrAttendanceDashboard() {
  // `today` is fixed for the component's lifetime — computed once rather
  // than re-read on every render, so "Today"/"This Month" stay stable while
  // the page is open.
  const today = useMemo(() => new Date(), []);
  // Smooth ~400ms load animation on every chart, switched off entirely for
  // anyone whose OS asks for reduced motion — read once, not reactively,
  // since nothing on this page needs to notice a live OS-setting change.
  const reducedMotion = useMemo(() => (
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ), []);
  const animDuration = reducedMotion ? 0 : 400;

  // ── Applied filter state — this, and only this, is what load() sends. ──
  const [appliedPreset, setAppliedPreset] = useState('thisMonth');
  const [appliedMonth, setAppliedMonth] = useState(today.getMonth());
  const [appliedYear, setAppliedYear] = useState(today.getFullYear());
  const [range, setRange] = useState(() => rangeForPreset('thisMonth', { today }));
  // Department is instant (applied immediately on change), not gated behind
  // Apply — kept that way because it's a single, self-contained dropdown with
  // no draft/invalid state of its own, unlike the Date filter's several
  // moving parts; gating it too would mean every click needed two actions
  // for no real benefit.
  const [department, setDepartment] = useState('All');

  // ── Draft filter state — only the Date side of the filter bar has a
  // draft/applied distinction, per the brief. Changing any of these does
  // NOT reload the dashboard; only clicking Apply copies them into the
  // applied state above. ──────────────────────────────────────────────────
  const [draftPreset, setDraftPreset] = useState('thisMonth');
  const [draftMonth, setDraftMonth] = useState(today.getMonth());
  const [draftYear, setDraftYear] = useState(today.getFullYear());
  const [draftFrom, setDraftFrom] = useState(ymd(firstOfMonth(today)));
  const [draftTo, setDraftTo] = useState(ymd(today));
  const [presetOpen, setPresetOpen] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [from, to] = range;
  // Rapid filter changes (e.g. editing From then To) fire two overlapping
  // requests; the older one can resolve after the newer one and clobber a
  // good result with a stale error or stale data. This tags each request and
  // only applies the response from the most recently STARTED one.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api.get('/hr-attendance-dashboard', {
      params: { from: ymd(from), to: ymd(to), department: department === 'All' ? undefined : department },
    })
      .then((r) => { if (id === requestId.current) setData(r.data); })
      .catch((err) => {
        if (id !== requestId.current) return;
        const message = err.response?.data?.message || 'Could not load the HR Attendance Dashboard';
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [from, to, department]);

  useEffect(() => { load(); }, [load]);

  const draftValid = isDraftValid(draftPreset, { from: draftFrom, to: draftTo });

  const selectDraftPreset = (key) => {
    setDraftPreset(key);
    setPresetOpen(false);
    // Sensible starting values for whichever preset was just picked, so its
    // own inputs (if it has any) aren't left showing a stale selection.
    if (key === 'monthYear') { setDraftMonth(today.getMonth()); setDraftYear(today.getFullYear()); }
    if (key === 'customRange') { setDraftFrom(ymd(firstOfMonth(today))); setDraftTo(ymd(today)); }
  };

  const applyDraft = () => {
    if (!draftValid) return;
    setAppliedPreset(draftPreset);
    setAppliedMonth(draftMonth);
    setAppliedYear(draftYear);
    setRange(rangeForPreset(draftPreset, { today, month: draftMonth, year: draftYear, from: draftFrom, to: draftTo }));
  };

  const resetToThisMonth = () => {
    setDraftPreset('thisMonth');
    setAppliedPreset('thisMonth');
    setRange(rangeForPreset('thisMonth', { today }));
  };

  // Current year back to 5 years ago, plus any year that actually has leave
  // data (from the API once loaded) — so a genuinely old record is still
  // reachable even if it's further back than the usual 6-year window.
  const yearOptions = useMemo(() => {
    const base = Array.from({ length: 6 }, (_, i) => today.getFullYear() - i);
    const extra = data?.scope.yearsWithData || [];
    return [...new Set([...base, ...extra])].sort((a, b) => b - a);
  }, [data, today]);

  const noData = data && data.kpis.totalEmployees === 0;
  const absenceTrendMax = niceCeil(data ? Math.max(0, ...data.absenceTrend.map((d) => d.count)) : 0);
  const patternMax = niceCeil(data ? Math.max(0, ...data.monthlyLeavePattern.map((d) => d.count)) : 0);
  const patternPeak = data ? data.monthlyLeavePattern.reduce((best, p) => (p.count > (best?.count ?? -1) ? p : best), null) : null;

  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  // Workforce Overview shows whole numbers only — display rounding, the raw
  // one-decimal values from the API are untouched. Absence is derived as
  // 100 - roundedAttendance rather than rounded on its own, so the two
  // shown numbers always sum to 100 even when independent rounding
  // wouldn't (e.g. 50.4% / 49.6% both rounding the same way).
  const attendancePctRounded = data?.workforceOverview.attendancePct == null ? null : Math.round(data.workforceOverview.attendancePct);
  const absencePctRounded = attendancePctRounded === null ? null : 100 - attendancePctRounded;

  // Every chart's export shares these — the exact filters currently applied
  // to the dashboard, so an export can never show different numbers than the
  // screen it was downloaded from.
  const exportParams = { from: ymd(from), to: ymd(to), department: department === 'All' ? undefined : department };
  const periodSub = formatAppliedRange(appliedPreset, from, to, appliedMonth, appliedYear);
  const fileFor = (name) => `HR-Dashboard_${name}_${periodFileLabel(from, to)}`;

  const leaveTypePieData = (data?.leaveTypeDistribution || []).filter((d) => d.count > 0);
  // Display-only: Board of Directors and HR are excluded from this one chart
  // per request, while the underlying data, the export, and every other
  // department keep their existing numbers unchanged.
  const HIDDEN_FROM_ATTENDANCE_CHART = new Set(['Board of Directors', 'HR']);
  const attendanceByDepartmentChart = (data?.attendanceByDepartment || [])
    .filter((d) => !HIDDEN_FROM_ATTENDANCE_CHART.has(d.department));
  const leaveTypeTotal = leaveTypePieData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="box-border p-4 bg-[#F4F7FB] min-h-full">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-800">HR Attendance Dashboard</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Attendance, leave, and workforce insights across the organization.</p>
      </div>

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
      )}

      {/* ── Top block ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_380px] gap-4 items-stretch mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <div className="text-[14px] font-medium text-[#334155] mb-2">Date</div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPresetOpen((o) => !o)}
                aria-haspopup="listbox" aria-expanded={presetOpen}
                className="w-full flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 h-9 text-[13px] text-slate-700 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span className="flex items-center gap-2"><CalendarDays size={14} className="text-slate-400" />{PRESET_LABELS[draftPreset]}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {presetOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPresetOpen(false)} />
                  <div role="listbox" className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                    {PRESET_ORDER.map((key) => (
                      <button key={key} role="option" aria-selected={draftPreset === key} onClick={() => selectDraftPreset(key)}
                        className={`block w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50 ${draftPreset === key ? 'text-blue-600 font-medium' : 'text-slate-700'}`}>
                        {PRESET_LABELS[key]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {draftPreset === 'monthYear' && (
              <div className="flex items-center gap-1.5 mt-2">
                <select value={draftMonth} onChange={(e) => setDraftMonth(Number(e.target.value))} aria-label="Month"
                  className="w-full border border-slate-200 rounded-lg px-2 h-8 text-[12px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <select value={draftYear} onChange={(e) => setDraftYear(Number(e.target.value))} aria-label="Year"
                  className="w-full border border-slate-200 rounded-lg px-2 h-8 text-[12px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}

            {draftPreset === 'customRange' && (
              <>
                <div className="flex items-center gap-1.5 mt-2">
                  <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} aria-label="From date"
                    className="w-full border border-slate-200 rounded-lg px-2 h-8 text-[12px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" />
                  <span className="text-slate-300 text-xs">to</span>
                  <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} aria-label="To date"
                    className="w-full border border-slate-200 rounded-lg px-2 h-8 text-[12px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" />
                </div>
                {!draftValid && (
                  <p className="text-[11px] text-red-600 mt-1">From date must be on or before the To date.</p>
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-2 mt-2.5">
              <button type="button" onClick={applyDraft} disabled={!draftValid}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[12px] font-semibold px-4 h-7 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                Apply
              </button>
              <button type="button" onClick={resetToThisMonth} className="text-[14px] text-blue-700 hover:text-blue-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded">
                Reset
              </button>
            </div>

            <div className="text-[13px] text-[#475569] mt-2 truncate" title={`Showing: ${periodSub}`}>
              Showing: {periodSub}
            </div>
          </Card>

          <Card>
            <div className="text-[14px] font-medium text-[#334155] mb-2 flex items-center gap-1.5">
              <Building2 size={13} className="text-slate-400" /> Department
            </div>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department filter"
              className="w-full border border-slate-200 rounded-lg px-3 h-9 text-[13px] text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
              <option value="All">All</option>
              {(data?.scope.departmentsInScope || []).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Card>

          <Kpi label="Leave Approval Rate" icon={BadgeCheck} accent="teal"
            tooltip="Approved ÷ (Approved + Rejected) requests in range — pending and cancelled aren't counted either way."
            value={loading ? <ValueSkeleton /> : pct(data?.kpis.leaveApprovalRate)}
            sub={!loading ? data?.kpis.leaveApprovalRateSub : null} />
          <Kpi label="Total Employees" icon={Users} accent="blue"
            tooltip="Active employees in the current scope and department filter."
            value={loading ? <ValueSkeleton /> : data?.kpis.totalEmployees ?? 0} />
          <Kpi label="Total Leave Requests" icon={ClipboardCheck} accent="purple"
            tooltip="All leave requests in the selected date range, excluding cancelled ones."
            value={loading ? <ValueSkeleton /> : data?.kpis.totalLeaveRequests ?? 0} />
          {data?.kpis.employeeProductivity !== null ? (
            <Kpi label="Employee Productivity" icon={Gauge} accent="amber"
              tooltip="Hours worked ÷ expected hours (working days × standard hours × headcount) for the selected range."
              value={loading ? <ValueSkeleton /> : pct(data?.kpis.employeeProductivity)} />
          ) : (
            <Card className="flex items-center gap-3 py-4 min-h-[92px]">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100">
                <Gauge size={18} className="text-slate-400" />
              </div>
              <div className="text-[13px] text-[#475569]">Employee Productivity<br />Data not available</div>
            </Card>
          )}
        </div>

        <TallStat title="Workforce Overview">
          <StatBlock icon={CheckCircle2} accent="teal" label="Attendance"
            value={loading ? <ValueSkeleton /> : (attendancePctRounded === null ? '—' : `${attendancePctRounded}%`)} />
          <StatBlock icon={XCircle} accent="amber" label="Absence"
            value={loading ? <ValueSkeleton /> : (absencePctRounded === null ? '—' : `${absencePctRounded}%`)} />
        </TallStat>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading dashboard charts">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[300px]" />)}
        </div>
      ) : noData ? (
        <Card><EmptyChart message="No employees in scope for this filter." /></Card>
      ) : (
        <>
          {/* ── Row 1 ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <ChartCard title="Employee Count by Work Mode" subtitle={periodSub} icon={Users} accent="blue"
              chart="workMode" exportParams={exportParams} fileLabel={fileFor('Work-Mode')}>
              {!data.workMode.classifyEnabled ? (
                <EmptyChart message="Office/Work-from-home is not being tracked yet for this org." />
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-1">
                    <span className="flex items-center gap-1.5 text-[12px] text-[#475569]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: PALETTE.blue }} /> WFO — {data.workMode.totals.wfo}
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] text-[#475569]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: PALETTE.teal }} /> WFH — {data.workMode.totals.wfh}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      layout="vertical"
                      data={[{ name: 'WFO', value: data.workMode.totals.wfo }, { name: 'WFH', value: data.workMode.totals.wfh }]}
                      margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="gradWfo" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.blue} stopOpacity={1} />
                          <stop offset="100%" stopColor={PALETTE.blue} stopOpacity={0.55} />
                        </linearGradient>
                        <linearGradient id="gradWfh" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.teal} stopOpacity={1} />
                          <stop offset="100%" stopColor={PALETTE.teal} stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={40} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                      <Tooltip {...TOOLTIP_PROPS}
                        formatter={(v) => [`${v} person-day${v === 1 ? '' : 's'}`, 'Total']} />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28} isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                        <Cell fill="url(#gradWfo)" />
                        <Cell fill="url(#gradWfh)" />
                        <LabelList dataKey="value" position="right" {...DATA_LABEL} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="text-[13px] text-[#475569] mt-1">
                    {data.workMode.rangeDays > 1 ? 'Total person-days in the selected range (one employee present on N days counts N times)' : 'Count for the selected date'}
                  </div>
                  {data.workMode.trend.length > 0 && (
                    <>
                      <div className="text-[13px] font-medium text-[#334155] mt-3 mb-1">WFO vs WFH trend</div>
                      <ResponsiveContainer width="100%" height={90}>
                        <LineChart data={data.workMode.trend} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#475569' }} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                          <YAxis tick={{ fontSize: 12, fill: '#475569' }} allowDecimals={false} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                          <Tooltip {...TOOLTIP_PROPS} />
                          <Line type="monotone" dataKey="wfo" stroke={PALETTE.blue} strokeWidth={2} dot={false} isAnimationActive={!reducedMotion} animationDuration={animDuration} />
                          <Line type="monotone" dataKey="wfh" stroke={PALETTE.teal} strokeWidth={2} dot={false} strokeDasharray="4 3" isAnimationActive={!reducedMotion} animationDuration={animDuration} />
                        </LineChart>
                      </ResponsiveContainer>
                    </>
                  )}
                </>
              )}
            </ChartCard>

            <ChartCard title="Monthly Absence Trend" subtitle="Last 3 Months" icon={CalendarRange} accent="purple"
              chart="absenceTrend" exportParams={exportParams} fileLabel={fileFor('Monthly-Absence-Trend')}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.absenceTrend} margin={{ top: 28, right: 24, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="gradAbsence" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PALETTE.purple} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={PALETTE.purple} stopOpacity={0.12} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal vertical={false} />
                  {/* Equal padding on both sides centers each month in its own
                      third of the width, instead of the first point sitting
                      on top of the y-axis. interval left at Recharts' default
                      (auto-skip on collision): with only 3 points this keeps
                      the first and last labels and drops the middle one
                      rather than overlapping text at a narrow card width. */}
                  <XAxis dataKey="label" padding={{ left: 40, right: 40 }}
                    tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <YAxis allowDecimals={false} domain={[0, absenceTrendMax]} tickCount={5}
                    tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Area type="linear" dataKey="count" stroke={PALETTE.purple} fill="url(#gradAbsence)"
                    strokeWidth={2} dot={{ r: 4, fill: PALETTE.purple, stroke: '#fff', strokeWidth: 1 }}
                    isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                    <LabelList dataKey="count" position="top" offset={10} {...DATA_LABEL} />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Leave Type Distribution" subtitle={periodSub} icon={PieIcon} accent="teal"
              chart="leaveTypeDistribution" exportParams={exportParams} fileLabel={fileFor('Leave-Type-Distribution')}>
              {leaveTypePieData.length === 0 ? <EmptyChart /> : (
                <div className="flex flex-col sm:flex-row items-center gap-3 h-full">
                  <div className="relative flex-shrink-0" style={{ width: 180, height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leaveTypePieData} dataKey="count" nameKey="label"
                          cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2}
                          isAnimationActive={!reducedMotion} animationDuration={animDuration}
                        >
                          {leaveTypePieData.map((d, i) => <Cell key={d.code} fill={PALETTE_SEQUENCE[i % PALETTE_SEQUENCE.length]} stroke="#fff" strokeWidth={2} />)}
                        </Pie>
                        <Tooltip {...TOOLTIP_PROPS}
                          formatter={(v, n, p) => [`${p.payload.count} requests, ${p.payload.days} days, ${p.payload.pct}%`, p.payload.label]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-2xl font-bold text-slate-800">{leaveTypeTotal}</div>
                      <div className="text-[12px] text-[#475569]">Requests</div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 w-full space-y-1.5">
                    {leaveTypePieData.map((d, i) => (
                      <div key={d.code} className="flex items-center gap-2 text-[13px]">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PALETTE_SEQUENCE[i % PALETTE_SEQUENCE.length] }} />
                        <span className="text-[#475569] truncate flex-1">{d.label}</span>
                        <span className="text-[#475569]">{d.count}</span>
                        <span className="font-semibold text-slate-700 w-10 text-right">{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Row 2 ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <ChartCard title="Monthly Leave Pattern" subtitle={data.monthlyLeavePatternLabel} icon={BarChart3} accent="blue"
              chart="monthlyLeavePattern" exportParams={exportParams} fileLabel={fileFor('Monthly-Leave-Pattern')}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.monthlyLeavePattern} margin={{ top: 20, right: 16, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPattern" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PALETTE.blue} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={PALETTE.blue} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#475569' }} interval={2} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} domain={[0, patternMax]} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Area type="monotone" dataKey="count" stroke={PALETTE.blue} fill="url(#gradPattern)" strokeWidth={2}
                    dot={(props) => (props.payload.day === patternPeak?.day && patternPeak.count > 0
                      ? <circle key={`peak-${props.payload.day}`} cx={props.cx} cy={props.cy} r={4} fill={PALETTE.blue} stroke="#fff" strokeWidth={1.5} />
                      : <React.Fragment key={`pt-${props.payload.day}`} />)}
                    isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                    <LabelList dataKey="count" position="top" fontSize={10} fill="#475569"
                      formatter={(v) => (v > 0 ? v : '')} />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Employees by Experience Group" subtitle="Years" icon={Briefcase} accent="amber"
              chart="experienceGroups" exportParams={exportParams} fileLabel={fileFor('Experience-Groups')}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.experienceGroups} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradExperience" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PALETTE.orange} stopOpacity={1} />
                      <stop offset="100%" stopColor={PALETTE.orange} stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Bar dataKey="count" fill="url(#gradExperience)" radius={[6, 6, 0, 0]} barSize={36} isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                    <LabelList dataKey="count" position="top" {...DATA_LABEL} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {data.experienceNoDataCount > 0 && (
                <div className="text-[13px] text-[#475569] mt-1">
                  {data.experienceNoDataCount} employee{data.experienceNoDataCount !== 1 ? 's' : ''} have no experience data
                </div>
              )}
            </ChartCard>

            <ChartCard title="Attendance Rate by Department" subtitle={periodSub} icon={Building2} accent="green"
              chart="attendanceByDepartment" exportParams={exportParams} fileLabel={fileFor('Attendance-by-Department')}>
              {attendanceByDepartmentChart.length === 0 ? <EmptyChart /> : (
                // Every department in scope gets a bar now (0% when it has no
                // attendance data, not dropped) — so the list can run long.
                // The area grows with the department count and the card
                // itself scrolls past ~420px, rather than squeezing labels.
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <ResponsiveContainer width="100%" height={Math.max(240, attendanceByDepartmentChart.length * 32)}>
                    <BarChart layout="vertical" data={attendanceByDepartmentChart} margin={{ top: 4, right: 36, left: 16, bottom: 4 }}>
                      <defs>
                        <linearGradient id="gradDept" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.green} stopOpacity={1} />
                          <stop offset="100%" stopColor={PALETTE.green} stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <XAxis type="number" domain={[0, 100]} hide />
                      <YAxis type="category" dataKey="department" width={170} tick={{ fontSize: 12, fill: '#475569' }} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                      <Tooltip {...TOOLTIP_PROPS} formatter={(v, n, p) => [`${p.payload.employees} employees, ${p.payload.actualHours}h / ${p.payload.expectedHours}h expected, ${v}%`, p.payload.department]} />
                      <Bar dataKey="pct" fill="url(#gradDept)" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                        <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} fontSize={12} fontWeight={600} fill="#1E293B" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Row 3 — full-width so its labels have room ──────────── */}
          <div className="grid grid-cols-1 gap-4 mt-4">
            <ChartCard title="Top Leave Reasons" subtitle={periodSub} icon={MessageSquare} accent="purple"
              chart="topLeaveReasons" exportParams={exportParams} fileLabel={fileFor('Top-Leave-Reasons')}>
              {!data.topLeaveReasons.hasAnyReason ? (
                <EmptyChart message="No reasons recorded for this period" />
              ) : (
                <>
                  {data.topLeaveReasons.insight && (
                    <div className="text-[13px] text-[#475569] mb-2">{data.topLeaveReasons.insight}</div>
                  )}
                  <ResponsiveContainer width="100%" height={Math.max(160, data.topLeaveReasons.groups.length * 36)}>
                    <BarChart
                      layout="vertical"
                      data={data.topLeaveReasons.groups.map((g) => ({ ...g, labelWithCount: `${g.label} (${g.count})` }))}
                      margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
                    >
                      <XAxis type="number" domain={[0, 100]} hide />
                      <YAxis type="category" dataKey="labelWithCount" width={220} tick={{ fontSize: 13, fill: '#475569' }} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
                      <Tooltip {...TOOLTIP_PROPS}
                        formatter={(v, n, p) => [`${v}% (${p.payload.count})`, p.payload.label]}
                        labelFormatter={(label, p) => (p?.[0]?.payload?.examples?.length ? `Includes: ${p[0].payload.examples.join(', ')}` : label)}
                      />
                      <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={20} isAnimationActive={!reducedMotion} animationDuration={animDuration}>
                        {data.topLeaveReasons.groups.map((_, i) => <Cell key={i} fill={PALETTE_SEQUENCE[i % PALETTE_SEQUENCE.length]} />)}
                        <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} fontSize={12} fontWeight={600} fill="#1E293B" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
