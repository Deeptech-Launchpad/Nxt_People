/* What actually happened on one day, for one person.
 *
 * The Present/Absent grid has room for a code or a duration and nothing more,
 * so a cell reading "0.15PM/0.85P" — or "01:15(PM)/07:41(P)" — can say a
 * permission happened without ever saying when it ran. Clicking the cell asks
 * that question, and this answers it: the punches, each session, and every
 * leave on the day with its own clock times.
 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';
import { useFormat } from '../../utils/datetime';
import { codeStyle } from './attendanceCodes';

const LEAVE_LABEL = {
  casual: 'Casual Leave',
  unpaid: 'Leave Without Pay',
  permission: 'Permission',
  comp_off: 'Compensatory Off',
};
const leaveLabel = t => LEAVE_LABEL[t] || String(t || '').replace(/_/g, ' ');

const HALF_LABEL = { first_half: 'First Half', second_half: 'Second Half' };

/* A labelled line. Values that are missing print an em dash rather than an
 * empty gap, so a row never looks like it failed to render. */
const Row = ({ label, children }) => (
  <div className="flex items-start gap-3 py-1.5">
    <span className="text-[12.5px] text-slate-500 w-[108px] flex-shrink-0">{label}</span>
    <span className="text-[13px] text-slate-800 min-w-0 flex-1">{children || '—'}</span>
  </div>
);

const Section = ({ title, children }) => (
  <div className="px-5 py-3.5 border-t border-slate-100">
    <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{title}</h4>
    {children}
  </div>
);

export default function PresentAbsentCellModal({ employeeId, date, onClose }) {
  const f = useFormat();
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    api.get(`/reports/attendance/present-absent/cell?employeeId=${employeeId}&date=${date}`)
      .then(r => { if (alive) setD(r.data.data); })
      .catch(err => { if (alive) setError(err.response?.data?.message || 'Could not load that day'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId, date]);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emp = d?.employee;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onClick={e => e.stopPropagation()}
        className="relative bg-white w-full max-w-[400px] h-full shadow-xl flex flex-col">

        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-800 truncate">
              {emp ? `${emp.firstName} ${emp.lastName}` : 'Day detail'}
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              {f.date(date)}{emp?.employeeCode ? ` · ${emp.employeeCode}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-slate-400 hover:text-slate-700 flex-shrink-0 ml-3"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-5 py-6 text-[13px] text-slate-400">Loading…</p>}
          {error && <p className="px-5 py-6 text-[13px] text-rose-600">{error}</p>}

          {d && !loading && (
            <>
              <div className="px-5 py-3.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${codeStyle(d.code)}`}>
                    {d.code}
                  </span>
                  {d.holidayName && <span className="text-[13px] text-slate-700">{d.holidayName}</span>}
                </div>
                <div className="mt-2">
                  <Row label="Shift">
                    {emp?.shiftName
                      ? `${emp.shiftName}${emp.shiftStart ? ` · ${f.range(emp.shiftStart, emp.shiftEnd)}` : ''}`
                      : null}
                  </Row>
                  <Row label="Worked">{d.workedHours ? f.hours(d.workedHours) : null}</Row>
                  {d.permissionHours > 0 && (
                    <Row label="Permission">{f.hours(d.permissionHours)}</Row>
                  )}
                </div>
              </div>

              <Section title="Attendance">
                {d.attendance ? (
                  <>
                    <Row label="Check-in">{f.instant(d.attendance.checkIn)}</Row>
                    <Row label="Check-out">{f.instant(d.attendance.checkOut)}</Row>
                    <Row label="Status">{d.attendance.status}</Row>
                    {d.attendance.lateMinutes > 0 && (
                      <Row label="Late by">{f.hours(d.attendance.lateMinutes / 60)}</Row>
                    )}
                    {d.attendance.checkInLocation && (
                      <Row label="Location">{d.attendance.checkInLocation}</Row>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-slate-400">No punch recorded.</p>
                )}
              </Section>

              {/* Only worth a section when the day was actually broken up —
                  a single session says nothing the check-in row hasn't. */}
              {d.sessions?.length > 1 && (
                <Section title={`Sessions (${d.sessions.length})`}>
                  {d.sessions.map((s, i) => (
                    <Row key={i} label={`#${i + 1}`}>
                      {f.instant(s.checkIn)} – {s.checkOut ? f.instant(s.checkOut) : 'still in'}
                      {s.sessionHours ? ` · ${f.hours(s.sessionHours)}` : ''}
                    </Row>
                  ))}
                </Section>
              )}

              {d.leaves?.length > 0 && (
                <Section title="Leave">
                  {d.leaves.map((l, i) => (
                    <div key={i} className={i ? 'mt-2.5 pt-2.5 border-t border-slate-50' : ''}>
                      <Row label="Type">
                        {leaveLabel(l.leaveType)}
                        {l.isHalfDay && l.halfDayType ? ` · ${HALF_LABEL[l.halfDayType] || l.halfDayType}` : ''}
                      </Row>
                      {/* The question this whole view exists to answer. */}
                      {(l.startTime || l.endTime) && (
                        <Row label="Timing">{f.range(l.startTime, l.endTime)}</Row>
                      )}
                      {l.hours > 0 && <Row label="Duration">{f.hours(l.hours)}</Row>}
                      {l.startYmd !== l.endYmd && (
                        <Row label="Applied for">{f.date(l.startYmd)} – {f.date(l.endYmd)}</Row>
                      )}
                      {l.reason && <Row label="Reason">{l.reason}</Row>}
                    </div>
                  ))}
                </Section>
              )}

              {d.pendingLeaves?.length > 0 && (
                <Section title="Awaiting approval">
                  {d.pendingLeaves.map((l, i) => (
                    <div key={i} className={i ? 'mt-2.5 pt-2.5 border-t border-slate-50' : ''}>
                      <Row label="Type">{leaveLabel(l.leaveType)}</Row>
                      {(l.startTime || l.endTime) && (
                        <Row label="Timing">{f.range(l.startTime, l.endTime)}</Row>
                      )}
                      {l.hours > 0 && <Row label="Duration">{f.hours(l.hours)}</Row>}
                      {l.reason && <Row label="Reason">{l.reason}</Row>}
                    </div>
                  ))}
                </Section>
              )}

              {d.onDuty?.length > 0 && (
                <Section title="On Duty">
                  {d.onDuty.map((o, i) => (
                    <div key={i} className={i ? 'mt-2.5 pt-2.5 border-t border-slate-50' : ''}>
                      <Row label="Type">{String(o.requestType || '').replace(/_/g, ' ') || 'On Duty'}</Row>
                      {(o.startTime || o.endTime) && (
                        <Row label="Timing">{f.range(o.startTime, o.endTime)}</Row>
                      )}
                      {o.hours > 0 && <Row label="Duration">{f.hours(o.hours)}</Row>}
                      {o.reason && <Row label="Reason">{o.reason}</Row>}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
