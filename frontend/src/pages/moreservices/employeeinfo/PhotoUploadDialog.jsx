import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Image, Check, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';

/* Profile Photo Upload, in bulk.
 *
 * Files are matched to people by FILENAME — "ANXT220016.jpg" is that person's
 * photo. That is how a folder of photos exported from anywhere is already
 * named, and it means no per-file picker.
 *
 * Anything that does not match an employee ID comes back listed rather than
 * dropped, because a typo in a filename otherwise looks exactly like an upload
 * that failed for no reason.
 */
export default function PhotoUploadDialog({ onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const upload = async () => {
    if (!files.length) return toast.error('Choose some images first');
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('photos', f);
      const r = await api.post('/employee-io/photos', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(r.data);
      toast.success(r.data.message);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not upload those photos');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Profile Photo Upload</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-[14px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            Name each file after the person's <strong>Employee ID</strong> — for example
            <code className="mx-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[13px]">ANXT220016.jpg</code>.
            Up to 200 images, 5 MB each. JPG, PNG or WebP.
          </p>

          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden"
            onChange={e => { setFiles(Array.from(e.target.files || [])); setResult(null); }} />
          <button onClick={() => inputRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 text-center hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
            <Image size={22} className="mx-auto text-slate-400 mb-2" />
            <span className="block text-[15px] text-slate-700">
              {files.length ? `${files.length} image(s) selected` : 'Choose images'}
            </span>
          </button>

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                <Check size={17} className="text-emerald-600 flex-shrink-0" />
                <p className="text-[14px] text-emerald-800">{result.matched.length} photo(s) updated.</p>
              </div>
              {result.unmatched.length > 0 && (
                <>
                  <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <AlertTriangle size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-[14px] text-amber-800">
                      {result.unmatched.length} file(s) did not match an employee. Nothing was uploaded for these.
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
                    {result.unmatched.map((u, i) => (
                      <div key={i} className="px-3.5 py-2 text-[14px] border-b border-slate-50 last:border-0 flex justify-between gap-3">
                        <span className="text-slate-700 truncate">{u.file}</span>
                        <span className="text-slate-400 flex-shrink-0">{u.reason}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={upload} disabled={!files.length || busy}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {busy ? 'Uploading…' : `Upload ${files.length || ''}`}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
