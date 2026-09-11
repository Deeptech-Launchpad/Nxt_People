import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import {
  ymd, weekDates, addDays, shiftFor, leavesFor, leaveChipText, shiftLabel,
  isWeekendDay, isToday,
} from '../moreservices/shift/shiftGrid';
import { DirectScopeNote, Spinner, Empty } from './teamShared';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Shift Schedule (Attendance → Team) ───────────────────────────────────
 *  Read-only. Who is on what shift this week, and who will not be there.
 *
 *  Every piece of arithmetic is shiftGrid.js's: shiftFor() resolves rostered
 *  over standing shift with the same precedence attendance.js measures a punch
 *  against, leavesFor()/leaveChipText() draw the leave chips, and the week runs
 *  Sunday-first as the rest of the Shift module does. Nothing about which
 *  shift applies is re-decided here.
 *
 *  The payload is /roster's, which already returns roster rows, standing
 *  shifts and approved leave for a range and already narrows a manager to
 *  their own team. Assigning shifts is deliberately absent — that lives on
 *  Operations → Shift, behind the shift-mapping permission matrix, and a
 *  second Assign button would be a second gate to keep in step.
 * ────────────────────────────────────────────────────────────────────────── */
export default function TeamShiftSchedule({ embedded = false }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [roster, setRoster] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [reportIds, setReportIds] = useState(null);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => weekDates(anchor), [anchor]);
  const from = ymd(days[0]);
  const to = ymd(days[6]);

  /* /roster narrows a MANAGER to their own team but returns the whole
   * organisation to a full-access caller — correct for Operations, wrong under
   * a heading that says "Team". The reportee list says which ids belong to this
   * caller's reporting line, and the grid shows the intersection, so an admin
   * opening Attendance → Team sees their own reports rather than everybody. */
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/roster?startDate=${from}&endDate=${to}`),
      api.get('/team/reportees'),
    ])
      .then(([r, t]) => {
        setRoster(r.data.data || []);
        setLeaves(r.data.leaves || []);
        setEmployees(r.data.employees || []);
        setReportIds(new Set((t.data.data || []).map(p => String(p.id))));
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the team schedule'))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(load, [load]);

  const rosterByKey = useMemo(
    () => new Map(roster.map(r => [`${r.employeeId}|${String(r.date).slice(0, 10)}`, r])), [roster]);

  const rows = useMemo(() => {
    if (!reportIds) return [];
    return employees
      .filter(e => reportIds.has(String(e._id)))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [employees, reportIds]);

  const step = dir => setAnchor(a => addDays(a, dir * 7));

  return (
    <div className={embedded ? 'p-5' : 'p-6'}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} title="Previous week"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
          <button onClick={() => step(1)} title="Next week"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
          <span className="text-[14px] font-semibold text-slate-800 ml-1">
            {days[0].toLocaleDateString('en-GB')} – {days[6].toLocaleDateString('en-GB')}
          </span>
          <button onClick={() => setAnchor(new Date())}
            className="ml-2 text-[13px] font-medium text-blue-600 hover:text-blue-700">This week</button>
        </div>
        <DirectScopeNote className="ml-auto" />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={CalendarClock} title="No schedule to show for your team"
            sub="Either nobody reports to you, or your role is not permitted to view their shift mapping." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-[12px] font-medium text-slate-500 w-[230px] sticky left-0 bg-slate-50">
                    Employee
                  </th>
                  {days.map(d => (
                    <th key={ymd(d)}
                      className={`px-2 py-2.5 text-left text-[12px] font-medium ${isWeekendDay(d) ? 'bg-amber-50' : ''}`}>
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
                      <p className="text-[14px] font-medium text-slate-800">{e.firstName} {e.lastName}</p>
                      <p className="text-[12px] text-slate-400">{e.department || '—'}</p>
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
        )}
      </div>
    </div>
  );
}
