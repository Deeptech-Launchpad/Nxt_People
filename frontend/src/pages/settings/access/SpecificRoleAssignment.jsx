import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Trash2, Plus, Inbox } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import UserPicker, { Avatar } from './UserPicker';

// Specific Role Assignment — an employee, the specific roles they hold, and
// the slice of the organization each one applies to.
//
// The five applicability lines are the same five levels Organization Structure
// defines plus department and location, so they are fed from the real lists
// rather than typed in: a role scoped to a company that does not exist is a
// role scoped to nothing.
//
// One employee can hold several specific roles, so the editor shows all of
// theirs at once and saving replaces the set. Saving one role at a time would
// leave a removed role behind with no way to see it had gone.

const select = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

function ApplicabilityLine({ line, fields, options, onChange, onRemove }) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-3">
      {fields.map(f => (
        <div key={f.key} className="flex items-center gap-3">
          <label className="text-[13.5px] text-slate-600 w-32 flex-shrink-0">{f.label}</label>
          <select
            value={line[f.key] || ''}
            onChange={e => onChange({ ...line, [f.key]: e.target.value || undefined })}
            className={select}
          >
            <option value="">Any</option>
            {(options[f.resource] || []).map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button
            onClick={() => onChange({ ...line, [f.key]: undefined })}
            aria-label={`Clear ${f.label}`}
            className="text-slate-400 hover:text-red-500 p-1.5 rounded flex-shrink-0"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {onRemove && (
        <button onClick={onRemove} className="text-[13px] text-red-600 hover:underline">
          Remove this scope
        </button>
      )}
    </div>
  );
}

function AssignDialog({ users, specificRoles, fields, options, initial, onClose, onSaved }) {
  const [employeeId, setEmployeeId] = useState(initial?.employeeId || '');
  const [blocks, setBlocks] = useState(
    initial?.roles?.length
      ? initial.roles.map(r => ({ roleId: r.roleId, applicability: r.applicability?.length ? r.applicability : [{}] }))
      : [{ roleId: '', applicability: [{}] }]
  );
  const [busy, setBusy] = useState(false);

  const setBlock = (i, patch) => setBlocks(bs => bs.map((b, j) => (i === j ? { ...b, ...patch } : b)));

  const save = () => {
    setBusy(true);
    api.post('/access/specific-assignments', {
      employeeId,
      roles: blocks.filter(b => b.roleId).map(b => ({
        roleId: b.roleId,
        // An empty line means "anywhere". Sending it would store a scope of
        // nothing, which reads as a mistake later.
        applicability: b.applicability.filter(l => Object.values(l).some(Boolean)),
      })),
    })
      .then(() => { toast.success('Specific role assigned'); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const valid = employeeId && blocks.some(b => b.roleId);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">Assign Specific Role</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="border border-slate-200 rounded-lg px-4 py-4">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Employee Name</label>
            <UserPicker users={users} value={employeeId} onChange={setEmployeeId} />
          </div>

          {blocks.map((b, i) => (
            <div key={i} className="border border-slate-200 rounded-lg px-4 py-4 space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-[13.5px] text-slate-700 flex-shrink-0">Role name</label>
                <select
                  value={b.roleId} onChange={e => setBlock(i, { roleId: e.target.value })}
                  className={`${select} max-w-xs`}
                >
                  <option value="">Select</option>
                  {specificRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {blocks.length > 1 && (
                  <button
                    onClick={() => setBlocks(bs => bs.filter((_, j) => j !== i))}
                    aria-label="Remove this role"
                    className="ml-auto text-slate-400 hover:text-red-500 p-1.5 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div>
                <p className="text-[13.5px] text-slate-700 mb-2">Applicability</p>
                <div className="space-y-3">
                  {b.applicability.map((line, li) => (
                    <ApplicabilityLine
                      key={li} line={line} fields={fields} options={options}
                      onChange={next => setBlock(i, {
                        applicability: b.applicability.map((l, lj) => (lj === li ? next : l)),
                      })}
                      onRemove={b.applicability.length > 1
                        ? () => setBlock(i, { applicability: b.applicability.filter((_, lj) => lj !== li) })
                        : null}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setBlock(i, { applicability: [...b.applicability, {}] })}
                  className="text-[13.5px] text-blue-600 hover:underline mt-2"
                >
                  + Add new
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setBlocks(bs => [...bs, { roleId: '', applicability: [{}] }])}
            className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:underline"
          >
            <Plus size={15} /> Add another role
          </button>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save} disabled={busy || !valid}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
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

export default function SpecificRoleAssignment() {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState([]);
  const [specificRoles, setSpecificRoles] = useState([]);
  const [fields, setFields] = useState([]);
  const [options, setOptions] = useState({});
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => (
    api.get('/access/specific-assignments')
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); })
  ), []);

  useEffect(() => {
    load();
    api.get('/access/assignable-users').then(r => setUsers(r.data.data || [])).catch(() => {});
    api.get('/access/roles?kind=specific').then(r => setSpecificRoles(r.data.data || [])).catch(() => {});
    api.get('/access/catalog').then(async r => {
      const f = r.data.data.applicabilityFields || [];
      setFields(f);
      // The five lists the scopes are chosen from, fetched once.
      const loaded = {};
      await Promise.all(f.map(x =>
        api.get(`/org-setup/${x.resource}`)
          .then(res => { loaded[x.resource] = res.data.data || []; })
          .catch(() => { loaded[x.resource] = []; })
      ));
      setOptions(loaded);
    }).catch(() => {});
  }, [load]);

  const remove = row => {
    if (!window.confirm(`Remove every specific role from ${row.employeeName}?`)) return;
    api.delete(`/access/specific-assignments/${row.employeeId}`)
      .then(() => { toast.success('Assignment removed'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not remove'));
  };

  if (rows === null) return <Spinner />;

  const scopeText = applicability => {
    if (!applicability?.length) return 'Everywhere';
    const names = [];
    for (const line of applicability) {
      for (const f of fields) {
        const id = line[f.key];
        if (!id) continue;
        const found = (options[f.resource] || []).find(o => o.id === id);
        // A scope pointing at something since deleted must say so rather than
        // silently reading as "everywhere".
        names.push(found ? found.name : `${f.label} (removed)`);
      }
    }
    return names.length ? names.join(', ') : 'Everywhere';
  };

  return (
    <div className="pb-4">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setEditing({})}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium"
        >
          Assign Specific Role
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Employee Role</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Applicable Specific Roles</th>
                <th className="w-16" />
              </tr>
            </thead>
            {rows.length > 0 && (
              <tbody>
                {rows.map(row => (
                  <tr key={row.employeeId} className="group border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-6 py-3 align-top">
                      <button onClick={() => setEditing(row)} className="flex items-center gap-2.5 text-left">
                        <Avatar user={{ name: row.employeeName, photo: row.photo }} size={30} />
                        <span>
                          <span className="block text-blue-600 hover:underline">{row.employeeName}</span>
                          <span className="block text-[12.5px] text-slate-500">{row.employeeCode}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-6 py-3 text-slate-700 align-top">{row.employeeRole || '—'}</td>
                    <td className="px-6 py-3 align-top">
                      <div className="space-y-1.5">
                        {row.roles.map(r => (
                          <div key={r.id}>
                            <span className="text-slate-700">{r.roleName}</span>
                            <span className="text-[12.5px] text-slate-500 ml-2">{scopeText(r.applicability)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-3 align-top">
                      <button onClick={() => remove(row)} aria-label={`Remove ${row.employeeName}`}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <Inbox size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[14px] text-slate-600">No record found</p>
          </div>
        )}
      </div>

      {specificRoles.length === 0 && (
        <p className="text-[12.5px] text-slate-500 mt-3">
          There are no specific roles yet. Create one under Specific Role first.
        </p>
      )}

      {/* Recorded, not yet enforced — route access still comes from the
          general role. Saying so beats a screen that looks like it gates. */}
      {rows.length > 0 && (
        <p className="text-[12.5px] text-amber-700 mt-3">
          Saved, but not enforced yet — route access still comes from the user's general role.
        </p>
      )}

      {editing && (
        <AssignDialog
          users={users} specificRoles={specificRoles} fields={fields} options={options}
          initial={editing.employeeId ? editing : null}
          onClose={() => setEditing(null)} onSaved={load}
        />
      )}
    </div>
  );
}
