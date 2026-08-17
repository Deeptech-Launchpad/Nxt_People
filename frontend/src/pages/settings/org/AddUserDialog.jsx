import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Search } from 'lucide-react';
import api from '../../../utils/api';
import { selectClass } from '../configKit';
import { roleLabel } from '../../../utils/roles';

// Add User(s) / Add Employee Profile.
//
// Two ways in, because there are two situations. Someone genuinely new gets
// typed in. Far more often the person already exists in the other group — an
// employee profile is usually a user whose login is being taken away, and a new
// user is usually a profile finally being given one. Retyping somebody who is
// already on record would create a duplicate, so picking them is the first tab.
//
// Both directions are the same account change, so both use the same endpoint,
// which already refuses to leave the organization with no administrator who can
// sign in.
//
// The reference wraps this in a four-step wizard whose first step chooses an
// invitation source — Zoho Mail, Google Workspace, Microsoft 365. Those are
// directory integrations we do not have, so that step would be a choice with
// one option. This is its second step, the part that creates somebody.
const ROLES = ['team_member', 'team_incharge', 'manager', 'hr_admin', 'director', 'admin'];

export default function AddUserDialog({ isUser, onClose, onCreated }) {
  // isUser is the group being added TO, so the pickable people are the other one.
  const [mode, setMode] = useState('existing');
  const [form, setForm] = useState({
    employeeCode: '', firstName: '', lastName: '', email: '',
    role: 'team_member', joiningDate: '', locationId: '', departmentId: '',
  });
  const [codes, setCodes] = useState({ last: null, next: null });
  const [locations, setLocations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const otherGroup = isUser ? 'profiles' : 'users';

  const loadCandidates = useCallback(() => {
    api.get(`/org-users?group=${otherGroup}&filter=all`)
      .then(r => setCandidates(r.data.data || []))
      .catch(() => setCandidates([]));
  }, [otherGroup]);

  useEffect(() => {
    loadCandidates();
    api.get('/org-users/next-code').then(r => setCodes(r.data.data || {})).catch(() => {});
    api.get('/org-setup/locations').then(r => setLocations(r.data.data || [])).catch(() => {});
    api.get('/org-setup/departments').then(r => setDepartments(r.data.data || [])).catch(() => {});
  }, [loadCandidates]);

  const set = changes => setForm(f => ({ ...f, ...changes }));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates || [];
    return (candidates || []).filter(c =>
      `${c.name} ${c.email} ${c.employeeCode || ''}`.toLowerCase().includes(q));
  }, [candidates, search]);

  const toggle = id =>
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submitExisting = () => {
    setBusy(true);
    api.patch('/org-users/accounts', { ids: [...picked], isUser })
      .then(r => {
        toast.success(`${r.data.data.moved} moved`);
        onCreated();
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not move them'))
      .finally(() => setBusy(false));
  };

  const submitNew = () => {
    setBusy(true);
    api.post('/org-users', { ...form, isUser })
      .then(r => { toast.success(`${r.data.data.name} added`); onCreated(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not add'))
      .finally(() => setBusy(false));
  };

  const input = 'w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';
  const label = 'block text-[13px] font-medium text-slate-700 mb-1.5';

  const canSubmit = mode === 'existing'
    ? picked.size > 0
    : form.firstName.trim() && form.email.trim();

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <p className="text-[16px] font-semibold text-slate-800">
            {isUser ? 'Add User(s)' : 'Add Employee Profile'}
          </p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="flex gap-1 px-6 pt-4 border-b border-slate-100">
          {[
            ['existing', isUser ? 'From employee profiles' : 'From existing users'],
            ['new', 'Someone new'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`px-4 py-2 text-[14px] border-b-2 -mb-px transition-colors ${
                mode === k ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-800'
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {mode === 'existing' ? (
            <>
              <p className="text-[13px] text-slate-600">
                {isUser
                  ? 'Give a login account to someone already on record. They keep their employee id, history and everything else.'
                  : 'Take the login account away from someone, and keep them on record. Their attendance and leave history is untouched.'}
              </p>

              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, email or employee id"
                  className={`${input} pl-8`}
                />
              </div>

              {candidates === null ? (
                <p className="text-[13.5px] text-slate-500 py-6 text-center">Loading…</p>
              ) : visible.length === 0 ? (
                <p className="text-[13.5px] text-slate-500 py-6 text-center">
                  {candidates.length === 0
                    ? (isUser ? 'There are no employee profiles to promote.' : 'There are no users to move.')
                    : 'Nobody matches that search.'}
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg max-h-[260px] overflow-y-auto">
                  {visible.map(c => (
                    <label key={c.id}
                      className="flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)}
                        className="w-4 h-4 accent-blue-600 flex-shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-[14px] text-slate-800 truncate">
                          {c.employeeCode ? `${c.employeeCode} - ` : ''}{c.name}
                        </span>
                        <span className="block text-[13px] text-slate-500 truncate">{c.email}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {picked.size > 0 && (
                <p className="text-[13px] text-blue-700">{picked.size} selected</p>
              )}
            </>
          ) : (
            <>
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
                {codes.last && <p className="text-[12.5px] text-slate-500 mt-1">Last employee ID: {codes.last}</p>}
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
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <button
            onClick={mode === 'existing' ? submitExisting : submitNew}
            disabled={busy || !canSubmit}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium"
          >
            {busy ? 'Saving…' : mode === 'existing' ? `Add${picked.size ? ` ${picked.size}` : ''}` : 'Add'}
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
