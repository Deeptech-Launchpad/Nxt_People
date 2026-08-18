import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Search, Copy } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Toggle, selectClass, Spinner } from '../configKit';
import ApprovalEditor from './ApprovalEditor';
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
  // Nothing configured yet, so the Approvals card opens on its Configure
  // Approver / Auto Approve / Auto Reject choice the way the reference does.
  //
  // The reference pre-selects Auto Approve there. This does not: an approval
  // saved by accident with no criteria becomes its form's catch-all, and one
  // that silently approves everything is a worse default than one that refuses
  // to save until a decision is made.
  levels: [],
  criteria: [],
  criteriaMatch: 'AND',
  followUp: { enabled: false, mode: 'one_time', days: 1, time: '10:00' },
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

// `service` scopes this to one module's forms, which is what the Attendance and
// Leave Tracker settings pass. Manage Accounts passes nothing and gets every
// form in one list, the way the reference's account-level tab does.
export default function ApprovalRules({ service = null }) {
  const [rules, setRules] = useState(null);
  const [meta, setMeta] = useState(null);
  const [preview, setPreview] = useState({});
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formFilter, setFormFilter] = useState('all');
  const [search, setSearch] = useState('');

  const forms = useMemo(
    () => (meta?.forms || []).filter(f => !service || f.service === service),
    [meta, service]
  );

  const load = useCallback(() => {
    api.get(service ? `/approval-rules?service=${service}` : '/approval-rules')
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

  // PATCH, not a full PUT: flipping a switch should not re-validate and
  // re-save every level, criterion and message on the rule.
  const toggleActive = rule => {
    api.patch(`/approval-rules/${rule.id}/status`, { isActive: !rule.isActive })
      .then(() => { toast.success(`${rule.name} ${rule.isActive ? 'switched off' : 'switched on'}`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  const duplicate = rule => {
    api.post(`/approval-rules/${rule.id}/duplicate`)
      .then(() => { toast.success('Copied, switched off'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not duplicate'));
  };

  if (rules === null || !meta) return <Spinner />;

  // A form can carry several approvals, so filtering by form is how an admin
  // finds the one they mean rather than reading every row.
  const visible = rules.filter(r =>
    (formFilter === 'all' || r.requestType === formFilter) &&
    (!search.trim() || `${r.name} ${r.formLabel}`.toLowerCase().includes(search.trim().toLowerCase()))
  );

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
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search approvals"
                className="w-[190px] border border-slate-300 rounded pl-8 pr-3 py-1.5 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => setEditing(blankRule(forms[0]?.key))}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded text-[13.5px] font-medium"
            >
              <Plus size={15} /> Add Approval
            </button>
          </div>
        }
      >
        <Note>
          Several approvals can share a form. The one that runs is the first switched-on approval whose
          criteria match the request, in order — so an approval with no criteria acts as the catch-all.
          A change applies to requests filed afterwards.
        </Note>

        <div className="mt-5 flex items-center gap-2.5">
          <span className="text-[13.5px] text-slate-600">Form</span>
          <select value={formFilter} onChange={e => setFormFilter(e.target.value)} className={`${selectClass} min-w-[220px]`}>
            <option value="all">All</option>
            {forms.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                {['Approval name', 'Form name', 'Template name', 'Chain', 'Follow-up', 'Order', 'Status', ''].map(h => (
                  <th key={h} className="text-left font-medium text-slate-600 px-4 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(rule => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{rule.name}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{rule.formLabel}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {rule.messages?.templateName || <span className="text-slate-400">Default wording</span>}
                  </td>
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
                  <td className="px-4 py-3 text-slate-600">
                    {rule.followUp?.enabled
                      ? <span className="text-[13px] text-slate-600">
                          {rule.followUp.mode === 'repeat' ? 'Every' : 'After'} {rule.followUp.days}d
                          <span className="text-slate-400"> at {rule.followUp.time}</span>
                        </span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{rule.sortOrder}</td>
                  <td className="px-4 py-3"><Toggle checked={rule.isActive} onChange={() => toggleActive(rule)} label="" /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing({ ...rule })}
                      className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                    <button onClick={() => duplicate(rule)} aria-label={`Duplicate ${rule.name}`} title="Duplicate"
                      className="ml-2 text-slate-400 hover:text-blue-600 p-1 align-middle"><Copy size={15} /></button>
                    <button onClick={() => remove(rule)} aria-label={`Delete ${rule.name}`}
                      className="ml-1 text-slate-400 hover:text-red-500 p-1 align-middle"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="text-[14px] text-slate-500 text-center py-8">
              No approval matches that form or search.
            </p>
          )}
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
        <ApprovalEditor
          value={editing}
          meta={meta}
          forms={forms}
          busy={busy}
          onChange={setEditing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
