import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Toggle, selectClass, Spinner } from '../configKit';
import { roleLabel } from '../../../utils/roles';

// Approvals — who a request goes to, and in what order.
//
// A form can have several approvals. Which one governs a request is decided at
// submission from its criteria, so a rule narrowed to "older than five days"
// can route differently from the catch-all beneath it. Order matters: the first
// active rule whose criteria match wins.
//
// The preview is what makes the screen trustworthy. It derives the real chain
// for a real person from what is SAVED, not from what is on screen — a chain
// described in the abstract is easy to get wrong.
//
// A change applies to requests filed afterwards. Anything already awaiting
// approval keeps the approvers it was given at submission.

const LEVEL_WORDS = ['', 'Single Level', 'Two Levels', 'Three Levels', 'Four Levels', 'Five Levels', 'Six Levels'];

const RECIPIENTS = [
  { key: 'current_approver', label: 'Current Approver' },
  { key: 'requester', label: 'Person performing this action' },
  { key: 'reporting_manager', label: 'Reporting manager' },
];

const blankRule = (requestType) => ({
  requestType,
  name: '',
  description: '',
  isActive: true,
  decision: 'chain',
  levels: [{ kind: 'reporting_to', count: 1 }],
  criteria: [],
  criteriaMatch: 'AND',
  followUp: false,
  sortOrder: 50,
  messages: {
    from: 'default_address',
    to: ['current_approver'],
    subject: 'A request is waiting for your approval',
    templateName: null,
    onApproved: { enabled: true, templateName: null },
    onRejected: { enabled: true, templateName: null },
  },
});

const SECTIONS = ['Approval Details', 'Criteria', 'Approvals', 'Messages'];

