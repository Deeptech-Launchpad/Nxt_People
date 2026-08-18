import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import { useCatalog, useScopedList, FormFilter, Field, MergeFields, input, select } from './kit';

// Email Alerts — the reusable named alerts a workflow runs.
//
// The recipient list is resolved when the alert fires, not stored as
// addresses: a manager who changed since the alert was written must get the
// mail, and a stored address would still be pointing at the old one.

const ROLES = [
  { key: 'admin', label: 'Admin' }, { key: 'director', label: 'Director' },
  { key: 'hr_admin', label: 'HR' }, { key: 'manager', label: 'Manager' },
  { key: 'team_incharge', label: 'Team Incharge' }, { key: 'team_member', label: 'Team member' },
];

const blank = recordType => ({
  recordType, name: '', description: '',
  fromKind: 'actor',
  toRecipients: { kinds: [], roles: [], emails: [] },
  cc: [], bcc: [], replyTo: '', subject: '', body: '', templateId: null,
});

function Dialog({ catalog, initial, templates, onClose, onSaved }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(!!(initial.cc?.length || initial.bcc?.length || initial.replyTo));
  const bodyRef = useRef(null);

  const type = catalog.recordTypes.find(t => t.key === draft.recordType);
  const set = patch => setDraft(d => ({ ...d, ...patch }));
  const kinds = draft.toRecipients.kinds || [];

  const toggleKind = k => set({
    toRecipients: {
      ...draft.toRecipients,
      kinds: kinds.includes(k) ? kinds.filter(x => x !== k) : [...kinds, k],
    },
  });

  const insert = token => {
    const el = bodyRef.current;
    if (!el) return set({ body: (draft.body || '') + token });
    const start = el.selectionStart ?? (draft.body || '').length;
    const next = (draft.body || '').slice(0, start) + token + (draft.body || '').slice(el.selectionEnd ?? start);
    set({ body: next });
  };

  const save = () => {
    setBusy(true);
    const call = draft.id
      ? api.put(`/workflows/alerts/${draft.id}`, draft)
      : api.post('/workflows/alerts', draft);
    call
      .then(() => { toast.success(`Email alert ${draft.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const list = (key, label) => (
    <Field label={label}>
      <input
        value={(draft[key] || []).join(', ')}
        onChange={e => set({ [key]: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
        placeholder="name@example.com, other@example.com"
        className={input}
      />
    </Field>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">{draft.id ? 'Edit Email Alert' : 'Add Email Alert'}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Form name" required>
              <select value={draft.recordType} disabled={!!draft.id}
                onChange={e => set({ recordType: e.target.value })}
                className={`${select} ${draft.id ? 'bg-slate-100 text-slate-500' : ''}`}>
                {catalog.recordTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Email alert name" required>
              <input value={draft.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
            </Field>
            <Field label="Description" wide>
              <textarea rows={2} value={draft.description || ''} maxLength={500}
                onChange={e => set({ description: e.target.value })} className={input} />
            </Field>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-[15px] font-semibold text-slate-800 mb-4">Message</p>

            <div className="space-y-4">
              <Field label="From" required>
                <select value={draft.fromKind} onChange={e => set({ fromKind: e.target.value })} className={`${select} max-w-sm`}>
                  {catalog.fromKinds.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>

              <Field label="To" required
                hint="Resolved when the alert fires, so it follows a change of manager rather than pointing at the old one.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {catalog.recipientKinds.map(k => (
                    <label key={k.key} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={kinds.includes(k.key)} onChange={() => toggleKind(k.key)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30" />
                      <span className="text-[13.5px] text-slate-700">{k.label}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {kinds.includes('role') && (
                <Field label="Which roles" required>
                  <div className="flex flex-wrap gap-3">
                    {ROLES.map(r => (
                      <label key={r.key} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox"
                          checked={(draft.toRecipients.roles || []).includes(r.key)}
                          onChange={() => {
                            const cur = draft.toRecipients.roles || [];
                            set({ toRecipients: { ...draft.toRecipients, roles: cur.includes(r.key) ? cur.filter(x => x !== r.key) : [...cur, r.key] } });
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30" />
                        <span className="text-[13.5px] text-slate-700">{r.label}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              )}

              {kinds.includes('specific') && (
                <Field label="Email addresses" required>
                  <input
                    value={(draft.toRecipients.emails || []).join(', ')}
                    onChange={e => set({ toRecipients: { ...draft.toRecipients, emails: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } })}
                    placeholder="name@example.com, other@example.com"
                    className={input}
                  />
                </Field>
              )}

              <div>
                {!showMore ? (
                  <button onClick={() => setShowMore(true)} className="text-[13.5px] text-blue-600 hover:underline">
                    Add: Cc · Bcc · Reply To
                  </button>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    {list('cc', 'Cc')}
                    {list('bcc', 'Bcc')}
                    <Field label="Reply To">
                      <input value={draft.replyTo || ''} onChange={e => set({ replyTo: e.target.value })} className={input} />
                    </Field>
                  </div>
                )}
              </div>

              <Field label="Subject" required>
                <input value={draft.subject} maxLength={255} onChange={e => set({ subject: e.target.value })} className={input} />
              </Field>

              <Field label="Body">
                <MergeFields fields={type?.mergeFields} onInsert={insert} />
                <textarea ref={bodyRef} rows={7} value={draft.body || ''}
                  onChange={e => set({ body: e.target.value })} className={`${input} font-mono text-[13px]`} />
              </Field>

              {templates.length > 0 && (
                <Field label="Or start from a template">
                  <select
                    value=""
                    onChange={e => {
                      const t = templates.find(x => x.id === e.target.value);
                      if (t) set({ subject: t.subject || draft.subject, body: t.body || draft.body, templateId: t.id });
                    }}
                    className={`${select} max-w-sm`}
                  >
                    <option value="">Select</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save} disabled={busy || !draft.name.trim() || !draft.subject.trim() || !kinds.length}
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

export default function EmailAlerts() {
  const catalog = useCatalog();
  const { scope, setScope, rows, reload } = useScopedList('/workflows/alerts');
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    api.get('/workflows/templates').then(r => setTemplates(r.data.data || [])).catch(() => {});
  }, []);

  if (!catalog || rows === null) return <Spinner />;

  const labelOf = key => catalog.recordTypes.find(t => t.key === key)?.label || key;

  const remove = a => {
    if (!window.confirm(`Delete ${a.name}?`)) return;
    api.delete(`/workflows/alerts/${a.id}`)
      .then(() => { toast.success('Email alert deleted'); reload(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  return (
    <div className="pb-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <FormFilter recordTypes={catalog.recordTypes} value={scope} onChange={setScope} />
        <button onClick={() => setEditing(blank(scope === 'all' ? catalog.recordTypes[0].key : scope))}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Email Alert
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Form name</th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Subject</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-6 py-3">
                  <button onClick={() => setEditing(a)} className="text-blue-600 hover:underline text-left font-medium">{a.name}</button>
                </td>
                <td className="px-6 py-3 text-slate-700">{labelOf(a.recordType)}</td>
                <td className="px-6 py-3 text-slate-600">{a.subject || '—'}</td>
                <td className="px-6 py-3">
                  <button onClick={() => remove(a)} aria-label={`Delete ${a.name}`}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="text-[14px] text-slate-600">No email alerts yet.</p>
            <p className="text-[13px] text-slate-500 mt-1.5">
              The scheduled check-in and check-out reminders live under Attendance, not here.
            </p>
          </div>
        )}
      </div>

      {editing && (
        <Dialog catalog={catalog} initial={editing} templates={templates}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </div>
  );
}
