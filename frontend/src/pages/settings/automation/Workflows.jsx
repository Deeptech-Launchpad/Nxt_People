import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Copy, ArrowLeft, X } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import { useCatalog, useScopedList, FormFilter, Field, input, select } from './kit';

// Workflows — the reference's centrepiece: a trigger, optional criteria, and
// the actions that follow.
//
// The editor is one scrolling page with a step rail down the left, as the
// reference has it, rather than a wizard: every section is visible at once and
// the rail scrolls to it.

const STEPS = [
  { key: 'basic', label: 'Basic Details' },
  { key: 'trigger', label: 'Trigger Events' },
  { key: 'criteria', label: 'Criteria' },
  { key: 'actions', label: 'Actions' },
];

const blank = recordTypes => ({
  recordType: recordTypes[0]?.key || '',
  name: '', description: '', isActive: true,
  triggerKind: 'action', triggerEvent: 'created', triggerField: '',
  dateField: '', dateDirection: 'on', dateMonths: 0, dateDays: 0,
  executeAt: '09:00', occurrence: 'one_time',
  criteria: [], actions: [],
});

function Editor({ catalog, initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(initial);
  const [alerts, setAlerts] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [busy, setBusy] = useState(false);

  const type = catalog.recordTypes.find(t => t.key === draft.recordType) || catalog.recordTypes[0];
  const set = patch => setDraft(d => ({ ...d, ...patch }));

  // The actions on offer are the ones for this record type. Changing the form
  // must not leave an action from the previous one selected.
  useEffect(() => {
    if (!type) return;
    api.get(`/workflows/alerts?recordType=${type.key}`).then(r => setAlerts(r.data.data || [])).catch(() => setAlerts([]));
    api.get(`/workflows/field-updates?recordType=${type.key}`).then(r => setUpdates(r.data.data || [])).catch(() => setUpdates([]));
  }, [type?.key]);

  const scrollTo = key => document.getElementById(`wf-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const save = () => {
    setBusy(true);
    const call = draft.id
      ? api.put(`/workflows/workflows/${draft.id}`, draft)
      : api.post('/workflows/workflows', draft);
    call
      .then(() => { toast.success(`Workflow ${draft.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const addAction = (kind, refId) => {
    if (!refId || draft.actions.some(a => a.kind === kind && a.refId === refId)) return;
    set({ actions: [...draft.actions, { kind, refId }] });
  };
  const nameOf = a => (a.kind === 'email_alert' ? alerts : updates).find(x => x.id === a.refId)?.name || a.name || 'Removed';

  if (!type) return null;
  const canWatchFields = type.watchableFields.length > 0;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-100 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <button onClick={onClose} aria-label="Back" className="text-slate-400 hover:text-slate-700"><ArrowLeft size={18} /></button>
        <p className="text-[16px] font-semibold text-slate-800">{draft.id ? 'Edit Workflow' : 'Add Workflow'}</p>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>

      <div className="flex items-start gap-6 px-6 py-6 max-w-6xl mx-auto">
        <nav className="w-[170px] flex-shrink-0 hidden md:block sticky top-20">
          {STEPS.map(s => (
            <button key={s.key} onClick={() => scrollTo(s.key)}
              className="block w-full text-left px-3 py-2 text-[14px] text-slate-600 hover:text-slate-900 border-l-2 border-transparent hover:border-blue-500">
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 space-y-5">
          {/* ── Basic Details ─────────────────────────────────────────── */}
          <section id="wf-basic" className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <h3 className="text-[15px] font-semibold text-slate-800">Basic Details</h3>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-4">Basic details of the workflow.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Form name" required>
                <select
                  value={draft.recordType}
                  // Locked on edit, as the reference locks it: the criteria,
                  // trigger field and actions all belong to this form.
                  disabled={!!draft.id}
                  onChange={e => set({ recordType: e.target.value, criteria: [], actions: [], triggerField: '', dateField: '' })}
                  className={`${select} ${draft.id ? 'bg-slate-100 text-slate-500' : ''}`}
                >
                  {catalog.recordTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Workflow name" required>
                <input value={draft.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
              </Field>
              <Field label="Description" wide>
                <textarea rows={3} value={draft.description || ''} maxLength={500}
                  onChange={e => set({ description: e.target.value })} className={input} />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
              <input type="checkbox" checked={draft.isActive}
                onChange={e => set({ isActive: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30" />
              <span className="text-[14px] text-slate-700">Status</span>
            </label>
          </section>

          {/* ── Trigger Events ────────────────────────────────────────── */}
          <section id="wf-trigger" className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <h3 className="text-[15px] font-semibold text-slate-800">Trigger Events</h3>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
              Select an action or date based event that will cause the workflow to be executed.
            </p>

            <div className="flex gap-6 border-b border-slate-200 mb-4">
              {[['action', 'Action based events'], ['date', 'Date based events']].map(([k, l]) => (
                <button key={k} onClick={() => set({ triggerKind: k })}
                  className={`pb-2 text-[14px] border-b-2 -mb-px ${
                    draft.triggerKind === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500'
                  }`}>
                  {l}
                </button>
              ))}
            </div>

            {draft.triggerKind === 'action' ? (
              <div className="space-y-2.5">
                {catalog.actionEvents.map(e => {
                  // Only Employee reports which columns changed, so only it can
                  // honestly offer this. Hidden rather than shown-and-refused.
                  const unavailable = e.key === 'field_updated' && !canWatchFields;
                  return (
                    <div key={e.key}>
                      <label className={`flex items-center gap-2.5 ${unavailable ? 'opacity-40' : 'cursor-pointer'}`}>
                        <input type="radio" name="trigger" disabled={unavailable}
                          checked={draft.triggerEvent === e.key}
                          onChange={() => set({ triggerEvent: e.key })}
                          className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-blue-500/30" />
                        <span className="text-[14px] text-slate-700">{e.label}</span>
                        {unavailable && (
                          <span className="text-[12.5px] text-slate-500">
                            — {type.label} does not report which field changed
                          </span>
                        )}
                      </label>
                      {e.key === 'field_updated' && draft.triggerEvent === 'field_updated' && canWatchFields && (
                        <div className="ml-7 mt-2 max-w-xs">
                          <select value={draft.triggerField} onChange={ev => set({ triggerField: ev.target.value })} className={select}>
                            <option value="">Select a field</option>
                            {type.watchableFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
                <Field label="Event date field" required wide>
                  <select value={draft.dateField} onChange={e => set({ dateField: e.target.value })} className={`${select} max-w-sm`}>
                    <option value="">-select-</option>
                    {type.dateFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </Field>
                <Field label="Date of execution" wide>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={draft.dateDirection} onChange={e => set({ dateDirection: e.target.value })} className={`${select} max-w-[200px]`}>
                      {catalog.directions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                    {draft.dateDirection !== 'on' && (
                      <>
                        <input type="number" min={0} max={120} value={draft.dateMonths}
                          onChange={e => set({ dateMonths: Number(e.target.value) })} className={`${input} w-20`} />
                        <span className="text-[13.5px] text-slate-600">Months</span>
                        <input type="number" min={0} max={365} value={draft.dateDays}
                          onChange={e => set({ dateDays: Number(e.target.value) })} className={`${input} w-20`} />
                        <span className="text-[13.5px] text-slate-600">Days</span>
                      </>
                    )}
                  </div>
                </Field>
                <Field label="Time of execution">
                  <input type="time" value={draft.executeAt} onChange={e => set({ executeAt: e.target.value })} className={input} />
                </Field>
                <Field label="Execution occurrence">
                  <select value={draft.occurrence} onChange={e => set({ occurrence: e.target.value })} className={select}>
                    {catalog.occurrences.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Applicable time zone" wide
                  hint="Fixed. Attendance, payroll and every scheduler in this application assume this zone.">
                  <input readOnly value="(GMT+05:30) India Standard Time (Asia/Kolkata)"
                    className={`${input} bg-slate-100 text-slate-500 max-w-md`} />
                </Field>
                <p className="md:col-span-2 text-[12.5px] text-slate-500">
                  Checked every 15 minutes, so a workflow due at 09:07 runs in the 09:15 sweep.
                </p>
              </div>
            )}
          </section>

          {/* ── Criteria ──────────────────────────────────────────────── */}
          <section id="wf-criteria" className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <h3 className="text-[15px] font-semibold text-slate-800">Criteria</h3>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
              The workflow will be triggered when the following criteria requirements are satisfied.
              With none, it runs for every record.
            </p>
            <div className="space-y-2.5">
              {draft.criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-[12.5px] grid place-items-center flex-shrink-0">{i + 1}</span>
                  <select value={c.field}
                    onChange={e => set({ criteria: draft.criteria.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}
                    className={`${select} max-w-[220px]`}>
                    <option value="">-select-</option>
                    {type.criteria.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <select value={c.operator}
                    onChange={e => set({ criteria: draft.criteria.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)) })}
                    className={`${select} max-w-[200px]`}>
                    {catalog.operators.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <input value={c.value}
                    onChange={e => set({ criteria: draft.criteria.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    className={`${input} max-w-[220px]`} />
                  <button onClick={() => set({ criteria: draft.criteria.filter((_, j) => j !== i) })}
                    aria-label="Remove condition" className="text-slate-400 hover:text-red-500 p-1.5">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => set({ criteria: [...draft.criteria, { field: type.criteria[0]?.key || '', operator: 'is', value: '' }] })}
              className="text-[13.5px] text-blue-600 hover:underline mt-3">
              Add Condition
            </button>
          </section>

          {/* ── Actions ───────────────────────────────────────────────── */}
          <section id="wf-actions" className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <h3 className="text-[15px] font-semibold text-slate-800">Actions</h3>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
              Select one or more processes to be automatically triggered when a certain action is performed.
            </p>

            {[['email_alert', 'Email Alerts', alerts], ['field_update', 'Field Updates', updates]].map(([kind, label, options]) => (
              <div key={kind} className="bg-slate-50 rounded-lg px-4 py-3 mb-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[14px] text-slate-700 flex-1 min-w-[140px]">{label}</span>
                  <select
                    value="" onChange={e => addAction(kind, e.target.value)}
                    className={`${select} max-w-xs`}
                  >
                    <option value="">
                      {options.length ? `Add an existing ${label.toLowerCase().replace(/s$/, '')}` : `No ${label.toLowerCase()} for ${type.label}`}
                    </option>
                    {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="mt-2 space-y-1.5">
                  {draft.actions.filter(a => a.kind === kind).map(a => (
                    <div key={a.refId} className="flex items-center gap-2 bg-white border border-slate-200 rounded px-3 py-2">
                      <span className="text-[13.5px] text-slate-700 flex-1">{nameOf(a)}</span>
                      <button onClick={() => set({ actions: draft.actions.filter(x => !(x.kind === a.kind && x.refId === a.refId)) })}
                        aria-label="Remove action" className="text-slate-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {draft.actions.length === 0 && (
              <p className="text-[12.5px] text-amber-700">
                A workflow with no actions fires and does nothing. Add at least one.
              </p>
            )}
          </section>
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-3">
        <button onClick={save} disabled={busy || !draft.name.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
          {busy ? 'Saving…' : draft.id ? 'Save' : 'Add'}
        </button>
        <button onClick={onClose}
          className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Workflows() {
  const catalog = useCatalog();
  const { scope, setScope, rows, reload } = useScopedList('/workflows/workflows');
  const [editing, setEditing] = useState(null);

  const labelOf = useCallback(key => catalog?.recordTypes.find(t => t.key === key)?.label || key, [catalog]);

  const executedOn = useMemo(() => w => {
    if (!catalog) return '';
    if (w.triggerKind === 'date') return 'Date';
    const e = catalog.actionEvents.find(a => a.key === w.triggerEvent);
    // The reference's column is a short word, not the whole sentence.
    return ({
      created: 'Create', edited: 'Edit', deleted: 'Delete', approved: 'Approve',
      rejected: 'Reject', created_or_edited: 'Create or Edit',
      field_updated: 'Field Updates', cancelled: 'Cancel',
    })[w.triggerEvent] || e?.label || w.triggerEvent;
  }, [catalog]);

  if (!catalog || rows === null) return <Spinner />;

  const toggle = w => {
    api.patch(`/workflows/workflows/${w.id}/status`, { isActive: !w.isActive })
      .then(() => reload())
      .catch(err => toast.error(err.response?.data?.message || 'Could not change the status'));
  };

  const duplicate = w => {
    api.post(`/workflows/workflows/${w.id}/duplicate`)
      .then(() => { toast.success('Copied, switched off'); reload(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not duplicate'));
  };

  const remove = w => {
    if (!window.confirm(`Delete ${w.name}?`)) return;
    api.delete(`/workflows/workflows/${w.id}`)
      .then(() => { toast.success('Workflow deleted'); reload(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  const open = w => {
    api.get(`/workflows/workflows/${w.id}`)
      .then(r => setEditing(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not open'));
  };

  return (
    <div className="pb-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <FormFilter recordTypes={catalog.recordTypes} value={scope} onChange={setScope} />
        <button onClick={() => setEditing(blank(catalog.recordTypes))}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Workflow
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Workflow name</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Form name</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Executed on</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Actions</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Status</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-6 py-3">
                    <button onClick={() => open(w)} className="text-blue-600 hover:underline text-left font-medium">{w.name}</button>
                  </td>
                  <td className="px-6 py-3 text-slate-700">{labelOf(w.recordType)}</td>
                  <td className="px-6 py-3 text-slate-700">{executedOn(w)}</td>
                  <td className="px-6 py-3">
                    {w.actions.length === 0 ? <span className="text-slate-400">None</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {['email_alert', 'field_update'].map(kind => {
                          const n = w.actions.filter(a => a.kind === kind).length;
                          if (!n) return null;
                          return (
                            <span key={kind} className="bg-slate-100 text-slate-700 rounded px-2 py-0.5 text-[12.5px]">
                              {kind === 'email_alert' ? 'Mail Alerts' : 'Field Updates'} : {n}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <button onClick={() => toggle(w)} aria-label={`${w.name} is ${w.isActive ? 'on' : 'off'}`}
                      className={`w-9 h-5 rounded-full transition-colors relative ${w.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${w.isActive ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => duplicate(w)} title="Duplicate"
                        className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Copy size={15} /></button>
                      <button onClick={() => remove(w)} title={`Delete ${w.name}`}
                        className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="text-[14px] text-slate-600">No workflows yet.</p>
            <p className="text-[13px] text-slate-500 mt-1.5">
              Nothing fires until one is created. Build the email alert or field update first, then the workflow that runs it.
            </p>
          </div>
        )}
      </div>

      {editing && (
        <Editor catalog={catalog} initial={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </div>
  );
}
