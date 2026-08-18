import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Trash2, Plus, Users } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import UserPicker, { Avatar } from './UserPicker';

// Applicability groups — named employees, or criteria that decide membership.
//
// Membership is worked out when the group is read, never stored as a list.
// A group defined as "everyone in Content" has to follow a transfer the moment
// it happens; a stored list would be right until the next time somebody moved
// and then quietly wrong.
//
// The two halves are joined by OR, as the reference shows: a named employee is
// always in the group, and anyone matching a criterion is too.

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

function GroupDialog({ group, users, criteriaFields, onClose, onSaved }) {
  const [name, setName] = useState(group?.name || '');
  const [employeeIds, setEmployeeIds] = useState(group?.employeeIds || []);
  const [criteria, setCriteria] = useState(group?.criteria || []);
  const [picking, setPicking] = useState('');
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    const body = { name: name.trim(), employeeIds, criteria };
    const call = group?.id
      ? api.patch(`/access/applicability-groups/${group.id}`, body)
      : api.post('/access/applicability-groups', body);
    call
      .then(() => { toast.success(`Group ${group?.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const addEmployee = id => {
    if (id && !employeeIds.includes(id)) setEmployeeIds(e => [...e, id]);
    setPicking('');
  };

  const valid = name.trim() && (employeeIds.length || criteria.some(c => c.field && String(c.value ?? '').trim()));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            {group?.id ? 'Edit Group' : 'Add New Group'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
            <div className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
                <input
                  autoFocus value={name} maxLength={150}
                  onChange={e => setName(e.target.value)}
                  className={`${input} max-w-sm`}
                />
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">Selected criteria</p>

                <div className="relative">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4">
                    <p className="text-[13px] text-slate-500 mb-2">Employees added directly</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {employeeIds.map(id => {
                        const u = users.find(x => x.id === id);
                        return (
                          <span key={id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-1 pr-2 py-1">
                            <Avatar user={u || { name: '?' }} size={22} />
                            <span className="text-[13px] text-slate-700">{u?.name || 'Unknown'}</span>
                            <button onClick={() => setEmployeeIds(e => e.filter(x => x !== id))}
                              aria-label="Remove" className="text-slate-400 hover:text-red-500">
                              <X size={13} />
                            </button>
                          </span>
                        );
                      })}
                      {employeeIds.length === 0 && <span className="text-[13px] text-slate-400">None yet</span>}
                    </div>
                    <div className="max-w-sm">
                      <UserPicker
                        users={users} value={picking} onChange={addEmployee}
                        placeholder="Add Employee" exclude={employeeIds}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 my-2">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[12px] font-medium text-slate-500 border border-slate-200 rounded-full px-3 py-1 bg-white">OR</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4">
                    <p className="text-[13px] text-slate-500 mb-2">Anyone matching</p>
                    <div className="space-y-2.5">
                      {criteria.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            value={c.field}
                            onChange={e => setCriteria(cs => cs.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                            className={`${input} bg-white max-w-[180px]`}
                          >
                            {criteriaFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <span className="text-[13px] text-slate-500">is</span>
                          <input
                            value={c.value || ''}
                            onChange={e => setCriteria(cs => cs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                            placeholder="Value"
                            className={`${input} max-w-[220px]`}
                          />
                          <button onClick={() => setCriteria(cs => cs.filter((_, j) => j !== i))}
                            aria-label="Remove criterion" className="text-slate-400 hover:text-red-500 p-1.5">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      {criteria.length === 0 && <span className="text-[13px] text-slate-400">None yet</span>}
                    </div>
                    <button
                      onClick={() => setCriteria(cs => [...cs, { field: criteriaFields[0]?.key || 'department', value: '' }])}
                      className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:underline mt-3"
                    >
                      <Plus size={15} /> Add Criteria
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 h-fit">
              <p className="text-[13px] text-amber-900 leading-relaxed">
                Applicable members who fall under the specified criteria (department, location, etc)
                become part of this user group.
              </p>
              <p className="text-[13px] text-amber-900 leading-relaxed mt-3">
                We can add the employee directly, and they will always be applicable to this group.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save} disabled={busy || !valid}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ApplicabilityGroups() {
  const [groups, setGroups] = useState(null);
  const [users, setUsers] = useState([]);
  const [criteriaFields, setCriteriaFields] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => (
    api.get('/access/applicability-groups')
      .then(r => setGroups(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setGroups([]); })
  ), []);

  useEffect(() => {
    load();
    api.get('/access/assignable-users').then(r => setUsers(r.data.data || [])).catch(() => {});
    api.get('/access/catalog').then(r => setCriteriaFields(r.data.data.criteriaFields || [])).catch(() => {});
  }, [load]);

  const remove = g => {
    if (!window.confirm(`Delete ${g.name}?`)) return;
    api.delete(`/access/applicability-groups/${g.id}`)
      .then(() => { toast.success('Group deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  if (groups === null) return <Spinner />;

  return (
    <div className="pb-4">
      {groups.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-14 text-center">
          <Users size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-[16px] text-slate-700">Applicability Groups are empty.</p>
          <p className="text-[13.5px] text-slate-500 mt-3 max-w-2xl mx-auto leading-relaxed">
            Applicability Groups lets you define dynamic employee groups based on criteria like role,
            designation, location, department and employee type. These groups manage their own membership
            as records change, and can be used to control visibility, access and applicability of features
            and policies to specific employee segments.
          </p>
          <button
            onClick={() => setEditing({})}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium mt-5"
          >
            Add
          </button>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setEditing({})}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium"
            >
              Add
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5">Members</th>
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5">Built from</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-6 py-3">
                      <button onClick={() => setEditing(g)} className="text-blue-600 hover:underline font-medium">
                        {g.name}
                      </button>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1.5">
                        {g.members.map(m => <Avatar key={m.id} user={m} size={26} />)}
                        {g.memberCount > g.members.length && (
                          <span className="text-[12.5px] text-slate-500 ml-1">+{g.memberCount - g.members.length}</span>
                        )}
                        {g.memberCount === 0 && <span className="text-slate-400">Nobody matches yet</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {[
                        g.employeeIds?.length ? `${g.employeeIds.length} named` : null,
                        g.criteria?.length ? `${g.criteria.length} criterion(s)` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-6 py-3">
                      <button onClick={() => remove(g)} aria-label={`Delete ${g.name}`}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[12.5px] text-amber-700 mt-3">
            Saved, but not enforced yet — nothing reads these groups to decide what a user sees.
          </p>
        </>
      )}

      {editing && (
        <GroupDialog
          group={editing.id ? editing : null} users={users} criteriaFields={criteriaFields}
          onClose={() => setEditing(null)} onSaved={load}
        />
      )}
    </div>
  );
}
