import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Trash2, Inbox } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import UserPicker, { Avatar } from './UserPicker';

// Administrator — per user, per service, a level for Settings and one for
// Data. They are separate questions in the reference and they are separate
// here: configuring attendance is not the same as seeing everyone's records
// in it.
//
// The matrix scrolls sideways, which is what makes it readable at ten
// services; the user column is frozen so the row you are setting stays named.
//
// Other Functions and Forms are the reference's other two tabs. They are empty
// in the reference org and there is nothing behind them here, so they say so
// rather than showing a matrix of controls that save nowhere.

const TABS = [
  { key: 'services', label: 'Services & Settings' },
  { key: 'other', label: 'Other Functions' },
  { key: 'forms', label: 'Forms' },
];

const LEVELS = [
  { value: 'full', label: 'Full Access' },
  { value: 'partial', label: 'Partial Access' },
  { value: 'none', label: 'No Access' },
];

// One control with three states rather than three radios per cell: the matrix
// is already twenty columns wide.
function LevelDot({ value, onChange, label }) {
  const next = { full: 'partial', partial: 'none', none: 'full' }[value || 'none'];
  const cls = value === 'full' ? 'bg-blue-600 border-blue-600'
    : value === 'partial' ? 'bg-white border-blue-600' : 'bg-white border-slate-300';
  return (
    <button
      onClick={() => onChange(next)}
      title={`${label}: ${LEVELS.find(l => l.value === (value || 'none')).label}`}
      aria-label={`${label}: ${LEVELS.find(l => l.value === (value || 'none')).label}`}
      className={`w-4 h-4 rounded-full border-2 grid place-items-center ${cls}`}
    >
      {value === 'partial' && <span className="block w-1.5 h-3 bg-blue-600 rounded-l-full -ml-[3px]" />}
    </button>
  );
}