export default function ApprovalRules({ service = 'attendance' }) {
  const [rules, setRules] = useState(null);
  const [meta, setMeta] = useState(null);
  const [preview, setPreview] = useState({});
  const [editing, setEditing] = useState(null);
  const [section, setSection] = useState(SECTIONS[0]);
  const [busy, setBusy] = useState(false);

  const forms = useMemo(
    () => (meta?.forms || []).filter(f => f.service === service),
    [meta, service]
  );

  const load = useCallback(() => {
    api.get(`/approval-rules?service=${service}`)
      .then(r => setRules(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load approvals'); setRules([]); });
  }, [service]);

  useEffect(load, [load]);
  useEffect(() => {
    api.get('/approval-rules/meta').then(r => setMeta(r.data.data)).catch(() => {});
  }, []);

  // Previewed per form, against the signed-in user, from what is saved.
  useEffect(() => {
    forms.forEach(f => {
      api.get(`/approval-rules/preview/${f.key}`)
        .then(r => setPreview(p => ({ ...p, [f.key]: r.data.data })))
        .catch(() => {});
    });
  }, [forms, rules]);

  const save = () => {
    setBusy(true);
    const call = editing.id
      ? api.put(`/approval-rules/${editing.id}`, editing)
      : api.post('/approval-rules', editing);
    call
      .then(() => { toast.success(`Approval ${editing.id ? 'saved' : 'added'}`); setEditing(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const remove = rule => {
    if (!window.confirm(`Delete "${rule.name}"?`)) return;
    api.delete(`/approval-rules/${rule.id}`)
      .then(() => { toast.success('Approval deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const toggleActive = rule => {
    api.put(`/approval-rules/${rule.id}`, { ...rule, isActive: !rule.isActive })
      .then(() => { toast.success(`${rule.name} ${rule.isActive ? 'switched off' : 'switched on'}`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  if (rules === null || !meta) return <Spinner />;

  const describeStep = step => {
    if (step.kind === 'reporting_to') return `${step.count} level${step.count > 1 ? 's' : ''} of Reporting To`;
    if (step.kind === 'role') return roleLabel(step.role);
    if (step.kind === 'department_head_of_owner') return "Requester's department head";
    if (step.kind === 'department_head') return `Head of ${meta.departments.find(d => d.id === step.departmentId)?.name || 'department'}`;
    if (step.kind === 'department_members') return `${meta.departments.find(d => d.id === step.departmentId)?.name || 'Department'} members`;
    return 'A specific person';
  };

  const setField = changes => setEditing(e => ({ ...e, ...changes }));
  const setStep = (i, changes) =>
    setEditing(e => ({ ...e, levels: e.levels.map((s, n) => (n === i ? { ...s, ...changes } : s)) }));
  const setCond = (i, changes) =>
    setEditing(e => ({ ...e, criteria: e.criteria.map((c, n) => (n === i ? { ...c, ...changes } : c)) }));
  const setMsg = changes => setEditing(e => ({ ...e, messages: { ...e.messages, ...changes } }));

  const fieldsForForm = meta.criteriaFields?.[editing?.requestType] || [];
  const typeOf = kind => meta.approverTypes.find(t => t.key === kind);

  return (
    <div className="space-y-4 pb-4">
      <Card title="Approvals" description="Who a request goes to, and in what order"
        actions={
          <button
            onClick={() => { setEditing(blankRule(forms[0]?.key)); setSection(SECTIONS[0]); }}
            className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded text-[13.5px] font-medium"
          >
            <Plus size={15} /> Add Approval
          </button>
        }
      >
        <Note>
          Several approvals can share a form. The one that runs is the first switched-on approval whose
          criteria match the request, in order — so an approval with no criteria acts as the catch-all.
          A change applies to requests filed afterwards.
        </Note>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                {['Approval name', 'Form name', 'Chain', 'Order', 'Status', ''].map(h => (
                  <th key={h} className="text-left font-medium text-slate-600 px-4 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{rule.name}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{rule.formLabel}</td>
                  <td className="px-4 py-3">
                    {rule.decision !== 'chain' ? (
                      <span className={`rounded px-2 py-0.5 text-[13px] ${
                        rule.decision === 'auto_approve' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {rule.decision === 'auto_approve' ? 'Auto approve' : 'Auto reject'}
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(rule.levels || []).map((step, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-slate-400">›</span>}
                            <span className="bg-slate-100 text-slate-700 rounded px-2 py-0.5 text-[13px] whitespace-nowrap">
                              {describeStep(step)}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    {(rule.criteria || []).length > 0 && (
                      <p className="text-[12.5px] text-slate-500 mt-1">
                        when {rule.criteria.length} condition{rule.criteria.length > 1 ? 's' : ''} match
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{rule.sortOrder}</td>
                  <td className="px-4 py-3"><Toggle checked={rule.isActive} onChange={() => toggleActive(rule)} label="" /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing({ ...rule }); setSection(SECTIONS[0]); }}
                      className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                    <button onClick={() => remove(rule)} aria-label={`Delete ${rule.name}`}
                      className="ml-2 text-slate-400 hover:text-red-500 p-1 align-middle"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="What would happen to your own request" description="Derived from the saved approvals, for you">
        <div className="space-y-2.5">
          {forms.map(f => {
            const p = preview[f.key];
            return (
              <div key={f.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
                <span className="text-slate-700 font-medium w-[190px] flex-shrink-0">{f.label}</span>
                {!p ? <span className="text-slate-400">…</span>
                  : p.decision !== 'chain'
                    ? <span className="text-slate-600">{p.decision === 'auto_approve' ? 'Auto approved' : 'Auto rejected'} by {p.ruleName}</span>
                    : p.approvers.length
                      ? <span className="text-slate-600">{p.approvers.map(a => a.name).join(' › ')}</span>
                      : <span className="text-slate-500">No approvers — you are at the top of the tree</span>}
              </div>
            );
          })}
        </div>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {editing.id ? 'Edit Approval' : 'Add Approval'}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="flex items-start flex-1 min-h-0">
              <nav className="w-[190px] flex-shrink-0 py-4 border-r border-slate-100 hidden sm:block">
                {SECTIONS.map(s => (
                  <button key={s} onClick={() => setSection(s)}
                    className={`w-full text-left px-5 py-2.5 text-[14px] border-l-2 transition-colors ${
                      section === s ? 'border-blue-600 text-slate-800 font-semibold bg-slate-50' : 'border-transparent text-slate-600 hover:bg-slate-50'
                    }`}>
                    {s}
                  </button>
                ))}
              </nav>

              <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 space-y-5">
                {section === 'Approval Details' && (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Form name</label>
                      <select value={editing.requestType} disabled={!!editing.id}
                        onChange={e => setField({ requestType: e.target.value, criteria: [] })}
                        className={`${selectClass} w-full max-w-md`}>
                        {forms.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      {editing.id && <p className="text-[12.5px] text-slate-500 mt-1">The form cannot change once an approval exists.</p>}
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                        Approval name<span className="text-red-500 ml-0.5">*</span>
                      </label>
                      <input value={editing.name} onChange={e => setField({ name: e.target.value })}
                        className="w-full max-w-md border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
                      <textarea rows={3} value={editing.description || ''} onChange={e => setField({ description: e.target.value })}
                        className="w-full max-w-md border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Order</label>
                      <input type="number" min={1} max={999} value={editing.sortOrder}
                        onChange={e => setField({ sortOrder: Number(e.target.value) })}
                        className="w-[110px] border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                      <p className="text-[12.5px] text-slate-500 mt-1 max-w-md">
                        Lower runs first. Put a narrow approval above the catch-all, or it never gets a turn.
                      </p>
                    </div>
                  </>
                )}

                {section === 'Criteria' && (
                  <>
                    <p className="text-[13.5px] text-slate-600">
                      This approval runs when the conditions below are satisfied. With none, it matches every
                      request on this form.
                    </p>
                    {editing.criteria.length > 1 && (
                      <div className="flex items-center gap-3">
                        <span className="text-[13px] text-slate-600">Match</span>
                        <select value={editing.criteriaMatch} onChange={e => setField({ criteriaMatch: e.target.value })} className={selectClass}>
                          <option value="AND">all conditions</option>
                          <option value="OR">any condition</option>
                        </select>
                      </div>
                    )}
                    <div className="space-y-2.5">
                      {editing.criteria.map((c, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[12.5px] flex items-center justify-center flex-shrink-0">{i + 1}</span>
                          <select value={c.field} onChange={e => setCond(i, { field: e.target.value })} className={`${selectClass} min-w-[170px]`}>
                            {fieldsForForm.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <select value={c.operator} onChange={e => setCond(i, { operator: e.target.value })} className={`${selectClass} min-w-[150px]`}>
                            {meta.operators.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                          <input value={c.value} onChange={e => setCond(i, { value: e.target.value })} placeholder="Value"
                            className="w-[160px] border border-slate-300 rounded-md px-2.5 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                          <button onClick={() => setField({ criteria: editing.criteria.filter((_, n) => n !== i) })}
                            aria-label="Remove condition" className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setField({
                        criteria: [...editing.criteria, { field: fieldsForForm[0]?.key, operator: 'is', value: '' }],
                      })}
                      disabled={!fieldsForForm.length || editing.criteria.length >= 10}
                      className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
                    >
                      <Plus size={14} /> Add Condition
                    </button>
                  </>
                )}

                {section === 'Approvals' && (
                  <>
                    <p className="text-[13.5px] text-slate-600">
                      Configure approver levels, or let the system settle the request on submission.
                    </p>
                    <div className="flex flex-wrap items-center gap-5">
                      {[['chain', 'Configure approver'], ['auto_approve', 'Auto Approve'], ['auto_reject', 'Auto Reject']].map(([k, l]) => (
                        <label key={k} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="decision" checked={editing.decision === k}
                            onChange={() => setField({ decision: k })} className="w-4 h-4 accent-blue-600" />
                          <span className="text-[14px] text-slate-700">{l}</span>
                        </label>
                      ))}
                    </div>

                    {editing.decision === 'chain' ? (
                      <>
                        <div className="space-y-2.5">
                          {editing.levels.map((step, i) => {
                            const t = typeOf(step.kind);
                            return (
                              <div key={i} className="flex flex-wrap items-center gap-2">
                                <select value={step.kind}
                                  onChange={e => {
                                    const kind = e.target.value;
                                    const seed = kind === 'reporting_to' ? { count: 1 }
                                      : kind === 'role' ? { role: 'hr_admin' }
                                      : kind === 'department_head' || kind === 'department_members' ? { departmentId: meta.departments[0]?.id }
                                      : kind === 'user' ? { userId: '' } : {};
                                    setEditing(e2 => ({ ...e2, levels: e2.levels.map((s, n) => (n === i ? { kind, ...seed } : s)) }));
                                  }}
                                  className={`${selectClass} flex-1 min-w-[240px]`}>
                                  {meta.approverTypes.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                                </select>

                                {t?.valueType === 'levels' && (
                                  <select value={step.count} onChange={e => setStep(i, { count: Number(e.target.value) })} className={`${selectClass} w-[160px]`}>
                                    {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{LEVEL_WORDS[n]}</option>)}
                                  </select>
                                )}
                                {t?.valueType === 'role' && (
                                  <select value={step.role} onChange={e => setStep(i, { role: e.target.value })} className={`${selectClass} w-[160px]`}>
                                    {meta.roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                                  </select>
                                )}
                                {t?.valueType === 'department' && (
                                  <select value={step.departmentId || ''} onChange={e => setStep(i, { departmentId: e.target.value })} className={`${selectClass} w-[190px]`}>
                                    <option value="">Select a department</option>
                                    {meta.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                  </select>
                                )}
                                {t?.valueType === 'employee' && (
                                  <input value={step.userId || ''} onChange={e => setStep(i, { userId: e.target.value })}
                                    placeholder="Employee id"
                                    className="w-[220px] border border-slate-300 rounded-md px-2.5 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                                )}

                                <button onClick={() => setField({ levels: editing.levels.filter((_, n) => n !== i) })}
                                  disabled={editing.levels.length === 1} aria-label="Remove level"
                                  className="text-slate-400 hover:text-red-500 disabled:opacity-30 p-1.5"><Trash2 size={15} /></button>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          onClick={() => setField({ levels: [...editing.levels, { kind: 'role', role: 'hr_admin' }] })}
                          disabled={editing.levels.length >= 6}
                          className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
                        >
                          <Plus size={14} /> Add Approver Level
                        </button>

                        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-1.5">
                          {editing.levels.map((step, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <span className="text-slate-400">›</span>}
                              <span className="bg-white border border-slate-200 rounded px-2.5 py-1 text-[13px]">{describeStep(step)}</span>
                            </React.Fragment>
                          ))}
                        </div>

                        {editing.levels.some(s => s.kind === 'role') && (
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input type="checkbox"
                              checked={editing.levels.some(s => s.kind === 'role' && s.skipWhenManagerIsBuHead)}
                              onChange={e => setField({
                                levels: editing.levels.map(s => (s.kind === 'role' ? { ...s, skipWhenManagerIsBuHead: e.target.checked } : s)),
                              })}
                              className="w-4 h-4 accent-blue-600 mt-0.5" />
                            <span>
                              <span className="block text-[14px] text-slate-700">Skip the role level when the manager is a Business Unit Head</span>
                              <span className="block text-[13px] text-slate-500 mt-0.5">
                                The rule the chain has always applied: someone reporting straight to the BU Head does not also go to HR.
                              </span>
                            </span>
                          </label>
                        )}
                      </>
                    ) : (
                      <Note>
                        The request is settled on submission and nobody is asked. No approver levels apply.
                      </Note>
                    )}

                    <div className="pt-1">
                      <Toggle checked={editing.followUp} onChange={v => setField({ followUp: v })}
                        label="Enable follow-up option for this approval"
                        hint="Saved; the reminder to a waiting approver is not sent yet" />
                    </div>
                  </>
                )}

                {section === 'Messages' && (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">From<span className="text-red-500 ml-0.5">*</span></label>
                      <select value={editing.messages.from} onChange={e => setMsg({ from: e.target.value })} className={`${selectClass} w-full max-w-md`}>
                        <option value="default_address">Default from address</option>
                        <option value="performer">Person performing this action</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">To<span className="text-red-500 ml-0.5">*</span></label>
                      <div className="flex flex-wrap gap-1.5">
                        {RECIPIENTS.map(r => {
                          const on = (editing.messages.to || []).includes(r.key);
                          return (
                            <button key={r.key} type="button"
                              onClick={() => setMsg({
                                to: on ? editing.messages.to.filter(x => x !== r.key) : [...(editing.messages.to || []), r.key],
                              })}
                              className={`text-[13px] rounded-full px-3 py-1 border transition-colors ${
                                on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                              }`}>
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Subject<span className="text-red-500 ml-0.5">*</span></label>
                      <input value={editing.messages.subject} onChange={e => setMsg({ subject: e.target.value })}
                        className="w-full max-w-md border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                    </div>

                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Body</label>
                      <select value={editing.messages.templateName || ''} onChange={e => setMsg({ templateName: e.target.value || null })}
                        className={`${selectClass} w-full max-w-md`}>
                        <option value="">Default wording</option>
                        {(meta.templates || []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                      <p className="text-[12.5px] text-slate-500 mt-1 max-w-md">
                        Templates are edited under Automation → Email Templates, so one change reaches every
                        approval that uses it.
                      </p>
                    </div>

                    <div className="pt-1 space-y-2.5">
                      <p className="text-[13px] font-medium text-slate-700">Also tell the requester when it is</p>
                      {[['onApproved', 'Approved'], ['onRejected', 'Rejected']].map(([k, l]) => (
                        <label key={k} className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" checked={editing.messages[k]?.enabled !== false}
                            onChange={e => setMsg({ [k]: { ...editing.messages[k], enabled: e.target.checked } })}
                            className="w-4 h-4 accent-blue-600" />
                          <span className="text-[14px] text-slate-700">{l}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={save} disabled={busy || !String(editing.name || '').trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
                {busy ? 'Saving…' : editing.id ? 'Save' : 'Add'}
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
