import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { Toggle, selectClass } from '../configKit';
import { roleLabel } from '../../../utils/roles';

// Add / Edit Approval.
//
// One scrolling page with the four sections stacked as cards, not a tab
// switcher. The left rail is a scroll-spy: clicking scrolls to a section, and
// scrolling moves the marker. That matters because the sections read as one
// form — the criteria decide when the approvers below them apply — and a tab
// switcher hides that relationship behind a click.
//
// Criteria and Approvals open on a button rather than a filled-in row, so an
// approval that simply routes everything up the reporting line does not present
// a condition builder nobody asked for.

const EXTRA_FIELDS = [['cc', 'Cc'], ['bcc', 'Bcc'], ['replyTo', 'Reply To']];

const LEVEL_WORDS = ['', 'Single Level', 'Two Levels', 'Three Levels', 'Four Levels', 'Five Levels', 'Six Levels'];

const RECIPIENTS = [
  { key: 'current_approver', label: 'Current Approver' },
  { key: 'requester', label: 'Person performing this action' },
  { key: 'reporting_manager', label: 'Reporting manager' },
];

// What the toggle falls back to for a rule saved before follow-up had a shape.
const FOLLOW_UP_DEFAULT = { enabled: false, mode: 'one_time', days: 1, time: '10:00' };

const SECTIONS = [
  { key: 'details', label: 'Approval Details' },
  { key: 'criteria', label: 'Criteria' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'messages', label: 'Messages' },
];

