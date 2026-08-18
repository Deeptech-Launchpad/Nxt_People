import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';
import { useCatalog, useScopedList, FormFilter, Field, input, select } from './kit';

// Field Updates — "set this field to this value when the workflow fires".
//
// The field list is a whitelist, not the table's columns. A field update that
// could name any column would be an arbitrary write to any table by anyone who
// can edit a workflow, so the server refuses anything not on the list and this
// screen only ever offers what is on it.

const blank = recordType => ({ recordType, name: '', description: '', targetField: '', targetValue: '' });

function Dialog({ catalog, initial, onClose, onSaved }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);

  const type = catalog.recordTypes.find(t => t.key === draft.recordType);
  const set = patch => setDraft(d => ({ ...d, ...patch }));
  const field = type?.writableFields.find(f => f.key === draft.targetField);

  const save = () => {
    setBusy(true);
    const call = draft.id
      ? api.put(`/workflows/field-updates/${draft.id}`, draft)
      : api.post('/workflows/field-updates', draft);
    call
      .then(() => { toast.success(`Field update ${draft.id ? 'saved' : 'created'}`); onSaved(); onClose(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  // Only some record types have anything a workflow may write.
  const writable = type?.writableFields || [];

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">{draft.id ? 'Edit Field Update' : 'Add Field Update'}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Form name" required>
              <select value={draft.recordType} disabled={!!draft.id}
                onChange={e => set({ recordType: e.target.value, targetField: '', targetValue: '' })}
                className={`${select} ${draft.id ? 'bg-slate-100 text-slate-500' : ''}`}>
                {catalog.recordTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Field update name" required>
              <input value={draft.name} maxLength={150} onChange={e => set({ name: e.target.value })} className={input} />
            </Field>
            <Field label="Description" wide>
              <textarea rows={2} value={draft.description || ''} maxLength={500}
                onChange={e => set({ description: e.target.value })} className={input} />
            </Field>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-[15px] font-semibold text-slate-800">Field update selection</p>
            <p className="text-[13.5px] text-slate-500 mt-1 mb-3">
              The field gets updated with the new value when the workflow is triggered.
            </p>

            {writable.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <p className="text-[13.5px] text-amber-900">
                  Nothing on {type?.label} can be written by a workflow. Approval status is set by the
                  approval flow, and letting a workflow overwrite it would put two things in charge of
                  the same field.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-3">
                  <p className="text-[13px] text-amber-900">
                    Only the fields listed here can be written. Anything else is refused, both when the
                    update is saved and again when it runs.
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap bg-slate-50 rounded-lg px-4 py-3">
                  <select value={draft.targetField}
                    onChange={e => set({ targetField: e.target.value, targetValue: '' })}
                    className={`${select} max-w-[240px]`}>
                    <option value="">-select-</option>
                    {writable.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <span className="text-slate-500">=</span>
                  {field?.values ? (
                    <select value={draft.targetValue} onChange={e => set({ targetValue: e.target.value })}
                      className={`${select} max-w-[240px]`}>
                      <option value="">-select-</option>
                      {field.values.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={draft.targetValue} maxLength={255} disabled={!draft.targetField}
                      onChange={e => set({ targetValue: e.target.value })}
                      className={`${input} max-w-[240px] ${draft.targetField ? '' : 'bg-slate-100'}`} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button onClick={save}
            disabled={busy || !draft.name.trim() || !draft.targetField || !String(draft.targetValue).trim()}
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

export default function FieldUpdates() {
  const catalog = useCatalog();
  const { scope, setScope, rows, reload } = useScopedList('/workflows/field-updates');
  const [editing, setEditing] = useState(null);

  if (!catalog || rows === null) return <Spinner />;

  const labelOf = key => catalog.recordTypes.find(t => t.key === key)?.label || key;
  const fieldLabel = row =>
    catalog.recordTypes.find(t => t.key === row.recordType)?.writableFields
      .find(f => f.key === row.targetField)?.label || row.targetField;

  const remove = u => {
    if (!window.confirm(`Delete ${u.name}?`)) return;
    api.delete(`/workflows/field-updates/${u.id}`)
      .then(() => { toast.success('Field update deleted'); reload(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  return (
    <div className="pb-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <FormFilter recordTypes={catalog.recordTypes} value={scope} onChange={setScope} />
        <button onClick={() => setEditing(blank(scope === 'all' ? catalog.recordTypes[0].key : scope))}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-[13.5px] font-medium">
          <Plus size={15} /> Add Field Update
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Form name</th>
              <th className="text-left font-medium text-slate-600 px-6 py-2.5">Sets</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-6 py-3">
                  <button onClick={() => setEditing(u)} className="text-blue-600 hover:underline text-left font-medium">{u.name}</button>
                </td>
                <td className="px-6 py-3 text-slate-700">{labelOf(u.recordType)}</td>
                <td className="px-6 py-3 text-slate-700">{fieldLabel(u)} = {u.targetValue}</td>
                <td className="px-6 py-3">
                  <button onClick={() => remove(u)} aria-label={`Delete ${u.name}`}
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
            <p className="text-[14px] text-slate-600">No field updates yet.</p>
          </div>
        )}
      </div>

      {editing && (
        <Dialog catalog={catalog} initial={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </div>
  );
}
