import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Download, Loader2, FileText } from 'lucide-react';
import api from '../utils/api';
import { downloadEmployeeDocument } from '../utils/employeeDocument';

/* Preview a document without leaving the page.
 *
 * It used to open a new tab on a blob URL, which Chrome titles "(anonymous)"
 * and addresses as blob:https://…/50941000-2fad-4b88-9adb-c2dd95ae861a. Both
 * are unavoidable for a blob: it has no filename to take a title from, and
 * the UUID is the browser's own handle rather than an address.
 *
 * The UUID is worth keeping — unguessable, unshareable, gone when the tab
 * closes, which is what an identity document wants. What is not worth keeping
 * is the tab. Shown in place, the document has a heading, the person keeps
 * their place in the record, and there is no stray tab left open on somebody's
 * Aadhaar afterwards.
 */
export default function DocumentPreview({ employeeId, doc, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  const ext = String(doc?.storedName || doc?.name || '').toLowerCase().split('.').pop();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
  const isPdf = ext === 'pdf' || String(doc?.name || '').toLowerCase().endsWith('.pdf');
  /* Word and Excel cannot render in a browser without a converter, so they
   * are offered as a download rather than shown as a broken frame. */
  const canShow = isImage || isPdf;

  useEffect(() => {
    if (!doc || !canShow) return undefined;
    let objectUrl = null;
    let cancelled = false;

    api.get(`/documents/${employeeId}/${doc._id}/file?disposition=inline`, { responseType: 'blob' })
      .then(r => {
        if (cancelled) return;
        if (r.data?.type === 'application/json') throw new Error('That document could not be opened.');
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch(async (err) => {
        if (cancelled) return;
        /* The server's own sentence where there is one — "the record exists
         * but the file is missing" is a different problem from a refusal. */
        let message = err?.message || 'That document could not be opened.';
        try {
          const parsed = JSON.parse(await err.response.data.text());
          if (parsed?.message) message = parsed.message;
        } catch { /* not JSON */ }
        setError(message);
      });

    return () => {
      cancelled = true;
      /* Released on close. An object URL held open keeps the whole decrypted
       * file in memory for the life of the tab. */
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, doc, canShow]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!doc) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-5xl h-[88vh] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-800 truncate">{doc.name}</h3>
            <p className="text-[12.5px] text-slate-400 truncate">{doc.storedName || ''}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => downloadEmployeeDocument(employeeId, doc._id, doc.name)}
              title="Download"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <Download size={17} />
            </button>
            <button onClick={onClose} title="Close"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-slate-100 rounded-b-2xl overflow-hidden">
          {error ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
              <FileText size={28} className="text-slate-300" />
              <p className="text-[14px] text-slate-600 max-w-md">{error}</p>
            </div>
          ) : !canShow ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText size={28} className="text-slate-300" />
              <p className="text-[14px] text-slate-600">
                A {ext ? ext.toUpperCase() : 'file'} cannot be shown in the browser.
              </p>
              <button onClick={() => downloadEmployeeDocument(employeeId, doc._id, doc.name)}
                className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-[14px]">
                <Download size={15} /> Download it
              </button>
            </div>
          ) : !url ? (
            <div className="h-full flex items-center justify-center gap-2 text-slate-400">
              <Loader2 size={18} className="animate-spin" /> <span className="text-[14px]">Opening…</span>
            </div>
          ) : isImage ? (
            <div className="h-full flex items-center justify-center p-4 overflow-auto">
              <img src={url} alt={doc.name} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            /* title on the frame so the document has a name even here, and
               nothing about the file leaves this page. */
            <iframe src={url} title={doc.name} className="w-full h-full border-0" />
          )}
        </div>
      </div>
    </div>
  );
}
