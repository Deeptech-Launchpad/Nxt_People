import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Upload, Trash2, Download, File, FileImage, AlertTriangle, X, FolderOpen } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const DOC_TYPES = ['resume', 'photo', 'offer_letter', 'id_proof', 'address_proof', 'educational', 'experience', 'payslip', 'contract', 'nda', 'other'];
const DOC_TYPE_LABELS = {
  resume:         'Resume / CV',
  photo:          'Photo',
  offer_letter:   'Offer Letter',
  id_proof:       'ID Proof (Aadhar / PAN)',
  address_proof:  'Address Proof',
  educational:    'Educational Certificates',
  experience:     'Experience Certificates',
  payslip:        'Pay Slip',
  contract:       'Contract',
  nda:            'NDA',
  other:          'Other',
};

const getFileIcon = (url) => {
  if (!url) return File;
  const ext = url.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png'].includes(ext)) return FileImage;
  return FileText;
};

const formatSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Documents({ employeeId: propEmpId }) {
  const { user } = useAuth();
  const empId = propEmpId || user?._id;
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'other', file: null });
  const [modal, setModal] = useState(false);
  const fileRef = React.useRef();

  const load = useCallback(() => {
    if (!empId) return;
    setLoading(true);
    api.get(`/documents/${empId}`).then(r => setDocs(r.data.data || [])).catch(console.error).finally(() => setLoading(false));
  }, [empId]);

  useEffect(load, [load]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!form.file) return toast.error('Please select a file');
    setUploading(true);
    const fd = new FormData();
    fd.append('file', form.file);
    fd.append('name', form.name || form.file.name);
    fd.append('type', form.type);
    try {
      await api.post(`/documents/${empId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Document uploaded!');
      setModal(false); setForm({ name: '', type: 'other', file: null });
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const handleDelete = async (docId) => {
    if (!confirm('Delete this document?')) return;
    try { await api.delete(`/documents/${empId}/${docId}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error('Failed to delete'); }
  };

  const canUpload = user?.role !== 'employee' || user?._id === empId;

  // Group by canonical type. Anything with a type not in DOC_TYPES (legacy
  // onboarding rows that escaped the migration backfill, or admin-supplied
  // custom types) falls into "other" so it's still visible.
  const grouped = docs.reduce((acc, d) => {
    const bucket = DOC_TYPES.includes(d.type) ? d.type : 'other';
    (acc[bucket] = acc[bucket] || []).push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-xl">Documents</h2>
          <p className="text-slate-400 text-sm mt-0.5">{docs.length} document{docs.length !== 1 ? 's' : ''} · PDF, Word, Images, Excel supported</p>
        </div>
        {canUpload && (
          <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Upload size={16} /> Upload Document
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : docs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm text-center py-20">
          <FolderOpen size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No documents uploaded yet</p>
          {canUpload && <p className="text-slate-300 text-sm mt-1">Click Upload to add your first document</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {DOC_TYPES.filter(t => grouped[t]?.length).map((type) => {
            const typeDocs = grouped[type];
            return (
            <div key={type}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="font-display font-semibold text-slate-700 text-sm">{DOC_TYPE_LABELS[type] || type}</h3>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{typeDocs.length}</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {typeDocs.map(doc => {
                  const Icon = getFileIcon(doc.fileUrl);
                  return (
                    <div key={doc._id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3 group hover:shadow-md transition-shadow">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Icon size={18} className="text-brand-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-700 text-sm truncate">{doc.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{formatSize(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">by {doc.uploadedBy?.firstName}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer"
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-brand-600 transition-colors">
                          <Download size={13} />
                        </a>
                        {canUpload && (
                          <button onClick={() => handleDelete(doc._id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-lg">Upload Document</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Document Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Offer Letter 2024" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Document Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                  {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">File * <span className="text-slate-400">(PDF, Word, Image, Excel — max 10MB)</span></label>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-brand-300 transition-colors cursor-pointer" onClick={() => fileRef.current?.click()}>
                  {form.file ? (
                    <div><FileText size={24} className="text-brand-500 mx-auto mb-2" /><p className="text-sm font-medium text-slate-700">{form.file.name}</p><p className="text-xs text-slate-400">{formatSize(form.file.size)}</p></div>
                  ) : (
                    <div><Upload size={24} className="text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-400">Click to choose file</p></div>
                  )}
                  <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" onChange={e => setForm({ ...form, file: e.target.files[0] })} />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={uploading || !form.file} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <Upload size={14} />{uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
