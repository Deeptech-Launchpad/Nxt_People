import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Toggle, selectClass, Spinner } from '../configKit';

// Approvals — who a request goes to. One rule per request type.
//
// The chain was always derived in code: two levels up the reporting line, then
// HR, with the Business Unit Head exception. This is that rule, written down
// and editable. The seeded values reproduce it exactly, so nothing moved when
// it became a record.
//
// The preview is the point of the screen. A rule described in the abstract is
// easy to get wrong; the preview derives the real chain for a real person from
// the saved rule, so the effect of a change is visible before anyone relies on
// it. It reflects what is SAVED, not what is on screen.
//
// A request already in flight keeps the approvers it was given — its levels
// were written at submission — so editing here only affects what comes next.

const KIND_LABEL = {
  reporting_to: 'Reporting To',
  role: 'Approver based on Role',
  user: 'A specific person',
};

const ROLE_LABEL = {
  hr_admin: 'HR', admin: 'Super Admin', director: 'Director',
  manager: 'Team Lead', team_incharge: 'Team In-charge',
};

const describe = step => {
  if (step.kind === 'reporting_to') return `${step.count} level${step.count > 1 ? 's' : ''} of Reporting To`;
  if (step.kind === 'role') return ROLE_LABEL[step.role] || step.role;
  return 'Specific person';
};

export default function ApprovalRules({ service = 'attendance' }) {
  const [rules, setRules] = useState(null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/approval-rules?service=${service}`)
      .then(r => setRules(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load approvals'); setRules([]); });
  }, [service]);

  useEffect(load, [load]);

  // Previewed against the signed-in user, whose own chain they can sanity-check.
  const loadPreview = useCallback(requestType => {
    api.get(`/approval-rules/${requestType}/preview`)
      .then(r => setPreview(p => ({ ...p, [requestType]: r.data.data })))
      .catch(() => {});
  }, []);

  useEffect(() => { (rules || []).forEach(r => loadPreview(r.requestType)); }, [rules, loadPreview]);

  const save = () => {
    setBusy(true);
    api.put(`/approval-rules/${editing.requestType}`, editing)
      .then(() => { toast.success('Approval saved'); setEditing(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const toggleActive = rule => {
    api.put(`/approval-rules/${rule.requestType}`, { ...rule, isActive: !rule.isActive })
      .then(() => { toast.success(`${rule.name} ${rule.isActive ? 'switched off' : 'switched on'}`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  if (rules === null) return <Spinner />;

  const setStep = (i, changes) =>
    setEditing(e => ({ ...e, levels: e.levels.map((s, n) => (n === i ? { ...s, ...changes } : s)) }));

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Approvals"
        description="Who a request goes to, and in what order"
      >
        <Note>
          A change applies to requests filed afterwards. Anything already awaiting approval keeps the
          approvers it was given when it was submitted.
        </Note>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Approval name</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Chain</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 whitespace-nowrap">Your approvers</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Status</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.requestType} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{rule.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(rule.levels || []).map((step, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="text-slate-400">›</span>}
                          <span className="bg-slate-100 text-slate-700 rounded px-2 py-0.5 text-[13px] whitespace-nowrap">
                            {describe(step)}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">
                    {preview[rule.requestType]
                      ? (preview[rule.requestType].length
                          ? preview[rule.requestType].map(p => p.name).join(' › ')
                          : 'No approvers — you are at the top of the tree')
                      : '…'}
                  </td>
                  <td className="px-4 py-3">
                    <Toggle checked={rule.isActive} onChange={() => toggleActive(rule)} label="" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing({ ...rule, levels: [...(rule.levels || [])] })}
                      className="text-[13.5px] text-blue-600 hover:text-blue-500"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rules.some(r => !r.isActive) && (
          <Note>
            A switched-off approval does not mean requests skip approval — the built-in chain takes over,
            because a request with no approvers could never be actioned.
          </Note>
        )}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Edit Approval</p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Approval name<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  value={editing.name || ''}
                  onChange={e => setEditing(v => ({ ...v, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">Approver levels</p>
                <div className="space-y-2.5">
                  {editing.levels.map((step, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select
                        value={step.kind}
                        onChange={e => setStep(i, {
                          kind: e.target.value,
                          ...(e.target.value === 'reporting_to' ? { count: 1 } : {}),
                          ...(e.target.value === 'role' ? { role: 'hr_admin' } : {}),
                        })}
                        className={`${selectClass} flex-1 min-w-[190px]`}
                      >
                        {Object.entries(KIND_LABEL)
                          .filter(([k]) => k !== 'user')
                          .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>

                      {step.kind === 'reporting_to' ? (
                        <select value={step.count} onChange={e => setStep(i, { count: Number(e.target.value) })}
                          className={`${selectClass} w-[150px]`}>
                          {[1, 2, 3, 4, 5].map(n => (
                            <option key={n} value={n}>{n} Level{n > 1 ? 's' : ''}</option>
                          ))}
                        </select>
                      ) : (
                        <select value={step.role} onChange={e => setStep(i, { role: e.target.value })}
                          className={`${selectClass} w-[150px]`}>
                          {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}

                      <button
                        onClick={() => setEditing(v => ({ ...v, levels: v.levels.filter((_, n) => n !== i) }))}
                        disabled={editing.levels.length === 1}
                        aria-label="Remove level"
                        className="text-slate-400 hover:text-red-500 disabled:opacity-30 p-1.5"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setEditing(v => ({ ...v, levels: [...v.levels, { kind: 'role', role: 'hr_admin' }] }))}
                  disabled={editing.levels.length >= 5}
                  className="mt-3 flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
                >
                  <Plus size={14} /> Add Approver Level
                </button>
              </div>

              {editing.levels.some(s => s.kind === 'role') && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.levels.some(s => s.kind === 'role' && s.skipWhenManagerIsBuHead)}
                    onChange={e => setEditing(v => ({
                      ...v,
                      levels: v.levels.map(s => (s.kind === 'role' ? { ...s, skipWhenManagerIsBuHead: e.target.checked } : s)),
                    }))}
                    className="w-4 h-4 accent-blue-600 mt-0.5"
                  />
                  <span>
                    <span className="block text-[14px] text-slate-700">Skip the role level when the manager is a Business Unit Head</span>
                    <span className="block text-[13px] text-slate-500 mt-0.5">
                      The rule the chain has always applied: someone reporting straight to the BU Head
                      does not also go to HR.
                    </span>
                  </span>
                </label>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={save} disabled={busy || !String(editing.name || '').trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)}
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
