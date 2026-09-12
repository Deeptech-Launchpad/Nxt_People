import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, User, ChevronLeft, ChevronRight, ChevronDown, X, CalendarDays, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from './useEmployeeList';
import { LEAVE_LABEL, to12 } from '../shift/shiftGrid';

/* ── User-specific Operations ───────────────────────────────────────────────
 *  Zoho's first Leave Tracker tab, and the one that explains the whole
 *  section: type a name, and everything below is about THAT person rather
 *  than about you — Leave Summary | Leave Requests | Compensatory Request.
 *
 *  It opens on an empty search deliberately. Loading a hundred and fifty
 *  people's balances to show a screen where you are about to pick one is work
 *  nobody asked for, and Zoho does the same — "Please begin typing to search
 *  for an employee".
 *
 *  The person view is exported as UserLeaveTabs because Leave Tracker → Team
 *  opens the same tabs on a reportee. It takes its roster and its `canManage`
 *  from the caller: the Operations door is full-access, the Team door is a
 *  manager, and the two may read different things about somebody else's
 *  leave. Two copies of this screen would be two chances for the same
 *  person's year to read differently depending on how you got there.
 *
 *  Every figure here comes from the endpoints the employee's OWN Leave
 *  Summary reads, with ?employeeId= on them, so an administrator and the
 *  person they are looking at cannot be shown different balances. Those
 *  endpoints used to fall back to the caller's own id when the caller was not
 *  allowed to name somebody else; they now refuse instead, which is what
 *  makes this screen safe to open from a manager's door at all.
 * ────────────────────────────────────────────────────────────────────────── */

const STATUS_STYLE = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

// Zoho shows Paid / Unpaid beside the type, because that is the column that
// decides whether the day costs the person money.
const UNPAID = new Set(['unpaid', 'lop', 'loss_of_pay']);

/* Dates arrive as YYYY-MM-DD or as a timestamp; the date part is the whole of
 * what a leave day means, and parsing at local midnight keeps a day from
 * sliding to its neighbour. The same idiom the other leave tables use. */
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const ymd = (d) => String(d || '').slice(0, 10);
const todayYmd = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/* Permission is hourly and its total_days is 0 by design, so printing days on
 * a permission row would put the one number the row cannot be next to it. */
const takenLabel = (l) => {
  if (l.leaveType === 'permission') {
    const h = Number(l.hours) || 0;
    const window = l.startTime && l.endTime ? ` (${to12(l.startTime)}–${to12(l.endTime)})` : '';
    return `${h} Hour${h === 1 ? '' : 's'}${window}`;
  }
  const d = Number(l.totalDays) || 0;
  const half = l.isHalfDay ? ` · ${l.halfDayType === 'second_half' ? '2nd' : '1st'} half` : '';
  return `${d} Day${d === 1 ? '' : 's'}${half}`;
};

const periodLabel = (l) => (ymd(l.startDate) === ymd(l.endDate)
  ? fmtDate(l.startDate)
  : `${fmtDate(l.startDate)} - ${fmtDate(l.endDate)}`);

const nameOf = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim() || '—';

