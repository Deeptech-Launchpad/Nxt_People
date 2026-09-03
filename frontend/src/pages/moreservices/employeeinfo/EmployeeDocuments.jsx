import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Upload, Eye, Download, Trash2, Loader2, AlertTriangle, Lock } from 'lucide-react';
import api from '../../../utils/api';
import { downloadEmployeeDocument } from '../../../utils/employeeDocument';
import DocumentPreview from '../../../components/DocumentPreview';

/* An employee's papers, where the rest of their record is.
 *
 * HR could only see documents on the old Employees page, and could not add one
 * at all — the only way a certificate ever reached the system was the employee
 * uploading it themselves during onboarding. An offer letter, a signed
 * contract, a warning letter are all things the company holds ABOUT somebody
 * rather than something they hand in, and there was nowhere to put them.
 *
 * Every button here goes through the endpoint that checks entitlement and
 * writes down who looked. Nothing addresses a file by URL.
 */
const TYPES = [
  ['offer_letter', 'Offer Letter'],
  ['contract', 'Contract'],
  ['id_proof', 'ID Proof'],
  ['educational', 'Educational'],
  ['resume', 'Resume'],
  ['photo', 'Photo'],
  ['payslip', 'Payslip'],
  ['letter', 'Letter'],
  ['other', 'Other'],
];
const TYPE_LABEL = Object.fromEntries(TYPES);

const fmtSize = (n) => {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};
const fmtWhen = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric' }) : '');

export default function EmployeeDocuments({ employeeId, canEdit = true }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);   // { name, type, file }
  const [previewing, setPreviewing] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    api.get(`/documents/${employeeId}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => {
        if (err.response?.status === 403) setRows([]);
        else { toast.error(err.response?.data?.message || 'Could not load documents'); setRows([]); }
      });
  }, [employeeId]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('That file is larger than 10 MB.');
      e.target.value = '';
      return;
    }
    /* The name defaults to the file's own, minus the extension, because that
     * is nearly always what somebody would have typed anyway. */
    setAdding({ file, name: file.name.replace(/\.[^.]+$/, ''), type: 'other' });
    e.target.value = '';
  };

  const save = async () => {
    if (!adding?.file) return;
    if (!adding.name.trim()) return toast.error('Give the document a name');
    setBusy(true);
    const fd = new FormData();
    fd.append('file', adding.file);
    fd.append('name', adding.name.trim());
    fd.append('type', adding.type);
    try {
      await api.post(`/documents/${employeeId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Uploaded');
      setAdding(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not upload that file');
    } finally { setBusy(false); }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? The file is removed from the server and cannot be recovered.`)) return;
    try {
      await api.delete(`/documents/${employeeId}/${doc._id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete that document');
    }
  };

  const Btn = ({ onClick, title, icon: Icon, tone = 'slate' }) => (
    <button onClick={onClick} title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${
        tone === 'rose' ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100'}`}>
      <Icon size={15} />
    </button>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-100">
        <h3 className="text-[16px] font-semibold text-slate-800">Documents</h3>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" hidden onChange={pick}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-[13.5px] text-brand-600 hover:text-brand-500">
              <Upload size={15} /> Upload
            </button>
          </>
        )}
      </div>

      {adding && (
        <div className="border border-brand-200 bg-brand-50/40 rounded-lg p-4 mb-3">
          <p className="text-[13.5px] text-slate-600 mb-3 truncate">
            <FileText size={14} className="inline mb-0.5 mr-1.5 text-slate-400" />
            {adding.file.name} <span className="text-slate-400">· {fmtSize(adding.file.size)}</span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Name</label>
              <input value={adding.name} onChange={e => setAdding(a => ({ ...a, name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Type</label>
              <select value={adding.type} onChange={e => setAdding(a => ({ ...a, type: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400">
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={busy}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[14px] flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />} Upload
            </button>
            <button onClick={() => setAdding(null)}
              className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[14px] hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows === null ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-slate-400">No documents on file.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(doc => (
            <div key={doc._id} className="flex items-center gap-3 border border-slate-100 rounded-lg px-3 py-2.5">
              <span className="w-8 h-8 rounded bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                <FileText size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-slate-800 truncate flex items-center gap-1.5">
                  {doc.name}
                  {/* Said quietly, because it is reassurance rather than an
                      instruction: nothing about opening it changes. */}
                  {doc.isEncrypted && <Lock size={11} className="text-slate-300 flex-shrink-0" title="Stored encrypted" />}
                </p>
                <p className="text-[12.5px] text-slate-400 truncate">
                  {TYPE_LABEL[doc.type] || doc.type}
                  {doc.fileSize ? ` · ${fmtSize(doc.fileSize)}` : ''}
                  {doc.createdAt ? ` · ${fmtWhen(doc.createdAt)}` : ''}
                  {doc.uploadedBy?.firstName ? ` · ${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName || ''}` : ''}
                </p>
              </div>

              {/* A row whose bytes are gone offers nothing to press. Two
                  buttons that both answer 404 is how somebody ended up with an
                  error message saved to their machine as a PDF. */}
              {doc.fileMissing ? (
                <span title="The record is here but the file is no longer on the server. Ask for it again."
                  className="flex items-center gap-1.5 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 flex-shrink-0">
                  <AlertTriangle size={12} /> File missing
                </span>
              ) : (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Btn onClick={() => setPreviewing(doc)} title="Preview" icon={Eye} />
                  <Btn onClick={() => downloadEmployeeDocument(employeeId, doc._id, doc.name)} title="Download" icon={Download} />
                  {canEdit && <Btn onClick={() => remove(doc)} title="Delete" icon={Trash2} tone="rose" />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {previewing && (
        <DocumentPreview employeeId={employeeId} doc={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}
