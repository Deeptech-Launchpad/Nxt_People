import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Calendar, Search, MoreHorizontal, Download, Printer, Trash2 } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList from '../leavetracker/useEmployeeList';
import AssignShiftDialog from './AssignShiftDialog';
import {
  ymd, weekDates, monthCells, addDays, shiftFor, leavesFor, leaveChipText,
  shiftLabel, to12, BAND_HOURS, BAND_START, placeOnBand, isWeekendDay, isToday,
} from './shiftGrid';

/* ── Operations → Shift → User-specific Operations ────────────────────────
 *  One person's schedule, Weekly or Monthly, with Assign shift on it.
 *
 *  The reference opens on a search box and nothing else — no default
 *  employee, no "first person alphabetically" — because the question this tab
 *  answers always starts with a name. That empty state is kept rather than
 *  pre-loading somebody, which would be a schedule you did not ask for and
 *  might act on by accident.
 *
 *  Weekly is a time grid (hours across, days down); Monthly is a calendar of
 *  chips. Both draw the same two things in a day: the shift that applies, and
 *  any approved leave or permission, because a schedule that omits the leave
 *  is not what will actually happen.
 * ────────────────────────────────────────────────────────────────────────── */

const MONTH = { month: 'short', year: 'numeric' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function OpsShiftUserSpecific() {
  const { people, loading: peopleLoading } = useEmployeeList();
  const [employeeId, setEmployeeId] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('weekly');
  const [anchor, setAnchor] = useState(() => new Date());
  const [roster, setRoster] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [employeeRow, setEmployeeRow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [menu, setMenu] = useState(false);

  const employee = people.find(p => String(p._id) === String(employeeId)) || null;

  const range = useMemo(() => {
    if (view === 'weekly') {
      const days = weekDates(anchor);
      return { from: ymd(days[0]), to: ymd(days[6]), days };
    }
    const cells = monthCells(anchor);
    const real = cells.filter(Boolean);
    return { from: ymd(real[0]), to: ymd(real[real.length - 1]), cells };
  }, [view, anchor]);

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    api.get(`/roster?startDate=${range.from}&endDate=${range.to}`)
      .then(r => {
        const mine = (r.data.data || []).filter(x => String(x.employeeId) === String(employeeId));
        setRoster(mine);
        setLeaves((r.data.leaves || []).filter(l => String(l.employeeId) === String(employeeId)));
        setEmployeeRow((r.data.employees || []).find(e => String(e._id) === String(employeeId)) || null);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load that schedule'))
      .finally(() => setLoading(false));
  }, [employeeId, range.from, range.to]);

  useEffect(load, [load]);

  const rosterByKey = useMemo(
    () => new Map(roster.map(r => [`${r.employeeId}|${String(r.date).slice(0, 10)}`, r])), [roster]);

  const step = (dir) => setAnchor(a => (view === 'weekly'
    ? addDays(a, dir * 7)
    : new Date(a.getFullYear(), a.getMonth() + dir, 1)));

  const removeRostered = async (rosterId) => {
    try {
      await api.delete(`/roster/${rosterId}`);
      toast.success('Assignment removed — the standing shift applies again');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that assignment');
    }
  };

  // ── Employee search ────────────────────────────────────────────────────
  const matches = query.trim()
    ? people.filter(p => {
        const q = query.trim().toLowerCase();
        return `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase().includes(q)
          || String(p.employeeId || '').toLowerCase().includes(q);
      }).slice(0, 12)
    : [];

  if (!employeeId) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="max-w-[620px] mx-auto px-6 py-14">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search Employee"
              className="w-full border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </div>

          {query.trim() ? (
            <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-[14px] text-slate-500">Nobody matches “{query}”.</p>
              ) : matches.map(p => (
                <button key={p._id} onClick={() => setEmployeeId(p._id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                  <span className="text-[14px] text-slate-800">
                    <span className="text-slate-500">{p.employeeId}</span> — <b>{p.firstName} {p.lastName}</b>
                  </span>
                  <span className="text-[13px] text-slate-500">{p.department || '—'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-center text-[14px] text-slate-500 mt-10">
              {peopleLoading ? 'Loading employees…' : 'Please begin typing to search for an employee'}
            </p>
          )}
        </div>
      </div>
    );
  }

  const title = view === 'weekly'
    ? `${range.days[0].toLocaleDateString('en-GB')} - ${range.days[6].toLocaleDateString('en-GB')}`
    : anchor.toLocaleDateString('en-US', MONTH);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      {/* Employee switcher — the reference keeps you in the tab and changes
          who you are looking at, rather than sending you back to the search. */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <button onClick={() => { setEmployeeId(''); setQuery(''); }}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
          <ChevronLeft size={16} />
        </button>
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-[14px] bg-white min-w-[240px] focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          {people.map(p => (
            <option key={p._id} value={p._id}>{p.employeeId} — {p.firstName} {p.lastName}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
          <Calendar size={15} className="text-slate-400" />
          <button onClick={() => step(1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
          <span className="text-[14px] font-semibold text-slate-800 ml-1">{title}</span>
          {loading && <span className="text-[12px] text-slate-400 ml-2">loading…</span>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-slate-300 overflow-hidden">
            {['weekly', 'monthly'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3.5 py-1.5 text-[13px] font-medium capitalize ${
                  view === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => setAssigning(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-[13px] font-semibold">
            Assign shift
          </button>
          <div className="relative">
            <button onClick={() => setMenu(m => !m)}
              className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                  <button onClick={() => { setMenu(false); window.print(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
                    <Printer size={14} /> Print
                  </button>
                  {/* Download as PDF is the browser's own print-to-PDF here
                      rather than a second renderer that would drift from what
                      is on screen. Import/Export of a roster is a real
                      feature and not a menu item — said plainly instead of
                      offered and then not working. */}
                  <button onClick={() => { setMenu(false); window.print(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
                    <Download size={14} /> Download as PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {view === 'weekly' ? (
        <WeeklyBand days={range.days} employeeId={employeeId} employee={employeeRow}
          rosterByKey={rosterByKey} leaves={leaves} onRemove={removeRostered} />
      ) : (
        <MonthlyCells cells={range.cells} employeeId={employeeId} employee={employeeRow}
          rosterByKey={rosterByKey} leaves={leaves} onRemove={removeRostered} />
      )}

      {assigning && (
        <AssignShiftDialog mode="single" employeeId={employeeId}
          employeeName={employee ? `${employee.employeeId} — ${employee.firstName} ${employee.lastName}` : ''}
          defaultFrom={ymd(new Date())} defaultTo={ymd(new Date())}
          onClose={() => setAssigning(false)} onSaved={load} />
      )}
    </div>
  );
}

/** Hours across, days down — the reference's Weekly view. */
function WeeklyBand({ days, employeeId, employee, rosterByKey, leaves, onRemove }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="grid" style={{ gridTemplateColumns: `120px repeat(${BAND_HOURS.length}, 1fr)` }}>
          <div className="bg-slate-50 border-b border-slate-200" />
          {BAND_HOURS.map(h => (
            <div key={h} className="bg-slate-50 border-b border-l border-slate-200 px-2 py-2 text-[12px] text-slate-500 text-center">
              {to12(`${String(Math.floor(h / 60)).padStart(2, '0')}:00`)}
            </div>
          ))}
        </div>

        {days.map(d => {
          const shift = shiftFor(d, employeeId, rosterByKey, employee);
          const dayLeaves = leavesFor(d, employeeId, leaves);
          return (
            <div key={ymd(d)} className={`grid border-b border-slate-100 ${isWeekendDay(d) ? 'bg-amber-50/50' : ''}`}
              style={{ gridTemplateColumns: `120px repeat(${BAND_HOURS.length}, 1fr)` }}>
              <div className="px-3 py-4 border-r border-slate-100">
                <p className="text-[13px] text-slate-500">{DAY_NAMES[d.getDay()]}</p>
                <p className={`text-[15px] font-semibold ${isToday(d) ? 'text-white bg-blue-600 w-7 h-7 rounded flex items-center justify-center' : 'text-slate-800'}`}>
                  {d.getDate()}
                </p>
              </div>
              <div className="relative py-3" style={{ gridColumn: `2 / span ${BAND_HOURS.length}` }}>
                {BAND_HOURS.map((h, i) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-slate-100"
                    style={{ left: `${(i / BAND_HOURS.length) * 100}%` }} />
                ))}
                {shift && (
                  <div className="relative h-8 mb-1 group" >
                    <div className="absolute h-8 rounded bg-blue-100 border border-blue-200 px-2 py-1 overflow-hidden"
                      style={placeOnBand(shift.startTime, shift.endTime)}
                      title={shift.reason ? `Reason: ${shift.reason}` : undefined}>
                      <p className="text-[12px] font-semibold text-blue-800 leading-tight truncate">{shift.name}</p>
                      <p className="text-[11px] text-blue-700 leading-tight truncate">{shiftLabel(shift)}</p>
                    </div>
                    {shift.rostered && (
                      <button onClick={() => onRemove(shift.rosterId)}
                        title="Remove this day's assignment"
                        className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 p-1 rounded bg-white/90 border border-slate-200 text-slate-400 hover:text-red-500">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
                {dayLeaves.map(l => (
                  <div key={l._id} className="relative h-7">
                    <div className="absolute h-7 rounded bg-amber-100 border border-amber-300 px-2 py-1 overflow-hidden"
                      style={l.leaveType === 'permission' && l.startTime
                        ? placeOnBand(l.startTime, l.endTime)
                        : { left: 0, width: '100%' }}>
                      <p className="text-[11px] font-medium text-amber-800 leading-tight truncate">{leaveChipText(l)}</p>
                    </div>
                  </div>
                ))}
                {!shift && dayLeaves.length === 0 && (
                  <p className="text-[12px] text-slate-300 pl-2">No shift</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A month of chips — the reference's Monthly view. */
function MonthlyCells({ cells, employeeId, employee, rosterByKey, leaves, onRemove }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {DAY_NAMES.map(d => (
            <div key={d} className="px-3 py-2 text-[12px] font-medium text-slate-500">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={`blank-${i}`} className="min-h-[112px] border-b border-r border-slate-100 bg-slate-50/40" />;
            const shift = shiftFor(d, employeeId, rosterByKey, employee);
            const dayLeaves = leavesFor(d, employeeId, leaves);
            return (
              <div key={ymd(d)}
                className={`min-h-[112px] border-b border-r border-slate-100 p-2 ${isWeekendDay(d) ? 'bg-amber-50/50' : ''}`}>
                <p className={`text-[13px] font-semibold mb-1.5 ${
                  isToday(d) ? 'text-white bg-blue-600 w-6 h-6 rounded flex items-center justify-center' : 'text-slate-700'}`}>
                  {d.getDate()}
                </p>
                {shift && (
                  <div className="group relative rounded bg-blue-100 border border-blue-200 px-1.5 py-1 mb-1"
                    title={shift.reason ? `Reason: ${shift.reason}` : undefined}>
                    <p className="text-[11px] font-semibold text-blue-800 leading-tight truncate">{shift.name}</p>
                    <p className="text-[10px] text-blue-700 leading-tight truncate">{shiftLabel(shift)}</p>
                    {shift.rostered && (
                      <button onClick={() => onRemove(shift.rosterId)}
                        title="Remove this day's assignment"
                        className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 p-0.5 rounded bg-white/90 text-slate-400 hover:text-red-500">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                )}
                {dayLeaves.map(l => (
                  <div key={l._id} className="rounded bg-amber-100 border border-amber-300 px-1.5 py-1 mb-1">
                    <p className="text-[10px] font-medium text-amber-800 leading-tight">{leaveChipText(l)}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
