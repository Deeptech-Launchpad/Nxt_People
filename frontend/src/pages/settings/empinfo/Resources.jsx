import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Link2, FileText, X, Pencil } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Policy -> Resources.
 *
 * Knowledge Base and FAQ. Two small content lists that HR fills in and
 * employees read; nothing else in the product depends on them, which is why
 * they are the simplest screens here.
 */
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] focus:outline-none focus:border-brand-400';

export function KnowledgeBase() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null);        // null | 'url'
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const fileRef = useRef(null);

  const load = () => {
    setLoading(true);
    api.get('/employee-info-settings/kb')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load references'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const upload = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', file.name);
    try {
      await api.post('/employee-info-settings/kb', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Reference added'); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add that file');
    }
  };

  const addUrl = async () => {
    if (!url.trim()) return toast.error('Enter a URL');
    try {
      await api.post('/employee-info-settings/kb', { url: url.trim(), title: title.trim() || url.trim() });
      toast.success('Reference added');
      setUrl(''); setTitle(''); setMode(null); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add that link');
    }
  };

  const remove = async (row) => {
    try { await api.delete(`/employee-info-settings/kb/${row._id}`); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not remove that'); }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-[16px] font-semibold text-slate-800 mb-3">Knowledge Base</h3>
        <div className="border-2 border-dashed border-slate-200 rounded-xl px-5 py-6 flex flex-wrap items-center justify-center gap-3">
          <span className="text-[14.5px] text-slate-500">Upload from</span>
          <button onClick={() => fileRef.current?.click()}
            className="text-[14.5px] text-brand-600 hover:text-brand-700 font-medium">Desktop</button>
          <span className="text-slate-300">/</span>
          <button onClick={() => setMode('url')}
            className="text-[14.5px] text-brand-600 hover:text-brand-700 font-medium">URL</button>
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </div>
        {/* Zoho also offers WorkDrive and Cloud. Those are its own storage
            products; offering them greyed would be two dead links. */}
        <p className="text-[13px] text-slate-400 mt-2">
          PDF, Office documents or images up to 10 MB, or a link to something hosted elsewhere.
        </p>

        {mode === 'url' && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <input className={`${input} flex-1 min-w-[240px]`} value={url} autoFocus
              placeholder="https://…" onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUrl(); if (e.key === 'Escape') setMode(null); }} />
            <input className={`${input} w-52`} value={title} placeholder="Title (optional)"
              onChange={e => setTitle(e.target.value)} />
            <button onClick={addUrl}
              className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-[14.5px] font-medium">Add</button>
            <button onClick={() => setMode(null)}
              className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[14.5px] hover:bg-slate-50">Cancel</button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h4 className="text-[15px] font-semibold text-slate-700 mb-3">Added references</h4>
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[15px] text-slate-600">No references have been added to this category currently</p>
            <p className="text-[14px] text-slate-400 mt-1">
              Add references, such as documents and URLs, which can be used as an informative guide
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => (
              <div key={r._id} className="flex items-center justify-between gap-4 py-2.5">
                <a href={r.kind === 'url' ? r.url : r.filePath} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2.5 min-w-0 text-slate-700 hover:text-brand-600">
                  {r.kind === 'url' ? <Link2 size={15} className="flex-shrink-0 text-slate-400" />
                    : <FileText size={15} className="flex-shrink-0 text-slate-400" />}
                  <span className="truncate text-[14.5px]">{r.title}</span>
                </a>
                <button onClick={() => remove(r)}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Faqs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | row

  const load = () => {
    setLoading(true);
    api.get('/employee-info-settings/faqs')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load FAQs'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const remove = async (row) => {
    try { await api.delete(`/employee-info-settings/faqs/${row._id}`); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not remove that'); }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-slate-800">Frequently Asked Questions</h3>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium">
          <Plus size={16} /> Add FAQ
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex justify-center py-14">
            <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-[15px] text-slate-600">No FAQs have been added currently</p>
            <p className="text-[14px] text-slate-400 mt-1 max-w-lg mx-auto">
              Add frequently asked questions with clear and informative answers, allowing employees to
              quickly find the information they seek
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => (
              <div key={r._id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-slate-800">{r.question}</p>
                    {r.answer && (
                      <div className="text-[14px] text-slate-600 mt-1 whitespace-pre-wrap">{r.answer}</div>
                    )}
                    {r.tags && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {r.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                          <span key={t} className="text-[12.5px] bg-slate-100 text-slate-600 rounded px-2 py-0.5">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setEditing(r)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(r)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <FaqEditor row={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function FaqEditor({ row, onClose, onSaved }) {
  const [form, setForm] = useState(row || { question: '', answer: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.question.trim()) return toast.error('Enter a question');
    setSaving(true);
    try {
      if (row?._id) await api.put(`/employee-info-settings/faqs/${row._id}`, form);
      else await api.post('/employee-info-settings/faqs', form);
      toast.success(row ? 'FAQ updated' : 'FAQ added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-4 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">{row ? 'Edit FAQ' : 'Add FAQ'}</h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-slate-700 mb-1.5">
              Question <span className="text-rose-500">*</span>
            </label>
            <input className={input} value={form.question} autoFocus
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))} />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Answer</label>
            {/* Plain text rather than a rich editor: the reference has one, but
                a half-built editor that mangles paste is worse than a textarea
                that never surprises anybody. */}
            <textarea className={`${input} h-48 resize-none`} value={form.answer || ''}
              onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Tags</label>
            <input className={input} value={form.tags || ''} placeholder="Comma separated"
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={save} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {saving ? 'Saving…' : 'Submit'}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
