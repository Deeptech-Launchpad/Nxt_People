import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, X, SlidersHorizontal,
  MoreHorizontal, Download, Upload, History, Plus,
} from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from '../leavetracker/useEmployeeList';
import RegularizeModal from '../../../components/requests/RegularizeModal';
import OnDutyModal from '../../../components/requests/OnDutyModal';
import useSortable from '../../../components/table/useSortable';
import SortableTh from '../../../components/table/SortableTh';
import { useLocaleFormat, formatTime, formatInstantTime } from '../../../utils/datetime';
import { AttendanceTimelineList, AttendanceListTable, AttendanceCalendarMonth } from '../../attendance/attendanceViews';

/* ── User-specific Operations ─────────────────────────────────────────────
 *  Zoho's first Attendance tab: search an employee, then act on THEIR
 *  attendance rather than your own. Four sub-tabs, each an existing,
 *  already-correct endpoint that learned to accept ?employeeId= for a
 *  full-access caller rather than a parallel admin copy of each.
 *
 *  Attendance Summary draws EVERY day of the period, not only the days with
 *  a punch. Drawing only the punches was the single most misleading thing on
 *  this screen: a seven-day week showed three lines, so a weekend looked the
 *  same as a day nobody came in, and an absence — which is the absence of a
 *  row — could not be seen at all. The month's shape now comes from the
 *  server alongside the punches, so weekends and holidays are labelled and
 *  the gaps are visible as gaps.
 *
 *  The person view is exported as UserAttendanceTabs because Attendance →
 *  Team opens the same four tabs on a reportee. It takes its roster and its
 *  `canManage` from the caller: the Operations door is full-access, the Team
 *  door is a manager, and the two are allowed to do different things to
 *  somebody else's attendance. Two copies of this screen would be two chances
 *  for a reportee's month to read differently depending on how you got there.
 */
