import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import api from '../../../utils/api';
import { Spinner } from '../configKit';

// Locations, Departments and Designations are the same screen with different
// fields: a list with a count of who is on it, an Add button, and a dialog.
// One component rather than three, so the delete guard and the error handling
// cannot drift between them.
//
// `fields` describes the dialog; `columns` describes the table. The user count
// column is added here because every one of these lists has it, and it is the
// thing that tells you whether a row is safe to remove.

export default function RecordList({ resource, title, description, singular, columns, fields, emptyHint }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // a row, or {} for a new one
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/org-setup/${resource}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => {
        toast.error(err.response?.data?.message || `Failed to load ${title.toLowerCase()}`);
        setRows([]);
      });
  }, [resource, title]);

  useEffect(load, [load]);

  const save = () => {
    const isNew = !editing.id;
    setBusy(true);
    const call = isNew
      ? api.post(`/org-setup/${resource}`, editing)
      : api.put(`/org-setup/${resource}/${editing.id}`, editing);
    call
      .then(() => {
        toast.success(`${singular} ${isNew ? 'added' : 'saved'}`);
        setEditing(null);
        load();
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  // The route refuses a delete that would strand employees, and says how many.
  // Confirming here as well means the common case never reaches the server.
  const remove = row => {
    if (row.userCount > 0) {
      return toast.error(`${row.userCount} employee(s) still have this ${singular.toLowerCase()}. Reassign them first.`);
    }
    if (!window.confirm(`Delete ${row.name}?`)) return;
    api.delete(`/org-setup/${resource}/${row.id}`)
      .then(() => { toast.success(`${singular} deleted`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  if (rows === null) return <Spinner />;

  const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
            {description && <p className="text-[13.5px] text-slate-500 mt-1.5">{description}</p>}
          </div>
          <button
            onClick={() => setEditing({})}
            className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded text-[13.5px] font-medium"
          >
            <Plus size={15} /> Add {singular}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 pb-8 pt-2 text-center">
            <p className="text-[14px] text-slate-600">No {title.toLowerCase()} yet.</p>
            {emptyHint && <p className="text-[13px] text-slate-500 mt-1.5">{emptyHint}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50">
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="text-left font-medium text-slate-600 px-6 py-2.5 whitespace-nowrap">Employees</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    {columns.map(c => (
                      <td key={c.key} className="px-6 py-3 text-slate-700">
                        {c.render ? c.render(row) : (row[c.key] || <span className="text-slate-400">—</span>)}
                      </td>
                    ))}
                    <td className="px-6 py-3 text-slate-700">{row.userCount}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`}
                          className="text-slate-400 hover:text-blue-600 p-1.5 rounded"><Pencil size={15} /></button>
                        <button onClick={() => remove(row)} aria-label={`Delete ${row.name}`}
                          className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {editing.id ? `Edit ${singular}` : `Add ${singular}`}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              {fields.map(f => (
                <div key={f.key}>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select
                      value={editing[f.key] || ''}
                      onChange={e => setEditing(v => ({ ...v, [f.key]: e.target.value || null }))}
                      className={`${input} bg-white`}
                    >
                      <option value="">{f.placeholder || 'None'}</option>
                      {(f.options(rows) || []).map(o => (
                        // A record cannot be its own parent, so it is not offered.
                        o.value === editing.id ? null : <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={2} value={editing[f.key] || ''}
                      onChange={e => setEditing(v => ({ ...v, [f.key]: e.target.value }))}
                      className={input}
                    />
                  ) : (
                    <input
                      value={editing[f.key] || ''}
                      placeholder={f.placeholder}
                      onChange={e => setEditing(v => ({ ...v, [f.key]: e.target.value }))}
                      className={input}
                    />
                  )}
                  {f.hint && <p className="text-[12.5px] text-slate-500 mt-1">{f.hint}</p>}
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button
                onClick={save}
                disabled={busy || !String(editing[fields[0].key] || '').trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
              >
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
