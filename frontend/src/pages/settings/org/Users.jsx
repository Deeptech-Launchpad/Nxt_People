import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Filter, X, ArrowUpDown, UserMinus } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner, selectClass } from '../configKit';
import { roleLabel } from '../../../utils/roles';
import useFitToViewport from '../../../hooks/useFitToViewport';

// Manage Accounts → Users.
//
// Two groups over the same people, split by whether a login account exists:
// Users can sign in, Employee Profiles are recorded only. In the reference that
// boundary is a licence; here it is simply whether an account exists.
//
// Employee status and Account status are separate columns on purpose. They
// usually agree, but they answer different questions — and the sign-in gap that
// went unnoticed for so long existed precisely because the product only had
// one of them.
//
// Employee status reads Active / Inactive rather than the reference's
// Active / Resigned / Terminated: exit_requests only models resignation, and
// fewer than half the inactive employees have an exit date, so the distinction
// cannot be recovered without inventing it.

const GROUPS = [
  {
    key: 'users', label: 'Users',
    filters: [
      { key: 'all', label: 'All', count: c => c.users },
      { key: 'enabled', label: 'Login Enabled', count: c => c.enabled },
      { key: 'disabled', label: 'Login Disabled', count: c => c.disabled },
    ],
  },
  {
    key: 'profiles', label: 'Employee Profiles',
    filters: [
      { key: 'all', label: 'All', count: c => c.profiles },
      { key: 'active', label: 'Active', count: c => c.profilesActive },
      { key: 'inactive', label: 'Inactive', count: c => c.profilesInactive },
    ],
  },
];

const Toggle = ({ on, onClick, disabled, label }) => (
  <button
    onClick={onClick} disabled={disabled} role="switch" aria-checked={on} aria-label={label}
    className={`w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
  >
    <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${on ? 'left-[20px]' : 'left-0.5'}`} />
  </button>
);

