import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';
import { selectClass } from '../configKit';
import { roleLabel } from '../../../utils/roles';

// Add User(s) / Add Employee Profile — the same form either way, because it is
// the same person record. The only difference is whether an account comes with
// it, which the caller decides.
//
// The reference wraps this in a four-step wizard whose first step chooses an
// invitation source: Zoho Mail, Google Workspace, Microsoft 365. Those are
// directory integrations we do not have, so the source step would be a choice
// with one option. This is its second step, which is the part that creates
// somebody.
//
// No password is set here. A user added this way shows under Invited until
// they set one through the reset-password flow, which is what that filter is
// for.
const ROLES = ['team_member', 'team_incharge', 'manager', 'hr_admin', 'director', 'admin'];

export default function AddUserDialog({ isUser, onClose, onCreated }) {
  const [form, setForm] = useState({
    employeeCode: '', firstName: '', lastName: '', email: '',
    role: 'team_member', joiningDate: '', locationId: '', departmentId: '',
  });
  const [codes, setCodes] = useState({ last: null, next: null });
  const [locations, setLocations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/org-users/next-code').then(r => setCodes(r.data.data || {})).catch(() => {});
    api.get('/org-setup/locations').then(r => setLocations(r.data.data || [])).catch(() => {});
    api.get('/org-setup/departments').then(r => setDepartments(r.data.data || [])).catch(() => {});
  }, []);

  const set = changes => setForm(f => ({ ...f, ...changes }));

  const submit = () => {
    setBusy(true);
    api.post('/org-users', { ...form, isUser })
      .then(r => {
        toast.success(`${r.data.data.name} added`);
        onCreated();
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not add'))
      .finally(() => setBusy(false));
  };

  const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
  const label = 'block text-[13px] font-medium text-slate-700 mb-1.5';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            {isUser ? 'Add User' : 'Add Employee Profile'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div>
            <label className={label}>Employee ID</label>
            <div className="flex items-center gap-2">
              <input value={form.employeeCode} onChange={e => set({ employeeCode: e.target.value })} className={input} />
              <button
                onClick={() => set({ employeeCode: codes.next || '' })}
                disabled={!codes.next}
                className="flex-shrink-0 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 px-3 py-2 rounded text-[13.5px]"
              >
                Generate
              </button>
            </div>
            {codes.last && (
              <p className="text-[12.5px] text-slate-500 mt-1">Last employee ID: {codes.last}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>First name<span className="text-red-500 ml-0.5">*</span></label>
              <input value={form.firstName} onChange={e => set({ firstName: e.target.value })} className={input} />
            </div>
            <div>
              <label className={label}>Last name</label>
              <input value={form.lastName} onChange={e => set({ lastName: e.target.value })} className={input} />
            </div>
          </div>

          <div>
            <label className={label}>Email address<span className="text-red-500 ml-0.5">*</span></label>
            <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={input} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Role</label>
              <select value={form.role} onChange={e => set({ role: e.target.value })} className={`${selectClass} w-full`}>
                {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Date of joining</label>
              <input type="date" value={form.joiningDate} onChange={e => set({ joiningDate: e.target.value })} className={input} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Location</label>
              <select value={form.locationId} onChange={e => set({ locationId: e.target.value })} className={`${selectClass} w-full`}>
                <option value="">Not set</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Department</label>
              <select value={form.departmentId} onChange={e => set({ departmentId: e.target.value })} className={`${selectClass} w-full`}>
                <option value="">Not set</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <p className="text-[12.5px] text-slate-500">
            {isUser
              ? 'No password is set. They appear under Invited until they set one from the sign-in page.'
              : 'An employee profile has no login. Give them one later from the Actions column.'}
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !form.firstName.trim() || !form.email.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
          >
            {busy ? 'Adding…' : 'Add'}
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
