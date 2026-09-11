import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, MoreHorizontal, Printer, Download, X } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList from '../leavetracker/useEmployeeList';
import AssignShiftDialog from './AssignShiftDialog';
import {
  ymd, weekDates, addDays, shiftFor, leavesFor, leaveChipText, shiftLabel,
  to12, BAND_HOURS, placeOnBand, isWeekendDay, isToday,
} from './shiftGrid';

/* ── Operations → Shift → Employee Shift Mapping ──────────────────────────
 *  Everybody's schedule at once: Weekly (days across, people down) or Daily
 *  (hours across, people down). This is the org-wide view the reference puts
 *  Assign shift and the filter panel on.
 *
 *  Deliberately NOT merged with the existing /shift-roster screen, which is a
 *  Monday-first drag-and-drop grid that people already use. This one is
 *  Sunday-first to match the reference, reads leave into the cells, and
 *  assigns by criteria over a range. Two screens over one table is normally
 *  the thing to avoid — the note in Shifts.jsx says so — but the difference
 *  here is real: that one edits a week by dragging, this one answers "who is
 *  on what, and who is actually in". Merging them would mean silently moving
 *  the other screen's week boundary under the people using it.
 *
 *  A cell shows the ROSTERED shift where there is one and the employee's
 *  standing shift otherwise, which is the same precedence attendance.js
 *  resolves a check-in against. A grid that showed only rostered rows would be
 *  empty for an organisation that rosters by exception — which is this one.
 * ────────────────────────────────────────────────────────────────────────── */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

