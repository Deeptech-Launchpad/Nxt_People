import React, { useState, useEffect, useMemo } from 'react';
import { Search, Download, Filter, RefreshCw } from 'lucide-react';
import api from '../utils/api';

/**
 * Daily Attendance — today-focused live snapshot for admin / manager.
 * Reuses GET /api/attendance/team which is role-gated server-side and
 * returns (a) the list of employees and (b) their attendance records for
 * the requested date.
 */
export default function DailyAttendance() {
  const todayCA = new Date().toLocaleDateString('en-CA');

  const [date, setDate]             = useState(todayCA);
  const [department, setDepartment] = useState('');
  const [search, setSearch]         = useState('');
  // Two top-level tabs split the dataset into "people who arrived today"
  // (presence in or out) vs "people who haven't checked in yet".
  const [tab, setTab]               = useState('checkedIn'); // checkedIn | notCheckedIn
  // Optional sub-filter set by clicking a summary tile. 'all' = no narrowing.
  const [subFilter, setSubFilter]   = useState('all'); // all | in | out | yetToCheckIn
  const [employees, setEmployees]   = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading]       = useState(false);

  /* ── load ─────────────────────────────────────────────────────────── */
  const load = () => {
    setLoading(true);
    api.get(`/attendance/team?date=${date}`)
      .then(r => {
        setEmployees(r.data.employees || []);
        setAttendance(r.data.data || []);
      })
      .catch(() => { setEmployees([]); setAttendance([]); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [date]);

  /* ── join + compute ───────────────────────────────────────────────── */
  const rows = useMemo(() => {
    const attMap = {};
    attendance.forEach(a => { if (a.employee?._id) attMap[a.employee._id] = a; });

    return employees.map(e => {
      const att = attMap[e._id] || null;
      let presence = 'yetToCheckIn';
      if (att?.checkIn && !att.checkOut) presence = 'in';
      else if (att?.checkOut)            presence = 'out';
      return { ...e, att, presence };
    });
  }, [employees, attendance]);

  /* ── department list (derived from data) ──────────────────────────── */
  const departments = useMemo(() => {
    const set = new Set(employees.map(e => e.department).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [employees]);

  /* ── apply search + tab + sub-filter + dept ───────────────────────── */
  const filtered = rows.filter(r => {
    if (department && department !== 'All' && r.department !== department) return false;
    // Tab split: "Checked In" = arrived today (in or out); "Not Checked In" = yetToCheckIn.
    const isCheckedInToday = r.presence === 'in' || r.presence === 'out';
    if (tab === 'checkedIn'    && !isCheckedInToday) return false;
    if (tab === 'notCheckedIn' &&  isCheckedInToday) return false;
    // Sub-filter from the summary tiles narrows further within the tab.
    if (subFilter !== 'all' && r.presence !== subFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${r.firstName || ''} ${r.lastName || ''}`.toLowerCase();
      if (!name.includes(q) && !(r.employeeId || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /* ── counts ───────────────────────────────────────────────────────── */
  const counts = useMemo(() => ({
    total:        rows.length,
    in:           rows.filter(r => r.presence === 'in').length,
    out:          rows.filter(r => r.presence === 'out').length,
    yetToCheckIn: rows.filter(r => r.presence === 'yetToCheckIn').length,
  }), [rows]);

  /* ── helpers ──────────────────────────────────────────────────────── */
  const fmtTime = (iso) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

  const exportCSV = () => {
    if (!filtered.length) return;
    const csv = 'Employee ID,Name,Department,Designation,Check In,Check Out,Hours,Status,Presence\n' +
      filtered.map(r =>
        `"${r.employeeId || ''}","${r.firstName} ${r.lastName}","${r.department || ''}","${r.designation || ''}","${r.att?.checkIn ? new Date(r.att.checkIn).toLocaleTimeString() : ''}","${r.att?.checkOut ? new Date(r.att.checkOut).toLocaleTimeString() : ''}","${r.att?.workingHours || 0}","${r.att?.status || ''}","${r.presence}"`
      ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `daily-attendance-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const PRESENCE_PILL = {
    in:           { label: 'In',              cls: 'bg-emerald-50 text-emerald-700' },
    out:          { label: 'Out',             cls: 'bg-slate-100 text-slate-600'    },
    yetToCheckIn: { label: 'Yet to check-in', cls: 'bg-amber-50 text-amber-700'     },
  };

  return (
    <div className="space-y-5">
      {/* ── Filters card ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              max={todayCA}
              onChange={(e) => {
                const v = e.target.value > todayCA ? todayCA : e.target.value;
                setDate(v);
              }}
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value === 'All' ? '' : e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 min-w-[160px]"
            >
              {departments.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or employee ID..."
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-60"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors border border-emerald-200"
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── Summary tiles — clickable, drive the tab + sub-filter ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',           count: counts.total,        tone: 'text-slate-700',   ring: 'ring-slate-300',   tab: 'checkedIn',    sub: 'all'          },
          { label: 'Checked In',      count: counts.in,           tone: 'text-emerald-700', ring: 'ring-emerald-300', tab: 'checkedIn',    sub: 'in'           },
          { label: 'Checked Out',     count: counts.out,          tone: 'text-slate-700',   ring: 'ring-slate-400',   tab: 'checkedIn',    sub: 'out'          },
          { label: 'Yet to check-in', count: counts.yetToCheckIn, tone: 'text-amber-700',   ring: 'ring-amber-300',   tab: 'notCheckedIn', sub: 'yetToCheckIn' },
        ].map(t => {
          const isActive = tab === t.tab && subFilter === t.sub;
          return (
            <button
              key={t.label}
              onClick={() => { setTab(t.tab); setSubFilter(t.sub); }}
              className={`bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-left transition-all hover:shadow ${
                isActive ? `ring-2 ${t.ring}` : ''
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t.label}</p>
              <p className={`text-[24px] font-bold ${t.tone} mt-1`}>{t.count}</p>
            </button>
          );
        })}
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/40">
          <h3 className="text-[13px] font-bold text-slate-700 uppercase tracking-wider">
            Daily Attendance · {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
          </h3>
          <span className="text-[11.5px] text-slate-500">{filtered.length} {filtered.length === 1 ? 'team_member' : 'employees'}</span>
        </div>

        {/* ── Tabs: Checked In vs Not Checked In ─────────────────── */}
        <div className="flex border-b border-slate-100 bg-white">
          {[
            { key: 'checkedIn',    label: 'Checked In',     count: counts.in + counts.out },
            { key: 'notCheckedIn', label: 'Not Checked In', count: counts.yetToCheckIn    },
          ].map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSubFilter('all'); }}
                className={`flex items-center gap-2 px-6 py-3 text-[13px] font-semibold border-b-[2.5px] transition-colors -mb-px ${
                  active
                    ? 'border-[#1a73e8] text-[#1a73e8]'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span>{t.label}</span>
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-blue-100 text-[#1a73e8]' : 'bg-slate-100 text-slate-500'
                }`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  {['Employee', 'Department', 'Check In', 'Check Out', 'Hours', 'Status'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">
                      No employees match the current filters.
                    </td>
                  </tr>
                ) : filtered.map((r) => {
                  const att = r.att;
                  return (
                    <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                            {(r.firstName?.[0] || '') + (r.lastName?.[0] || '')}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-slate-700 truncate">{r.firstName} {r.lastName}</p>
                            <p className="text-[11px] text-slate-400">{r.employeeId}{r.designation ? ` · ${r.designation}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-600">{r.department || '—'}</td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-700 font-mono">{fmtTime(att?.checkIn)}</td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-700 font-mono">{fmtTime(att?.checkOut)}</td>
                      <td className="px-5 py-3.5 text-[13px] text-slate-700">
                        {att?.workingHours ? `${Number(att.workingHours).toFixed(1)}h` : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${PRESENCE_PILL[r.presence].cls}`}>
                          {PRESENCE_PILL[r.presence].label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
