import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import useSortable from '../../components/table/useSortable';
import SortableTh from '../../components/table/SortableTh';
import { formatInstantTime, useLocaleFormat } from '../../utils/datetime';
import { reverseGeocode } from '../../utils/reverseGeocode';

/* ── One rendering of a day's attendance, shared by My Attendance and every
 *  screen that opens someone else's (Team → a reportee, Operations →
 *  User-specific). Before this, the two drew the same idea — a week of
 *  punches, a list, a month grid — as two separate implementations that had
 *  already drifted: Team's timeline was a single flat bar with no hour axis,
 *  its list had no "Late by" line, its calendar had no hours-worked line.
 *  One person's day looking different depending on whose screen you opened it
 *  from is the bug this file removes, for good — both callers hand it the
 *  same shape and get the same pixels.
 *
 *  A day is:
 *    {
 *      date: 'YYYY-MM-DD',
 *      isToday, isFuture: boolean,
 *      isLoaded: boolean,          // false only for a day whose period hasn't
 *                                  // resolved yet — lets a caller draw '—'
 *                                  // instead of a false "Absent"
 *      off: null | { kind: 'holiday' | 'weekend', label: string },
 *      record: null | {
 *        checkIn, checkOut,        // ISO timestamps
 *        sessions,                 // [{checkIn, checkOut}], multi check-in/out
 *        workingHours, lateMinutes, sessionStartedAt, status,
 *      },
 *    }
 * ────────────────────────────────────────────────────────────────────────── */

