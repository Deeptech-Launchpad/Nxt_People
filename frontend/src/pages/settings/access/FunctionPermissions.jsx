import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner, SaveBar } from '../configKit';

// Function Based Permissions — the reference's sixteen switches, per role.
//
// Two things worth being straight about. The reference org has every role set
// identically, so there was nothing per-role to copy; every role here starts
// from those same values. And five of the sixteen are features this
// application does not have — Delegation, Tags, API Access, Wedding
// Anniversary and Show designation based on permission. Those are stored and
// returned faithfully and say on the row that they enforce nothing, rather
// than presenting a switch that quietly does nothing.

export default function FunctionPermissions() {
  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState('');
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/access/roles?kind=general')
      .then(r => {
        const list = r.data.data || [];
        setRoles(list);
        if (list.length) setRoleId(list[0].id);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load roles'));
  }, []);

  const load = useCallback(() => {
    if (!roleId) return;
    setRows(null);
    api.get(`/access/functions?roleId=${roleId}`)
      .then(r => {
        setRows(r.data.data.functions);
        setDraft(r.data.data.functions.map(f => ({ ...f })));
      })
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); });
  }, [roleId]);

  useEffect(load, [load]);

  if (!rows || !draft) return <Spinner />;

  const dirty = JSON.stringify(rows.map(r => [r.allowed, r.options]))
             !== JSON.stringify(draft.map(r => [r.allowed, r.options]));

  const setRow = (key, patch) =>
    setDraft(d => d.map(f => (f.key === key ? { ...f, ...patch } : f)));

  const setOption = (key, optionKey, value) =>
    setDraft(d => d.map(f => (f.key === key ? { ...f, options: { ...f.options, [optionKey]: value } } : f)));

  const save = () => {
    setSaving(true);
    api.patch(`/access/functions/${roleId}`, {
      functions: draft.map(f => ({ functionKey: f.key, allowed: f.allowed, options: f.options })),
    })
      .then(r => { toast.success('Permissions saved'); setRows(r.data.data); setDraft(r.data.data.map(f => ({ ...f }))); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="pb-24">
      <div className="flex items-center gap-3 mb-4">
        <label className="text-[14px] text-slate-600">Role</label>
        <select
          value={roleId} onChange={e => setRoleId(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-2 text-[14px] bg-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
        >
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5 w-[42%]">Function</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Access</th>
              </tr>
            </thead>
            <tbody>
              {draft.map(f => (
                <tr key={f.key} className="border-t border-slate-100">
                  <td className="px-6 py-3.5 align-top">
                    <span className="text-slate-700">{f.label}</span>
                    {!f.wired && (
                      <span className="block text-[12px] text-amber-700 mt-0.5">
                        Saved, but not enforced yet
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-6 flex-wrap">
                      <button
                        onClick={() => setRow(f.key, { allowed: !f.allowed })}
                        aria-label={`${f.label}: ${f.allowed ? 'allowed' : 'not allowed'}`}
                        className="flex-shrink-0"
                      >
                        {f.allowed
                          ? <CheckCircle2 size={20} className="text-emerald-500" />
                          : <XCircle size={20} className="text-red-500" />}
                      </button>

                      {f.control?.type === 'check' && (
                        <label className={`flex items-center gap-2 ${f.allowed ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                          <input
                            type="checkbox"
                            // The reference keeps the sub-control on screen
                            // when the row is off, but it cannot mean anything
                            // there, so it is disabled rather than hidden.
                            disabled={!f.allowed}
                            checked={!!f.options?.[f.control.key]}
                            onChange={e => setOption(f.key, f.control.key, e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                          />
                          <span className="text-[13.5px] text-slate-700">{f.control.label}</span>
                          {f.control.hint && (
                            <span title={f.control.hint}><Info size={13} className="text-slate-400" /></span>
                          )}
                        </label>
                      )}

                      {f.control?.type === 'radio' && f.control.options.map(o => (
                        <label key={o.value}
                          className={`flex items-center gap-2 ${f.allowed ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                          <input
                            type="radio" disabled={!f.allowed}
                            name={`${f.key}-${f.control.key}`}
                            checked={(f.options?.[f.control.key] || f.control.options[0].value) === o.value}
                            onChange={() => setOption(f.key, f.control.key, o.value)}
                            className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-blue-500/30"
                          />
                          <span className="text-[13.5px] text-slate-700">{o.label}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
