import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Clock, CheckCircle2, XCircle, User, Mail, Phone, Briefcase, Building2, Layers, BadgeCheck, ChevronDown, Search, Filter, FileText, Eye, Download } from 'lucide-react';

const STATUS_TABS = [
  { key: 'pending', label: 'Pending', color: 'text-amber-400', dot: 'bg-amber-400' },
  { key: 'approved', label: 'Approved', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  { key: 'rejected', label: 'Rejected', color: 'text-red-400', dot: 'bg-red-400' },
  { key: 'active', label: 'Active', color: 'text-brand-400', dot: 'bg-brand-400' },
  { key: 'all', label: 'All', color: 'text-slate-400', dot: 'bg-slate-400' },
];

const Badge = ({ status }) => {
  const map = {
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
    active: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
      {status}
    </span>
  );
};

function ApproveModal({ employee, onClose, onApproved }) {
  const [form, setForm] = useState({ role: 'employee', department: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await api.put(`/registrations/${employee._id}/approve`, form);
      toast.success(`${employee.firstName} approved successfully`);
      onApproved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-display font-bold text-slate-900 text-lg mb-1">Approve Registration</h3>
        <p className="text-slate-500 text-sm mb-5">Set role and initial password for <span className="text-slate-800 font-medium">{employee.firstName} {employee.lastName}</span></p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Role</label>
            <div className="relative">
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 appearance-none shadow-sm">
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Department (optional)</label>
            <div className="relative">
              <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 appearance-none shadow-sm">
                <option value="">Select department</option>
                {['Engineering', 'HR', 'Sales', 'Marketing', 'Finance', 'Operations', 'Design', 'Product'].map(d => <option key={d}>{d}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Initial password <span className="text-slate-500 font-normal">(required for login)</span></label>
            <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400 shadow-sm" placeholder="Set a temporary password" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-medium py-2.5 rounded-xl text-sm transition-all shadow-sm">Cancel</button>
          <button onClick={handleApprove} disabled={loading} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-md shadow-brand-500/20">
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><CheckCircle2 size={14} /> Approve</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ employee, onClose, onRejected }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReject = async () => {
    setLoading(true);
    try {
      await api.put(`/registrations/${employee._id}/reject`, { reason });
      toast.success('Registration rejected');
      onRejected();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Rejection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-display font-bold text-slate-900 text-lg mb-1">Reject Registration</h3>
        <p className="text-slate-500 text-sm mb-5">Rejecting <span className="text-slate-800 font-medium">{employee.firstName} {employee.lastName}</span></p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Reason (optional)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-red-500 placeholder-slate-400 resize-none shadow-sm" placeholder="e.g. Not a registered employee" />
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-medium py-2.5 rounded-xl text-sm transition-all shadow-sm">Cancel</button>
          <button onClick={handleReject} disabled={loading} className="flex-1 bg-red-600/90 hover:bg-red-600 text-white font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-md shadow-red-500/20">
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><XCircle size={14} /> Reject</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ employee, onClose, onConfirmed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    dateOfJoining: '', companyName: '', division: '', employeeType: '',
    workingMode: '', designation: '', department: '', officialEmail: '', allowAccess: '', password: '', reportingManagerId: ''
  });
  const [allEmployees, setAllEmployees] = useState([]);

  useEffect(() => {
    api.get(`/registrations/${employee._id}/full`)
      .then(r => setData(r.data.data))
      .catch(err => toast.error('Failed to load candidate details'))
      .finally(() => setLoading(false));

    api.get('/employees?limit=1000&status=active')
      .then(r => setAllEmployees(r.data.data || []))
      .catch(console.error);
  }, [employee._id]);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await api.put(`/registrations/${employee._id}/confirm`, form);
      toast.success('Employee confirmed successfully');
      onConfirmed();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Confirmation failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex justify-center"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
        <h3 className="font-display font-bold text-slate-800 text-xl mb-4 border-b border-slate-100 pb-4">Confirm Registration: {data?.first_name} {data?.last_name}</h3>
        
        <div className="flex-1 overflow-y-auto pr-2 space-y-6">
          {/* Candidate Details (Read-only) */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
            <h4 className="text-brand-600 font-semibold mb-4 border-b border-slate-200 pb-2">Candidate Submitted Details</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div><span className="block text-slate-500 text-xs font-medium">Email</span><span className="text-slate-900 font-medium">{data?.email}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Phone</span><span className="text-slate-900 font-medium">{data?.phone}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Gender</span><span className="text-slate-900 font-medium">{data?.gender || '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Date of Birth</span><span className="text-slate-900 font-medium">{data?.date_of_birth ? new Date(data.date_of_birth).toLocaleDateString() : '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Marital Status</span><span className="text-slate-900 font-medium">{data?.marital_status || '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Blood Group</span><span className="text-slate-900 font-medium">{data?.blood_group || '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">Aadhaar Number</span><span className="text-slate-900 font-medium">{data?.aadhaar_number || '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">PAN Number</span><span className="text-slate-900 font-medium">{data?.pan_number || '—'}</span></div>
              <div><span className="block text-slate-500 text-xs font-medium">UAN Number</span><span className="text-slate-900 font-medium">{data?.uan_number || '—'}</span></div>
              <div className="col-span-2 md:col-span-3"><span className="block text-slate-500 text-xs font-medium">Current Address</span><span className="text-slate-900 font-medium">{data?.current_address || '—'}, {data?.city}, {data?.state}, {data?.country} - {data?.pin_code}</span></div>
              {data?.education && data.education.length > 0 && (
                <div className="col-span-2 md:col-span-3 mt-2">
                  <span className="block text-slate-500 text-xs font-medium mb-1">Education</span>
                  {data.education.map((e, i) => (
                    <div key={i} className="text-slate-700 text-xs bg-white p-2.5 rounded-lg mt-1.5 border border-slate-200 shadow-sm">{e.highest_qualification} from {e.university_or_institution} ({e.year_of_passing}) - {e.percentage_or_cgpa}</div>
                  ))}
                </div>
              )}
              {data?.documents && data.documents.length > 0 && (
                <div className="col-span-2 md:col-span-3 mt-2">
                  <span className="block text-slate-500 text-xs font-medium mb-2">Uploaded Documents</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.documents.map((doc, i) => {
                      const fileUrl = `/uploads/${doc.filePath}`;
                      return (
                        <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 hover:border-brand-300 transition-colors group">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-8 h-8 rounded bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                              <FileText size={16} />
                            </div>
                            <div className="truncate">
                              <div className="text-sm font-medium text-slate-800 capitalize truncate">{doc.documentType.replace(/([A-Z])/g, ' $1').trim()}</div>
                              <div className="text-xs text-slate-400 truncate">{doc.originalName}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                            <a href={fileUrl} target="_blank" rel="noreferrer" title="Preview" className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-100 rounded transition-colors">
                              <Eye size={16} />
                            </a>
                            <a href={fileUrl} download={doc.originalName} title="Download" className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-100 rounded transition-colors">
                              <Download size={16} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* HR Form */}
          <div className="bg-brand-50/50 rounded-xl p-5 border border-brand-500/20">
            <h4 className="text-slate-800 font-semibold mb-4 border-b border-brand-200 pb-2">HR Assignment Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Date of Joining</label>
                <input type="date" value={form.dateOfJoining} onChange={e => setForm({...form, dateOfJoining: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Company Name</label>
                <select value={form.companyName} onChange={e => setForm({...form, companyName: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>Altius Technology</option><option>AltiusNxt</option><option>DTLP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Division</label>
                <select value={form.division} onChange={e => setForm({...form, division: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>Coimbatore – Saibaba Colony</option><option>Madurai</option><option>Coimbatore – Doc Service</option><option>Coimbatore – ASG</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Employee Type</label>
                <select value={form.employeeType} onChange={e => setForm({...form, employeeType: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>Full Time</option><option>Part Time</option><option>Consultant</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Working Mode</label>
                <select value={form.workingMode} onChange={e => setForm({...form, workingMode: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>WFH</option><option>Office</option><option>Onsite</option><option>Hybrid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Designation</label>
                <select value={form.designation} onChange={e => setForm({...form, designation: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>BUH</option><option>Manager</option><option>Associate</option><option>SDL</option><option>ASDL</option><option>SSL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Department</label>
                <select value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">Select...</option>
                  <option>Software</option><option>Content Engineer</option><option>Trainee</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Reporting Person</label>
                <select value={form.reportingManagerId} onChange={e => setForm({...form, reportingManagerId: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  <option value="">None</option>
                  {allEmployees.map(emp => <option key={emp._id || emp.id} value={emp._id || emp.id}>{emp.firstName} {emp.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Official Email ID</label>
                <input type="text" value={form.officialEmail} onChange={e => setForm({...form, officialEmail: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Initial Password</label>
                <input type="text" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" placeholder="Required for login" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Allow Access To</label>
                <input type="text" value={form.allowAccess} onChange={e => setForm({...form, allowAccess: e.target.value})} className="w-full bg-white border border-slate-300 text-slate-900 px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" placeholder="e.g. Jira, GitHub, Slack" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-medium py-3 rounded-xl text-sm transition-all shadow-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-md shadow-brand-500/20">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><CheckCircle2 size={16} /> Confirm as Employee</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Registrations() {
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const [generateEmail, setGenerateEmail] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerateLink = async () => {
    if (!generateEmail) return toast.error('Email is required');
    setGenerating(true); setGeneratedLink('');
    try {
      const res = await api.post('/registrations/generate-link', { email: generateEmail });
      setGeneratedLink(res.data.link);
      toast.success(res.data.message || 'Link generated successfully');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to generate link');
    } finally {
      setGenerating(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, countRes] = await Promise.all([
        api.get(`/registrations?status=${tab}`),
        api.get('/registrations/counts')
      ]);
      setData(listRes.data.data);
      setCounts(countRes.data.data);
    } catch (err) {
      toast.error('Failed to load registrations');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = data.filter(r =>
    search === '' ||
    `${r.firstName} ${r.lastName} ${r.email} ${r.company} ${r.division}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display font-bold text-slate-900 text-2xl">Registration Requests</h1>
        <p className="text-slate-500 text-sm mt-1">Review and approve or reject user registration requests.</p>
      </div>

      {/* Generate Link Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8 shadow-sm">
        <h3 className="text-slate-800 font-bold mb-4 flex items-center gap-2 text-lg"><User size={20} className="text-brand-600" /> Generate Onboarding Link</h3>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <input value={generateEmail} onChange={e => setGenerateEmail(e.target.value)} type="email" placeholder="Candidate Email Address" className="w-full sm:max-w-xs bg-white border border-slate-300 text-slate-800 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
          <button onClick={handleGenerateLink} disabled={generating} className="w-full sm:w-auto bg-brand-600 hover:bg-brand-500 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70 flex items-center justify-center gap-2">
            {generating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : 'Send Preboard Mail'}
          </button>
        </div>
        {generatedLink && (
          <div className="mt-5 bg-slate-50 border border-brand-500/30 p-3.5 rounded-xl flex items-center justify-between gap-3">
            <code className="text-brand-700 font-medium text-sm truncate flex-1">{generatedLink}</code>
            <button onClick={() => { navigator.clipboard.writeText(generatedLink); toast.success('Link copied to clipboard'); }} className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap shadow-sm">
              Copy Link
            </button>
          </div>
        )}
        <p className="text-slate-500 text-xs mt-3 italic">This will email a single-use onboarding link to the candidate automatically.</p>
      </div>

      {/* Count cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Pending Review', value: counts.pending, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
          { label: 'Approved', value: counts.approved, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: 'Rejected', value: counts.rejected, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-xl border p-4 ${bg}`}>
            <p className={`font-display font-bold text-2xl ${color}`}>{value}</p>
            <p className="text-slate-400 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row gap-4 mb-5">
        <div className="flex gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shadow-sm">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${t.dot}`} />
              {t.label}
              {t.key === 'pending' && counts.pending > 0 && <span className="ml-1.5 bg-amber-100 text-amber-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{counts.pending}</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company…" className="w-full bg-white border border-slate-300 text-slate-800 pl-8 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:border-brand-500 placeholder-slate-400 shadow-sm" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock size={32} className="text-slate-300 mb-3" />
            <p className="text-slate-500 text-sm">No {tab === 'all' ? '' : tab} registrations found.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Name', 'Email', 'Company / Division', 'Designation', 'Status', 'Submitted', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => (
                <tr key={r._id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {r.firstName?.[0]}{r.lastName?.[0]}
                      </div>
                      <div>
                        <p className="text-slate-800 text-sm font-medium">{r.firstName} {r.lastName}</p>
                        {r.employeeId && <p className="text-slate-500 text-xs">{r.employeeId}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-sm">{r.email}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-800 text-sm">{r.company || '—'}</p>
                    <p className="text-slate-500 text-xs">{r.division || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-sm">{r.designation || '—'}</td>
                  <td className="px-4 py-3"><Badge status={r.registrationStatus} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3">
                    {r.registrationStatus === 'pending' && (
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmTarget(r)} className="flex items-center gap-1 bg-brand-50 hover:bg-brand-100 text-brand-600 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-brand-200 transition-all whitespace-nowrap">
                          <CheckCircle2 size={12} /> View & Confirm
                        </button>
                        <button onClick={() => setRejectTarget(r)} className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 transition-all">
                          <XCircle size={12} /> Reject
                        </button>
                      </div>
                    )}
                    {r.registrationStatus === 'rejected' && r.rejectionReason && (
                      <span className="text-slate-500 text-xs italic">"{r.rejectionReason}"</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {approveTarget && <ApproveModal employee={approveTarget} onClose={() => setApproveTarget(null)} onApproved={() => { setApproveTarget(null); fetchData(); }} />}
      {rejectTarget && <RejectModal employee={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={() => { setRejectTarget(null); fetchData(); }} />}
      {confirmTarget && <ConfirmModal employee={confirmTarget} onClose={() => setConfirmTarget(null)} onConfirmed={() => { setConfirmTarget(null); fetchData(); }} />}
    </div>
  );
}