export const STATUS_PILL = {
  present:   { label: 'Present',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  absent:    { label: 'Absent',   cls: 'bg-red-100 text-red-600 border-red-200' },
  'half-day':{ label: 'Half Day', cls: 'bg-blue-100 text-blue-600 border-blue-200' },
  on_duty:   { label: 'On Duty',  cls: 'bg-violet-100 text-violet-600 border-violet-200' },
  leave:     { label: 'On Leave', cls: 'bg-purple-100 text-purple-600 border-purple-200' },
  holiday:   { label: 'Holiday',  cls: 'bg-cyan-100 text-cyan-600 border-cyan-200' },
  weekend:   { label: 'Weekend',  cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

/* Late is a property of the arrival, not a verdict on the day: somebody who
 * came in at 09:46 was present. The minutes are stated beside the check-in
 * time already, so the pill itself always reads Present rather than a
 * separate "Late" colour competing with it. */
const pillKeyFor = (status) => (status === 'late' ? 'present' : status);

export function StatusPill({ status, title }) {
  const s = STATUS_PILL[pillKeyFor(status)] || { label: status || '—', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  return <span title={title} className={`text-[12px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>;
}

/* Every clock reading on this page is judged in IST, whoever's laptop and
 * whatever timezone it is set to — a viewer in a different zone must not see
 * bars shifted off the hours printed beside them. */
export function istMinutesOfInstant(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return ist.getHours() * 60 + ist.getMinutes();
}

export const SHIFT_START_MIN = 8 * 60;   // 08:00 → the axis's leftmost tick
export const SHIFT_END_MIN   = 20 * 60;  // 20:00 → its rightmost
const TICK_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const pctOfDay = (mins) =>
  Math.max(0, Math.min(100, ((mins - SHIFT_START_MIN) / (SHIFT_END_MIN - SHIFT_START_MIN)) * 100));

/* Re-renders once a second only while at least one row needs it — a day
 * that is checked in right now, still open. Everyone else's row is static. */
function useTick(enabled) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setN(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);
}

/* The hours a day is worth right now. A day still open (checked in, no
 * check-out) counts the stretch being worked, capped at 18h so a punch
 * forgotten days ago cannot inflate today's screen with someone else's
 * missed check-out — the same guard the employee's own timer uses. */
export function hoursOfRecord(record) {
  const banked = Number(record?.workingHours) || 0;
  if (!record?.checkIn || record?.checkOut) return { hours: banked, live: false };
  const from = new Date(record.sessionStartedAt || record.checkIn).getTime();
  if (!Number.isFinite(from)) return { hours: banked, live: false };
  const openHrs = Math.max(0, (Date.now() - from) / 3600000);
  return openHrs > 18 ? { hours: banked, live: false } : { hours: banked + openHrs, live: true };
}

export function fmtHM(hours) {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return '00:00';
  const neg = Number(hours) < 0;
  const total = Math.round(Math.abs(Number(hours)) * 60);
  const s = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

function fmtHMS(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const fmtT = (iso, timeFormat) => (iso ? formatInstantTime(iso, timeFormat) : null);
const fmtDateShort = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/* ── Timeline ──────────────────────────────────────────────────────────── */

function TimelineDot({ pct, color, title }) {
  return (
    <div className="absolute w-2.5 h-2.5 rounded-full bg-white z-10 border-2"
      style={{ left: `${pct}%`, top: '50%', transform: 'translate(-50%,-50%)', borderColor: color }}
      title={title} />
  );
}

function TimelineRowBar({ day, timeFormat }) {
  const { record, isToday } = day;
  const { live } = hoursOfRecord(record);
  useTick(isToday && live);

  const nowMins = istMinutesOfInstant(new Date().toISOString());
  const nowPct = pctOfDay(nowMins);
  const showNowLine = isToday;
  const color = '#22c55e';

  const sessions = record?.sessions?.length ? record.sessions : (record?.checkIn
    ? [{ checkIn: record.checkIn, checkOut: record.checkOut }] : []);

  if (!sessions.length) {
    return (
      <div className="flex-1 flex items-center relative h-12">
        <div className="absolute left-[3%] right-[3%] h-[1px] border-t border-dashed border-slate-200" style={{ top: '50%' }} />
        <div className="absolute left-[3%] w-2 h-2 rounded-full border-2 border-slate-300 bg-white" style={{ top: '50%', transform: 'translate(-50%,-50%)' }} />
        <div className="absolute right-[3%] w-2 h-2 rounded-full border-2 border-slate-300 bg-white" style={{ top: '50%', transform: 'translate(50%,-50%)' }} />
        {showNowLine && <div className="absolute top-0 bottom-0 border-l border-dashed border-blue-400 z-20" style={{ left: `${nowPct}%` }} />}
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center relative h-12">
      <div className="absolute left-[3%] right-[3%] h-[1px] border-t border-dashed border-slate-200" style={{ top: '50%' }} />
      {sessions.map((s, i) => {
        const sMins = istMinutesOfInstant(s.checkIn);
        const eMins = s.checkOut ? istMinutesOfInstant(s.checkOut) : null;
        const sPct = pctOfDay(sMins);
        const ePct = eMins !== null ? pctOfDay(eMins) : null;
        const isOpenSession = isToday && i === sessions.length - 1 && !s.checkOut;
        const livePct = isOpenSession ? Math.max(sPct, nowPct) : null;
        return (
          <React.Fragment key={i}>
            {ePct !== null && (
              <div className="absolute h-1 rounded-full" style={{ left: `${sPct}%`, width: `${Math.max(0, ePct - sPct)}%`, backgroundColor: color, top: '50%', transform: 'translateY(-50%)' }} />
            )}
            {livePct !== null && (
              <div className="absolute h-0 border-t-2 border-dashed" style={{ left: `${sPct}%`, width: `${Math.max(0, livePct - sPct)}%`, borderColor: color, top: '50%', transform: 'translateY(-50%)' }} />
            )}
            <TimelineDot pct={sPct} color={color} title={`Session ${i + 1} in: ${fmtT(s.checkIn, timeFormat)}`} />
            {ePct !== null && <TimelineDot pct={ePct} color={color} title={`Session ${i + 1} out: ${fmtT(s.checkOut, timeFormat)}`} />}
          </React.Fragment>
        );
      })}
      {showNowLine && <div className="absolute top-0 bottom-0 border-l border-dashed border-blue-400 z-20" style={{ left: `${nowPct}%` }} />}
    </div>
  );
}

function TimelineHours({ day }) {
  const { hours, live } = hoursOfRecord(day.record);
  useTick(live);
  if (day.isFuture) return <p className="text-slate-300 text-[13px]">—</p>;
  if (!day.isLoaded) return <p className="text-slate-300 text-[13px]">—</p>;
  if (live) {
    const from = new Date(day.record.sessionStartedAt || day.record.checkIn).getTime();
    const banked = Number(day.record?.workingHours) || 0;
    const seconds = banked * 3600 + Math.max(0, (Date.now() - from) / 1000);
    return (
      <>
        <p className="text-[15px] font-bold text-emerald-600">{fmtHMS(seconds)}</p>
        <p className="text-[12px] text-slate-400 mt-0.5">Hrs</p>
      </>
    );
  }
  return (
    <>
      <p className="text-[15px] font-bold text-slate-700">{fmtHM(hours)}</p>
      <p className="text-[12px] text-slate-400 mt-0.5">Hrs worked</p>
    </>
  );
}

/**
 * The week/period-as-rows view: one line per day, a dashed baseline with dots
 * for each punch, and an hour axis underneath shared by every row above it.
 * `onAddRequest(date, buttonRect)` is optional — omit it on a read-only
 * screen and the hover button never appears.
 */
export function AttendanceTimelineList({ days, timeFormat, onAddRequest, onRowClick }) {
  const [hovered, setHovered] = useState(null);
  const nowMins = istMinutesOfInstant(new Date().toISOString());
  const periodHasToday = days.some(d => d.isToday);

  return (
    <div className="flex flex-col bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {days.map(day => {
        const dateObj = new Date(`${day.date}T00:00:00`);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = dateObj.getDate();
        const ci = day.record?.sessions?.[0]?.checkIn || day.record?.checkIn;
        const checkInStr = fmtT(ci, timeFormat);

        return (
          <div key={day.date} data-testid="attendance-timeline-row" data-date={day.date}
            className={`flex items-center gap-4 px-5 py-3.5 border-b border-slate-100 last:border-0 min-h-[56px] transition-colors relative ${onRowClick ? 'cursor-pointer' : ''} ${day.isToday ? 'bg-blue-50/30' : 'hover:bg-slate-50/80'}`}
            onMouseEnter={() => setHovered(day.date)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onRowClick && onRowClick(day.date)}>
            <div className="w-[64px] flex-shrink-0 flex items-center gap-2">
              {day.isToday ? (
                <div className="flex flex-col items-center">
                  <span className="text-[12px] font-semibold text-slate-600">Today</span>
                  <div className="w-7 h-7 rounded bg-blue-600 text-white flex items-center justify-center text-[15px] font-bold mt-1">{dayNum}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className={`text-[12px] font-medium ${day.off ? 'text-slate-400' : 'text-slate-500'}`}>{dayName}</span>
                  <span className={`text-[15px] font-semibold mt-0.5 ${day.off ? 'text-slate-400' : 'text-slate-700'}`}>{dayNum}</span>
                </div>
              )}
            </div>

            <div className="w-[80px] flex-shrink-0">
              <span className="text-[14px] text-slate-700 font-medium">
                {checkInStr || (day.off ? <span className="text-slate-300 text-[13px]">{day.off.label}</span> : '')}
              </span>
              {day.record?.lateMinutes > 0 && (
                <div className="text-[12px] font-semibold" style={{ color: '#F5A623' }}>Late by {fmtHM(day.record.lateMinutes / 60)}</div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              {day.off ? (
                <div className="flex-1 flex items-center relative h-6">
                  <div className={`absolute left-[3%] right-[3%] h-[2px] ${day.off.kind === 'holiday' ? 'bg-cyan-300' : 'bg-amber-300'}`} style={{ top: '50%', transform: 'translateY(-50%)' }} />
                  <div className={`absolute left-[3%] w-2.5 h-2.5 rounded-full ${day.off.kind === 'holiday' ? 'bg-cyan-300' : 'bg-amber-300'}`} style={{ top: '50%', transform: 'translate(-50%,-50%)' }} />
                  <div className={`absolute right-[3%] w-2.5 h-2.5 rounded-full ${day.off.kind === 'holiday' ? 'bg-cyan-300' : 'bg-amber-300'}`} style={{ top: '50%', transform: 'translate(50%,-50%)' }} />
                  <div className={`absolute left-1/2 -translate-x-1/2 border rounded px-2 py-0.5 text-[12px] font-semibold z-10 ${
                    day.off.kind === 'holiday' ? 'bg-cyan-50 border-cyan-200 text-cyan-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                    {day.off.label}
                  </div>
                </div>
              ) : <TimelineRowBar day={day} timeFormat={timeFormat} />}
            </div>

            <div className="w-[100px] flex-shrink-0 text-right">
              {!day.off && <TimelineHours day={day} />}
            </div>

            <div className="w-[104px] flex-shrink-0 flex justify-end">
              {!day.off && onAddRequest && hovered === day.date && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onAddRequest(day.date, { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
                  }}
                  className="request-menu-trigger flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-2.5 py-1.5 rounded-md transition-colors shadow-sm">
                  Add Request
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* One axis for every row above — it reads off the same SHIFT_START/END
          scale the bars are placed on, so a bar's position always names its
          own time rather than an axis that has quietly drifted from it. */}
      <div className="flex items-start gap-4 px-5 py-2 bg-slate-50/80 border-t border-slate-100">
        <div className="w-[64px] flex-shrink-0" />
        <div className="w-[80px] flex-shrink-0" />
        <div className="flex-1 min-w-0 relative h-9">
          {TICK_HOURS.map(h => {
            const pct = pctOfDay(h * 60);
            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            return (
              <React.Fragment key={h}>
                <div className="absolute top-0 h-1.5 border-l border-slate-300" style={{ left: `${pct}%` }} />
                <span className="absolute top-2.5 text-[12px] text-slate-400 transform -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct}%` }}>
                  {h12}:00{h < 12 ? 'AM' : 'PM'}
                </span>
              </React.Fragment>
            );
          })}
          {periodHasToday && nowMins >= SHIFT_START_MIN && nowMins <= SHIFT_END_MIN && (
            <>
              <div className="absolute top-0 h-2.5 border-l border-blue-400" style={{ left: `${pctOfDay(nowMins)}%` }} />
              <span className="absolute top-[22px] text-[12px] font-semibold text-blue-500 transform -translate-x-1/2 whitespace-nowrap" style={{ left: `${pctOfDay(nowMins)}%` }}>Now</span>
            </>
          )}
        </div>
        <div className="w-[100px] flex-shrink-0" />
        <div className="w-[104px] flex-shrink-0" />
      </div>
    </div>
  );
}

/* ── List ──────────────────────────────────────────────────────────────── */

/**
 * The dense, sortable table. `onRowClick(date)` opens a day's detail;
 * `onQuickRegularize(date)` and `canQuickRegularize(date)` together offer the
 * per-row pencil — both optional, and the action column disappears without
 * `onQuickRegularize`.
 */
export function AttendanceListTable({ days, timeFormat, sortId, onRowClick, onQuickRegularize, canQuickRegularize }) {
  const sort = useSortable(days, {
    id: sortId,
    columns: {
      date: { get: d => d.date, type: 'date' },
      day: { get: d => new Date(`${d.date}T00:00:00`).getDay(), type: 'number' },
      checkIn: { get: d => d.record?.sessions?.[0]?.checkIn || d.record?.checkIn || null, type: 'date' },
      checkOut: {
        get: d => {
          const s = d.record?.sessions;
          return (s?.length ? s[s.length - 1]?.checkOut : null) || d.record?.checkOut || null;
        }, type: 'date',
      },
      hours: { get: d => (d.isLoaded ? hoursOfRecord(d.record).hours : null), type: 'number' },
      status: {
        get: d => {
          if (d.off) return d.off.kind;
          if (d.isFuture || !d.isLoaded) return null;
          return pillKeyFor(d.record?.status || 'absent');
        }, type: 'text',
      },
    },
  });

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {[['Date', 'date'], ['Day', 'day'], ['Check In', 'checkIn'], ['Check Out', 'checkOut'], ['Hours', 'hours'], ['Status', 'status']].map(([h, k]) => (
              <SortableTh key={h} sort={sort} k={k} className="px-5 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</SortableTh>
            ))}
            {onQuickRegularize && <th className="px-5 py-3 w-[60px]" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {sort.sorted.map(d => {
            const ci = d.record?.sessions?.[0]?.checkIn || d.record?.checkIn;
            const sessions = d.record?.sessions;
            const co = (sessions?.length ? sessions[sessions.length - 1]?.checkOut : null) || d.record?.checkOut;
            const { hours } = hoursOfRecord(d.record);
            const canAct = !d.off && onQuickRegularize && (!canQuickRegularize || canQuickRegularize(d.date));
            return (
              <tr key={d.date}
                onClick={onRowClick ? () => onRowClick(d.date) : undefined}
                className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''} ${d.isToday ? 'bg-blue-50/30' : ''}`}>
                <td className="px-5 py-3 text-[14px] font-medium text-slate-700">
                  <div>{fmtDateShort(d.date)}</div>
                  {d.record?.lateMinutes > 0 && (
                    <div className="text-[12px] font-semibold mt-0.5" style={{ color: '#F5A623' }}>Late by {fmtHM(d.record.lateMinutes / 60)}</div>
                  )}
                </td>
                <td className="px-5 py-3 text-[14px] text-slate-500">{new Date(`${d.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</td>
                <td className="px-5 py-3 text-[14px] text-slate-700">{fmtT(ci, timeFormat) || '—'}</td>
                <td className="px-5 py-3 text-[14px] text-slate-700">{fmtT(co, timeFormat) || '—'}</td>
                <td className="px-5 py-3 text-[14px] text-slate-700">{d.isLoaded && hours ? `${fmtHM(hours)} hrs` : '—'}</td>
                <td className="px-5 py-3">
                  {d.off
                    ? (<div><StatusPill status={d.off.kind} />{d.off.kind === 'holiday' && d.off.label !== 'Holiday' && <div className="text-[12px] text-slate-500 mt-0.5">{d.off.label}</div>}</div>)
                    : (d.isFuture || !d.isLoaded)
                      ? <span className="text-slate-400 text-[13px]">—</span>
                      : <StatusPill status={d.record?.status || 'absent'} />}
                </td>
                {onQuickRegularize && (
                  <td className="px-5 py-3 text-right">
                    {canAct && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onQuickRegularize(d.date); }}
                        title="Request Regularization"
                        className="w-7 h-7 inline-flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                        ✎
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Calendar ──────────────────────────────────────────────────────────── */

export function AttendanceCalendarMonth({ year, month, days, onDayClick, title }) {
  const byDate = useMemo(() => new Map(days.map(d => [d.date, d])), [days]);
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-[16px] font-bold text-slate-800">{title}</h3>
        </div>
      )}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="px-3 py-2 text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((dayNum, idx) => {
          if (dayNum === null) return <div key={`x${idx}`} className="h-[88px] border-r border-b border-slate-100 bg-slate-50/40" />;
          const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const d = byDate.get(ymd);
          const { hours } = d ? hoursOfRecord(d.record) : { hours: 0 };

          let pill = null;
          if (d?.off?.kind === 'holiday') {
            pill = (
              <div className="text-[13px] font-medium px-2 py-1 rounded leading-tight bg-cyan-50 text-cyan-700 border border-cyan-200">
                <div>Holiday</div>
                {d.off.label && d.off.label !== 'Holiday' && <div className="text-[12px] opacity-80 truncate">{d.off.label}</div>}
              </div>
            );
          } else if (d?.off?.kind === 'weekend') {
            pill = <div className="text-[13px] font-medium px-2 py-1 rounded leading-tight bg-slate-100 text-slate-500 border border-slate-200">Weekend</div>;
          } else if (d?.record) {
            const isLate = d.record.status === 'late';
            const label = STATUS_PILL[pillKeyFor(d.record.status)]?.label || d.record.status;
            const isAbsent = d.record.status === 'absent';
            pill = (
              <div className={`text-[13px] font-medium px-2 py-1 rounded leading-tight ${
                isAbsent ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                <div>{label}</div>
                {hours > 0 && <div className="text-[12px] opacity-80">{fmtHM(hours)} Hrs</div>}
                {isLate && d.record.lateMinutes > 0 && (
                  <div className="text-[11px] font-semibold mt-0.5" style={{ color: '#F5A623' }}>Late {fmtHM(d.record.lateMinutes / 60)}</div>
                )}
              </div>
            );
          } else if (d && !d.off && !d.isFuture && d.isLoaded) {
            pill = <div className="text-[13px] font-medium px-2 py-1 rounded leading-tight bg-rose-50 text-rose-700 border border-rose-200">Absent</div>;
          }

          const Wrapper = onDayClick ? 'button' : 'div';
          return (
            <Wrapper key={ymd}
              onClick={onDayClick ? () => onDayClick(ymd) : undefined}
              className={`h-[88px] border-r border-b border-slate-100 p-2 text-left transition-colors ${onDayClick ? 'hover:bg-blue-50/40' : ''} ${
                d?.off?.kind === 'holiday' ? 'bg-cyan-50/30' : d?.off?.kind === 'weekend' ? 'bg-amber-50/30' : ''}`}>
              <div className={`text-[13px] font-semibold mb-1 inline-flex items-center justify-center ${
                d?.isToday ? 'w-6 h-6 rounded-full bg-blue-600 text-white' : d?.off ? 'text-slate-400' : 'text-slate-700'}`}>
                {dayNum}
              </div>
              {pill}
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}

/* ── One day, in full — the side panel opened from any row click ────────────
 *  Same reuse rule as the rest of this file: My Attendance, Team → a
 *  reportee, and Operations → User-specific all open the same panel on the
 *  same shape of day, rather than three screens quietly drifting apart on
 *  what a "day in full" shows. */
const osmLink = (lat, lng) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

/* One column of a Check-in / Check-out pair, laid side by side in a single
 * card rather than as two stacked boxes — the punch and its own location sit
 * directly under one another, and the day reads left-to-right like a
 * timeline instead of top-to-bottom like a list. */
function PunchDetail({ label, time, locationLabel, lat, lng }) {
  /* 0,0 is the Atlantic, and it is what a failed capture writes — the same
     guard LocationMapPicker makes for the office pin. */
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const [address, setAddress] = useState(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!hasCoords) return;
    let cancelled = false;
    setResolving(true);
    reverseGeocode(lat, lng)
      .then(a => { if (!cancelled) { setAddress(a); setResolving(false); } })
      .catch(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [lat, lng, hasCoords]);

  return (
    <div className="px-3.5 py-3 min-w-0">
      <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-[15px] font-bold text-slate-800 mt-0.5">{time || '—'}</div>

      {!time ? (
        <p className="text-[13px] text-slate-400 mt-2">Not recorded.</p>
      ) : (
        <div className="mt-2.5 flex items-start gap-1.5">
          <MapPin size={13} className="text-slate-400 mt-[3px] flex-shrink-0" />
          <div className="min-w-0">
            {hasCoords ? (
              <>
                <p className="text-[13.5px] text-slate-700 break-words">
                  {resolving
                    ? 'Resolving address…'
                    : (address || 'Address could not be resolved for these coordinates')}
                </p>
                <p className="text-[11.5px] text-slate-400 mt-0.5">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </p>
                <a
                  href={osmLink(lat, lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:text-blue-700 mt-1.5"
                >
                  View map <ExternalLink size={11} />
                </a>
              </>
            ) : (
              <>
                {locationLabel && <p className="text-[13.5px] text-slate-600">{locationLabel}</p>}
                <p className="text-[12px] text-slate-400 mt-0.5">
                  No coordinates were captured for this punch, so there is no address and no map.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_NOTE = { manual: 'Entered manually', import: 'Imported from a file' };

export function DayDetailPanel({ date, record, shiftLabel, kind, loaded, onClose }) {
  const { timeFormat } = useLocaleFormat();
  const sessions = record?.sessions || [];
  const firstIn  = sessions[0]?.checkIn || record?.checkIn || null;
  const lastOut  = sessions.length
    ? sessions[sessions.length - 1]?.checkOut || null
    : record?.checkOut || null;
  const sourceNote = record?.source && record.source !== 'punch'
    ? (SOURCE_NOTE[record.source] || `Source: ${record.source}`)
    : null;

  const heading = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-[400px] max-w-full bg-white shadow-2xl border-l border-slate-200 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-[17px] font-bold text-slate-800">{heading}</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">{shiftLabel}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {kind?.kind === 'holiday' && (
            <div className="text-[13px] font-semibold bg-cyan-50 border border-cyan-200 text-cyan-700 rounded-lg px-3 py-2">
              {kind.label || 'Holiday'}
            </div>
          )}
          {kind?.kind === 'weekend' && (
            <div className="text-[13px] font-semibold bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
              Weekend
            </div>
          )}
          {sourceNote && (
            <div className="text-[13px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {sourceNote}
            </div>
          )}

          {/* A day we never fetched is not a day nobody worked — the same
              distinction the rest of the page makes. */}
          {!record && date > new Date(new Date().setHours(23, 59, 59, 999)) ? (
            <p className="text-[14px] text-slate-500">This day hasn’t happened yet.</p>
          ) : !record && !loaded ? (
            <p className="text-[14px] text-slate-500">
              This day is outside the range that was loaded, so there is nothing to show yet.
            </p>
          ) : !record ? (
            <p className="text-[14px] text-slate-500">No attendance was recorded for this day.</p>
          ) : (
            <>
              <div className="border border-slate-200 rounded-lg grid grid-cols-2 divide-x divide-slate-200 overflow-hidden">
                <PunchDetail
                  label="Check-in"
                  time={fmtT(firstIn, timeFormat)}
                  locationLabel={record.checkInLocation}
                  lat={record.checkInLat}
                  lng={record.checkInLng}
                />
                <PunchDetail
                  label="Check-out"
                  time={fmtT(lastOut, timeFormat)}
                  locationLabel={record.checkOutLocation}
                  lat={record.checkOutLat}
                  lng={record.checkOutLng}
                />
              </div>

              {/* Only two coordinate pairs are stored per day, so with several
                  sessions the map above belongs to the first in and the last
                  out. The middle punches are still listed, rather than left
                  looking like they never happened. */}
              {sessions.length > 1 && (
                <div className="border border-slate-200 rounded-lg px-3.5 py-3">
                  <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Sessions
                  </p>
                  {sessions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[13.5px] text-slate-600 py-1">
                      <span>Session {i + 1}</span>
                      <span className="tabular-nums">
                        {fmtT(s.checkIn, timeFormat) || '—'} – {fmtT(s.checkOut, timeFormat) || 'running'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {record.lateMinutes > 0 && (
                <p className="text-[13px] font-semibold" style={{ color: '#F5A623' }}>
                  Late by {fmtHM(record.lateMinutes / 60)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
          {[
            { label: 'First Check-In',  val: fmtT(firstIn, timeFormat) || '—' },
            { label: 'Last Check-Out',  val: fmtT(lastOut, timeFormat) || '—' },
            { label: 'Total Hours',     val: record?.workingHours ? fmtHM(record.workingHours) : '—' },
          ].map(({ label, val }) => (
            <div key={label} className="px-3 py-3 text-center">
              <p className="text-[12px] text-slate-400">{label}</p>
              <p className="text-[14px] font-bold text-slate-700 mt-0.5">{val}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