export default function OpsEmployeeShiftMapping() {
  const { people, loading: peopleLoading } = useEmployeeList();
  const [view, setView] = useState('weekly');       // 'weekly' | 'daily'
  const [anchor, setAnchor] = useState(() => new Date());
  const [roster, setRoster] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filters, setFilters] = useState({
    employee: '', department: '', designation: '', location: '', shiftId: '', directOnly: false,
  });

  const days = useMemo(() => (view === 'weekly' ? weekDates(anchor) : [new Date(anchor)]), [view, anchor]);
  const from = ymd(days[0]);
  const to = ymd(days[days.length - 1]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/roster?startDate=${from}&endDate=${to}`),
      api.get('/shifts'),
    ])
      .then(([r, s]) => {
        setRoster(r.data.data || []);
        setLeaves(r.data.leaves || []);
        setEmployees(r.data.employees || []);
        setShifts(s.data.data || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the schedule'))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(load, [load]);

  const rosterByKey = useMemo(
    () => new Map(roster.map(r => [`${r.employeeId}|${String(r.date).slice(0, 10)}`, r])), [roster]);

  // The employee list the grid draws, after the filter panel.
  const rows = useMemo(() => {
    const byId = new Map(people.map(p => [String(p._id), p]));
    return employees
      .map(e => ({ ...e, profile: byId.get(String(e._id)) || null }))
      .filter(e => {
        const p = e.profile;
        if (filters.employee && String(e._id) !== filters.employee) return false;
        if (filters.department && (p?.department || e.department) !== filters.department) return false;
        if (filters.designation && p?.designation !== filters.designation) return false;
        if (filters.location && p?.workLocation !== filters.location) return false;
        if (filters.shiftId) {
          /* Filtering by shift asks "who is on this shift in this period",
           * which is not the same as "whose standing shift is this" — a day
           * rostered onto it counts. */
          const onIt = days.some(d => {
            const s = shiftFor(d, e._id, rosterByKey, e);
            return s && String(s.id) === filters.shiftId;
          });
          if (!onIt) return false;
        }
        return true;
      })
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [employees, people, filters, days, rosterByKey]);

  const step = (dir) => setAnchor(a => addDays(a, dir * (view === 'weekly' ? 7 : 1)));

  const distinct = (key) => [...new Set(people.map(p => p[key]).filter(Boolean))].sort();

  const title = view === 'weekly'
    ? `${days[0].toLocaleDateString('en-GB')} - ${days[6].toLocaleDateString('en-GB')}`
    : days[0].toLocaleDateString('en-GB');

  const activeFilters = Object.entries(filters)
    .filter(([k, v]) => (k === 'directOnly' ? v : Boolean(v))).length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
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
            {['weekly', 'daily'].map(v => (
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
          <button onClick={() => setFilterOpen(true)}
            className={`relative p-1.5 rounded-md border text-slate-500 hover:bg-slate-50 ${
              activeFilters ? 'border-blue-400 text-blue-600' : 'border-slate-300'}`}>
            <SlidersHorizontal size={16} />
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                {activeFilters}
              </span>
            )}
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

      {rows.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[15px] font-medium text-slate-700">No shifts have been mapped currently</p>
          <p className="text-[13px] text-slate-500 mt-1">
            {activeFilters ? 'Nothing matches the filters on this period.' : 'Assign a shift to put people on this schedule.'}
          </p>
        </div>
      ) : view === 'weekly' ? (
        <WeeklyGrid days={days} rows={rows} rosterByKey={rosterByKey} leaves={leaves} />
      ) : (
        <DailyBand day={days[0]} rows={rows} rosterByKey={rosterByKey} leaves={leaves} />
      )}

      {assigning && (
        <AssignShiftDialog mode="criteria" people={people} peopleLoading={peopleLoading}
          defaultFrom={from} defaultTo={view === 'weekly' ? to : from}
          onClose={() => setAssigning(false)} onSaved={load} />
      )}

      {filterOpen && (
        <FilterPanel filters={filters} setFilters={setFilters} people={people} shifts={shifts}
          departments={distinct('department')} designations={distinct('designation')}
          locations={distinct('workLocation')} date={days[0]}
          onClose={() => setFilterOpen(false)} />
      )}
    </div>
  );
}

/** Days across, people down. */
function WeeklyGrid({ days, rows, rosterByKey, leaves }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1100px] w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-2.5 text-[12px] font-medium text-slate-500 w-[260px] sticky left-0 bg-slate-50">Employee</th>
            {days.map(d => (
              <th key={ymd(d)} className={`px-2 py-2.5 text-left text-[12px] font-medium ${isWeekendDay(d) ? 'bg-amber-50' : ''}`}>
                <span className="text-slate-500">{DAY_NAMES[d.getDay()]}</span>{' '}
                <span className={isToday(d)
                  ? 'inline-flex items-center justify-center w-6 h-6 rounded bg-blue-600 text-white'
                  : 'text-slate-800 font-semibold'}>
                  {String(d.getDate()).padStart(2, '0')}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={e._id} className="border-b border-slate-100 align-top">
              <td className="px-4 py-3 sticky left-0 bg-white">
                <p className="text-[13px] text-slate-500">{e.profile?.employeeId || ''}</p>
                <p className="text-[14px] font-medium text-slate-800">{e.firstName} {e.lastName}</p>
              </td>
              {days.map(d => {
                const shift = shiftFor(d, e._id, rosterByKey, e);
                const dayLeaves = leavesFor(d, e._id, leaves);
                return (
                  <td key={ymd(d)} className={`px-2 py-2 ${isWeekendDay(d) ? 'bg-amber-50/50' : ''}`}>
                    {shift ? (
                      <div className={`rounded px-2 py-1 mb-1 border ${
                        shift.rostered ? 'bg-blue-100 border-blue-300' : 'bg-blue-50 border-blue-100'}`}
                        title={shift.rostered
                          ? `Rostered${shift.reason ? ` — ${shift.reason}` : ''}`
                          : 'Standing shift'}>
                        <p className="text-[11px] font-semibold text-blue-800 leading-tight truncate">{shift.name}</p>
                        <p className="text-[10px] text-blue-700 leading-tight truncate">{shiftLabel(shift)}</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-300">—</p>
                    )}
                    {dayLeaves.map(l => (
                      <div key={l._id} className="rounded bg-amber-100 border border-amber-300 px-2 py-1">
                        <p className="text-[10px] font-medium text-amber-800 leading-tight">{leaveChipText(l)}</p>
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hours across, people down — one day. */
function DailyBand({ day, rows, rosterByKey, leaves }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1100px]">
        <div className="grid bg-slate-50 border-b border-slate-200"
          style={{ gridTemplateColumns: `280px repeat(${BAND_HOURS.length}, 1fr)` }}>
          <div className="px-4 py-2.5 text-[12px] font-medium text-slate-500">Employee</div>
          {BAND_HOURS.map(h => (
            <div key={h} className="border-l border-slate-200 px-2 py-2.5 text-[12px] text-slate-500 text-center">
              {to12(`${String(Math.floor(h / 60)).padStart(2, '0')}:00`)}
            </div>
          ))}
        </div>
        {rows.map(e => {
          const shift = shiftFor(day, e._id, rosterByKey, e);
          const dayLeaves = leavesFor(day, e._id, leaves);
          return (
            <div key={e._id} className="grid border-b border-slate-100"
              style={{ gridTemplateColumns: `280px repeat(${BAND_HOURS.length}, 1fr)` }}>
              <div className="px-4 py-4 border-r border-slate-100">
                <p className="text-[13px] text-slate-500">{e.profile?.employeeId || ''}</p>
                <p className="text-[14px] font-medium text-slate-800">{e.firstName} {e.lastName}</p>
              </div>
              <div className="relative py-3" style={{ gridColumn: `2 / span ${BAND_HOURS.length}` }}>
                {BAND_HOURS.map((h, i) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-slate-100"
                    style={{ left: `${(i / BAND_HOURS.length) * 100}%` }} />
                ))}
                {shift ? (
                  <div className="relative h-8 mb-1">
                    <div className="absolute h-8 rounded bg-blue-100 border border-blue-200 px-2 py-1 overflow-hidden"
                      style={placeOnBand(shift.startTime, shift.endTime)}>
                      <p className="text-[12px] font-semibold text-blue-800 leading-tight truncate">{shift.name}</p>
                      <p className="text-[11px] text-blue-700 leading-tight truncate">{shiftLabel(shift)}</p>
                    </div>
                  </div>
                ) : <p className="text-[12px] text-slate-300 pl-2">No shift</p>}
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterPanel({ filters, setFilters, people, shifts, departments, designations, locations, date, onClose }) {
  const [draft, setDraft] = useState(filters);
  const set = patch => setDraft(d => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div className="bg-white w-full max-w-[380px] h-full shadow-2xl flex flex-col"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-[16px] font-semibold text-slate-800">Filter</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={17} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <Field label="Date">
            {/* Read-only: the period is moved with the arrows on the grid, so a
                second date control here would be two ways to say the same
                thing that can disagree. */}
            <input className={`${input} bg-slate-50 text-slate-500`} readOnly value={date.toLocaleDateString('en-GB')} />
          </Field>

          <Field label="Employee">
            <select className={`${input} bg-white`} value={draft.employee}
              onChange={e => set({ employee: e.target.value })}>
              <option value="">All Employees</option>
              {people.map(p => (
                <option key={p._id} value={p._id}>{p.employeeId} — {p.firstName} {p.lastName}</option>
              ))}
            </select>
          </Field>

          <Field label="Department">
            <select className={`${input} bg-white`} value={draft.department}
              onChange={e => set({ department: e.target.value })}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <Field label="Designation">
            <select className={`${input} bg-white`} value={draft.designation}
              onChange={e => set({ designation: e.target.value })}>
              <option value="">All Designations</option>
              {designations.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <Field label="Location">
            <select className={`${input} bg-white`} value={draft.location}
              onChange={e => set({ location: e.target.value })}>
              <option value="">All Locations</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>

          <Field label="Shift(s)">
            <select className={`${input} bg-white`} value={draft.shiftId}
              onChange={e => set({ shiftId: e.target.value })}>
              <option value="">All Shifts</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
          <button onClick={() => { setFilters(draft); onClose(); }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-md text-[14px] font-semibold">
            Apply
          </button>
          <button onClick={() => {
              const cleared = { employee: '', department: '', designation: '', location: '', shiftId: '', directOnly: false };
              setDraft(cleared); setFilters(cleared);
            }}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-5 py-2 rounded-md text-[14px] font-semibold">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[13px] font-medium text-slate-600 mb-1.5">{label}</label>
    {children}
  </div>
);
