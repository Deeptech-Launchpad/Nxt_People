import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import { useCatalog, Field, MergeFields, input, select } from './kit';

// Email Templates — the same table the Attendance screen writes to.
//
// A template carries either a service (the scheduled reminders) or a record
// type (a workflow's wording). The list shows whichever it has, and a built-in
// one cannot be deleted because a reminder is written against it.

export default function EmailTemplates() {
  const catalog = useCatalog();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => (
    api.get('/workflows/templates')
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load'); setRows([]); })
  ), []);

  useEffect(() => { load(); }, [load]);

  if (!catalog || rows === null) return <Spinner />;

  const belongsTo = t =>
    catalog.recordTypes.find(x => x.key === t.recordType)?.label
    || (t.service ? t.service.charAt(0).toUpperCase() + t.service.slice(1) : null);

  const remove = t => {
    if (!window.confirm(`Delete ${t.name}?`)) return;
    api.delete(`/workflows/templates/${t.id}`)
      .then(() => { toast.success('Template deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  return (
    <div className="pb-4">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ name: '', subject: '', body: '', recordType: catalog.recordTypes[0].key })}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Email Template
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
            {rows.map(t => (
              <tr key={t.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-6 py-3">
                  <button onClick={() => setEditing(t)} className="text-blue-600 hover:underline text-left font-medium">
                    {t.name}
                  </button>
                  {t.isSystem && <span className="ml-2 text-[12px] text-slate-500">built-in</span>}
                </td>
                <td className="px-6 py-3 text-slate-700">{belongsTo(t) || <span className="text-slate-400">—</span>}</td>
                <td className="px-6 py-3 text-slate-600">{t.subject || '—'}</td>
                <td className="px-6 py-3">
                  {!t.isSystem && (
                    <button onClick={() => remove(t)} aria-label={`Delete ${t.name}`}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1.5 rounded transition-opacity">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="text-[14px] text-slate-600">No email templates yet.</p>
          </div>
        )}
      </div>

      {editing && (
        <TemplateDialog catalog={catalog} initial={editing}
          onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}

function TemplateDialog({ catalog, initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  const type = catalog.recordTypes.find(t => t.key === draft.recordType);
  const set = patch => setDraft(d => ({ ...d, ...patch }));

  const insert = token => {
    const el = bodyRef.current;
    if (!el) return set({ body: (draft.body || '') + token });
    const start = el.selectionStart ?? (draft.body || '').length;
    set({ body: (draft.body || '').slice(0, start) + token + (draft.body || '').slice(el.selectionEnd ?? start) });
  };

  const save = () => {
    setBusy(true);
    const call = draft.id
      ? api.put(`/workflows/templates/${draft.id}`, draft)
      : api.post('/workflows/templates', draft);
    call
      .then(() => { toast.success(`Template ${draft.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            {draft.id ? 'Edit Email Template' : 'Add Email Template'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Form name">
              <select value={draft.recordType || ''} onChange={e => set({ recordType: e.target.value })} className={select}>
                <option value="">None</option>
                {catalog.recordTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Email template name" required>
              <input value={draft.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
            </Field>
          </div>

          <div className="border-t border-slate-100 pt-5 space-y-4">
            <p className="text-[15px] font-semibold text-slate-800">Message</p>
            <Field label="Subject" required>
              <input value={draft.subject || ''} maxLength={255} onChange={e => set({ subject: e.target.value })} className={input} />
            </Field>
            <Field label="Body">
              <MergeFields fields={type?.mergeFields} onInsert={insert} />
              <textarea ref={bodyRef} rows={10} value={draft.body || ''}
                onChange={e => set({ body: e.target.value })} className={`${input} font-mono text-[13px]`} />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save} disabled={busy || !draft.name?.trim() || !draft.subject?.trim()}
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
