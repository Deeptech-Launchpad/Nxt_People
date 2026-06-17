import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, X, ChevronLeft, ChevronRight, Mail, Send, Eye, FileText, Download, RefreshCw, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { isFullAccess, roleLabel } from '../utils/roles';
import AppAccessPicker from '../components/AppAccessPicker';

// Options will be fetched dynamically from the database

const initForm = {
  firstName:'', lastName:'', email:'', employeeId:'', password:'', phone:'',
  role:'team_member', department:'', designation:'', company:'',
  joiningDate: new Date().toISOString().split('T')[0],
  monthlyCTC:'', basicSalary:'',
  casualLeave:'',
  reportingManagerId:'', approvingAuthorityId:'',
  // Personal
  nickName:'', dateOfBirth:'', gender:'', maritalStatus:'', bloodGroup:'', nationality:'',
  // Contact
  personalEmail:'', workPhone:'', address:'', permanentAddress:'',
  // Identity (PII)
  panNumber:'', aadhaarNumber:'', uanNumber:'',
  // Bank
  bankName:'', bankAccount:'', bankIfsc:'',
  // Emergency contact
  emergencyContactName:'', emergencyContactPhone:'', emergencyContactRelation:'',
  // Work
  workLocation:'', employmentType:'', status:'active',
  // Zoho extras
  exitDate:'', totalExperience:'', expertise:'',
};

// Company list must match the backend COMPANY_PREFIXES in
// backend/utils/employeeId.js — keeps the per-company ID sequence working.
const COMPANIES = ['AltiusNxt', 'Altius Technology', 'DTLP'];

// Employment status options + their display metadata. Notice Period keeps
// login access; everything else (other than Active) revokes it.
const STATUS_OPTIONS = [
  { value: 'active',         label: 'Active (Current Employee)', color: 'bg-emerald-100 text-emerald-700',  loginAccess: true  },
  { value: 'notice_period',  label: 'Notice Period',             color: 'bg-amber-100 text-amber-700',      loginAccess: true  },
  { value: 'resigned',       label: 'Resigned',                  color: 'bg-slate-100 text-slate-600',      loginAccess: false },
  { value: 'terminated',     label: 'Terminated',                color: 'bg-red-100 text-red-700',          loginAccess: false },
  { value: 'inactive',       label: 'Inactive',                  color: 'bg-slate-100 text-slate-500',      loginAccess: false },
];
const statusMeta = (s) => STATUS_OPTIONS.find(o => o.value === s) || STATUS_OPTIONS[0];


