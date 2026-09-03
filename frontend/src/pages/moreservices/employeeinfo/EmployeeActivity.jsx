import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UserPlus, LogOut, FileText, CalendarDays, Clock, Briefcase, Pencil, IndianRupee, Circle,
} from 'lucide-react';
import api from '../../../utils/api';

/* What has happened to this person's record.
 *
 * The questions this answers are the ones that used to need four screens and
 * sometimes a database: when did they send their PAN card, who changed their
 * designation, when did they last take leave. Each of those already existed
 * somewhere; none of them existed together.
 *
 * Check-ins are deliberately absent. Two punches a day for four years is not
 * a timeline, it is a flood that buries the twelve events somebody opened
 * this to find — and Attendance already shows them better.
 */
const ICONS = {
  user: UserPlus, exit: LogOut, file: FileText, calendar: CalendarDays,
  clock: Clock, briefcase: Briefcase, edit: Pencil, money: IndianRupee,
};

/* Colour carries meaning here rather than decoration: a joining and an exit
 * should not look like a profile edit. */
const TONE = {
  joined: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  exit: 'bg-rose-50 text-rose-600 border-rose-100',
  document: 'bg-sky-50 text-sky-600 border-sky-100',
  leave: 'bg-violet-50 text-violet-600 border-violet-100',
  regularization: 'bg-amber-50 text-amber-600 border-amber-100',
  onduty: 'bg-blue-50 text-blue-600 border-blue-100',
  pay: 'bg-slate-100 text-slate-600 border-slate-200',
  change: 'bg-slate-50 text-slate-500 border-slate-200',
};

const STATUS_CLS = {
  approved: 'bg-emerald-100 text-emerald-700', pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600', cancelled: 'bg-slate-100 text-slate-500',
  submitted: 'bg-amber-100 text-amber-700',
};

const FILTERS = [
  ['all', 'Everything'],
  ['document', 'Documents'],
  ['leave', 'Leave'],
  ['regularization', 'Corrections'],
  ['onduty', 'On duty'],
  ['change', 'Record changes'],
];

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric' }) : '');
const fmtTime = (d) => {
  if (!d) return '';
  const t = new Date(d);
  /* A date-only value (a joining date, an exit date) has no meaningful time,
     and printing 00:00 beside it invents a precision that is not there. */
  return t.getHours() === 0 && t.getMinutes() === 0
    ? '' : t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

export default function EmployeeActivity({ employeeId }) {
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setRows(null);
    api.get(`/employee-activity/${employeeId}?limit=200`)
      .then(r => { setRows(r.data.data || []); setNote(r.data.note || ''); })
      .catch(err => {
        if (err.response?.status === 403) setRows([]);
        else { toast.error(err.response?.data?.message || 'Could not load the activity'); setRows([]); }
      });
  }, [employeeId]);

  const shown = (rows || []).filter(r => filter === 'all' || r.kind === filter);

  /* Grouped by day, because a timeline read as a flat list of timestamps is
     harder to scan than one broken at the dates. */
  const byDay = shown.reduce((acc, r) => {
    const day = String(r.at).slice(0, 10);
    (acc[day] = acc[day] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-100 flex-wrap">
        <h3 className="text-[16px] font-semibold text-slate-800">Activity</h3>
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(([k, label]) => {
            const n = k === 'all' ? (rows || []).length : (rows || []).filter(r => r.kind === k).length;
            if (k !== 'all' && n === 0) return null;
            return (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-lg text-[12.5px] border transition-colors ${
                  filter === k ? 'bg-brand-50 border-brand-300 text-brand-700'
                               : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                {label} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-[14px] text-slate-400">Nothing recorded yet.</p>
      ) : (
        <div className="space-y-5">
          {Object.entries(byDay).map(([day, items]) => (
            <div key={day}>
              <p className="text-[12.5px] font-medium text-slate-400 mb-2">{fmtDay(day)}</p>
              <div className="space-y-0">
                {items.map((e, i) => {
                  const Icon = ICONS[e.icon] || Circle;
                  const last = i === items.length - 1;
                  return (
                    <div key={`${day}-${i}`} className="flex gap-3">
                      {/* The rail: a line between the markers, stopped at the
                          last one so it does not dangle into the next day. */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <span className={`w-7 h-7 rounded-full border flex items-center justify-center ${
                          TONE[e.kind] || TONE.change}`}>
                          <Icon size={13} />
                        </span>
                        {!last && <span className="w-px flex-1 bg-slate-100 my-1" />}
                      </div>

                      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-4'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[14px] text-slate-800">
                            {e.title}
                            {e.status && (
                              <span className={`ml-2 text-[11.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                                STATUS_CLS[e.status] || 'bg-slate-100 text-slate-500'}`}>
                                {e.status}
                              </span>
                            )}
                          </p>
                          <span className="text-[12px] text-slate-400 flex-shrink-0">{fmtTime(e.at)}</span>
                        </div>
                        {e.detail && <p className="text-[13px] text-slate-500 mt-0.5">{e.detail}</p>}
                        {e.actor && <p className="text-[12.5px] text-slate-400 mt-0.5">by {e.actor}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {note && rows !== null && (
        <p className="text-[12.5px] text-slate-400 mt-5 pt-3 border-t border-slate-100">{note}</p>
      )}
    </div>
  );
}
