/**
 * AttendanceLocation.jsx — Attendance → Location
 *
 * Location history for check-ins / check-outs. Data is captured by the browser
 * at the moment of each action (see AttendanceContext + geoPermission) and read
 * back here from GET /attendance/location.
 *
 * Scope (enforced server-side):
 *   • Employees / Team Leads — only their own records.
 *   • HR / Super Admin       — all employees, with an employee filter.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin, LogIn, LogOut, ExternalLink, Filter, ChevronLeft, ChevronRight, RefreshCw, Navigation,
} from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import { reverseGeocode, coordKey } from '../../utils/reverseGeocode';

const TYPE_OPTIONS = [
  { key: '',         label: 'Check-in & Check-out' },
  { key: 'checkin',  label: 'Check-in only' },
  { key: 'checkout', label: 'Check-out only' },
];

const PERMISSION_PILL = {
  always:      { label: 'Allow Always',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  once:        { label: 'Allow This Time', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  denied:      { label: 'Denied',          cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  unavailable: { label: 'Unavailable',     cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const coordStr = (v) => (v === null || v === undefined) ? null : Number(v).toFixed(5);

function TypeBadge({ type }) {
  const isIn = type === 'checkin';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${isIn ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}>
      {isIn ? <LogIn size={13} /> : <LogOut size={13} />}{isIn ? 'Check-in' : 'Check-out'}
    </span>
  );
}

export default function AttendanceLocation() {
  const { user } = useAuth();
  const full = isFullAccess(user);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(30);
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [directory, setDirectory] = useState([]);
  // Resolved place names keyed by rounded coordinate — display only, derived
  // from the captured coordinates (see reverseGeocode). Generic stored labels
  // like "Office" are never shown.
  const [places, setPlaces] = useState({});

  // Employee filter (HR / Super Admin only).
  useEffect(() => {
    if (!full) return;
    api.get('/org/directory').then(r => setDirectory(r.data.data || [])).catch(() => {});
  }, [full]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (full && employeeId) params.set('employeeId', employeeId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('page', page);
    params.set('limit', limit);
    api.get(`/attendance/location?${params.toString()}`)
      .then(r => { setRows(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [type, employeeId, startDate, endDate, page, limit, full]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [type, employeeId, startDate, endDate]);

  // Resolve the actual place name for every row that has coordinates. Cached in
  // reverseGeocode, so revisited spots resolve instantly without re-requesting.
  useEffect(() => {
    let cancelled = false;
    const pending = rows.filter(l => {
      const k = coordKey(l.latitude, l.longitude);
      return k && places[k] === undefined;
    });
    if (pending.length === 0) return;
    (async () => {
      for (const l of pending) {
        const k = coordKey(l.latitude, l.longitude);
        const name = await reverseGeocode(l.latitude, l.longitude);
        if (cancelled) return;
        setPlaces(p => ({ ...p, [k]: name ?? null }));
      }
    })();
    return () => { cancelled = true; };
    // `places` intentionally omitted — the coordinate-key guard prevents refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const colSpan = full ? 7 : 6;

  return (
    <div className="p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <MapPin size={20} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-800">Location History</h2>
              <p className="text-[12px] text-slate-400">
                {full ? 'Check-in / check-out locations across employees' : 'Your check-in / check-out locations'} · {total} record{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button onClick={load} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/50">
          <span className="flex items-center gap-1 text-[12px] text-slate-400 font-medium"><Filter size={13} /> Filters</span>
          <select value={type} onChange={e => setType(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-700 bg-white focus:outline-none focus:border-blue-400">
            {TYPE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {full && (
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400 max-w-[220px]">
              <option value="">All Employees</option>
              {directory.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}{e.employeeId ? ` (${e.employeeId})` : ''}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="From" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400" />
            <span className="text-slate-300 text-xs">–</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="To" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400" />
          </div>
          {(type || employeeId || startDate || endDate) && (
            <button onClick={() => { setType(''); setEmployeeId(''); setStartDate(''); setEndDate(''); }}
              className="text-[12px] text-blue-600 hover:text-blue-700 font-medium ml-1">Clear</button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Time</th>
                {full && <th className="px-5 py-3">Employee</th>}
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Coordinates</th>
                <th className="px-5 py-3">Permission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={colSpan} className="px-5 py-16 text-center"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={colSpan} className="px-5 py-16 text-center text-slate-400 text-[13px]">
                  <MapPin size={32} className="text-slate-200 mx-auto mb-2" />
                  No location records yet. Locations are captured on check-in and check-out.
                </td></tr>
              ) : rows.map(l => {
                const lat = coordStr(l.latitude), lng = coordStr(l.longitude);
                const perm = PERMISSION_PILL[l.permissionStatus] || PERMISSION_PILL.unavailable;
                const ck = coordKey(l.latitude, l.longitude);
                const place = ck ? places[ck] : undefined;   // undefined=resolving, null=unresolved
                return (
                  <tr key={l._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 text-[13px] text-slate-600">{fmtDate(l.capturedAt)}</td>
                    <td className="px-5 py-3.5 text-[13px] text-slate-600">{fmtTime(l.capturedAt)}</td>
                    {full && (
                      <td className="px-5 py-3.5">
                        <p className="text-[13px] font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{l.employee?.employeeId}</p>
                      </td>
                    )}
                    <td className="px-5 py-3.5"><TypeBadge type={l.type} /></td>
                    <td className="px-5 py-3.5 text-[13px]">
                      {!ck ? (
                        <span className="text-slate-400">—</span>
                      ) : place === undefined ? (
                        <span className="text-slate-400 italic">Locating…</span>
                      ) : place ? (
                        <span className="text-slate-700">{place}</span>
                      ) : (
                        <span className="text-slate-400">Location unavailable</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {lat && lng ? (
                        <a
                          href={`https://www.google.com/maps?q=${lat},${lng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[12.5px] text-blue-600 hover:text-blue-700 font-medium"
                          title="View on Google Maps"
                        >
                          <Navigation size={12} /> {lat}, {lng}
                          <ExternalLink size={11} className="opacity-60" />
                        </a>
                      ) : (
                        <span className="text-[12.5px] text-slate-400">No coordinates</span>
                      )}
                      {l.accuracy != null && lat && lng && (
                        <span className="block text-[11px] text-slate-400 mt-0.5">±{Math.round(l.accuracy)} m</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${perm.cls}`}>{perm.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[12px] text-slate-500">
            {total === 0 ? '0' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}`} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={15} /></button>
            <span className="text-[12px] text-slate-500">Page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