export default function Administrators() {
  const [tab, setTab] = useState('services');
  const [rows, setRows] = useState(null);
  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => (
    api.get('/access/administrators')
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); })
  ), []);

  useEffect(() => {
    load();
    api.get('/access/catalog').then(r => setServices(r.data.data.services || [])).catch(() => {});
    api.get('/access/assignable-users').then(r => setUsers(r.data.data || [])).catch(() => {});
  }, [load]);

  const setLevel = (employeeId, serviceKey, area, level) => {
    // Optimistic, because a twenty-column matrix that waits for a round trip
    // on every click feels broken.
    setRows(rs => rs.map(r => r.employeeId !== employeeId ? r : {
      ...r, access: { ...r.access, [serviceKey]: { ...(r.access[serviceKey] || {}), [area]: level } },
    }));
    const current = rows.find(r => r.employeeId === employeeId)?.access[serviceKey] || {};
    api.patch(`/access/administrators/${employeeId}`, {
      serviceKey,
      settingsLevel: area === 'settings' ? level : (current.settings || 'none'),
      dataLevel: area === 'data' ? level : (current.data || 'none'),
    }).catch(err => { toast.error(err.response?.data?.message || 'Could not save'); load(); });
  };

  const add = () => {
    setBusy(true);
    api.post('/access/administrators', { employeeId: pick })
      .then(r => { toast.success(r.data.message || 'Added'); setAdding(false); setPick(''); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not add'))
      .finally(() => setBusy(false));
  };

  const remove = row => {
    if (!window.confirm(`Remove ${row.name} as an administrator?`)) return;
    api.delete(`/access/administrators/${row.employeeId}`)
      .then(() => { toast.success('Administrator removed'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not remove'));
  };

  if (rows === null) return <Spinner />;

  const empty = (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-16 text-center">
      <Inbox size={40} className="mx-auto text-slate-300 mb-3" />
      <p className="text-[15px] text-slate-700">No administrators added</p>
      <p className="text-[13.5px] text-slate-500 mt-1.5 max-w-md mx-auto">
        Add a user as an administrator to grant access to settings, data and operations
        for specific services and locations
      </p>
    </div>
  );

  return (
    <div className="pb-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[13.5px] font-medium ${
                tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'bg-slate-50 text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13.5px] text-slate-600 border border-slate-200 rounded px-3 py-1.5">
            Admin Users: <span className="text-amber-600 font-medium">{rows.length}</span>
          </span>
          <button
            onClick={() => setAdding(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium"
          >
            Add user
          </button>
        </div>
      </div>

      {tab !== 'services' ? empty : rows.length === 0 ? empty : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-[14px]" style={{ minWidth: 'max-content' }}>
              <thead className="bg-slate-50">
                <tr>
                  {/* Frozen, so a row stays named while the services scroll. */}
                  <th rowSpan={2}
                    className="sticky left-0 z-10 bg-slate-50 text-left font-medium text-slate-600 px-6 py-2.5 border-r border-slate-200 min-w-[240px]">
                    Users
                  </th>
                  {services.map(s => (
                    <th key={s.key} colSpan={2}
                      className="text-center font-medium text-slate-600 px-4 py-2 border-l border-slate-200 whitespace-nowrap">
                      {s.label}
                    </th>
                  ))}
                  <th rowSpan={2} className="w-16 bg-slate-50" />
                </tr>
                <tr>
                  {services.flatMap(s => ([
                    <th key={`${s.key}-s`} className="text-center font-normal text-slate-500 text-[13px] px-4 py-1.5 border-l border-slate-200">Settings</th>,
                    <th key={`${s.key}-d`} className="text-center font-normal text-slate-500 text-[13px] px-4 py-1.5">Data</th>,
                  ]))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.employeeId} className="group border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-6 py-3 border-r border-slate-200">
                      <div className="flex items-center gap-2.5">
                        <Avatar user={row} size={30} />
                        <span className="text-slate-700 whitespace-nowrap">
                          {row.employeeCode ? `${row.employeeCode} - ` : ''}{row.name}
                        </span>
                      </div>
                    </td>
                    {services.flatMap(s => ([
                      <td key={`${s.key}-s`} className="text-center px-4 py-3 border-l border-slate-100">
                        <div className="flex justify-center">
                          <LevelDot
                            value={row.access[s.key]?.settings}
                            label={`${s.label} settings`}
                            onChange={v => setLevel(row.employeeId, s.key, 'settings', v)}
                          />
                        </div>
                      </td>,
                      <td key={`${s.key}-d`} className="text-center px-4 py-3">
                        <div className="flex justify-center">
                          <LevelDot
                            value={row.access[s.key]?.data}
                            label={`${s.label} data`}
                            onChange={v => setLevel(row.employeeId, s.key, 'data', v)}
                          />
                        </div>
                      </td>,
                    ]))}
                    <td className="px-4 py-3">
                      <button onClick={() => remove(row)} aria-label={`Remove ${row.name}`}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-6 px-6 py-3 border-t border-slate-200 bg-slate-50/60 flex-wrap">
            <span className="text-[13.5px] text-slate-600">Permission Access</span>
            {LEVELS.map(l => (
              <span key={l.value} className="flex items-center gap-2 text-[13.5px] text-slate-600">
                <span className={`w-4 h-4 rounded-full border-2 grid place-items-center ${
                  l.value === 'full' ? 'bg-blue-600 border-blue-600'
                  : l.value === 'partial' ? 'bg-white border-blue-600' : 'bg-white border-slate-300'
                }`}>
                  {l.value === 'partial' && <span className="block w-1.5 h-3 bg-blue-600 rounded-l-full -ml-[3px]" />}
                </span>
                {l.label}
              </span>
            ))}
            <span className="text-[12.5px] text-slate-500 ml-auto">Click a dot to cycle through the three levels.</span>
          </div>
        </div>
      )}

      {/* The levels are recorded, not yet enforced: every route still checks
          the role's permissions. Saying so beats a matrix that looks like it
          is gating something. */}
      {tab === 'services' && rows.length > 0 && (
        <p className="text-[12.5px] text-amber-700 mt-3">
          Saved, but not enforced yet — route access still comes from the user's role under General Role.
        </p>
      )}

      {adding && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Select User</p>
              <button onClick={() => setAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Users</label>
              <UserPicker
                users={users} value={pick} onChange={setPick}
                exclude={rows.map(r => r.employeeId)}
              />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={add} disabled={busy || !pick}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
                {busy ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => setAdding(false)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