export default function Employees() {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user);
  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [desigFilter, setDesigFilter] = useState('');
  // 'active' (default) | 'inactive' (terminated/resigned/etc.)
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  // Zoho sync state — only used by admins
  const [zohoSyncing, setZohoSyncing] = useState(false);
  const [zohoResult, setZohoResult]   = useState(null);
  const [modal, setModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [viewEmpId, setViewEmpId] = useState(null);
  const [viewEmpData, setViewEmpData] = useState(null);
  const [loadingView, setLoadingView] = useState(false);
  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  // App access — loaded on Edit-open, surfaced as a checkbox grid in the
  // modal, synced via PUT /employees/:id/app-access after the main save.
  const [appAccessList, setAppAccessList] = useState([]);
  const [appAccessLoading, setAppAccessLoading] = useState(false);
  const [selectedApps, setSelectedApps] = useState(new Set());
  // Employment status update modal (separate from Edit Employee — focused on
  // the exit/notice-period workflow with applied date, end date, reason,
  // rehire eligibility, blacklist).
  const [statusModal, setStatusModal] = useState(null);
  const [statusForm, setStatusForm]   = useState({
    status: 'active', statusAppliedAt: '', noticePeriodEndDate: '',
    statusReason: '', rehireEligibility: '', isBlacklisted: false,
  });
  const [statusSaving, setStatusSaving] = useState(false);

  const openStatus = (emp) => {
    setStatusModal(emp);
    setStatusForm({
      status:              emp.status || 'active',
      statusAppliedAt:     (emp.statusAppliedAt || '').split?.('T')[0] || new Date().toISOString().slice(0, 10),
      noticePeriodEndDate: (emp.noticePeriodEndDate || '').split?.('T')[0] || '',
      statusReason:        emp.statusReason || '',
      rehireEligibility:   emp.rehireEligibility || '',
      isBlacklisted:       !!emp.isBlacklisted,
    });
  };

  const handleStatusSave = async () => {
    setStatusSaving(true);
    try {
      const payload = {
        status:              statusForm.status,
        statusAppliedAt:     statusForm.statusAppliedAt || null,
        noticePeriodEndDate: statusForm.status === 'notice_period' ? (statusForm.noticePeriodEndDate || null) : null,
        statusReason:        statusForm.statusReason || null,
        rehireEligibility:   ['resigned','terminated','inactive'].includes(statusForm.status) ? (statusForm.rehireEligibility || null) : null,
        isBlacklisted:       !!statusForm.isBlacklisted,
        // Mirror the exit_date when moving to a terminal status.
        exitDate:            statusForm.status === 'resigned' || statusForm.status === 'terminated'
                                ? (statusForm.statusAppliedAt || new Date().toISOString().slice(0, 10))
                                : null,
      };
      await api.put(`/employees/${statusModal._id}`, payload);
      const meta = statusMeta(statusForm.status);
      toast.success(`Status updated → ${meta.label}${meta.loginAccess ? '' : '. Login access revoked.'}`);
      setStatusModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Status update failed');
    } finally {
      setStatusSaving(false);
    }
  };

  const [onboardingModal, setOnboardingModal] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({ email: '', candidateName: '', dueDate: '' });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [departments, setDepartments] = useState(['Engineering', 'HR', 'Sales', 'Marketing']);
  const [designations, setDesignations] = useState(['Software Engineer', 'Manager']);
  // Role is a fixed enum — admin needs to be able to assign these three even
  // when no current employee has the role (e.g. after a fresh Zoho sync where
  // everyone defaults to "employee"). Don't override from metadata.
  const roles = ['admin', 'director', 'manager', 'team_member'];
  // `managers` is the leadership-filtered list (Heads / Leads / Managers) used
  // for the Reporting Person dropdown. Replaces the old `allEmployees` list
  // which let admin pick any employee as a manager.
  const [managers, setManagers] = useState([]);
  const [approvingAuthorities, setApprovingAuthorities] = useState([]);
  const limit = 10;

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      page, limit,
      ...(search       && { search }),
      ...(deptFilter   && { department:  deptFilter }),
      ...(roleFilter   && { role:        roleFilter }),
      ...(desigFilter  && { designation: desigFilter }),
      ...(statusFilter && { status:      statusFilter }),
    });
    api.get(`/employees?${params}`).then(r => { setEmployees(r.data.data); setTotal(r.data.total); }).catch(console.error).finally(()=>setLoading(false));
  };

  // Metadata (managers / departments / designations) used to be fetched
  // once on mount, so promoting someone to manager elsewhere wouldn't
  // appear in the dropdown until a full page reload. Re-fetch when the
  // tab regains focus so admin sees fresh dropdowns without F5.
  useEffect(() => {
    const fetchMetadata = () => {
      api.get('/employees/metadata').then(r => {
        const d = r.data.data || {};
        if (d.departments?.length)          setDepartments(d.departments);
        if (d.designations?.length)         setDesignations(d.designations);
        // roles is intentionally hardcoded above — no metadata override
        if (d.managers?.length)             setManagers(d.managers);
        if (d.approvingAuthorities?.length) setApprovingAuthorities(d.approvingAuthorities);
      }).catch(console.error);
    };
    fetchMetadata();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchMetadata(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(load, [page, search, deptFilter, roleFilter, desigFilter, statusFilter]);

  const openCreate = () => {
    setEditEmp(null);
    setForm(initForm);
    setLastSuggestedId('');
    setAppAccessList([]);
    setSelectedApps(new Set());
    setModal(true);
  };
  const openEdit = async (emp) => {
    setEditEmp(emp);
    // Kick off app-access fetch in parallel with the employee detail fetch.
    setAppAccessLoading(true);
    setAppAccessList([]);
    setSelectedApps(new Set());
    api.get(`/employees/${emp._id}/app-access`)
      .then(r => {
        const list = r.data.data || [];
        setAppAccessList(list);
        setSelectedApps(new Set(list.filter(a => a.hasAccess).map(a => a.id)));
      })
      .catch(() => setAppAccessList([]))
      .finally(() => setAppAccessLoading(false));
    // Fetch full employee record — list endpoint doesn't include PII fields
    // (PAN, Aadhaar, bank, etc.). The GET /employees/:id returns everything.
    let full = emp;
    try {
      const r = await api.get(`/employees/${emp._id}`);
      full = r.data.data || emp;
    } catch (_) { /* fall back to the row from the list */ }

    // pg returns snake_case; the route may return either format depending
    // on the SELECT. Coalesce both forms so we don't lose fields.
    const get = (a, b) => full[a] ?? full[b] ?? '';

    setForm({
      firstName: get('firstName', 'first_name'),
      lastName:  get('lastName',  'last_name'),
      email:     get('email',     'email'),
      employeeId: get('employeeId', 'employee_id') || '',
      password:'',
      phone:     get('phone', 'phone'),
      role:      get('role', 'role'),
      department: get('department', 'department'),
      designation: get('designation', 'designation'),
      company:    get('company', 'company'),
      joiningDate: (get('joiningDate', 'joining_date') || '').split?.('T')[0] || '',
      reportingManagerId:    get('reportingManagerId',   'reporting_manager_id') || '',
      approvingAuthorityId:  get('approvingAuthorityId', 'approving_authority_id') || '',
      monthlyCTC:  get('monthlyCTC',  'monthly_ctc'),
      basicSalary: get('basicSalary', 'basic_salary'),
      casualLeave: full.casualLeave ?? full.casual_leave ?? '',
      // Personal
      nickName:      get('nickName',      'nick_name'),
      dateOfBirth:  (get('dateOfBirth',   'date_of_birth') || '').split?.('T')[0] || '',
      gender:        get('gender',        'gender'),
      maritalStatus: get('maritalStatus', 'marital_status'),
      bloodGroup:    get('bloodGroup',    'blood_group'),
      nationality:   get('nationality',   'nationality'),
      // Contact
      personalEmail:    get('personalEmail',    'personal_email'),
      workPhone:        get('workPhone',        'work_phone'),
      address:          get('address',          'address'),
      permanentAddress: get('permanentAddress', 'permanent_address'),
      // Identity
      panNumber:     get('panNumber',     'pan_number'),
      aadhaarNumber: get('aadhaarNumber', 'aadhaar_number'),
      uanNumber:     get('uanNumber',     'uan_number'),
      // Bank
      bankName:    get('bankName',    'bank_name'),
      bankAccount: get('bankAccount', 'bank_account'),
      bankIfsc:    get('bankIfsc',    'bank_ifsc'),
      // Emergency
      emergencyContactName:     get('emergencyContactName',     'emergency_contact_name'),
      emergencyContactPhone:    get('emergencyContactPhone',    'emergency_contact_phone'),
      emergencyContactRelation: get('emergencyContactRelation', 'emergency_contact_relation'),
      // Work
      workLocation:   get('workLocation',   'work_location'),
      employmentType: get('employmentType', 'employment_type'),
      status:         get('status', 'status') || 'active',
      // Zoho extras
      exitDate:        (get('exitDate',        'exit_date') || '').split?.('T')[0] || '',
      totalExperience: get('totalExperience', 'total_experience'),
      expertise:       get('expertise', 'expertise'),
    });
    setLastSuggestedId(get('employeeId', 'employee_id') || '');
    setModal(true);
  };

  // Per-company Employee ID suggestion (only when creating a new employee).
  // Refetches whenever Company changes; respects admin-typed custom IDs.
  const [lastSuggestedId, setLastSuggestedId] = useState('');
  useEffect(() => {
    if (editEmp) return; // don't override existing IDs when editing
    if (!modal) return;
    api.get(`/employees/next-id?company=${encodeURIComponent(form.company || '')}`)
      .then(r => {
        const next = r.data.data?.suggested || '';
        setForm(f => (!f.employeeId || f.employeeId === lastSuggestedId) ? { ...f, employeeId: next } : f);
        setLastSuggestedId(next);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.company, modal, editEmp]);

  const openView = async (id) => {
    setViewEmpId(id);
    setLoadingView(true);
    try {
      const res = await api.get(`/employees/${id}`);
      setViewEmpData(res.data.data);
    } catch (err) {
      toast.error('Failed to load employee details');
      setViewEmpId(null);
    } finally {
      setLoadingView(false);
    }
  };


  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;

      // Save the employee fields first — that's the primary operation.
      let employeeId = editEmp?._id;
      if (editEmp) {
        await api.put(`/employees/${editEmp._id}`, payload);
        toast.success('Employee updated');
      } else {
        const r = await api.post('/employees', payload);
        employeeId = r.data?.data?._id || r.data?.data?.id;
        toast.success('Employee created');
      }

      // Then sync the app-access selection (idempotent — sets the list to
      // exactly what's checked). Skip if no apps are registered yet.
      if (employeeId && appAccessList.length > 0) {
        try {
          await api.put(`/employees/${employeeId}/app-access`, {
            apiConnectionIds: Array.from(selectedApps),
          });
        } catch (_) {
          toast.error('Saved, but app access could not be updated. Try again from Edit.');
        }
      }

      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this employee?')) return;
    try { await api.delete(`/employees/${id}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  /**
   * Pull every employee from Zoho People. Two-pass on the server — first
   * upserts, then resolves manager links. Imported users all start as
   * role='team_member'; admin promotes them via the Edit dialog afterwards.
   */
  const handleZohoSync = async () => {
    if (zohoSyncing) return;
    if (!confirm('Import all employees from Zoho People? Existing records will be updated; new records will be added with role "Employee" and no password set.')) return;
    setZohoSyncing(true);
    setZohoResult(null);
    try {
      const r = await api.post('/admin/zoho-sync');
      setZohoResult(r.data.stats);
      toast.success(`Imported ${r.data.stats.inserted}, updated ${r.data.stats.updated}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Zoho sync failed');
      setZohoResult(err.response?.data?.stats || null);
    } finally {
      setZohoSyncing(false);
    }
  };

  // Phase 2 — pull bank account / IFSC / CTC from the Zoho People Payroll
  // module. Best-effort: orgs without the Payroll subscription get a
  // graceful "0 updated" result, no error.
  const handlePayrollSync = async () => {
    if (zohoSyncing) return;
    if (!confirm('Sync payroll data (bank account, IFSC, CTC) from Zoho People Payroll? Existing values are never overwritten — only NULLs are filled.')) return;
    setZohoSyncing(true);
    try {
      const r = await api.post('/admin/zoho-sync-payroll');
      const s = r.data.stats;
      toast.success(`Payroll: processed ${s.processed}, updated ${s.updated}, skipped ${s.skipped}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Payroll sync failed');
    } finally {
      setZohoSyncing(false);
    }
  };

  // Phase 3 — download Zoho People file attachments (Aadhaar/PAN/offer
  // letter PDFs etc.) for every employee. Slow — ~5 min for 70 employees
  // depending on how many files each has.
  const handleDocumentsSync = async () => {
    if (zohoSyncing) return;
    if (!confirm("Import documents from Zoho People for every employee?\n\nThis can take several minutes — each employee's files are downloaded one at a time. Already-imported files are skipped.")) return;
    setZohoSyncing(true);
    try {
      const r = await api.post('/admin/zoho-sync-documents');
      const s = r.data.stats;
      toast.success(`Documents: ${s.downloaded} downloaded, ${s.skipped} skipped, ${s.failed} failed (${s.employees} employees scanned)`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Documents sync failed');
    } finally {
      setZohoSyncing(false);
    }
  };

  const handleSendOnboarding = async (e) => {
    e.preventDefault();
    setSendingEmail(true);
    try {
      await api.post('/employees/send-onboarding', onboardingForm);
      toast.success(`Onboarding email sent to ${onboardingForm.email}`);
      setOnboardingModal(false);
      setOnboardingForm({ email: '', candidateName: '', dueDate: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const pages = Math.ceil(total / limit);
  const roleColors = {
    admin:'bg-purple-100 text-purple-700',
    director:'bg-purple-100 text-purple-700',
    manager:'bg-brand-100 text-brand-700',
    team_incharge:'bg-brand-100 text-brand-700',
    team_member:'bg-slate-100 text-slate-600'
  };

  return (
    <div className="space-y-5">
      {/* Current vs Ex Employees tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {[
          { key: 'active',   label: 'Active Employees' },
          { key: 'inactive', label: 'Inactive Employees'      },
        ].map(t => (
          <button key={t.key}
            onClick={() => { setStatusFilter(t.key); setPage(1); }}
            className={`px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${statusFilter === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 flex-1">
            <div className="relative min-w-48 flex-1 max-w-72">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search employees..." className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
            </div>
            <select value={deptFilter} onChange={e=>{setDeptFilter(e.target.value);setPage(1)}} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-400">
              <option value="">All Departments</option>{departments.map(d=><option key={d}>{d}</option>)}
            </select>
            <select value={desigFilter} onChange={e=>{setDesigFilter(e.target.value);setPage(1)}} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-400">
              <option value="">All Designations</option>{designations.map(d=><option key={d}>{d}</option>)}
            </select>
            <select value={roleFilter} onChange={e=>{setRoleFilter(e.target.value);setPage(1)}} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-400">
              <option value="">All Roles</option>{roles.map(r=><option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          {isAdmin && (
            <button
              onClick={handleZohoSync}
              disabled={zohoSyncing}
              title="Pull every employee from Zoho People into Nxt-People"
              className="flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
            >
              <RefreshCw size={16} className={zohoSyncing ? 'animate-spin' : ''} />
              {zohoSyncing ? 'Syncing…' : 'Sync from Zoho'}
            </button>
          )}
          {/* Payroll + Documents sync buttons removed — Zoho tenant doesn't
              expose Payroll module or the Files API. Backend endpoints
              (/api/admin/zoho-sync-payroll, /api/admin/zoho-sync-documents)
              are still wired and can be re-enabled with a button if you
              ever subscribe to Zoho Payroll or get File API access. */}
          <button onClick={() => setOnboardingModal(true)} className="flex items-center gap-2 bg-white hover:bg-slate-50 text-brand-600 border border-brand-200 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
            <Mail size={16}/> Send Preboarding
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16}/> Add Employee
          </button>
        </div>

        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-slate-50">{['Employee','ID','Department','Role','Designation', statusFilter === 'inactive' ? 'Left On' : 'Joining Date','Actions'].map(h=><th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {employees.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-slate-400">No employees found</td></tr> :
                  employees.map(emp => (
                    <tr key={emp._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {/* Initials gradient is always rendered. If a photo URL
                              exists AND loads, the image overlays on top. If it
                              fails (broken URL, Zoho auth, etc.), the image
                              hides itself and the initials show through —
                              giving every row a consistent avatar circle. */}
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 relative overflow-hidden">
                            <span>{emp.firstName?.[0]}{emp.lastName?.[0]}</span>
                            {emp.photoUrl && (
                              <img src={emp.photoUrl} alt=""
                                referrerPolicy="no-referrer"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                className="absolute inset-0 w-full h-full object-cover"/>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                              {emp.firstName} {emp.lastName}
                              {emp.isBlacklisted && (
                                <span title="Blacklisted — flag during future onboarding" className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">🚫 BLACKLIST</span>
                              )}
                              {emp.status === 'notice_period' && (
                                <span title={`Notice period ends ${emp.noticePeriodEndDate || ''}`} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">NOTICE</span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 font-mono">{emp.employeeId}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{emp.department}</td>
                      <td className="px-5 py-3.5"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[emp.role]}`}>{roleLabel(emp.role)}</span></td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{emp.designation}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-500">
                        {statusFilter === 'inactive'
                          ? (emp.exitDate ? new Date(emp.exitDate).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '—')
                          : (emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '—')}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button onClick={()=>openView(emp._id)} title="View" className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"><Eye size={14}/></button>
                          {/* Edit / status / delete are employee-management actions — HR / Super Admin only. */}
                          {isAdmin && (<>
                          <button onClick={()=>openEdit(emp)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors"><Edit2 size={14}/></button>
                          <button onClick={()=>openStatus(emp)} title="Update employment status (notice period / exit / blacklist)" className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors text-[15px] font-bold">⚑</button>
                          <button onClick={()=>handleDelete(emp._id)} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"><Trash2 size={14}/></button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">Showing {Math.min((page-1)*limit+1, total)}–{Math.min(page*limit, total)} of {total} employees</p>
              <div className="flex gap-2">
                <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 disabled:opacity-40 hover:bg-slate-200 transition-colors"><ChevronLeft size={16}/></button>
                <button onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 disabled:opacity-40 hover:bg-slate-200 transition-colors"><ChevronRight size={16}/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {onboardingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="font-display font-semibold text-slate-800 text-lg">Send Preboarding Email</h3>
                <p className="text-xs text-slate-400 mt-0.5">Invite a candidate to complete their registration</p>
              </div>
              <button onClick={() => setOnboardingModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSendOnboarding} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Candidate Email <span className="text-brand-600">*</span></label>
                <input
                  type="email"
                  value={onboardingForm.email}
                  onChange={e => setOnboardingForm({...onboardingForm, email: e.target.value})}
                  placeholder="candidate@example.com"
                  required
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Candidate Name <span className="text-slate-400">(optional)</span></label>
                <input
                  type="text"
                  value={onboardingForm.candidateName}
                  onChange={e => setOnboardingForm({...onboardingForm, candidateName: e.target.value})}
                  placeholder="e.g. Ravi Kumar"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Registration Deadline <span className="text-slate-400">(optional)</span></label>
                <input
                  type="date"
                  value={onboardingForm.dueDate}
                  onChange={e => setOnboardingForm({...onboardingForm, dueDate: e.target.value})}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
                />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                The candidate will receive an email with a link to complete their registration and a list of required documents.
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setOnboardingModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={sendingEmail} className="flex-1 flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
                  {sendingEmail ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Sending...</> : <><Send size={14}/>Send Email</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <h3 className="font-display font-semibold text-slate-800 text-lg">{editEmp ? 'Edit Employee' : 'Add New Employee'}</h3>
              <button onClick={()=>setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                {[['firstName','First Name'],['lastName','Last Name']].map(([f,l])=>(
                  <div key={f}>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">{l}</label>
                    <input value={form[f]} onChange={e=>setForm({...form,[f]:e.target.value})} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Company</label>
                  <select value={form.company} onChange={e=>setForm({...form,company:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                    <option value="">Select...</option>
                    {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee ID</label>
                  <input value={form.employeeId} onChange={e=>setForm({...form,employeeId:e.target.value})} placeholder="e.g. NXT0001" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  <p className="text-[11px] text-slate-400 mt-1">{editEmp ? 'Change if needed — must be unique.' : 'Auto-suggested based on Company.'}</p>
                </div>
              </div>
              {!editEmp && <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Password</label>
                <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required={!editEmp} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
              </div>}
<div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Department</label>
                   <select value={form.department} onChange={e=>setForm({...form,department:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                     {departments.map(d=><option key={d}>{d}</option>)}
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
                   <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                     {roles.map(r=><option key={r} value={r}>{roleLabel(r)}</option>)}
                   </select>
                 </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Designation</label>
                   <select value={form.designation} onChange={e=>setForm({...form,designation:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                     <option value="">Select...</option>
                     {designations.map(d=><option key={d}>{d}</option>)}
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Reporting Person</label>
                   <select value={form.reportingManagerId} onChange={e=>setForm({...form,reportingManagerId:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                     <option value="">None</option>
                     {managers.map(m => <option key={m._id} value={m._id}>{m.firstName} {m.lastName}{m.designation ? ` — ${m.designation}` : ''}</option>)}
                   </select>
                 </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Secondary Reporting Person</label>
                   <select value={form.approvingAuthorityId} onChange={e=>setForm({...form,approvingAuthorityId:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                     <option value="">None</option>
                     {/* Use the same leadership list as Reporting Person — admin
                         shouldn't be able to pick a trainee as an approver. */}
                     {managers.map(m => <option key={m._id} value={m._id}>{m.firstName} {m.lastName}{m.designation ? ` — ${m.designation}` : ''}</option>)}
                   </select>
                 </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Joining Date</label>
                   <input type="date" value={form.joiningDate} onChange={e=>setForm({...form,joiningDate:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                 </div>
                 <div>
                   <label className="block text-xs font-medium text-slate-600 mb-1.5">Phone</label>
                   <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                 </div>
               </div>
              {/* Personal */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Personal</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Nickname</label>
                    <input value={form.nickName} onChange={e=>setForm({...form,nickName:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Date of Birth</label>
                    <input type="date" value={form.dateOfBirth} onChange={e=>setForm({...form,dateOfBirth:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Gender</label>
                    <select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                      <option value="">Select...</option>
                      {['Male','Female','Other'].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Marital Status</label>
                    <select value={form.maritalStatus} onChange={e=>setForm({...form,maritalStatus:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                      <option value="">Select...</option>
                      {['Single','Married'].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Blood Group</label>
                    <select value={form.bloodGroup} onChange={e=>setForm({...form,bloodGroup:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                      <option value="">Select...</option>
                      {['A+','A-','A1+','A1-','B+','B-','AB+','AB-','A1B+','A1B-','O+','O-'].map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Nationality</label>
                    <input value={form.nationality} onChange={e=>setForm({...form,nationality:e.target.value})} placeholder="e.g. Indian" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Personal Email</label>
                    <input type="email" value={form.personalEmail} onChange={e=>setForm({...form,personalEmail:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Work Phone</label>
                    <input value={form.workPhone} onChange={e=>setForm({...form,workPhone:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Current Address</label>
                    <textarea rows={2} value={form.address} onChange={e=>setForm({...form,address:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none"/>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Permanent Address</label>
                    <textarea rows={2} value={form.permanentAddress} onChange={e=>setForm({...form,permanentAddress:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none"/>
                  </div>
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Emergency Contact</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Name</label>
                    <input value={form.emergencyContactName} onChange={e=>setForm({...form,emergencyContactName:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Phone</label>
                    <input value={form.emergencyContactPhone} onChange={e=>setForm({...form,emergencyContactPhone:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Relationship</label>
                    <input value={form.emergencyContactRelation} onChange={e=>setForm({...form,emergencyContactRelation:e.target.value})} placeholder="e.g. Father" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                </div>
              </div>

              {/* Experience + Expertise */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Experience & Expertise</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Total Experience</label>
                    <input value={form.totalExperience} onChange={e=>setForm({...form,totalExperience:e.target.value})} placeholder="e.g. 5 years 3 months" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Work Location</label>
                    <input value={form.workLocation} onChange={e=>setForm({...form,workLocation:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Expertise / Skills</label>
                    <textarea rows={2} value={form.expertise} onChange={e=>setForm({...form,expertise:e.target.value})} placeholder="e.g. React, Node.js, Python (comma separated)" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none"/>
                  </div>
                </div>
              </div>

              {/* Status (Current / Ex Employee) — admin can toggle here */}
              {editEmp && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Employment Status</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                      <select value={form.status} onChange={e=>setForm({...form,status:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                        <option value="active">Active (Current Employee)</option>
                        <option value="resigned">Resigned</option>
                        <option value="terminated">Terminated</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Employment Type</label>
                      <select value={form.employmentType} onChange={e=>setForm({...form,employmentType:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                        <option value="">Select...</option>
                        {['Full Time','Part Time','Contract','Intern','Consultant'].map(o=><option key={o}>{o}</option>)}
                      </select>
                    </div>
                    {/* Exit Date — only meaningful when status != active. */}
                    {form.status !== 'active' && (
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">Exit Date <span className="text-slate-400 font-normal">(when they left)</span></label>
                        <input type="date" value={form.exitDate} onChange={e=>setForm({...form,exitDate:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* App Access — only meaningful when editing an existing
                  employee. Lets admin grant/revoke internal app access
                  inline instead of a second trip to the Apps page. */}
              {editEmp && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">App Access</p>
                  <AppAccessPicker
                    apps={appAccessList}
                    selected={selectedApps}
                    onChange={setSelectedApps}
                    loading={appAccessLoading}
                  />
                </div>
              )}

              {/* Leave Balance */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Leave Balance (days)</p>
                <div className="grid grid-cols-3 gap-3">
                  {[['casualLeave','Casual']].map(([f,l])=>(
                    <div key={f}>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">{l}</label>
                      <input type="number" value={form[f]} onChange={e=>setForm({...form,[f]:e.target.value})} min={0} max={365} step={0.5} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
                  {saving ? 'Saving...' : editEmp ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Employment Status modal — focused workflow for notice period
          and exit. Captures applied date, end date, reason, rehire flag,
          blacklist. Auto-revoke cron handles login access on the end date. */}
      {statusModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="font-display font-semibold text-slate-800 text-lg">Update Employment Status</h3>
                <p className="text-xs text-slate-400 mt-0.5">{statusModal.firstName} {statusModal.lastName} · {statusModal.employeeId || statusModal.email}</p>
              </div>
              <button onClick={()=>setStatusModal(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>

            <form onSubmit={(e)=>{e.preventDefault();handleStatusSave();}} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">New Status</label>
                <select value={statusForm.status} onChange={e=>setStatusForm({...statusForm,status:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  {statusMeta(statusForm.status).loginAccess
                    ? '✓ Employee keeps login access at this status.'
                    : '⚠️ Setting this status revokes login access immediately.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Status Applied Date</label>
                  <input type="date" value={statusForm.statusAppliedAt} onChange={e=>setStatusForm({...statusForm,statusAppliedAt:e.target.value})} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                </div>
                {statusForm.status === 'notice_period' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Notice Period End Date <span className="text-red-500">*</span></label>
                    <input type="date" value={statusForm.noticePeriodEndDate} onChange={e=>setStatusForm({...statusForm,noticePeriodEndDate:e.target.value})} required min={statusForm.statusAppliedAt || undefined} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                    <p className="text-[10.5px] text-slate-400 mt-1">Login access auto-revoked the day after this date.</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Reason</label>
                <textarea rows={3} value={statusForm.statusReason} onChange={e=>setStatusForm({...statusForm,statusReason:e.target.value})} placeholder="Why this status change?" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none"/>
              </div>

              {['notice_period','resigned','terminated','inactive'].includes(statusForm.status) && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Will you rehire?</label>
                  <div className="flex gap-3">
                    {[
                      { v: 'yes',   label: 'Yes',   cls: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
                      { v: 'maybe', label: 'Maybe', cls: 'bg-amber-50 border-amber-300 text-amber-700' },
                      { v: 'no',    label: 'No',    cls: 'bg-red-50 border-red-300 text-red-700' },
                    ].map(o => (
                      <label key={o.v} className={`flex-1 px-3 py-2 rounded-xl border text-sm font-medium text-center cursor-pointer ${statusForm.rehireEligibility === o.v ? o.cls : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        <input type="radio" name="rehire" className="hidden" checked={statusForm.rehireEligibility === o.v} onChange={() => setStatusForm({...statusForm, rehireEligibility: o.v})}/>
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={statusForm.isBlacklisted} onChange={e=>setStatusForm({...statusForm,isBlacklisted:e.target.checked})} className="w-4 h-4 accent-red-600"/>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Blacklist this person</p>
                    <p className="text-[11px] text-slate-400">If checked, future onboarding for the same email shows a warning. Use sparingly — this is a permanent mark on the record.</p>
                  </div>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setStatusModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={statusSaving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
                  {statusSaving ? 'Saving…' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewEmpId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="font-display font-semibold text-slate-800 text-xl">Employee Details</h3>
                <p className="text-slate-400 text-sm mt-0.5">{viewEmpData ? `${viewEmpData.firstName} ${viewEmpData.lastName}` : 'Loading...'}</p>
              </div>
              <button onClick={() => { setViewEmpId(null); setViewEmpData(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
              {loadingView ? (
                <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : viewEmpData ? (
                <div className="space-y-6">
                  {/* Basic HR Info */}
                  <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                    <h4 className="text-slate-800 font-semibold mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500"></div> Work Information
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Employee ID</span><span className="text-slate-800 font-mono font-medium">{viewEmpData.employeeId || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Email</span><span className="text-slate-800 break-all">{viewEmpData.email}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Department</span><span className="text-slate-800">{viewEmpData.department || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Designation</span><span className="text-slate-800">{viewEmpData.designation || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Role</span><span className="text-slate-800">{roleLabel(viewEmpData.role)}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Joining Date</span><span className="text-slate-800">{viewEmpData.joiningDate ? new Date(viewEmpData.joiningDate).toLocaleDateString() : '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Company</span><span className="text-slate-800">{viewEmpData.company || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Division</span><span className="text-slate-800">{viewEmpData.division || '—'}</span></div>
                    </div>
                  </div>

                  {/* Personal Preboard Info */}
                  <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                    <h4 className="text-slate-800 font-semibold mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> Personal Details
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Phone</span><span className="text-slate-800">{viewEmpData.phone || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Gender</span><span className="text-slate-800">{viewEmpData.gender || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Date of Birth</span><span className="text-slate-800">{viewEmpData.date_of_birth ? new Date(viewEmpData.date_of_birth).toLocaleDateString() : '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Marital Status</span><span className="text-slate-800">{viewEmpData.marital_status || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Blood Group</span><span className="text-slate-800">{viewEmpData.blood_group || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">Aadhaar Number</span><span className="text-slate-800 font-mono">{viewEmpData.aadhaar_number || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">PAN Number</span><span className="text-slate-800 font-mono">{viewEmpData.pan_number || '—'}</span></div>
                      <div><span className="block text-slate-400 text-xs font-medium mb-0.5">UAN Number</span><span className="text-slate-800 font-mono">{viewEmpData.uan_number || '—'}</span></div>
                      <div className="md:col-span-4 mt-2">
                        <span className="block text-slate-400 text-xs font-medium mb-0.5">Current Address</span>
                        <span className="text-slate-800">
                          {viewEmpData.current_address ? `${viewEmpData.current_address}, ${viewEmpData.city || ''}, ${viewEmpData.state || ''}, ${viewEmpData.country || ''} - ${viewEmpData.pin_code || ''}` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Education Info */}
                  {viewEmpData.education && viewEmpData.education.length > 0 && (
                    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                      <h4 className="text-slate-800 font-semibold mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Education
                      </h4>
                      <div className="space-y-3">
                        {viewEmpData.education.map((edu, i) => (
                          <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                            <div className="font-semibold text-slate-800">{edu.highest_qualification}</div>
                            <div className="text-slate-600 mt-1">{edu.university_or_institution} <span className="text-slate-400 mx-2">•</span> {edu.year_of_passing} <span className="text-slate-400 mx-2">•</span> {edu.percentage_or_cgpa}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Documents Info */}
                  {viewEmpData.documents && viewEmpData.documents.length > 0 && (
                    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                      <h4 className="text-slate-800 font-semibold mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Uploaded Documents
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {viewEmpData.documents.map((doc, i) => {
                          const fileUrl = `/uploads/${doc.filePath}`;
                          return (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-colors group">
                              <div className="flex items-center gap-3 overflow-hidden">
                                <div className="w-8 h-8 rounded bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
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
              ) : null}
            </div>
            
            <div className="p-5 border-t border-slate-100 bg-white rounded-b-2xl flex justify-end">
              <button onClick={() => { setViewEmpId(null); setViewEmpData(null); }} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Zoho sync result modal ─────────────────────────────────── */}
      {zohoResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <h3 className="font-semibold text-slate-800 text-[15px]">Zoho sync complete</h3>
              </div>
              <button onClick={() => setZohoResult(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'New employees added', value: zohoResult.inserted ?? 0, tone: 'text-emerald-700' },
                  { label: 'Existing records updated', value: zohoResult.updated ?? 0, tone: 'text-blue-700' },
                  { label: 'Manager links resolved', value: (zohoResult.managersResolved ?? 0) + (zohoResult.secondaryManagersResolved ?? 0), tone: 'text-slate-700' },
                  { label: 'Skipped (no email)',       value: zohoResult.skipped ?? 0, tone: 'text-amber-700' },
                ].map(t => (
                  <div key={t.label} className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">{t.label}</p>
                    <p className={`text-[22px] font-bold ${t.tone}`}>{t.value}</p>
                  </div>
                ))}
              </div>
              {zohoResult.errors?.length > 0 && (
                <div className="border border-red-200 bg-red-50/60 rounded-lg p-3">
                  <p className="text-[12px] font-semibold text-red-700 mb-1">
                    {zohoResult.errors.length} record(s) failed
                  </p>
                  <ul className="text-[11.5px] text-red-700 space-y-1 max-h-32 overflow-y-auto">
                    {zohoResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}><span className="font-mono">{e.email}</span> — {e.message}</li>
                    ))}
                    {zohoResult.errors.length > 10 && (
                      <li className="text-red-500 italic">… and {zohoResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
              <p className="text-[11.5px] text-slate-500">
                All new employees are imported with role <strong>Employee</strong>. Use the Edit button on
                any row to promote someone to <strong>Team Lead</strong> or <strong>Admin</strong>.
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setZohoResult(null)}
                className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