function Section({ id, title, subtitle, children, refs }) {
  return (
    <section ref={el => { refs.current[id] = el; }} className="bg-white border border-slate-200 rounded-xl">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-[13.5px] text-slate-500 mt-1">{subtitle}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

export default function ApprovalEditor({ value, meta, forms, busy, onChange, onSave, onClose }) {
  const [active, setActive] = useState('details');
  // Which of Cc / Bcc / Reply-To have been revealed on this visit. An
  // address already saved keeps its box shown without needing this.
  const [extra, setExtra] = useState({});
  const scrollRef = useRef(null);
  const refs = useRef({});

  // The marker follows the scroll rather than only the click, so it still tells
  // the truth when someone scrolls past a section by hand.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const onScroll = () => {
      const top = container.getBoundingClientRect().top;
      let current = SECTIONS[0].key;
      for (const s of SECTIONS) {
        const el = refs.current[s.key];
        // 24px of slack, so a section counts as reached just before its heading
        // touches the top edge.
        if (el && el.getBoundingClientRect().top - top <= 24) current = s.key;
      }
      setActive(current);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = key => {
    const el = refs.current[key];
    const container = scrollRef.current;
    if (!el || !container) return;
    container.scrollTo({ top: el.offsetTop - container.offsetTop - 8, behavior: 'smooth' });
  };

  const set = changes => onChange({ ...value, ...changes });
  const setStep = (i, changes) =>
    set({ levels: value.levels.map((s, n) => (n === i ? { ...s, ...changes } : s)) });
  const setCond = (i, changes) =>
    set({ criteria: value.criteria.map((c, n) => (n === i ? { ...c, ...changes } : c)) });
  const setMsg = changes => set({ messages: { ...value.messages, ...changes } });

  const fields = meta.criteriaFields?.[value.requestType] || [];
  const typeOf = kind => meta.approverTypes.find(t => t.key === kind);
  const departmentName = id => meta.departments.find(d => d.id === id)?.name;

  const describeStep = step => {
    if (step.kind === 'reporting_to') return `${step.count} Level(s) of Reporting To`;
    if (step.kind === 'role') return roleLabel(step.role);
    if (step.kind === 'department_head_of_owner') return "Requester's department head";
    if (step.kind === 'department_head') return `Head of ${departmentName(step.departmentId) || 'department'}`;
    if (step.kind === 'department_members') return `${departmentName(step.departmentId) || 'Department'} members`;
    return 'A specific person';
  };

  // The chosen template's wording, shown as it will read. Read-only here: the
  // template is edited under Automation, so one change reaches every approval
  // that uses it rather than drifting per approval.
  const body = useMemo(
    () => (meta.templates || []).find(t => t.name === value.messages.templateName)?.body || '',
    [meta.templates, value.messages.templateName]
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-100 flex flex-col">
      <div className="bg-white border-b border-slate-200 flex items-center justify-between px-5 py-3.5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} aria-label="Back"
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600">
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-[17px] font-semibold text-slate-900">
            {value.id ? 'Edit Approval' : 'Add Approval'}
          </h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
      </div>

      <div className="flex items-start flex-1 min-h-0">
        <nav className="w-[210px] flex-shrink-0 py-5 hidden md:block">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => goTo(s.key)}
              className={`w-full text-left px-6 py-2.5 text-[14px] border-l-2 transition-colors ${
                active === s.key ? 'border-blue-600 text-slate-900 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}>
              {s.label}
            </button>
          ))}
        </nav>

        <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto h-full px-4 sm:px-6 py-5">
          <div className="max-w-3xl mx-auto space-y-4 pb-10">

            <Section id="details" refs={refs} title="Approval Details" subtitle="Basic details of the approval.">
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Form name</label>
                  <select value={value.requestType} disabled={!!value.id}
                    onChange={e => set({ requestType: e.target.value, criteria: [] })}
                    className={`${selectClass} w-full disabled:bg-slate-100`}>
                    {forms.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  {value.id && <p className="text-[12.5px] text-slate-500 mt-1">The form cannot change once an approval exists.</p>}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                    Approval name<span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <input value={value.name} onChange={e => set({ name: e.target.value })} className={input} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
                  <textarea rows={3} value={value.description || ''} onChange={e => set({ description: e.target.value })} className={input} />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Order</label>
                  <input type="number" min={1} max={999} value={value.sortOrder}
                    onChange={e => set({ sortOrder: Number(e.target.value) })}
                    className={`${input} w-[120px]`} />
                  <p className="text-[12.5px] text-slate-500 mt-1">
                    Lower runs first. Put a narrow approval above the catch-all, or it never gets a turn.
                  </p>
                </div>
              </div>
            </Section>

            <Section id="criteria" refs={refs} title="Criteria"
              subtitle="The approval will be applied when the following criteria requirements are satisfied.">
              {value.criteria.length === 0 ? (
                <div className="text-center py-3">
                  <button
                    onClick={() => set({ criteria: [{ field: fields[0]?.key, operator: 'is', value: '' }] })}
                    disabled={!fields.length}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded text-[14px] font-medium"
                  >
                    Set Criteria
                  </button>
                  <p className="text-[13px] text-slate-500 mt-3">
                    With none, this approval matches every request on the form.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {value.criteria.length > 1 && (
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-slate-600">Match</span>
                      <select value={value.criteriaMatch} onChange={e => set({ criteriaMatch: e.target.value })} className={selectClass}>
                        <option value="AND">all conditions</option>
                        <option value="OR">any condition</option>
                      </select>
                    </div>
                  )}
                  {value.criteria.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[12.5px] flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      <select value={c.field} onChange={e => setCond(i, { field: e.target.value })} className={`${selectClass} min-w-[170px]`}>
                        {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <select value={c.operator} onChange={e => setCond(i, { operator: e.target.value })} className={`${selectClass} min-w-[150px]`}>
                        {meta.operators.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      <input value={c.value} onChange={e => setCond(i, { value: e.target.value })} placeholder="Value"
                        className="w-[150px] border border-slate-300 rounded-md px-2.5 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                      <button onClick={() => set({ criteria: value.criteria.filter((_, n) => n !== i) })}
                        aria-label="Remove condition" className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                    </div>
                  ))}
                  <button
                    onClick={() => set({ criteria: [...value.criteria, { field: fields[0]?.key, operator: 'is', value: '' }] })}
                    disabled={value.criteria.length >= 10}
                    className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
                  >
                    <Plus size={14} /> Add Condition
                  </button>
                </div>
              )}
            </Section>

            <Section id="approvals" refs={refs} title="Approvals"
              subtitle="You can either configure approver levels or allow the system to auto approve / reject the record.">
              {value.decision === 'chain' && value.levels.length === 0 ? (
                <div className="text-center py-3">
                  <button
                    onClick={() => set({ levels: [{ kind: 'reporting_to', count: 1 }] })}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium"
                  >
                    Configure Approver
                  </button>
                  <p className="text-[13px] text-slate-500 my-3">(OR)</p>
                  <div className="flex items-center justify-center gap-6">
                    {[['auto_approve', 'Auto Approve'], ['auto_reject', 'Auto Reject']].map(([k, l]) => (
                      <label key={k} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="decision" checked={value.decision === k}
                          onChange={() => set({ decision: k, levels: [] })} className="w-4 h-4 accent-blue-600" />
                        <span className="text-[14px] text-slate-700">{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : value.decision !== 'chain' ? (
                <div className="text-center py-3">
                  <button
                    onClick={() => set({ decision: 'chain', levels: [{ kind: 'reporting_to', count: 1 }] })}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-[14px] font-medium"
                  >
                    Configure Approver
                  </button>
                  <p className="text-[13px] text-slate-500 my-3">(OR)</p>
                  <div className="flex items-center justify-center gap-6">
                    {[['auto_approve', 'Auto Approve'], ['auto_reject', 'Auto Reject']].map(([k, l]) => (
                      <label key={k} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="decision" checked={value.decision === k}
                          onChange={() => set({ decision: k, levels: [] })} className="w-4 h-4 accent-blue-600" />
                        <span className="text-[14px] text-slate-700">{l}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[13px] text-slate-500 mt-4 max-w-md mx-auto">
                    The request is settled on submission and nobody is asked to approve it.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {value.levels.map((step, i) => {
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
                            set({ levels: value.levels.map((s, n) => (n === i ? { kind, ...seed } : s)) });
                          }}
                          className={`${selectClass} flex-1 min-w-[250px]`}>
                          {meta.approverTypes.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>

                        {t?.valueType === 'levels' && (
                          <select value={step.count} onChange={e => setStep(i, { count: Number(e.target.value) })} className={`${selectClass} w-[170px]`}>
                            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{LEVEL_WORDS[n]}</option>)}
                          </select>
                        )}
                        {t?.valueType === 'role' && (
                          <select value={step.role} onChange={e => setStep(i, { role: e.target.value })} className={`${selectClass} w-[170px]`}>
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

                        <button onClick={() => set({ levels: value.levels.filter((_, n) => n !== i) })}
                          aria-label="Remove level" className="text-slate-400 hover:text-red-500 p-1.5"><Trash2 size={15} /></button>
                      </div>
                    );
                  })}

                  <button
                    onClick={() => set({ levels: [...value.levels, { kind: 'role', role: 'hr_admin' }] })}
                    disabled={value.levels.length >= 6}
                    className="flex items-center gap-1.5 text-[13.5px] text-blue-600 hover:text-blue-500 disabled:text-slate-400 bg-blue-50 disabled:bg-slate-100 rounded px-3 py-1.5"
                  >
                    <Plus size={14} /> Add Approver Level
                  </button>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5 flex flex-wrap items-center gap-2">
                    {value.levels.map((step, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="text-slate-400">›</span>}
                        <span className="bg-white border border-slate-200 rounded px-3 py-1.5 text-[13px]">{describeStep(step)}</span>
                      </React.Fragment>
                    ))}
                  </div>

                  {value.levels.some(s => s.kind === 'role') && (
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input type="checkbox"
                        checked={value.levels.some(s => s.kind === 'role' && s.skipWhenManagerIsBuHead)}
                        onChange={e => set({
                          levels: value.levels.map(s => (s.kind === 'role' ? { ...s, skipWhenManagerIsBuHead: e.target.checked } : s)),
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

                  {/* The reference's follow-up block. This was a boolean that
                      nothing read; it is a schedule now, and the sweep that
                      reads it runs every 15 minutes. */}
                  <div className="pt-1 space-y-3">
                    <Toggle
                      checked={!!value.followUp?.enabled}
                      onChange={v => set({ followUp: { ...FOLLOW_UP_DEFAULT, ...value.followUp, enabled: v } })}
                      label="Enable follow-up option for this approval"
                      hint="Chases the approver who has not acted yet."
                    />

                    {value.followUp?.enabled && (
                      <div className="bg-slate-50 rounded-lg px-4 py-3.5 space-y-3">
                        <div className="flex items-center gap-5">
                          {[['one_time', 'One-time'], ['repeat', 'Repeat']].map(([k, l]) => (
                            <label key={k} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio" name="followUpMode"
                                checked={(value.followUp.mode || 'one_time') === k}
                                onChange={() => set({ followUp: { ...value.followUp, mode: k } })}
                                className="w-4 h-4 accent-blue-600" />
                              <span className="text-[14px] text-slate-700">{l}</span>
                            </label>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-[14px] text-slate-700">
                          <span>
                            {(value.followUp.mode || 'one_time') === 'repeat' ? 'Repeat every' : 'One-time follow-up after'}
                          </span>
                          <input
                            type="number" min={1} max={365}
                            value={value.followUp.days ?? 1}
                            onChange={e => set({ followUp: { ...value.followUp, days: Number(e.target.value) } })}
                            className="w-20 border border-slate-300 rounded px-2 py-1.5 text-[14px]" />
                          <span>day(s) from the approval trigger date.</span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-[14px] text-slate-700">
                          <span>Follow-up email sent at</span>
                          <input
                            type="time"
                            value={value.followUp.time || '10:00'}
                            onChange={e => set({ followUp: { ...value.followUp, time: e.target.value } })}
                            className="border border-slate-300 rounded px-2 py-1.5 text-[14px]" />
                        </div>

                        <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                          Only approvers who have not acted are chased, and each reminder is recorded — a
                          sweep that overlaps the one before it cannot chase the same person twice.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Section>

            <Section id="messages" refs={refs} title="Messages"
              subtitle="The email that tells an approver a request is waiting.">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <label className="block text-[13px] font-medium text-slate-700">From<span className="text-red-500 ml-0.5">*</span></label>
                    {/* Revealed rather than always shown: three empty address
                        boxes on every approval read as required fields. */}
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="text-slate-500">Add:</span>
                      {EXTRA_FIELDS.map(([k, l]) => (
                        <button key={k} onClick={() => setExtra(x => ({ ...x, [k]: true }))}
                          disabled={extra[k] || (value.messages[k] || []).length > 0}
                          className="text-blue-600 hover:text-blue-500 disabled:text-slate-300 disabled:cursor-default">
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <select value={value.messages.from} onChange={e => setMsg({ from: e.target.value })} className={`${selectClass} w-full`}>
                    <option value="default_address">Default from address</option>
                    <option value="performer">Person performing this action</option>
                  </select>
                </div>

                {EXTRA_FIELDS.filter(([k]) => extra[k] || (value.messages[k] || []).length > 0).map(([k, l]) => (
                  <div key={k}>
                    <label className="block text-[13px] font-medium text-slate-700 mb-1.5">{l}</label>
                    <input
                      value={(value.messages[k] || []).join(', ')}
                      placeholder={k === 'replyTo' ? 'one address' : 'comma separated'}
                      onChange={e => setMsg({
                        [k]: e.target.value.split(',').map(x => x.trim()).filter(Boolean),
                      })}
                      className={input}
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">To<span className="text-red-500 ml-0.5">*</span></label>
                  <div className="border border-slate-300 rounded-md px-3 py-2.5">
                    <p className="text-[12px] text-slate-500 mb-2">System options</p>
                    <div className="flex flex-wrap gap-1.5">
                      {RECIPIENTS.map(r => {
                        const on = (value.messages.to || []).includes(r.key);
                        return on ? (
                          <span key={r.key} className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded px-2.5 py-1 text-[13px] text-slate-700">
                            {r.label}
                            <button onClick={() => setMsg({ to: value.messages.to.filter(x => x !== r.key) })}
                              aria-label={`Remove ${r.label}`} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                          </span>
                        ) : (
                          <button key={r.key} onClick={() => setMsg({ to: [...(value.messages.to || []), r.key] })}
                            className="inline-flex items-center gap-1 border border-dashed border-slate-300 rounded px-2.5 py-1 text-[13px] text-slate-500 hover:border-blue-400 hover:text-blue-600">
                            <Plus size={12} /> {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Subject<span className="text-red-500 ml-0.5">*</span></label>
                  <input value={value.messages.subject} onChange={e => setMsg({ subject: e.target.value })} className={input} />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Body</label>
                  <select value={value.messages.templateName || ''} onChange={e => setMsg({ templateName: e.target.value || null })}
                    className={`${selectClass} w-full`}>
                    <option value="">Default wording</option>
                    {(meta.templates || []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>

                  <div className="mt-2.5 border border-slate-200 rounded-md bg-slate-50 px-4 py-3 min-h-[110px]">
                    {body ? (
                      <pre className="text-[13px] text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
                    ) : (
                      <p className="text-[13px] text-slate-500">
                        The built-in approval email is used. Choose a template above to replace its wording.
                      </p>
                    )}
                  </div>
                  <p className="text-[12.5px] text-slate-500 mt-1.5">
                    Templates are edited under Automation → Email Templates, so one change reaches every
                    approval that uses it.
                  </p>
                </div>

                <div className="pt-1 space-y-2.5">
                  <p className="text-[13px] font-medium text-slate-700">Also tell the requester when it is</p>
                  {[['onApproved', 'Approved'], ['onRejected', 'Rejected']].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={value.messages[k]?.enabled !== false}
                        onChange={e => setMsg({ [k]: { ...value.messages[k], enabled: e.target.checked } })}
                        className="w-4 h-4 accent-blue-600" />
                      <span className="text-[14px] text-slate-700">{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-slate-200 px-5 py-3.5 flex items-center gap-3 flex-shrink-0">
        <button onClick={onSave} disabled={busy || !String(value.name || '').trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-6 py-2 rounded text-[14px] font-medium">
          {busy ? 'Saving…' : value.id ? 'Save' : 'Add'}
        </button>
        <button onClick={onClose}
          className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-6 py-2 rounded text-[14px] font-medium">
          Cancel
        </button>
      </div>
    </div>
  );
}
