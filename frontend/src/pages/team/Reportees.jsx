import React, { useEffect, useState } from 'react';
import { Users, Search, Phone, Mail, Clock, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { to12 } from '../moreservices/shift/shiftGrid';
import {
  Avatar, PresenceBadge, DirectScopeNote, Spinner, Empty, fmtTime,
} from './teamShared';

/* ── Reportees ────────────────────────────────────────────────────────────
 *  A card per direct report: who they are, where they stand today, and the
 *  shift they are measured against.
 *
 *  `showLeaveBooked` adds the year's booked total, which is what the Leave
 *  Tracker's Team → Reportees tab shows and the Attendance one does not. One
 *  component with a flag rather than two pages, because the identity half of
 *  the card is identical and would otherwise drift.
 * ────────────────────────────────────────────────────────────────────────── */
export default function Reportees({ showLeaveBooked = false, embedded = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/team/reportees')
      .then(r => { if (live) setRows(r.data.data || []); })
      .catch(err => {
        if (live) toast.error(err.response?.data?.message || 'Could not load your reportees');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(term) ||
        (p.employeeId || '').toLowerCase().includes(term) ||
        (p.designation || '').toLowerCase().includes(term))
    : rows;

  return (
    <div className={embedded ? 'p-5' : 'p-6'}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reportees…"
            className="w-full pl-9 pr-3 py-2 text-[14px] border border-slate-200 rounded-lg bg-white
                       focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
        </div>
        <div className="ml-auto text-right">
          <p className="text-[13px] font-semibold text-slate-600">{rows.length} reportee{rows.length === 1 ? '' : 's'}</p>
          <DirectScopeNote />
        </div>
      </div>

      {loading ? <Spinner /> : shown.length === 0 ? (
        <Empty icon={Users}
          title={rows.length === 0 ? 'Nobody reports to you yet' : 'No reportee matches that search'}
          sub={rows.length === 0
            ? 'A reporting manager or approving authority has to point at you before anyone appears here.'
            : 'Clear the search to see the whole team.'} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map(p => (
            <div key={p.id}
              className="bg-white rounded-lg border border-slate-200 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]
                         hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-all">
              <div className="flex items-start gap-3">
                <Avatar person={p} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-800 truncate">
                    {p.firstName} {p.lastName}
                  </p>
                  <p className="text-[12px] text-slate-400 font-mono">{p.employeeId || '—'}</p>
                  <p className="text-[13px] text-slate-500 truncate mt-0.5">{p.designation || 'No designation'}</p>
                </div>
                <PresenceBadge person={p} />
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                <Line icon={Clock} text={p.shift?.name
                  ? `${p.shift.name}${p.shift.startTime && p.shift.endTime ? ` · ${to12(p.shift.startTime)} – ${to12(p.shift.endTime)}` : ''}`
                  : 'No shift assigned'} muted={!p.shift?.name} />

                {/* Times only where there are times. A dash beside "In" reads
                    as a failed lookup rather than as somebody who is not in. */}
                {p.checkIn && (
                  <Line icon={Clock}
                    text={`In ${fmtTime(p.checkIn)}${p.checkOut ? ` · Out ${fmtTime(p.checkOut)}` : ''}`} />
                )}

                {showLeaveBooked && (
                  <Line icon={CalendarDays}
                    text={`${Number(p.leaveBookedThisYear) || 0} day${Number(p.leaveBookedThisYear) === 1 ? '' : 's'} booked this year`} />
                )}

                <div className="flex items-center gap-3 pt-1">
                  {p.phone && (
                    <a href={`tel:${p.phone}`} title={p.phone}
                      className="text-slate-400 hover:text-blue-600"><Phone size={14} /></a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} title={p.email}
                      className="text-slate-400 hover:text-blue-600"><Mail size={14} /></a>
                  )}
                  {p.workLocation && <span className="text-[12px] text-slate-400 truncate">{p.workLocation}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Line = ({ icon: Icon, text, muted = false }) => (
  <p className={`flex items-center gap-1.5 text-[13px] ${muted ? 'text-slate-400' : 'text-slate-600'}`}>
    <Icon size={13} className="text-slate-400 flex-shrink-0" />
    <span className="truncate">{text}</span>
  </p>
);
