import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Search } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import UserPicker, { Avatar } from './UserPicker';

// General Role and Specific Role are the same screen with a different `kind`,
// so they share this one rather than diverging.
//
// The reference's hover actions are not uniform: a built-in role offers only
// "assign a user", while a role somebody created also offers rename and
// delete. That is the honest split for us too — our six roles are what every
// route guard was derived from and what every employee record carries, so
// deleting one would strand its holders and rename must never touch the key.

const AVATARS_SHOWN = 10;

function AddRoleDialog({ kind, roles, onClose, onCreated }) {
  const [name, setName] = useState('');
  // The reference defaults Clone role to Team member. Cloning copies the
  // permissions and the sixteen switches; a role cloned from nothing would
  // grant nothing, which is the trap this defaults away from.
  const [cloneFromId, setCloneFromId] = useState(
    kind === 'general' ? (roles.find(r => r.key === 'team_member')?.id || '') : ''
  );
  const [busy, setBusy] = useState(false);

  const create = () => {
    setBusy(true);
    api.post('/access/roles', { name: name.trim(), kind, cloneFromId: cloneFromId || null })
      .then(() => { toast.success(`${name.trim()} created`); onCreated(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not create the role'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            Add {kind === 'general' ? 'General' : 'Specific'} Role
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Role name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              autoFocus value={name} maxLength={100}
              onChange={e => setName(e.target.value)}
              placeholder="Enter the Role Name"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>

          {/* Specific roles have no clone in the reference, and none here. */}
          {kind === 'general' && (
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Clone role</label>
              <select
                value={cloneFromId} onChange={e => setCloneFromId(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                <option value="">Start with nothing</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="text-[12.5px] text-slate-500 mt-1">
                The new role starts with this role's permissions and function switches.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={create} disabled={busy || !name.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignDialog({ role, users, onClose, onAssigned }) {
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);

  const assign = () => {
    setBusy(true);
    api.post(`/access/roles/${role.id}/members`, { employeeId: userId })
      .then(r => { toast.success(r.data.message || 'Assigned'); onAssigned(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not assign'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">Assign User to {role.name}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Select User</label>
          <UserPicker users={users} value={userId} onChange={setUserId} />
          {/* One general role per person, so this moves them rather than
              adding a second. Saying so beats a silent reassignment. */}
          <p className="text-[12.5px] text-slate-500 mt-2">
            A user has one general role. Assigning moves them from the role they are on now.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={assign} disabled={busy || !userId}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
          >
            {busy ? 'Assigning…' : 'Assign'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDialog({ role, permissions, onClose, onSaved }) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState(role.permissions || []);
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    api.patch(`/access/roles/${role.id}`, { name: name.trim(), permissions: perms })
      .then(() => { toast.success('Role saved'); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const toggle = key => setPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">Edit role</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Role name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              autoFocus value={name} maxLength={100}
              onChange={e => setName(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            {role.isSystem && (
              <p className="text-[12.5px] text-slate-500 mt-1">
                Renaming changes what this role is called. Everyone stays on it.
              </p>
            )}
          </div>

          <div>
            <p className="text-[13px] font-medium text-slate-700 mb-2">What this role can do</p>
            <div className="space-y-2.5">
              {permissions.map(p => (
                <label key={p.key} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox" checked={perms.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-slate-800">{p.label}</span>
                    <span className="block text-[12.5px] text-slate-500">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={save} disabled={busy || !name.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoleCards({ kind }) {
  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ permissions: [] });
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [editing, setEditing] = useState(null);
  const [peek, setPeek] = useState(null);
  const [term, setTerm] = useState('');
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => (
    api.get(`/access/roles?kind=${kind}`)
      .then(r => setRoles(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load roles'); setRoles([]); })
  ), [kind]);

  useEffect(() => {
    load();
    api.get('/access/assignable-users').then(r => setUsers(r.data.data || [])).catch(() => {});
    api.get('/access/catalog').then(r => setCatalog(r.data.data || { permissions: [] })).catch(() => {});
  }, [load]);

  const shown = useMemo(() => {
    if (!roles) return [];
    const t = term.trim().toLowerCase();
    return t ? roles.filter(r => r.name.toLowerCase().includes(t)) : roles;
  }, [roles, term]);

  const remove = role => {
    if (!window.confirm(`Delete ${role.name}?`)) return;
    api.delete(`/access/roles/${role.id}`)
      .then(() => { toast.success('Role deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const openPeek = role => {
    setPeek({ role, list: null });
    api.get(`/access/roles/${role.id}/members`)
      .then(r => setPeek({ role, list: r.data.data || [] }))
      .catch(() => setPeek({ role, list: [] }));
  };

  if (roles === null) return <Spinner />;

  const label = kind === 'general' ? 'General' : 'Specific';

  return (
    <div className="pb-4">
      <div className="flex items-center justify-end gap-2 mb-4">
        {searching && (
          <input
            autoFocus value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Search roles"
            className="border border-slate-300 rounded-md px-3 py-2 text-[14px] w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        )}
        <button
          onClick={() => setAdding(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium"
        >
          Add {label} Role
        </button>
        <button
          onClick={() => { setSearching(s => !s); setTerm(''); }}
          aria-label="Search roles"
          className="border border-slate-300 text-slate-500 hover:text-slate-700 rounded p-2"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {shown.map(role => (
          <div key={role.id} className="group bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-[15px] font-semibold text-slate-800 truncate">{role.name}</h3>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {kind === 'general' && (
                  <button onClick={() => setAssigning(role)} title={`Assign user to ${role.name}`}
                    className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Plus size={16} /></button>
                )}
                {/* A built-in role offers neither, as in the reference: it is
                    what the route guards were derived from and what every
                    employee record carries. */}
                {!role.isSystem && (
                  <>
                    <button onClick={() => setEditing(role)} title={`Edit ${role.name}`}
                      className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Pencil size={15} /></button>
                    <button onClick={() => remove(role)} title={`Delete ${role.name}`}
                      className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={15} /></button>
                  </>
                )}
                {role.isSystem && (
                  <button onClick={() => setEditing(role)} title={`Edit ${role.name}`}
                    className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Pencil size={15} /></button>
                )}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg px-4 py-3 min-h-[56px] flex items-center">
              {role.memberCount === 0 ? (
                <p className="text-[13.5px] text-slate-500">No Users assigned to this Role</p>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {role.members.map(m => (
                    <span key={m.id} title={`${m.employeeId || ''} ${m.name}`.trim()}>
                      <Avatar user={m} size={30} />
                    </span>
                  ))}
                  {role.memberCount > AVATARS_SHOWN && (
                    <button
                      onClick={() => openPeek(role)}
                      className="h-[30px] px-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[12.5px] font-medium"
                    >
                      +{role.memberCount - AVATARS_SHOWN}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* The permissions are what makes this role more than a label, so
                the card says what they are rather than only who is on it. */}
            {kind === 'general' && (
              <p className="text-[12.5px] text-slate-500 mt-2.5">
                {role.permissions.length === 0
                  ? 'Own records only'
                  : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
                {role.memberCount > 0 && ` · ${role.memberCount} user${role.memberCount === 1 ? '' : 's'}`}
                {role.isSystem && ' · built-in'}
              </p>
            )}
          </div>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center">
          <p className="text-[14px] text-slate-600">
            {term ? 'No roles match that.' : `No ${label.toLowerCase()} roles yet.`}
          </p>
        </div>
      )}

      {adding && (
        <AddRoleDialog kind={kind} roles={roles} onClose={() => setAdding(false)} onCreated={load} />
      )}
      {assigning && (
        <AssignDialog role={assigning} users={users} onClose={() => setAssigning(null)} onAssigned={load} />
      )}
      {editing && (
        <EditDialog role={editing} permissions={catalog.permissions || []}
          onClose={() => setEditing(null)} onSaved={load} />
      )}

      {peek && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[15px] font-semibold text-slate-800">{peek.role.name} — {peek.role.memberCount} user(s)</p>
              <button onClick={() => setPeek(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto">
              {peek.list === null ? <Spinner /> : (
                <table className="w-full text-[14px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee ID</th>
                      <th className="text-left font-medium text-slate-600 px-6 py-2.5">Designation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peek.list.map(m => (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-6 py-2.5 text-slate-700 flex items-center gap-2">
                          <Avatar user={m} size={26} />{m.name || m.email}
                        </td>
                        <td className="px-6 py-2.5 text-slate-600">{m.employeeId || '—'}</td>
                        <td className="px-6 py-2.5 text-slate-600">{m.designation || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const GeneralRole = () => <RoleCards kind="general" />;
export const SpecificRole = () => <RoleCards kind="specific" />;
