import React from 'react';
import { Link } from 'react-router-dom';
import {
  User, Link2, Megaphone, CalendarDays,
  ClipboardCheck, Users,
  ExternalLink, Pin
} from 'lucide-react';
import api from '../../utils/api';

export const Card = ({ title, children, icon: Icon, className = "" }) => (
  <div className={`bg-white rounded border border-slate-200 shadow-sm flex flex-col ${className}`}>
    <div className="px-5 py-4 flex items-center gap-2 border-b border-transparent">
      {Icon && <Icon size={14} className="text-slate-400" />}
      <h3 className="text-[15px] font-bold text-slate-800">{title}</h3>
    </div>
    <div className="flex-1 p-5 flex flex-col">
      {children}
    </div>
  </div>
);

export const EmptyState = ({ text }) => (
  <div className="flex-1 flex items-center justify-center text-[14px] font-semibold text-slate-800">
    {text}
  </div>
);

/* An empty card that says why it is empty.
 *
 * Distinct from EmptyState on purpose. "No items found" and "this feature does
 * not exist here" look identical on screen but mean opposite things to whoever
 * is waiting for the feed to fill up, so the second one is never dressed as the
 * first. */
const NotWired = ({ text }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
    <p className="text-[14px] font-semibold text-slate-500">Not configured yet</p>
    <p className="text-[13px] text-slate-400 mt-1 leading-snug">{text}</p>
  </div>
);

const Avatar = ({ first, last }) => (
  <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center flex-shrink-0">
    <img
      src={`https://ui-avatars.com/api/?name=${encodeURIComponent(first || '')}+${encodeURIComponent(last || '')}&background=f8f9fc&color=475569`}
      alt="avatar" className="w-full h-full object-cover"
    />
  </div>
);

