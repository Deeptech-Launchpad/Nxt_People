import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from '../leavetracker/useEmployeeList';

/* ── User-specific Operations ─────────────────────────────────────────────
 *  Zoho's first Attendance tab: search an employee, then act on THEIR
 *  attendance rather than your own. Four sub-tabs, each an existing,
 *  already-correct endpoint that learned to accept ?employeeId= for a
 *  full-access caller (see routes/attendance.js /my, routes/
 *  regularizations.js /my, routes/on-duty.js /my, routes/reports.js
 *  /attendance/expected-vs-worked) rather than a parallel admin copy of
 *  each.
 *
 *  Attendance Summary here is the list view only. Zoho also offers a
 *  timeline/grid view and a calendar view of the same data — deferred,
 *  deliberately, rather than built thin and wrong under the same time as
 *  everything else in this pass. The list view is the one that carries
 *  every figure (First In, Last Out, Total Hours, Status), so it is the
 *  one worth having correct first.
 */
const STATUS_LABEL = {
  present: { label: 'Present', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  late: { label: 'Late', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-600 border-red-200' },
  'half-day': { label: 'Half Day', cls: 'bg-blue-100 text-blue-600 border-blue-200' },
  on_duty: { label: 'On Duty', cls: 'bg-violet-100 text-violet-600 border-violet-200' },
};
const StatusPill = ({ status }) => {
  const s = STATUS_LABEL[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  return <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>;
};

const fmtTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
  : '—';
const fmtHM = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '00:00';
  const total = Math.round(Number(n) * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const fmtDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
// attendance_regularizations.check_in/out are TIME columns — pg returns
// "09:30:00" as a plain string, not a value Date() can be pointed at.
const fmtTimeStr = (hms) => {
  if (!hms) return '—';
  const [h, m] = hms.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

const REG_STATUS = [['all', 'All'], ['approved', 'Approved'], ['pending', 'Pending'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']];
const ONDUTY_STATUS = [['all', 'All'], ['submitted', 'Submitted'], ['cancelled', 'Cancelled']];
const REQ_STATUS_CLS = {
  approved: 'bg-emerald-100 text-emerald-700', pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600', cancelled: 'bg-slate-100 text-slate-500', submitted: 'bg-amber-100 text-amber-700',
};

function AttendanceSummaryTab({ employee }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { month: d.getMonth(), year: d.getFullYear() }; });
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get(`/attendance/my?month=${cursor.month}&year=${cursor.year}&employeeId=${employee._id}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load attendance'); setRows([]); });
  }, [employee._id, cursor]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const shift = employee.shift?.name ? `${employee.shift.name} [${employee.shift.startTime?.slice(0, 5) || ''} - ${employee.shift.endTime?.slice(0, 5) || ''}]` : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(c => c.month === 0 ? { month: 11, year: c.year - 1 } : { ...c, month: c.month - 1 })}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
          <span className="text-[15px] font-medium text-slate-700 min-w-[140px] text-center">{monthLabel}</span>
          <button onClick={() => setCursor(c => c.month === 11 ? { month: 0, year: c.year + 1 } : { ...c, month: c.month + 1 })}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
        </div>
        {shift && <span className="text-[13px] text-slate-400">{shift}</span>}
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No attendance recorded for {monthLabel}.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">First In</th>
                <th className="px-4 py-3 font-medium">Last Out</th>
                <th className="px-4 py-3 font-medium">Total Hours</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Late By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.date} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtTime(r.checkIn)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtTime(r.checkOut)}</td>
                  <td className="px-4 py-3 text-slate-700 font-mono">{fmtHM(r.workingHours)}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-amber-600">{r.lateMinutes > 0 ? `${r.lateMinutes} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpectedVsWorkedTab({ employee }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    // One row per of the last 6 calendar months, oldest last — the same
    // shape Zoho's own ledger shows. Each call is independently correct
    // (previousBalance already nets everything before that month), so
    // these six requests do not need to run in a particular order.
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d.toLocaleDateString('en-CA');
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
      return { start, end };
    });
    Promise.all(months.map(({ start, end }) =>
      api.get(`/reports/attendance/expected-vs-worked?startDate=${start}&endDate=${end}&employeeId=${employee._id}`)
        .then(r => ({ start, end, row: (r.data.data || [])[0] || null }))
    ))
      .then(setRows)
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load the hours ledger'); setRows([]); });
  }, [employee._id]);

  return (
    <div>
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Previous Balance</th>
                <th className="px-4 py-3 font-medium">Expected Hours</th>
                <th className="px-4 py-3 font-medium">Payable Hours</th>
                <th className="px-4 py-3 font-medium">Balance Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ start, end, row }) => (
                <tr key={start} className="border-t border-slate-50">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{new Date(`${start}T00:00:00`).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{new Date(`${end}T00:00:00`).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.previousBalance)}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.expectedHours)}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{fmtHM(row?.payableHours)}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${Number(row?.balanceHours) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {fmtHM(row?.balanceHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegularizationTab({ employee }) {
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get(`/regularizations/my?employeeId=${employee._id}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load regularizations'); setRows([]); });
  }, [employee._id]);

  const filtered = useMemo(() => (rows || []).filter(r => status === 'all' || r.status === status), [rows, status]);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400">
          {REG_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No regularization requests raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Check-in</th>
                <th className="px-4 py-3 font-medium">Check-out</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r._id} className="border-t border-slate-50">
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(String(r.date).slice(0, 10))}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtTimeStr(r.checkIn)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtTimeStr(r.checkOut)}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[240px] truncate" title={r.reason}>{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${REQ_STATUS_CLS[r.status] || 'bg-slate-100 text-slate-500'}`}>
                      {r.status?.charAt(0).toUpperCase() + r.status?.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OnDutyTab({ employee }) {
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api.get(`/on-duty/my?employeeId=${employee._id}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load on-duty requests'); setRows([]); });
  }, [employee._id]);

  const filtered = useMemo(() => (rows || []).filter(r => status === 'all' || r.status === status), [rows, status]);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400">
          {ONDUTY_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No on-duty requests raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r._id} className="border-t border-slate-50">
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {fmtDate(String(r.startDate).slice(0, 10))}{r.endDate && r.endDate !== r.startDate ? ` – ${fmtDate(String(r.endDate).slice(0, 10))}` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.requestType || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[280px] truncate" title={r.reason}>{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${REQ_STATUS_CLS[r.status] || 'bg-slate-100 text-slate-500'}`}>
                      {r.status?.charAt(0).toUpperCase() + r.status?.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SUBTABS = [
  ['summary', 'Attendance Summary', AttendanceSummaryTab],
  ['expected', 'Expected vs Worked Hours', ExpectedVsWorkedTab],
  ['regularization', 'Regularization', RegularizationTab],
  ['onduty', 'On Duty', OnDutyTab],
];

export default function OpsUserSpecific() {
  const { people } = useEmployeeList();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [subtab, setSubtab] = useState('summary');

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
            className="w-full border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-[15px] focus:outline-none focus:border-brand-400"
          />
        </div>
        {matches.length > 0 && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-50">
            {matches.map(p => (
              <button key={p._id} onClick={() => { setPicked(p); setSubtab('summary'); }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                <span className="text-[14.5px] text-slate-700">{labelOf(p)}</span>
                <span className="text-[13px] text-slate-400">{p.department}</span>
              </button>
            ))}
          </div>
        )}
        {!q.trim() && <p className="text-center text-slate-400 py-16">Please begin typing to search for an employee.</p>}
      </div>
    );
  }

  const ActiveTab = SUBTABS.find(([id]) => id === subtab)[2];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setPicked(null)} className="text-[14.5px] text-brand-600 hover:underline">
          ← {labelOf(picked)}
        </button>
      </div>
      <div className="flex gap-0.5 border-b border-slate-200 mb-5">
        {SUBTABS.map(([id, label]) => (
          <button key={id} onClick={() => setSubtab(id)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              subtab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {label}
          </button>
        ))}
      </div>
      <ActiveTab employee={picked} />
    </div>
  );
}