export default function Users() {
  const [group, setGroup] = useState('users');
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [criteria, setCriteria] = useState({ search: '', role: '', locationId: '', employeeStatus: '' });
  const [applied, setApplied] = useState({ search: '', role: '', locationId: '', employeeStatus: '' });
  const [locations, setLocations] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'employeeCode', dir: 'desc' });
  const scrollRef = useRef(null);

  // The table scrolls inside itself rather than growing the page, so the
  // horizontal scrollbar stays reachable at the foot of the window instead of
  // sitting below the fold on a long list.
  const scrollHeight = useFitToViewport(scrollRef, null, [rows, showFilters, group, filter]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ group, filter });
    Object.entries(applied).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [group, filter, applied]);

  const load = useCallback(() => {
    api.get(`/org-users?${query}`)
      .then(r => { setRows(r.data.data || []); setCounts(r.data.counts || {}); })
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load users'); setRows([]); });
  }, [query]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get('/org-setup/locations').then(r => setLocations(r.data.data || [])).catch(() => {});
  }, []);

  const setLogin = (row, next) => {
    setBusyId(row.id);
    api.patch(`/org-users/${row.id}/login`, { loginEnabled: next })
      .then(() => { toast.success(`Sign-in ${next ? 'enabled' : 'disabled'} for ${row.name}`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not change access'))
      .finally(() => setBusyId(null));
  };

  // Sorted here rather than by the route: the list is one page of a few hundred
  // rows, and a round-trip per column click would be slower than the compare.
  const sorted = useMemo(() => {
    if (!rows) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;   // blanks last, whichever way it is sorted
      if (y == null) return -1;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort]);

  const toggleSort = key =>
    setSort(s2 => ({ key, dir: s2.key === key && s2.dir === 'asc' ? 'desc' : 'asc' }));

  const allOnPage = (sorted || []).map(u => u.id);
  const allSelected = allOnPage.length > 0 && allOnPage.every(id => selected.has(id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allOnPage));
  const toggleOne = id =>
    setSelected(s2 => { const n = new Set(s2); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const removeAccount = row => {
    if (!window.confirm(`Remove ${row.name}'s login account? They stay on record as an employee profile.`)) return;
    setBusyId(row.id);
    api.patch(`/org-users/${row.id}/account`, { isUser: false })
      .then(() => { toast.success(`${row.name} moved to employee profiles`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not change the account'))
      .finally(() => setBusyId(null));
  };

  const activeGroup = GROUPS.find(g => g.key === group);
  const hasCriteria = Object.values(applied).some(Boolean);

  return (
    <div className="flex items-start gap-5 pb-4">
      <nav className="w-[210px] flex-shrink-0 hidden lg:block">
        {GROUPS.map(g => (
          <div key={g.key} className="mb-3">
            <p className="px-4 py-1.5 text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{g.label}</p>
            {g.filters.map(f => {
              const on = group === g.key && filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => { setGroup(g.key); setFilter(f.key); setSelected(new Set()); }}
                  className={`w-full flex items-center justify-between px-4 py-2 text-[14px] rounded-lg transition-colors ${
                    on ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="text-[12.5px] text-slate-500">{f.count(counts) ?? ''}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1 min-w-0">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 flex-wrap">
            <div className="lg:hidden flex gap-1 overflow-x-auto">
              {GROUPS.flatMap(g => g.filters.map(f => (
                <button key={`${g.key}.${f.key}`}
                  onClick={() => { setGroup(g.key); setFilter(f.key); setSelected(new Set()); }}
                  className={`px-3 py-1.5 text-[13px] rounded-lg whitespace-nowrap ${
                    group === g.key && filter === f.key ? 'bg-slate-100 font-semibold text-slate-800' : 'text-slate-600'
                  }`}>
                  {g.key === 'profiles' ? `Profiles · ${f.label}` : f.label}
                </button>
              )))}
            </div>
            <p className="text-[14px] text-slate-600">
              Total count: <span className="font-semibold text-slate-800">{rows?.length ?? '—'}</span>
              {selected.size > 0 && (
                <span className="ml-3 text-[13.5px] text-blue-700">{selected.size} selected</span>
              )}
            </p>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[13.5px] ${
                hasCriteria ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter size={14} /> Filter{hasCriteria ? ' (on)' : ''}
            </button>
          </div>

          {rows === null ? <Spinner /> : rows.length === 0 ? (
            <div className="px-6 py-12 text-center border-t border-slate-100">
              <p className="text-[14px] text-slate-600">No one in this filter currently.</p>
              {group === 'profiles' && (
                <p className="text-[13px] text-slate-500 mt-1.5 max-w-[460px] mx-auto">
                  An employee profile is someone on record without a login. Remove a user&rsquo;s
                  account to move them here.
                </p>
              )}
            </div>
          ) : (
            // Both scrollbars belong to this one element: the body scrolls
            // vertically inside the window and horizontally under a header and
            // first column that stay put.
            <div
              ref={scrollRef}
              style={scrollHeight ? { height: scrollHeight } : undefined}
              className="overflow-auto border-t border-slate-100"
            >
              <table className="text-[14px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-3 py-2.5 w-[44px]">
                      <input
                        type="checkbox" checked={allSelected} onChange={toggleAll}
                        aria-label="Select everyone in this filter"
                        className="w-4 h-4 accent-blue-600 align-middle"
                      />
                    </th>
                    <th className="sticky top-0 left-[44px] z-30 bg-slate-50 border-b border-r border-slate-200 px-5 py-2.5 text-left font-medium text-slate-600 w-[290px]">
                      <button onClick={() => toggleSort('name')} className="flex items-center gap-1.5 hover:text-slate-800">
                        Basic information <ArrowUpDown size={13} className={sort.key === 'name' ? 'text-blue-600' : 'text-slate-400'} />
                      </button>
                    </th>
                    <th className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 px-5 py-2.5 text-left font-medium text-slate-600 whitespace-nowrap">
                      <button onClick={() => toggleSort('joiningDate')} className="flex items-center gap-1.5 hover:text-slate-800">
                        Date of joining <ArrowUpDown size={13} className={sort.key === 'joiningDate' ? 'text-blue-600' : 'text-slate-400'} />
                      </button>
                    </th>
                    {['Roles', 'Location', 'Employee status',
                      ...(group === 'users' ? ['Account status', 'Actions'] : ['Actions'])].map(h => (
                      <th key={h} className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 px-5 py-2.5 text-left font-medium text-slate-600 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    {/* Keeps the last real column off the right edge, the way
                        the reference leaves a gutter after Actions. */}
                    <th className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(u => {
                    const picked = selected.has(u.id);
                    const cell = 'border-b border-slate-100 px-5 py-3';
                    return (
                      <tr key={u.id} className={picked ? 'bg-blue-50/50' : 'hover:bg-slate-50/60'}>
                        <td className={`sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-3 w-[44px] ${picked ? 'bg-blue-50' : 'bg-white'}`}>
                          <input
                            type="checkbox" checked={picked} onChange={() => toggleOne(u.id)}
                            aria-label={`Select ${u.name}`}
                            className="w-4 h-4 accent-blue-600 align-middle"
                          />
                        </td>
                        <td className={`sticky left-[44px] z-10 border-b border-r border-slate-200 px-5 py-3 w-[290px] ${picked ? 'bg-blue-50' : 'bg-white'}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {u.photoUrl
                              ? <img src={u.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                              : <div className="w-8 h-8 rounded-full bg-slate-200 flex-shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-slate-800 truncate">
                                {u.employeeCode ? `${u.employeeCode} - ` : ''}<span className="font-medium">{u.name}</span>
                              </p>
                              <p className="text-[13px] text-slate-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className={`${cell} text-slate-600 whitespace-nowrap`}>
                          {u.joiningDate ? new Date(u.joiningDate).toLocaleDateString('en-GB') : '—'}
                        </td>
                        <td className={`${cell} text-slate-600 whitespace-nowrap`}>{roleLabel(u.role)}</td>
                        <td className={`${cell} text-slate-600`}>{u.location || <span className="text-slate-400">—</span>}</td>
                        <td className={`${cell} whitespace-nowrap`}>
                          <span className={u.employeeStatus === 'active' ? 'text-slate-700' : 'text-amber-700'}>
                            {u.employeeStatus === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {group === 'users' && (
                          <td className={`${cell} whitespace-nowrap`}>
                            <span className={u.loginEnabled ? 'text-slate-700' : 'text-red-600'}>
                              {u.loginEnabled ? 'Login Enabled' : 'Login Disabled'}
                            </span>
                          </td>
                        )}
                        <td className={cell}>
                          <div className="flex items-center gap-2">
                            {group === 'users' && (
                              <>
                                <Toggle
                                  on={u.loginEnabled}
                                  disabled={busyId === u.id}
                                  onClick={() => setLogin(u, !u.loginEnabled)}
                                  label={`Sign-in for ${u.name}`}
                                />
                                <button
                                  onClick={() => removeAccount(u)}
                                  disabled={busyId === u.id}
                                  title="Remove the login account and keep them on record"
                                  aria-label={`Remove ${u.name}'s account`}
                                  className="text-slate-400 hover:text-red-500 disabled:opacity-40 p-1"
                                >
                                  <UserMinus size={15} />
                                </button>
                              </>
                            )}
                            {group === 'profiles' && (
                              <button
                                onClick={() => {
                                  setBusyId(u.id);
                                  api.patch(`/org-users/${u.id}/account`, { isUser: true })
                                    .then(() => { toast.success(`${u.name} now has a login account`); load(); })
                                    .catch(err => toast.error(err.response?.data?.message || 'Could not change the account'))
                                    .finally(() => setBusyId(null));
                                }}
                                disabled={busyId === u.id}
                                className="text-[13px] text-blue-600 hover:text-blue-500 disabled:opacity-40"
                              >
                                Give a login
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="border-b border-slate-100 w-10" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-y-0 right-0 z-[70] w-full max-w-[340px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <p className="text-[16px] font-semibold text-slate-800">Filter</p>
            <button onClick={() => setShowFilters(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          <div className="px-5 py-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Search</label>
              <input
                value={criteria.search}
                onChange={e => setCriteria(c => ({ ...c, search: e.target.value }))}
                placeholder="Name, email or employee id"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Role</label>
              <select value={criteria.role} onChange={e => setCriteria(c => ({ ...c, role: e.target.value }))} className={`${selectClass} w-full`}>
                <option value="">All roles</option>
                {['admin', 'director', 'hr_admin', 'manager', 'team_incharge', 'team_member'].map(r => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Location</label>
              <select value={criteria.locationId} onChange={e => setCriteria(c => ({ ...c, locationId: e.target.value }))} className={`${selectClass} w-full`}>
                <option value="">All locations</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Employee status</label>
              <select value={criteria.employeeStatus} onChange={e => setCriteria(c => ({ ...c, employeeStatus: e.target.value }))} className={`${selectClass} w-full`}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-slate-200 flex items-center gap-3">
            <button
              onClick={() => { setApplied(criteria); setShowFilters(false); }}
              className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium"
            >
              Apply
            </button>
            <button
              onClick={() => {
                const blank = { search: '', role: '', locationId: '', employeeStatus: '' };
                setCriteria(blank); setApplied(blank);
              }}
              className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