const StatusPill = ({ status, title }) => (
  <span title={title}
    className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize ${
      STATUS_STYLE[status] || 'bg-slate-100 text-slate-500'}`}>
    {status || '—'}
  </span>
);

const Loading = () => <p className="px-5 py-6 text-slate-400 text-sm">Loading…</p>;
const Blank = ({ text }) => <p className="px-5 py-8 text-slate-400 text-sm text-center">{text}</p>;

const Panel = ({ title, right, children }) => (
  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
      <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    {children}
  </div>
);

/* ── Leave Summary ────────────────────────────────────────────────────────
 *  The header figures, the year's balance cards, and what is still to come
 *  beside what has already happened.
 *
 *  The cards are /leaves/balance's four, not /leave-types/balances' row per
 *  configured type: /leaves/balance is the same read the employee's own Leave
 *  Summary makes, and it is the only one that also answers the header line.
 *  Two sources for one question is how an administrator and an employee end
 *  up quoting different numbers at each other.
 */
function LeaveSummaryTab({ employee, canManage = true }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [cards, setCards] = useState(null);
  const [summary, setSummary] = useState({});
  const [leaves, setLeaves] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      api.get(`/leaves/balance?year=${year}&employeeId=${employee._id}`),
      api.get(`/leaves?employeeId=${employee._id}&startDate=${year}-01-01&endDate=${year}-12-31&limit=200&sortBy=startDate&sortDir=asc`),
      /* Non-fatal, but never silent: a year rendered with no holidays in it
         looks exactly like a year that has none. */
      api.get(`/attendance/holidays?year=${year}`).catch(() => {
        toast.error('Holidays could not be loaded, so the lists below may be incomplete');
        return { data: { data: [] } };
      }),
    ]).then(([b, l, h]) => {
      if (!live) return;
      setCards(b.data.data || []);
      setSummary(b.data.summary || {});
      setLeaves(l.data.data || []);
      setHolidays(h.data.data || []);
    }).catch(err => {
      if (!live) return;
      toast.error(err.response?.data?.message || 'Could not load this leave summary');
      setCards([]); setSummary({}); setLeaves([]); setHolidays([]);
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [employee._id, year]);

  const { upcoming, past } = useMemo(() => {
    const today = todayYmd();
    const items = [
      ...holidays.map(h => ({
        key: `h-${h._id}`, date: ymd(h.date), kind: 'Holiday',
        title: h.name, note: h.description || '', status: null,
      })),
      ...leaves
        .filter(l => l.status !== 'cancelled' && l.status !== 'rejected')
        .map(l => ({
          key: `l-${l._id}`, date: ymd(l.startDate), end: ymd(l.endDate),
          kind: LEAVE_LABEL[l.leaveType] || l.leaveType,
          title: periodLabel(l), note: l.reason || '', status: l.status,
          taken: takenLabel(l),
        })),
    ];
    return {
      upcoming: items.filter(i => (i.end || i.date) >= today).sort((a, b) => a.date.localeCompare(b.date)),
      past: items.filter(i => (i.end || i.date) < today).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [holidays, leaves]);

  const four = (cards || []).filter(c => ['casual', 'comp_off', 'unpaid', 'permission'].includes(c.code));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Both figures come from the server. Hours are named separately
            because two hours of permission is not a fraction of a leave day,
            and are named only when there are any. */}
        <span className="text-[14px] font-semibold text-slate-600">
          Leave booked this year : <span className="text-brand-600">
            {summary.bookedDays ?? 0} day(s){summary.bookedHours ? ` and ${summary.bookedHours} hour(s)` : ''}
          </span>
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-[14px] text-slate-500">
          Absent : <span className="font-semibold text-slate-700">{summary.absentDays ?? 0}</span>
        </span>

        <div className="ml-auto flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] text-slate-600">
          <button onClick={() => setYear(y => y - 1)} title="Previous year"
            className="hover:text-brand-600"><ChevronLeft size={14} /></button>
          <span className="font-semibold text-slate-700">01/01/{year} - 31/12/{year}</span>
          <button onClick={() => setYear(y => y + 1)} title="Next year"
            className="hover:text-brand-600"><ChevronRight size={14} /></button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse">
              <div className="h-3 bg-slate-100 rounded w-24 mb-3" />
              <div className="h-5 bg-slate-100 rounded w-16" />
            </div>
          ))}
        </div>
      ) : four.length === 0 ? (
        <Panel title="Leave balance"><Blank text="No leave balance is configured for this employee." /></Panel>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {four.map(card => {
            const isPerm = card.code === 'permission';
            const unit = isPerm ? 'h' : '';
            // Round to 2 dp so JS float math does not show 2.9699999999999998.
            const fmt = (v) => (v === null || v === undefined) ? '—'
              : `${Math.round((Number(v) + Number.EPSILON) * 100) / 100}${unit}`;
            return (
              <div key={card.code} className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[18px]">{card.icon || '📋'}</span>
                  <p className="text-[13.5px] font-semibold text-slate-600">{card.name}</p>
                </div>
                {/* Permission resets every calendar month with no carry-over,
                    and Leave Without Pay has no allowance at all — so
                    "Available" is a question neither of them answers the way
                    casual leave does, and the label says which figure it is. */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13.5px] text-slate-500">
                    {card.available === null ? 'Booked' : isPerm ? 'Available this month' : 'Available'}
                  </span>
                  <span className="text-[15px] font-bold text-slate-800">
                    {card.available === null ? fmt(card.booked) : fmt(card.available)}
                  </span>
                </div>
                {card.available !== null && (
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                    <span className="text-[13.5px] text-slate-500">{isPerm ? 'Booked this month' : 'Booked'}</span>
                    <span className="text-[13.5px] font-semibold text-slate-700">{fmt(card.booked)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && !loading && (
        <p className="text-sm text-slate-400">
          To change any of these figures, use <span className="font-medium text-slate-500">Customize Balance</span>.
        </p>
      )}

      <Panel title="Upcoming Leaves & Holidays">
        {loading ? <Loading /> : upcoming.length === 0
          ? <Blank text="Nothing is coming up for the rest of this range." />
          : <DayList items={upcoming} />}
      </Panel>

      <Panel title="Past Leaves & Holidays">
        {loading ? <Loading /> : past.length === 0
          ? <Blank text="Nothing has been taken in this range." />
          : <DayList items={past} />}
      </Panel>
    </div>
  );
}

const DayList = ({ items }) => (
  <ul className="divide-y divide-slate-50">
    {items.map(i => (
      <li key={i.key} className="px-5 py-3 flex items-center gap-3">
        <CalendarDays size={15} className="text-slate-300 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-slate-700 truncate">
            {i.kind}{i.title ? ` · ${i.title}` : ''}
          </p>
          {i.note && <p className="text-[12.5px] text-slate-400 truncate">{i.note}</p>}
        </div>
        {i.taken && <span className="text-[13px] text-slate-500 flex-shrink-0">{i.taken}</span>}
        {i.status ? <StatusPill status={i.status} /> : (
          <span className="text-[13px] text-slate-400 flex-shrink-0">{fmtDate(i.date)}</span>
        )}
      </li>
    ))}
  </ul>
);

/* ── Leave Requests ──────────────────────────────────────────────────────
 *  Every request this person has filed, in Zoho's columns and Zoho's order.
 *  /leaves is the same endpoint the Operations table reads — it already
 *  authorizes approvers and narrows them to their own reporting line, so the
 *  Team door needs nothing added to it.
 */
function LeaveRequestsTab({ employee }) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/leaves?employeeId=${employee._id}&limit=200&sortBy=startDate&sortDir=desc`)
      .then(r => {
        if (!live) return;
        setRows(r.data.data || []);
        setTotal(r.data.total ?? (r.data.data || []).length);
      })
      .catch(err => {
        if (!live) return;
        toast.error(err.response?.data?.message || 'Could not load these leave requests');
        setRows([]); setTotal(0);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [employee._id]);

  return (
    <Panel title="Leave Requests"
      right={<span className="text-[13px] text-slate-500">{total} request{total === 1 ? '' : 's'}</span>}>
      {loading ? <Loading /> : !rows || rows.length === 0 ? (
        <Blank text="No leave has been applied for." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-slate-400 text-[12px] uppercase tracking-wider bg-slate-50/60">
                  {['Status', 'Employee Name', 'Leave type', 'Type', 'Leave period', 'Days/hours taken', 'Date of request']
                    .map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(l => (
                  <tr key={l._id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <StatusPill status={l.status}
                        title={l.status === 'rejected' && l.rejectionReason ? l.rejectionReason : undefined} />
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{nameOf(l.employee || employee)}</td>
                    <td className="px-4 py-3 text-slate-700">{LEAVE_LABEL[l.leaveType] || l.leaveType}</td>
                    <td className="px-4 py-3 text-slate-500">{UNPAID.has(l.leaveType) ? 'Unpaid' : 'Paid'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{periodLabel(l)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{takenLabel(l)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The endpoint clamps a page at 200. Saying so beats a table that
              quietly stops short of the total printed above it. */}
          {total > rows.length && (
            <p className="px-4 py-2.5 text-[13px] text-slate-400 border-t border-slate-100">
              Showing the most recent {rows.length} of {total}.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/* ── Compensatory Request ────────────────────────────────────────────────
 *  Credited, taken and what is left, for this person.
 *
 *  /comp-off/all is full-access only, and it is the only read that answers
 *  the whole picture — /comp-off/pending is pending-by-definition, so
 *  labelling it "Compensatory Request" for a manager would show a partial
 *  list as if it were the lot. The tab is dropped for them instead (see
 *  SUBTABS); Leave Tracker → Team has its own Compensatory Request tab, which
 *  is the comp-off screen scoped to their reports.
 */
function CompRequestTab({ employee }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get('/comp-off/all')
      .then(r => {
        if (!live) return;
        setRows((r.data.data || []).filter(c => String(c.employee?._id) === String(employee._id)));
      })
      .catch(err => {
        if (!live) return;
        toast.error(err.response?.data?.message || 'Could not load compensatory requests');
        setRows([]);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [employee._id]);

  return (
    <Panel title="Compensatory Request"
      right={<span className="text-[13px] text-slate-500">{rows?.length || 0} request{rows?.length === 1 ? '' : 's'}</span>}>
      {loading ? <Loading /> : !rows || rows.length === 0 ? (
        <Blank text="No compensatory off has been claimed." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-slate-400 text-[12px] uppercase tracking-wider bg-slate-50/60">
                {['Status', 'Employee Name', 'Worked date', 'Comp-off date', 'Expires', 'Credited', 'Taken', 'Date of request']
                  .map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(c => (
                <tr key={c._id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <StatusPill status={c.expired && c.status === 'approved' ? 'expired' : c.status}
                      title={c.status === 'rejected' && c.rejectionReason ? c.rejectionReason : undefined} />
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{nameOf(c.employee || employee)}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(c.workedDate)}</td>
                  {/* Claiming a credit and spending it are two separate acts,
                      so a request with no day named yet is the normal case. */}
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                    {c.compOffDate ? fmtDate(c.compOffDate) : <span className="text-slate-400">Not yet chosen</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.expiresAt ? fmtDate(c.expiresAt) : '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{Number(c.daysEarned) || 0}</td>
                  <td className="px-4 py-3 text-slate-700">{Number(c.daysUsed) || 0}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

/* `full: true` marks a tab whose endpoint is full-access-only underneath, so
 * it is dropped rather than disabled for a manager — pressing it would earn
 * them a 403 and nothing else. Hiding a door is a UI fix; opening one is an
 * access-control decision, and widening /comp-off/all to approvers would
 * widen it to every employee in the company, not to their reports. */
const SUBTABS = [
  ['summary', 'Leave Summary', LeaveSummaryTab],
  ['requests', 'Leave Requests', LeaveRequestsTab],
  ['comp-off', 'Compensatory Request', CompRequestTab, { full: true }],
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

/* Switch person without going back to the search first. The Attendance
 * Operations screen draws the same control and does not export it; importing
 * it would tie the Leave Tracker's screen to Attendance's, which is the
 * cross-section coupling these workspaces exist to avoid. */
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

/* ── one person's leave, three tabs ───────────────────────────────────────
 *  The half of this screen that is about an employee rather than about
 *  finding one. Operations reaches it through the search below; Leave Tracker
 *  → Team reaches it from a reportee card, where the roster is the manager's
 *  reportees and `onBack` goes to that list rather than to a search box.
 *
 *  `canManage` false DROPS the affordances that are full-access-only behind
 *  the scenes rather than letting a manager press them and get a 403.
 */
export function UserLeaveTabs({
  employee, people = [], onPick, onBack, backTitle = 'Back', canManage = true,
}) {
  const [subtab, setSubtab] = useState('summary');
  const tabs = subtabsFor(canManage);
  // A hidden tab is still reachable by a stale bit of state, and find() on a
  // missing id would throw rather than degrade.
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
      <ActiveTab employee={employee} canManage={canManage} />
    </div>
  );
}

export default function OpsUserSpecific() {
  const { people, loading } = useEmployeeList();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return people
      .filter(p => labelOf(p).toLowerCase().includes(needle)
        || String(p.department || '').toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, people]);

  if (!picked) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search Employee" autoFocus
            className="w-full border border-slate-200 rounded-xl pl-11 pr-11 py-3.5 text-base focus:outline-none focus:border-brand-400"
          />
          {q && (
            <button onClick={() => setQ('')} title="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
              <X size={15} />
            </button>
          )}
        </div>

        {q.trim() && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm divide-y divide-slate-50">
            {loading ? (
              <p className="px-4 py-3 text-slate-400 text-sm">Loading employees…</p>
            ) : matches.length === 0 ? (
              <p className="px-4 py-3 text-slate-400 text-sm">Nobody matches that.</p>
            ) : matches.map(p => (
              <button key={p._id} onClick={() => setPicked(p)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                <Avatar person={p} size={30} />
                <span className="text-[15px] text-slate-700 flex-1 truncate">{labelOf(p)}</span>
                {p.department && <span className="text-sm text-slate-400 flex-shrink-0">{p.department}</span>}
              </button>
            ))}
          </div>
        )}

        {!q.trim() && (
          <div className="text-center py-20">
            <User size={34} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-[15px]">Please begin typing to search for an employee</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <UserLeaveTabs
        employee={picked} people={people} onPick={setPicked}
        onBack={() => setPicked(null)} backTitle="Back to search" />
    </div>
  );
}
