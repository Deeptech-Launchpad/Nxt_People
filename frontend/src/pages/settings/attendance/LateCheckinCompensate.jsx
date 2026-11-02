import React, { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { useFormat } from '../../../utils/datetime';

/* Admin/HR audit view of the late-check-in decision (Permission vs.
 * Compensate Working Hours) — a new, separate report reading the new
 * attendance.late_checkin_action/late_checkin_reason columns. Deliberately
 * its own page rather than added to an existing report, so it carries zero
 * risk to any report that already shipped. This whole settings section is
 * already admin/director/hr_admin-only (see serviceCatalog.js), so no
 * additional access check is needed here. */
export default function LateCheckinCompensate() {
  const fmt = useFormat();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const today = new Date().toLocaleDateString('en-CA');
  const [startDate, setStartDate] = useState(today.slice(0, 8) + '01');
  const [endDate, setEndDate] = useState(today);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get('/attendance/late-checkin-records', { params: { startDate, endDate } })
      .then(r => setRows(r.data.data || []))
      .catch(err => setError(err.response?.data?.message || 'Failed to load records'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const inputClass = 'border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]';

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-display font-semibold text-slate-800">Compensate Working Hours</h3>
        <p className="text-[13px] text-slate-500 mt-1">
          Every late General-Shift check-in by an Employee, the reason given, which option they
          chose, and whether a Compensate day actually reached 8h 30m.
        </p>

        <div className="flex flex-wrap items-end gap-3 mt-4">
          <div>
            <label className="block text-[12.5px] text-slate-500 mb-1">From</label>
            <input type="date" className={inputClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[12.5px] text-slate-500 mb-1">To</label>
            <input type="date" className={inputClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-[13.5px] font-medium hover:bg-brand-700"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-[13.5px] text-slate-400 px-4 py-6">Loading…</p>
        ) : error ? (
          <p className="text-[13.5px] text-red-600 px-4 py-6">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-[13.5px] text-slate-400 px-4 py-6">No late check-in records in this range.</p>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Check-in</th>
                <th className="px-3 py-2.5 font-medium">Option</th>
                <th className="px-3 py-2.5 font-medium">Late Reason</th>
                <th className="px-3 py-2.5 font-medium">Worked</th>
                <th className="px-3 py-2.5 font-medium">8h 30m met</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 text-slate-800">{r.employeeName} <span className="text-slate-400">({r.employeeId})</span></td>
                  <td className="px-3 py-2.5 text-slate-600">{fmt.date(r.date)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{r.checkIn ? fmt.time(r.checkIn) : '—'}</td>
                  <td className="px-3 py-2.5">
                    {r.action === 'compensate' ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[12px] font-medium bg-purple-50 text-purple-700">
                        Compensate Working Hours
                      </span>
                    ) : r.permissionLinked ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[12px] font-medium bg-blue-50 text-blue-700">
                        Applied Permission
                      </span>
                    ) : (
                      // Permission was chosen but no application is linked to
                      // it — either a submission never happened (cancelled/
                      // closed the form) or this is a historical row from
                      // before the link was required. Shown honestly rather
                      // than claiming a Permission that may not exist.
                      <span className="inline-block px-2 py-0.5 rounded-full text-[12px] font-medium bg-amber-50 text-amber-700">
                        Permission selected (not confirmed)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{r.reason || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{Number(r.workingHours || 0).toFixed(2)}h</td>
                  <td className="px-3 py-2.5">
                    {r.requirementMet
                      ? <span className="text-emerald-600 font-medium">Yes</span>
                      : <span className="text-amber-600 font-medium">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
