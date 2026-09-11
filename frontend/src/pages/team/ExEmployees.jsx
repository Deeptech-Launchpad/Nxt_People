import React, { useEffect, useState } from 'react';
import { UserMinus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { Avatar, DirectScopeNote, Spinner, Empty, fmtDay } from './teamShared';

/* ── Ex-Employees ─────────────────────────────────────────────────────────
 *  Former reports, with the date they left and how long they were here.
 *
 *  "Former" is exit_date being set — the same test reports.js's
 *  Active/Ex-Employee chip uses. Deliberately NOT `status <> 'active'`, which
 *  also catches notice-period and resigned people who have not left yet and
 *  would appear here with an empty leaving date.
 *
 *  Experience is computed from joining date to leaving date rather than read
 *  from employees.total_experience: that column is free text carried in from
 *  the Zoho import and says nothing about tenure here.
 * ────────────────────────────────────────────────────────────────────────── */
export default function ExEmployees({ embedded = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/team/ex-employees')
      .then(r => { if (live) setRows(r.data.data || []); })
      .catch(err => {
        if (live) toast.error(err.response?.data?.message || 'Could not load former reportees');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(term) ||
        (p.employeeId || '').toLowerCase().includes(term))
    : rows;

  return (
    <div className={embedded ? 'p-5' : 'p-6'}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search former reportees…"
            className="w-full pl-9 pr-3 py-2 text-[14px] border border-slate-200 rounded-lg bg-white
                       focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
        </div>
        <div className="ml-auto text-right">
          <p className="text-[13px] font-semibold text-slate-600">{rows.length} record{rows.length === 1 ? '' : 's'}</p>
          <DirectScopeNote />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <Spinner /> : shown.length === 0 ? (
          <Empty icon={UserMinus}
            title={rows.length === 0 ? 'No former reportees on record' : 'No record matches that search'}
            sub={rows.length === 0
              ? 'Somebody appears here once their date of exit is set on their record.'
              : 'Clear the search to see every record.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Employee', 'Designation', 'Department', 'Joined', 'Relieved On', 'Experience'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-[12px] font-medium text-slate-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar person={p} size={32} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-slate-800 truncate">{p.firstName} {p.lastName}</p>
                          <p className="text-[12px] text-slate-400 font-mono">{p.employeeId || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{p.designation || '—'}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{p.department || '—'}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{fmtDay(p.joinedOn)}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{fmtDay(p.exitDate)}</td>
                    <td className="px-5 py-3 text-[14px] font-medium text-slate-700">{experienceLabel(p)}</td>
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

/* The reference prints whole years — "4 Year(s)". Months are added below a
 * year, because "0 Year(s)" beside a leaving date is not an answer. */
function experienceLabel(p) {
  const y = Number(p.experienceYears) || 0;
  const m = Number(p.experienceMonths) || 0;
  if (!p.exitDate || !p.joinedOn) return '—';
  if (y === 0) return `${m} Month(s)`;
  return m > 0 ? `${y} Year(s) ${m} Month(s)` : `${y} Year(s)`;
}