const dmy = v => v ? new Date(String(v).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—';

/* ── Data sources ──────────────────────────────────────────────────────────
 *
 * One entry per request the page can make, keyed by name; a widget lists the
 * sources it reads and the page fetches the union of what its *visible* widgets
 * asked for. Hiding a card therefore stops its request rather than just its
 * markup — which was the point of the old /employees?limit=200 call being
 * replaced: three cards' worth of names cost two hundred full employee records
 * whether or not the cards were on screen.
 */
export const SOURCES = {
  people:        () => api.get('/dashboard/my-space').then(r => r.data?.data || {}),
  announcements: () => api.get('/announcements').then(r => r.data?.data || []),
  leaveBalance:  () => api.get('/leaves/balance').then(r => r.data?.data || []),
  holidays:      () => api.get('/holidays').then(r => r.data?.data || []),
  favorites:     () => api.get('/report-favorites').then(r => r.data?.data || []),
  apps:          () => api.get('/my-apps').then(r => r.data?.data || []),
  goals:         () => api.get('/performance/goals/my').then(r => r.data?.data || []),
  reviews:       () => api.get('/performance').then(r => r.data?.data || []),
  lop:           () => api.get('/dashboard/lop-summary').then(r => r.data?.data || {}),
  tasks:         user => api.get(`/tasks?limit=50&assigneeId=${encodeURIComponent(user._id)}`)
                          .then(r => r.data?.data || []),
  documents:     user => api.get(`/documents/${encodeURIComponent(user._id)}`)
                          .then(r => r.data?.data || []),
};

/* Every widget gets ({ data, status }) where data[source] is whatever that
 * source resolved to and status[source] is 'loading' | 'ready' | 'error'.
 * `err` carries the server's sentence so a refusal can be shown as a refusal —
 * Favorites, for one, 403s when the role has that function switched off, and
 * "no favorites" would be the wrong thing to say about it. */
const gate = (status, err, sources, body) => {
  if (sources.some(s => status[s] === 'loading' || status[s] === undefined)) {
    return <EmptyState text="Loading…" />;
  }
  const failed = sources.find(s => status[s] === 'error');
  if (failed) {
    return (
      <div className="flex-1 flex items-center justify-center px-2 text-center">
        <p className="text-[13px] font-medium text-slate-500">{err[failed] || 'Could not load this widget.'}</p>
      </div>
    );
  }
  return body();
};

export const WIDGETS = [
  {
    key: 'newHires',
    title: 'New Hires',
    icon: User,
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[220px]',
    sources: ['people'],
    render: ({ data, status, err }) => gate(status, err, ['people'], () => {
      const hires = data.people?.newHires || [];
      if (hires.length === 0) return <EmptyState text="No New Joinees in past 30 days." />;
      return (
        <div className="space-y-3">
          {hires.slice(0, 3).map(e => (
            <div key={e._id} className="flex items-center gap-3">
              <Avatar first={e.firstName} last={e.lastName} />
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-slate-800 truncate">{e.firstName} {e.lastName}</p>
                <p className="text-[13px] text-slate-500 truncate">{e.designation || 'Employee'}</p>
              </div>
            </div>
          ))}
        </div>
      );
    }),
  },

  {
    key: 'birthday',
    title: '🎂 Birthday',
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[220px]',
    sources: ['people'],
    render: ({ data, status, err }) => gate(status, err, ['people'], () => {
      const list = data.people?.birthdays || [];
      if (list.length === 0) {
        return <div className="p-5 flex flex-1"><EmptyState text="No birthdays today." /></div>;
      }
      return (
        <div className="flex-1 overflow-y-auto max-h-[240px]">
          {list.map((e, i) => (
            <div key={`${e.employeeId || e.firstName}-${i}`} className="flex items-start gap-3 border border-slate-100 rounded-lg p-3 m-3 shadow-sm bg-white">
              <div className="w-12 h-12 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-50">
                <img
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(e.firstName || '')}+${encodeURIComponent(e.lastName || '')}&background=f8f9fc&color=475569`}
                  alt="avatar" className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-500 mb-1 truncate">{e.employeeId ? `${e.employeeId} - ` : ''}{e.firstName}</p>
                <p className="text-[14px] text-slate-700 leading-snug truncate">{e.designation || 'Employee'}</p>
                <p className="text-[13px] text-slate-400 mt-1 truncate">{e.department || 'Unassigned'}</p>
              </div>
            </div>
          ))}
        </div>
      );
    }),
  },

  {
    key: 'quickLinks',
    title: 'Quick Links',
    icon: Link2,
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[280px]',
    sources: ['apps'],
    render: ({ data, status, err }) => gate(status, err, ['apps'], () => {
      const apps = data.apps || [];
      if (apps.length === 0) {
        return <NotWired text="Links come from the apps an administrator has shared with you. None have been." />;
      }
      return (
        <div className="space-y-0 -m-5">
          {apps.map(a => (
            <a key={a.id} href={a.websiteUrl || '#'} target="_blank" rel="noreferrer" draggable={false}
              className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-800 truncate">{a.name}</p>
                {a.description && <p className="text-[12px] text-slate-400 truncate">{a.description}</p>}
              </div>
              <ExternalLink size={13} className="text-slate-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      );
    }),
  },

  {
    key: 'announcements',
    title: 'Announcements',
    icon: Megaphone,
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[280px]',
    sources: ['announcements'],
    render: ({ data, status, err }) => gate(status, err, ['announcements'], () => {
      const list = (data.announcements || []).slice(0, 5);
      if (list.length === 0) return <EmptyState text="No announcements" />;
      return (
        <div className="space-y-5 -mt-2">
          {list.map(ann => (
            <div key={ann._id} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-slate-700 leading-snug">{ann.title}</p>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  {new Date(ann.createdAt || Date.now()).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {ann.isPinned && <Pin size={13} className="text-brand-600 flex-shrink-0 mt-0.5" />}
            </div>
          ))}
        </div>
      );
    }),
  },

  {
    key: 'leaveReport',
    title: 'Leave Report',
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[280px]',
    sources: ['leaveBalance'],
    render: ({ data, status, err }) => gate(status, err, ['leaveBalance'], () => {
      const list = data.leaveBalance || [];
      if (list.length === 0) return <EmptyState text="No leave data" />;
      return (
        <div className="space-y-4 -mt-2">
          {list.map(lb => {
            const isHours = lb.unit === 'hours';
            const colorClass =
              lb.code === 'casual'     ? 'border-orange-200 text-orange-500'  :
              lb.code === 'comp_off'   ? 'border-emerald-200 text-emerald-500' :
              lb.code === 'unpaid'     ? 'border-rose-200 text-rose-500'      :
              lb.code === 'permission' ? 'border-amber-200 text-amber-500'    :
              'border-slate-200 text-slate-400';
            const sub = lb.available !== null && lb.available !== undefined
              ? `Available ${lb.available} ${isHours ? 'Hour(s)' : 'Day(s)'}`
              : null;
            return (
              <div key={lb.code} className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-full border-[3px] flex items-center justify-center text-[13px] font-bold flex-shrink-0 ${colorClass}`}>
                  {lb.booked || 0}
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-800 truncate">{lb.name}</p>
                  {sub && <p className="text-[12px] text-slate-500 font-medium">{sub}</p>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }),
  },

  {
    key: 'holidays',
    title: 'Upcoming Holidays',
    icon: CalendarDays,
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[220px]',
    sources: ['holidays'],
    render: ({ data, status, err }) => gate(status, err, ['holidays'], () => {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      // An Exception Working Day (type='working_day') is the opposite of a
      // holiday — a day off turned into a mandatory working day — so it does
      // not belong in a widget meant to tell people when they're next off.
      const list = (data.holidays || [])
        .filter(h => h.type !== 'working_day' && h.date && new Date(String(h.date).slice(0, 10) + 'T00:00:00') >= todayStart)
        .slice(0, 6);
      if (list.length === 0) return <EmptyState text="No upcoming holidays" />;
      return (
        <div className="space-y-0 -m-5">
          {list.map(hol => {
            const date = new Date(String(hol.date).slice(0, 10) + 'T00:00:00');
            return (
              <div key={hol._id} className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 last:border-b-0">
                <p className="text-[14px] font-semibold text-slate-800 truncate">{hol.name}</p>
                <div className="text-right flex-shrink-0">
                  <p className="text-[13px] font-bold text-slate-700">{date.toLocaleDateString('en-GB')}</p>
                  <p className="text-[12px] text-slate-400 capitalize">{date.toLocaleDateString('en-US', { weekday: 'long' })}</p>
                </div>
              </div>
            );
          })}
        </div>
      );
    }),
  },

  {
    key: 'appraisals',
    title: 'Appraisal Pending Approval',
    icon: ClipboardCheck,
    defaultVisible: true,
    colSpan: 1,
    minHeight: 'min-h-[220px]',
    sources: ['reviews'],
    render: ({ data, status, err }) => gate(status, err, ['reviews'], () => {
      /* performance_reviews has no approval chain — 'submitted' is the state
       * between the reviewer filling it in and it being closed as 'completed',
       * which is the only thing here that means "waiting on a decision". */
      const pending = (data.reviews || []).filter(r => r.status === 'submitted');
      if (pending.length === 0) return <EmptyState text="No appraisal awaiting approval." />;
      return (
        <div className="space-y-0 -m-5">
          {pending.slice(0, 5).map(r => (
            <Link key={r._id} to="/performance" draggable={false}
              className="block px-5 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
              <p className="text-[14px] font-semibold text-slate-800 truncate">{r.cycleName}</p>
              <p className="text-[12px] text-slate-400 truncate">
                {r.employee?.firstName} {r.employee?.lastName} · {dmy(r.periodStart)} – {dmy(r.periodEnd)}
              </p>
            </Link>
          ))}
        </div>
      );
    }),
  },

  {
    key: 'engagement',
    title: 'Employee Engagement',
    icon: Users,
    defaultVisible: false,
    colSpan: 1,
    minHeight: 'min-h-[220px]',
    sources: [],
    /* No source, and no honest way to invent one: there is no survey, poll or
     * engagement-score table anywhere in the backend. Off by default, and says
     * what is missing rather than showing a zero that looks like a measurement. */
    render: () => <NotWired text="NxtPeople has no survey or engagement module, so there is nothing to score yet." />,
  },
];

export const WIDGET_BY_KEY = WIDGETS.reduce((acc, w) => { acc[w.key] = w; return acc; }, {});
export const DEFAULT_ORDER = WIDGETS.map(w => w.key);
export const DEFAULT_HIDDEN = WIDGETS.filter(w => !w.defaultVisible).map(w => w.key);