const STATUS_LABEL = {
  present: { label: 'Present', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  late: { label: 'Late', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-600 border-red-200' },
  'half-day': { label: 'Half Day', cls: 'bg-blue-100 text-blue-600 border-blue-200' },
  on_duty: { label: 'On Duty', cls: 'bg-violet-100 text-violet-600 border-violet-200' },
  weekend: { label: 'Weekend', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  holiday: { label: 'Holiday', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
};
const StatusPill = ({ status, title }) => {
  const s = STATUS_LABEL[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  return <span title={title} className={`text-[12px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>;
};

const fmtTime = (iso, timeFormat) => (iso ? formatInstantTime(iso, timeFormat) : '—');

/* Hours as HH:MM.
 *
 * The sign has to be pulled out before the arithmetic: JS keeps it on the
 * remainder, so -129.05 hours came out as "-130:-3" — which is what the
 * ledger column was showing before the balance itself was fixed. A negative
 * should be rare now, but a formatter that cannot render one is a formatter
 * waiting to print nonsense. */
const fmtHM = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '00:00';
  const neg = Number(n) < 0;
  const total = Math.round(Math.abs(Number(n)) * 60);
  const s = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};

/* Every date on this screen is a YYYY-MM-DD string — the endpoints send them
 * that way now. Slicing anyway costs nothing and means a caller that hands
 * over a timestamp gets a date rather than "Invalid Date", which is exactly
 * what this screen used to print in every row of every view. */
const ymdOf = (v) => String(v || '').slice(0, 10);
const fmtDate = (v) => {
  const d = new Date(`${ymdOf(v)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
};
const fmtDateFull = (v) => {
  const d = new Date(`${ymdOf(v)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
// attendance_regularizations.check_in/out are TIME columns — pg returns
// "09:30:00" as a plain string, not a value Date() can be pointed at.
const fmtTimeStr = (hms, timeFormat) => formatTime(hms, timeFormat) || '—';
/* A shift reads in the same 12-hour clock as the rest of the product. It was
 * the one place left printing 09:30 - 18:00. */
const fmtShiftLabel = (shift, timeFormat) => {
  if (!shift?.name) return '';
  const t = (hms) => fmtTimeStr(hms, timeFormat);
  return `${shift.name} [ ${t(shift.startTime)} - ${t(shift.endTime)} ]`;
};

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* The export is built here from rows already on screen — there is no server
 * endpoint for one employee's month, and asking for one would mean the file
 * could disagree with the table it came from. utils/downloadFile fetches FROM
 * the server, so it is the wrong tool for a blob we already hold. */
const saveCsv = (rows, filename) => {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const REG_STATUS = [['all', 'All'], ['approved', 'Approved'], ['pending', 'Pending'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']];
const ONDUTY_STATUS = [['all', 'All'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']];
const REQ_STATUS_CLS = {
  approved: 'bg-emerald-100 text-emerald-700', pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600', cancelled: 'bg-slate-100 text-slate-500', submitted: 'bg-amber-100 text-amber-700',
};

/* ── the period being looked at ───────────────────────────────────────────
 * Monthly by default, weekly on request — the two the reference offers. A
 * period is a {start,end} pair of YYYY-MM-DD strings plus a label, so every
 * view and every export works from the same window. */
const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodOf(mode, anchor) {
  const a = new Date(anchor);
  if (mode === 'weekly') {
    const start = new Date(a); start.setDate(a.getDate() - a.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return {
      start: toYmd(start), end: toYmd(end),
      label: `${fmtDateFull(toYmd(start))} - ${fmtDateFull(toYmd(end))}`,
      month: start.getMonth(), year: start.getFullYear(),
    };
  }
  const start = new Date(a.getFullYear(), a.getMonth(), 1);
  const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return {
    start: toYmd(start), end: toYmd(end),
    label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    month: start.getMonth(), year: start.getFullYear(),
  };
}
const stepPeriod = (mode, anchor, dir) => {
  const d = new Date(anchor);
  if (mode === 'weekly') d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  return d;
};

/* A day, as the screen needs it: the punch if there was one, and what the day
 * was supposed to be if there wasn't. */
function buildDays(period, rows, calendar) {
  const byDate = new Map((rows || []).map(r => [ymdOf(r.date), r]));
  const shape = new Map((calendar || []).map(c => [c.date, c]));
  const out = [];
  const cur = new Date(`${period.start}T00:00:00`);
  const last = new Date(`${period.end}T00:00:00`);
  const today = toYmd(new Date());
  while (cur <= last) {
    const ymd = toYmd(cur);
    const att = byDate.get(ymd) || null;
    const kind = shape.get(ymd)?.kind || 'working';
    out.push({
      date: ymd,
      att,
      kind,
      holidayName: shape.get(ymd)?.holidayName || null,
      isFuture: ymd > today,
      /* A working day, in the past, with nothing recorded, is an absence.
       * Saying so is the entire point of drawing the empty days. */
      derivedStatus: att?.status
        || (kind === 'holiday' ? 'holiday' : kind === 'weekend' ? 'weekend' : (ymd > today ? null : 'absent')),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/* The hours a day is worth right now. A day still open counts the stretch
 * being worked, which is why a person who checked in this morning no longer
 * reads 00:00 while they are sitting at their desk. */
const hoursOf = (att) => {
  const banked = Number(att?.workingHours) || 0;
  if (!att?.checkIn || att?.checkOut) return banked;
  const from = new Date(att.sessionStartedAt || att.checkIn).getTime();
  if (!Number.isFinite(from)) return banked;
  const open = Math.max(0, (Date.now() - from) / 3600000);
  /* Guarded the same way the employee's own timer is: a stretch this long is
   * a missed check-out, not work, and adding it would inflate the month. */
  return open > 18 ? banked : banked + open;
};

/* ── views ───────────────────────────────────────────────────────────────── */
/* Timeline, List and Calendar all live in attendanceViews.jsx now — the same
 * three views My Attendance draws for your own days. One implementation, so
 * a reportee's day looks the same whether you open it from Team or from
 * Operations, and the same as it looks to them. */

/* The period totalled, the way the reference footers it. Days and Hours are
 * two readings of the same window, so they are a toggle rather than two
 * places to look. */
function SummaryFooter({ days, shiftLabel }) {
  const [unit, setUnit] = useState('days');
  const t = useMemo(() => {
    const acc = { present: 0, absent: 0, onDuty: 0, holidays: 0, weekend: 0, payable: 0, hours: 0, expected: 0 };
    for (const d of days) {
      acc.hours += hoursOf(d.att);
      if (d.kind === 'holiday') { acc.holidays++; acc.payable++; continue; }
      if (d.kind === 'weekend') { acc.weekend++; continue; }
      if (d.isFuture) continue;
      acc.expected++;
      if (d.att?.status === 'on_duty') { acc.onDuty++; acc.payable++; continue; }
      if (d.att?.checkIn) { acc.present++; acc.payable++; continue; }
      acc.absent++;
    }
    return acc;
  }, [days]);

  const Cell = ({ label, value }) => (
    <div className="px-4 border-l border-slate-200 first:border-l-0">
      <div className="text-[12px] text-slate-400">{label}</div>
      <div className="text-[14px] font-semibold text-slate-700">{value}</div>
    </div>
  );

  return (
    <div className="mt-4 flex items-center justify-between gap-4 flex-wrap bg-white border border-slate-200 rounded-2xl px-4 py-3">
      <div className="flex items-center">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden mr-4">
          {[['days', 'Days'], ['hours', 'Hours']].map(([id, label]) => (
            <button key={id} onClick={() => setUnit(id)}
              className={`px-3 py-1 text-[12.5px] font-medium ${unit === id ? 'bg-slate-100 text-slate-700' : 'bg-white text-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
        {unit === 'days' ? (
          <div className="flex items-center">
            <Cell label="Payable Days" value={`${t.payable} Days`} />
            <Cell label="Present" value={`${t.present} Days`} />
            <Cell label="On Duty" value={`${t.onDuty} Day`} />
            <Cell label="Absent" value={`${t.absent} Days`} />
            <Cell label="Holidays" value={`${t.holidays} Day`} />
            <Cell label="Weekend" value={`${t.weekend} Days`} />
          </div>
        ) : (
          <div className="flex items-center">
            <Cell label="Worked" value={fmtHM(t.hours)} />
            <Cell label="Days counted" value={`${t.expected} Days`} />
          </div>
        )}
      </div>
      {shiftLabel && <span className="text-[13px] text-slate-500">{shiftLabel}</span>}
    </div>
  );
}

/* The `...` menu: import, export, audit — the three the reference keeps
 * there. Import is the module's own Check-in/out Import & Export tab rather
 * than a second importer that would drift from it. */
function OverflowMenu({ onExport, onAudit, onImport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const Item = ({ icon: Icon, label, onClick }) => (
    <button onClick={() => { setOpen(false); onClick(); }}
      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[14px] text-slate-600 hover:bg-slate-50 text-left">
      <Icon size={15} className="text-slate-400" /> {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title="More"
        className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
        <MoreHorizontal size={16} />
      </button>
      {/* Import lands on an Operations-only screen and Audit History reads
          /audit, which is full-access only. Offering either to a manager would
          be offering a 403, so they are dropped rather than shown disabled. */}
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30">
          {onImport && <Item icon={Upload} label="Import" onClick={onImport} />}
          <Item icon={Download} label="Export" onClick={onExport} />
          {onAudit && <Item icon={History} label="Audit History" onClick={onAudit} />}
        </div>
      )}
    </div>
  );
}

function AuditDialog({ employee, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get(`/audit?resourceId=${employee._id}&limit=50`)
      .then(r => setRows(r.data.data || []))
      .catch(() => setRows([]));
  }, [employee._id]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl my-8 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-lg">Audit History</h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {rows === null ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-center text-slate-400 py-12">Nothing recorded against this employee yet.</p>
          ) : (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r._id} className="border border-slate-100 rounded-lg px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px] text-slate-700">{r.action} · {r.resource}</span>
                    <span className="text-[12.5px] text-slate-400 flex-shrink-0">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : ''}
                    </span>
                  </div>
                  {r.changes?.summary && <p className="text-[13px] text-slate-500 mt-0.5">{r.changes.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Attendance Summary ──────────────────────────────────────────────────── */

const VIEWS = [['list', 'List'], ['timeline', 'Timeline'], ['calendar', 'Calendar']];

function AttendanceSummaryTab({ employee, onGoTo, canManage = true }) {
  const { timeFormat } = useLocaleFormat();
  const [mode, setMode] = useState('monthly');
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [view, setView] = useState('list');
  const [showFilter, setShowFilter] = useState(false);
  const [request, setRequest] = useState(null);   // { type: 'regularization' | 'onduty', date }
  const [showAudit, setShowAudit] = useState(false);
  const [reload, setReload] = useState(0);

  const period = useMemo(() => periodOf(mode, anchor), [mode, anchor]);

  useEffect(() => {
    setRows(null);
    /* The month is what the endpoint serves, and a week is a slice of it —
     * one request either way, and the week view never straddles two months
     * without asking for the second. */
    const months = new Set([`${period.year}-${period.month}`]);
    const endD = new Date(`${period.end}T00:00:00`);
    months.add(`${endD.getFullYear()}-${endD.getMonth()}`);
    Promise.all([...months].map(k => {
      const [y, m] = k.split('-').map(Number);
      return api.get(`/attendance/my?month=${m}&year=${y}&employeeId=${employee._id}`);
    }))
      .then(res => {
        setRows(res.flatMap(r => r.data.data || []));
        setCalendar(res.flatMap(r => r.data.calendar || []));
      })
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load attendance'); setRows([]); setCalendar([]); });
  }, [employee._id, period.start, period.end, period.month, period.year, reload]);

  const days = useMemo(() => (rows === null ? [] : buildDays(period, rows, calendar)), [rows, calendar, period]);
  const shiftLabel = fmtShiftLabel(employee.shift, timeFormat);

  /* The shape attendanceViews.jsx draws -- the same one My Attendance builds
   * for its own week, so a reportee's timeline, list and calendar are pixel
   * for pixel what they would see of themselves. */
  const todayYmd = toYmd(new Date());
  const sharedDays = useMemo(() => days.map(d => ({
    date: d.date,
    isToday: d.date === todayYmd,
    isFuture: d.isFuture,
    isLoaded: true,
    off: d.kind === 'holiday' ? { kind: 'holiday', label: d.holidayName || 'Holiday' }
       : d.kind === 'weekend' ? { kind: 'weekend', label: 'Weekend' }
       : null,
    record: d.att ? {
      checkIn: d.att.checkIn, checkOut: d.att.checkOut, sessions: d.att.sessions,
      workingHours: d.att.workingHours, lateMinutes: d.att.lateMinutes,
      sessionStartedAt: d.att.sessionStartedAt, status: d.att.status,
    } : null,
  })), [days, todayYmd]);

  const [rowRequest, setRowRequest] = useState(null); // { date, buttonRect } -- the hover Add Request popup

  const exportCsv = () => {
    const head = ['Date', 'Day type', 'First In', 'Last Out', 'Total Hours', 'Status', 'Late By'];
    const lines = days.map(d => [
      d.date,
      d.kind === 'holiday' ? (d.holidayName || 'Holiday') : titleCase(d.kind),
      fmtTime(d.att?.checkIn), fmtTime(d.att?.checkOut),
      fmtHM(hoursOf(d.att)),
      d.derivedStatus ? (STATUS_LABEL[d.derivedStatus]?.label || d.derivedStatus) : '',
      d.att?.lateMinutes > 0 ? fmtHM(d.att.lateMinutes / 60) : '',
    ]);
    saveCsv([head, ...lines], `attendance-${employee.employeeId || employee._id}-${period.start}.csv`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(a => stepPeriod(mode, a, -1))}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
          <span className="text-[15px] font-medium text-slate-700 min-w-[210px] text-center">{period.label}</span>
          <button onClick={() => setAnchor(a => stepPeriod(mode, a, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {shiftLabel && <span className="text-[13px] text-slate-400 mr-1">{shiftLabel}</span>}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {VIEWS.map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  view === id ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Raise a correction for this person without leaving the screen —
              the reference's Request button. The request belongs to them; the
              server routes it through their approvers, not ours.
              Full access only: raising on somebody else's behalf is a
              full-access power, and the POST silently files on the caller
              instead of refusing, so a manager's click would quietly land on
              their own day. */}
          {canManage && <RequestMenu onPick={(type) => setRequest({ type, date: toYmd(new Date()) })} />}

          <div className="relative">
            <button onClick={() => setShowFilter(f => !f)} title="Filter"
              className={`w-9 h-9 flex items-center justify-center rounded-lg border ${
                showFilter ? 'border-brand-300 bg-brand-50 text-brand-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              <SlidersHorizontal size={15} />
            </button>
            {showFilter && (
              <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-30">
                <p className="text-[13px] font-medium text-slate-600 mb-1.5">Period</p>
                <select value={mode} onChange={e => { setMode(e.target.value); setShowFilter(false); }}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[14px] focus:outline-none focus:border-brand-400">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            )}
          </div>

          <OverflowMenu onExport={exportCsv}
            onAudit={canManage ? () => setShowAudit(true) : undefined}
            onImport={canManage ? () => onGoTo('import') : undefined} />
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {view === 'timeline'
            ? <AttendanceTimelineList days={sharedDays} timeFormat={timeFormat}
                onAddRequest={canManage ? (date, buttonRect) => setRowRequest({ date, buttonRect }) : undefined} />
            : view === 'calendar'
              ? <AttendanceCalendarMonth year={period.year} month={period.month} days={sharedDays} />
              : <AttendanceListTable days={sharedDays} timeFormat={timeFormat} sortId="user-attendance-summary"
                  onQuickRegularize={canManage ? (date) => setRequest({ type: 'regularization', date }) : undefined} />}
          <SummaryFooter days={days} shiftLabel={shiftLabel} />
        </>
      )}

      {rowRequest && (
        <RowRequestPopup buttonRect={rowRequest.buttonRect}
          onClose={() => setRowRequest(null)}
          onPick={(type) => { setRequest({ type, date: rowRequest.date }); setRowRequest(null); }} />
      )}

      {request?.type === 'regularization' && (
        <RegularizeModal date={request.date} employeeId={employee._id}
          onClose={() => setRequest(null)}
          onDone={() => { setRequest(null); setReload(n => n + 1); }} />
      )}
      {request?.type === 'onduty' && (
        <OnDutyModal date={request.date} employeeId={employee._id}
          onClose={() => setRequest(null)}
          onDone={() => { setRequest(null); setReload(n => n + 1); }} />
      )}
      {showAudit && <AuditDialog employee={employee} onClose={() => setShowAudit(false)} />}
    </div>
  );
}

/* The Timeline row's own hover "Add Request", offering the same two options
 * the header's does, but against the day that was hovered rather than today.
 * Positioned off the button's own rect, the way My Attendance's row menu is. */
function RowRequestPopup({ buttonRect, onClose, onPick }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999, ready: false });

  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !buttonRect) return;
    const GUTTER = 16;
    const menuH = el.offsetHeight, menuW = el.offsetWidth;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const openAbove = spaceBelow < menuH + GUTTER && buttonRect.top > spaceBelow;
    const top = openAbove ? Math.max(GUTTER, buttonRect.top - menuH - 6) : Math.min(window.innerHeight - menuH - GUTTER, buttonRect.bottom + 6);
    const left = Math.max(GUTTER, Math.min(buttonRect.right - menuW, window.innerWidth - menuW - GUTTER));
    setPos({ left, top, ready: true });
  }, [buttonRect]);

  return (
    <div ref={ref} className="fixed z-50 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.12)] border border-slate-100 w-48 py-1"
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}>
      {[['regularization', 'Regularization'], ['onduty', 'On Duty']].map(([id, label]) => (
        <button key={id} onClick={() => onPick(id)}
          className="w-full px-3.5 py-2 text-[14px] text-slate-600 hover:bg-slate-50 text-left">
          {label}
        </button>
      ))}
    </div>
  );
}

function RequestMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium">
        <Plus size={15} /> Request <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30">
          {[['regularization', 'Regularization'], ['onduty', 'On Duty']].map(([id, label]) => (
            <button key={id} onClick={() => { setOpen(false); onPick(id); }}
              className="w-full px-3.5 py-2 text-[14px] text-slate-600 hover:bg-slate-50 text-left">
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Expected vs Worked Hours ────────────────────────────────────────────── */

function ExpectedVsWorkedTab({ employee }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    /* One row per calendar month, newest first. The month in progress runs to
     * TODAY, not to its last date: comparing three days of work against a
     * whole month of expected hours is what made the current row look like a
     * catastrophic shortfall. */
    const now = new Date();
    const todayYmd = toYmd(now);
    const months = Array.from({ length: 9 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = toYmd(d);
      const monthEnd = toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      return { start, end: monthEnd > todayYmd ? todayYmd : monthEnd };
    });
    Promise.all(months.map(({ start, end }) =>
      api.get(`/reports/attendance/expected-vs-worked?startDate=${start}&endDate=${end}&employeeId=${employee._id}`)
        .then(r => ({ start, end, row: (r.data.data || [])[0] || null }))
    ))
      .then(setRows)
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load the hours ledger'); setRows([]); });
  }, [employee._id]);

  const sort = useSortable(rows, {
    id: 'user-expected-vs-worked',
    columns: {
      from: { get: x => x.start, type: 'date' },
      to: { get: x => x.end, type: 'date' },
      previousBalance: { get: x => x.row?.previousBalance ?? null, type: 'number' },
      expectedHours: { get: x => x.row?.expectedHours ?? null, type: 'number' },
      payableHours: { get: x => x.row?.payableHours ?? null, type: 'number' },
      paidHours: { get: x => x.row?.paidHours ?? null, type: 'number' },
      adjustmentHours: { get: x => x.row?.adjustmentHours ?? null, type: 'number' },
      balanceHours: { get: x => x.row?.balanceHours ?? null, type: 'number' },
    },
  });
  const Head = ({ k, children }) => (
    <SortableTh sort={sort} k={k} className="px-4 py-3 font-medium whitespace-nowrap">{children}</SortableTh>
  );

  return (
    <div>
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="border border-slate-200 rounded-2xl overflow-auto">
            <table className="w-full text-[14.5px] min-w-max">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-500 text-sm">
                  <Head k="from">From</Head><Head k="to">To</Head><Head k="previousBalance">Previous Balance</Head>
                  <Head k="expectedHours">Expected Hours</Head><Head k="payableHours">Payable Hours</Head><Head k="paidHours">Paid Hours</Head>
                  <Head k="adjustmentHours">Adjustment Hours</Head><Head k="balanceHours">Balance Hours</Head>
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map(({ start, end, row }) => (
                  <tr key={start} className="border-t border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDateFull(start)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDateFull(end)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.previousBalance)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.expectedHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.payableHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.paidHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">{fmtHM(row?.adjustmentHours)}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{fmtHM(row?.balanceHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-slate-500 mt-3 px-1">
            Overtime banks into the balance; a month worked short is simply not paid and the balance
            reopens at zero rather than carrying a debt forward. Adjustment Hours has no manual entry
            facility yet, so it always reads 00:00.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Regularization ──────────────────────────────────────────────────────── */

/* Both request tabs step through months and count what they found, the way
 * every other list in the reference does. */
function MonthBar({ anchor, setAnchor, status, setStatus, options, count, onAdd }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div className="flex items-center gap-2">
        <button onClick={() => setAnchor(a => stepPeriod('monthly', a, -1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
        <span className="text-[15px] font-medium text-slate-700 min-w-[150px] text-center">
          {anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => setAnchor(a => stepPeriod('monthly', a, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-slate-400">{count} record{count === 1 ? '' : 's'}</span>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-brand-400">
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {onAdd && (
          <button onClick={onAdd}
            className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium">
            <Plus size={15} /> Add Request
          </button>
        )}
      </div>
    </div>
  );
}

const inMonth = (ymd, anchor) => {
  const d = ymdOf(ymd);
  return d.slice(0, 7) === `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
};

function RegularizationTab({ employee, canFile = true }) {
  const { timeFormat } = useLocaleFormat();
  const [status, setStatus] = useState('all');
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setRows(null);
    api.get(`/regularizations/my?employeeId=${employee._id}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load regularizations'); setRows([]); });
  }, [employee._id, reload]);

  const filtered = useMemo(() => (rows || [])
    .filter(r => status === 'all' || r.status === status)
    .filter(r => inMonth(r.date, anchor)), [rows, status, anchor]);

  /* What the request WOULD make the day, so the table reads as the
   * before-and-after it is rather than a pair of times with no context. */
  const newHoursOf = (r) => {
    if (!r.checkIn || !r.checkOut) return null;
    const [h1, m1] = String(r.checkIn).split(':').map(Number);
    const [h2, m2] = String(r.checkOut).split(':').map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    return mins > 0 ? mins / 60 : null;
  };

  const sort = useSortable(filtered, {
    id: 'user-regularization',
    columns: {
      date: { get: r => ymdOf(r.date) || null, type: 'date' },
      oldHours: { get: r => (r.oldHours == null ? null : Number(r.oldHours)), type: 'number' },
      newHours: { get: newHoursOf, type: 'number' },
      oldStatus: { get: r => (r.oldStatus ? (STATUS_LABEL[r.oldStatus]?.label || r.oldStatus) : null), type: 'text' },
      requested: { get: r => (r.checkIn ? String(r.checkIn) : null), type: 'text' },
      reason: { get: r => r.reason, type: 'text' },
      status: { get: r => r.status, type: 'text' },
    },
  });

  return (
    <div>
      <MonthBar anchor={anchor} setAnchor={setAnchor} status={status} setStatus={setStatus}
        options={REG_STATUS} count={filtered.length}
        onAdd={canFile ? () => setAdding(true) : undefined} />
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No regularization requests for this month.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <SortableTh sort={sort} k="date" className="px-4 py-3 font-medium" rowSpan={2}>Worked day</SortableTh>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Hours</th>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Status</th>
                <SortableTh sort={sort} k="requested" className="px-4 py-3 font-medium border-l border-slate-200" rowSpan={2}>Requested</SortableTh>
                <SortableTh sort={sort} k="reason" className="px-4 py-3 font-medium" rowSpan={2}>Reason</SortableTh>
                <SortableTh sort={sort} k="status" className="px-4 py-3 font-medium" rowSpan={2}>Approval Status</SortableTh>
              </tr>
              <tr className="text-left text-slate-400 text-[12.5px]">
                <SortableTh sort={sort} k="oldHours" className="px-4 py-1.5 font-medium border-l border-slate-200">Old</SortableTh>
                <SortableTh sort={sort} k="newHours" className="px-4 py-1.5 font-medium">New</SortableTh>
                <SortableTh sort={sort} k="oldStatus" className="px-4 py-1.5 font-medium border-l border-slate-200">Old</SortableTh>
                <th className="px-4 py-1.5 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(r => {
                const nh = newHoursOf(r);
                return (
                  <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 border-l border-slate-100">{fmtHM(r.oldHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{nh === null ? '—' : fmtHM(nh)}</td>
                    <td className="px-4 py-3 border-l border-slate-100">
                      {r.oldStatus ? <StatusPill status={r.oldStatus} /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {/* Only an approved request has actually changed the day.
                          Anything else is still a proposal, and printing a new
                          status for it would claim the change already landed. */}
                      {r.status === 'approved' ? <StatusPill status="present" /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap border-l border-slate-100">
                      {fmtTimeStr(r.checkIn, timeFormat)} – {fmtTimeStr(r.checkOut, timeFormat)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate" title={r.reason}>{r.reason || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${REQ_STATUS_CLS[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {titleCase(r.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <RegularizeModal date={toYmd(new Date())} employeeId={employee._id}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); setReload(n => n + 1); }} />
      )}
    </div>
  );
}

/* ── On Duty ─────────────────────────────────────────────────────────────── */

function OnDutyTab({ employee, canFile = true }) {
  const [status, setStatus] = useState('all');
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setRows(null);
    api.get(`/on-duty/my?employeeId=${employee._id}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load on-duty requests'); setRows([]); });
  }, [employee._id, reload]);

  const filtered = useMemo(() => (rows || [])
    .filter(r => status === 'all' || r.status === status)
    /* A request spanning a month boundary belongs to both months, so the
     * month it started in is not enough to decide whether to show it. */
    .filter(r => inMonth(r.startDate, anchor) || inMonth(r.endDate, anchor)), [rows, status, anchor]);

  /* Zoho reads "4 day(s)" or "03:00 hours"; the row already carries the unit
   * and the span, so the label is derived rather than stored. */
  const durationOf = (r) => {
    if (r.unit === 'hours') return `${fmtHM(Number(r.hours) || 0)} hours`;
    const days = Number(r.hours);
    if (Number.isFinite(days) && days > 0) return `${days} day(s)`;
    const span = Math.round(
      (new Date(`${ymdOf(r.endDate)}T00:00:00`) - new Date(`${ymdOf(r.startDate)}T00:00:00`)) / 86400000) + 1;
    return `${span} day(s)`;
  };

  const sort = useSortable(filtered, {
    id: 'user-on-duty',
    columns: {
      period: { get: r => ymdOf(r.startDate) || null, type: 'date' },
      type: { get: r => titleCase(r.requestType) || null, type: 'text' },
      duration: { get: r => (r.unit === 'hours' ? Number(r.hours) || 0 : parseFloat(durationOf(r)) * 24), type: 'number' },
      reason: { get: r => r.reason, type: 'text' },
      status: { get: r => r.status, type: 'text' },
    },
  });

  return (
    <div>
      <MonthBar anchor={anchor} setAnchor={setAnchor} status={status} setStatus={setStatus}
        options={ONDUTY_STATUS} count={filtered.length}
        onAdd={canFile ? () => setAdding(true) : undefined} />
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No on-duty requests for this month.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <SortableTh sort={sort} k="period" className="px-4 py-3 font-medium">Period</SortableTh>
                <SortableTh sort={sort} k="type" className="px-4 py-3 font-medium">Type</SortableTh>
                <SortableTh sort={sort} k="duration" className="px-4 py-3 font-medium">Duration</SortableTh>
                <SortableTh sort={sort} k="reason" className="px-4 py-3 font-medium">Reason</SortableTh>
                <SortableTh sort={sort} k="status" className="px-4 py-3 font-medium">Approval Status</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(r => (
                <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {fmtDate(r.startDate)}
                    {r.endDate && ymdOf(r.endDate) !== ymdOf(r.startDate) ? ` – ${fmtDate(r.endDate)}` : ''}
                  </td>
                  {/* The stored value is client_visit; nobody should have to
                      read a column name out of a database. */}
                  <td className="px-4 py-3 text-slate-600">{titleCase(r.requestType) || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{durationOf(r)}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[280px] truncate" title={r.reason}>{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${REQ_STATUS_CLS[r.status] || 'bg-slate-100 text-slate-500'}`}>
                      {titleCase(r.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <OnDutyModal date={toYmd(new Date())} employeeId={employee._id}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); setReload(n => n + 1); }} />
      )}
    </div>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

/* `full: true` marks a tab whose endpoint is full-access-only underneath.
 * Expected vs Worked reads /reports/attendance/expected-vs-worked, which
 * authorizes admin, director, hr_admin and manager but NOT team_incharge —
 * so a Team Incharge opening it got a 403 and nine error toasts, one per
 * month fetched. The tab is dropped for them rather than the role being added
 * to a reports route: hiding a door is a UI fix, opening one is an
 * access-control decision. */
const SUBTABS = [
  ['summary', 'Attendance Summary', AttendanceSummaryTab],
  ['expected', 'Expected vs Worked Hours', ExpectedVsWorkedTab, { full: true }],
  ['regularization', 'Regularization', RegularizationTab],
  ['onduty', 'On Duty', OnDutyTab],
];

const subtabsFor = (canManage) => SUBTABS.filter(([, , , o]) => canManage || !o?.full);

const Avatar = ({ person, size = 32 }) => (
  person?.photoUrl
    ? <img src={person.photoUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover flex-shrink-0" />
    : <span style={{ width: size, height: size }}
        className="rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-[12px] font-semibold flex-shrink-0">
        {(person?.firstName || '?').charAt(0).toUpperCase()}
      </span>
);

/* Switch person without going back to the search first. */
function EmployeeSwitcher({ people, picked, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter(p => !needle || labelOf(p).toLowerCase().includes(needle)).slice(0, 40);
  }, [q, people]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-100">
        <Avatar person={picked} />
        <span className="text-[15px] font-semibold text-slate-800">{labelOf(picked)}</span>
        <ChevronDown size={16} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search employee"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-brand-400" />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {matches.map(p => (
              <button key={p._id} onClick={() => { setOpen(false); setQ(''); onPick(p); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left ${
                  p._id === picked._id ? 'bg-brand-50/60' : ''}`}>
                <Avatar person={p} size={26} />
                <span className="text-[14px] text-slate-700 truncate">{labelOf(p)}</span>
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-6 text-center text-[13.5px] text-slate-400">No match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── one person's attendance, four tabs ───────────────────────────────────
 *  The half of this screen that is about an employee rather than about
 *  finding one. Operations reaches it through the search below; Attendance →
 *  Team reaches it from a reportee card, where the roster is the manager's
 *  reportees and `onBack` goes to that list rather than to a search box.
 *
 *  `canManage` false hides the affordances that are full-access-only behind
 *  the scenes rather than letting a manager press them and get a 403 — or
 *  worse, a write that silently lands on themselves.
 */
export function UserAttendanceTabs({
  employee, people = [], onPick, onBack, backTitle = 'Back',
  onGoTo = () => {}, canManage = true, canFile = true,
}) {
  const [subtab, setSubtab] = useState('summary');
  const tabs = subtabsFor(canManage);
  // A hidden tab is still reachable by URL or by a stale bit of state, and
  // find() on a missing id would throw rather than degrade.
  const ActiveTab = (tabs.find(([id]) => id === subtab) || tabs[0])[2];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {onBack && (
          <button onClick={onBack} title={backTitle}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ChevronLeft size={16} />
          </button>
        )}
        {/* Only worth a switcher when there is somebody to switch to. */}
        {onPick && people.length > 1
          ? <EmployeeSwitcher people={people} picked={employee} onPick={onPick} />
          : (
            <span className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar person={employee} />
              <span className="text-[15px] font-semibold text-slate-800">{labelOf(employee)}</span>
            </span>
          )}
      </div>
      <div className="flex gap-0.5 border-b border-slate-200 mb-5 overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setSubtab(id)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              subtab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {label}
          </button>
        ))}
      </div>
      <ActiveTab employee={employee} onGoTo={onGoTo} canManage={canManage} canFile={canFile} />
    </div>
  );
}

export default function OpsUserSpecific({ onGoTo = () => {} }) {
  const { people } = useEmployeeList();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return people.filter(p => labelOf(p).toLowerCase().includes(needle)
      || String(p.department || '').toLowerCase().includes(needle)).slice(0, 12);
  }, [q, people]);

  if (!picked) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search Employee" autoFocus
            className="w-full border border-slate-200 rounded-xl pl-11 pr-11 py-3 text-[15px] focus:outline-none focus:border-brand-400"
          />
          {q && (
            <button onClick={() => setQ('')} title="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
              <X size={15} />
            </button>
          )}
        </div>
        {matches.length > 0 && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-50">
            {matches.map(p => (
              <button key={p._id} onClick={() => setPicked(p)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                <Avatar person={p} size={30} />
                <span className="text-[14.5px] text-slate-700 flex-1 truncate">{labelOf(p)}</span>
                <span className="text-[13px] text-slate-400 flex-shrink-0">{p.department}</span>
              </button>
            ))}
          </div>
        )}
        {q.trim() && matches.length === 0 && (
          <p className="text-center text-slate-400 py-16">Nobody matches “{q.trim()}”.</p>
        )}
        {!q.trim() && <p className="text-center text-slate-400 py-16">Please begin typing to search for an employee.</p>}
      </div>
    );
  }

  return (
    <UserAttendanceTabs
      employee={picked} people={people} onPick={setPicked}
      onBack={() => setPicked(null)} backTitle="Back to search"
      onGoTo={onGoTo} />
  );
}
