import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Spinner } from '../configKit';

// Email Templates — the wording of the mail the system sends.
//
// The built-in ones are marked so they cannot be deleted or renamed: an alert
// and the approval mailer find them by name. Their wording is entirely editable,
// which is the point — editing one changes what actually arrives.
//
// ${field} placeholders are substituted when the mail is sent. An unknown one is
// left as written rather than becoming "undefined", so a typo is visible in the
// email instead of silently blanking a sentence.
const MERGE_FIELDS = [
  ['employeeName', "The recipient's name"],
  ['approverName', 'The approver the mail is addressed to'],
  ['requestType', 'Leave, On duty, Regularization…'],
  ['reason', 'The reason given on the request'],
];

export default function EmailTemplates({ service = 'attendance' }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/automation/templates?service=${service}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load templates'); setRows([]); });
  }, [service]);

  useEffect(load, [load]);

  const save = () => {
    const isNew = !editing.id;
    setBusy(true);
    const call = isNew
      ? api.post('/automation/templates', { ...editing, service })
      : api.put(`/automation/templates/${editing.id}`, editing);
    call
      .then(() => { toast.success(`Template ${isNew ? 'added' : 'saved'}`); setEditing(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const remove = row => {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    api.delete(`/automation/templates/${row.id}`)
      .then(() => { toast.success('Template deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete'));
  };

  if (rows === null) return <Spinner />;

  const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500';

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-800">Email Templates</h2>
            <p className="text-[13.5px] text-slate-500 mt-1.5">
              The wording of the mail this service sends. Editing one changes what arrives.
            </p>
          </div>
          <button
            onClick={() => setEditing({ name: '', subject: '', body: '' })}
            className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded text-[13.5px] font-medium"
          >
            <Plus size={15} /> Add Template
          </button>
        </div>

        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Name</th>
                <th className="text-left font-medium text-slate-600 px-6 py-2.5">Subject</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-6 py-3 text-slate-800">
                    {row.name}
                    {row.isSystem && <span className="ml-2 text-[11.5px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">built-in</span>}
                  </td>
                  <td className="px-6 py-3 text-slate-600">{row.subject}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setEditing(row)} className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                      {!row.isSystem && (
                        <button onClick={() => remove(row)} aria-label={`Delete ${row.name}`}
                          className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {editing.id ? 'Edit Email Template' : 'Add Email Template'}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Template name<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  value={editing.name || ''} disabled={editing.isSystem}
                  onChange={e => setEditing(v => ({ ...v, name: e.target.value }))}
                  className={input}
                />
                {editing.isSystem && (
                  <p className="text-[12.5px] text-slate-500 mt-1">
                    A built-in template keeps its name — an alert finds it by that.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Subject<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input value={editing.subject || ''} onChange={e => setEditing(v => ({ ...v, subject: e.target.value }))} className={input} />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Body<span className="text-red-500 ml-0.5">*</span>
                </label>
                <textarea
                  rows={9} value={editing.body || ''}
                  onChange={e => setEditing(v => ({ ...v, body: e.target.value }))}
                  className={`${input} font-mono text-[13px] leading-relaxed`}
                />
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">Merge fields</p>
                <div className="flex flex-wrap gap-2">
                  {MERGE_FIELDS.map(([field, hint]) => (
                    <button
                      key={field} type="button" title={hint}
                      onClick={() => setEditing(v => ({ ...v, body: `${v.body || ''}\${${field}}` }))}
                      className="text-[12.5px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded px-2 py-1"
                    >
                      {'${' + field + '}'}
                    </button>
                  ))}
                </div>
                <Note>
                  A field that does not apply to a particular email is left in the text as written, so a
                  mistake shows up in the message rather than blanking a sentence.
                </Note>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button
                onClick={save}
                disabled={busy || !String(editing.name || '').trim() || !String(editing.subject || '').trim() || !String(editing.body || '').trim()}
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
