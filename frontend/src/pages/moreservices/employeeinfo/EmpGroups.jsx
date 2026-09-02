import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Pencil, Trash2, Search, MoreHorizontal } from 'lucide-react';
import api from '../../../utils/api';

/* Operations -> Employee Information -> Groups.
 *
 * Deliberately not the shared list component: the reference's Groups screen has
 * no saved views, no filter panel, no column picker and no paging — it is a
 * plain table with a scope dropdown and Add Group. Forcing it through the list
 * chrome would add four controls that do nothing.
 *
 * Clicking a row opens the detail panel with the member table, where Role is a
 * two-value dropdown. The server refuses to demote or remove the last
 * administrator; this surfaces that message rather than pre-empting it, so the
 * rule lives in one place.
 */
const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
const label = 'block text-[14px] font-medium text-slate-600 mb-1.5';

function PersonPicker({ label: text, chosen, onChange, exclude = [] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?limit=8&search=${encodeURIComponent(q.trim())}`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);   // debounced: a request per keystroke would hammer the endpoint
    return () => clearTimeout(t);
  }, [q]);

  const add = (p) => {
    if (!chosen.some(c => c._id === p._id)) onChange([...chosen, p]);
    setQ(''); setResults([]); setOpen(false);
  };

  return (
    <div>
      <label className={label}>{text}</label>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {chosen.map(p => (
            <span key={p._id} className="inline-flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1 text-[14px] text-slate-700">
              {p.employeeId} {p.firstName} {p.lastName}
              <button onClick={() => onChange(chosen.filter(c => c._id !== p._id))}
                className="text-slate-400 hover:text-rose-600"><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input className={input} value={q} placeholder="Start typing to search Employee"
          onChange={e => { setQ(e.target.value); setOpen(true); }} />
        {open && results.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-56 overflow-y-auto">
            {results.filter(p => !exclude.includes(p._id)).map(p => (
              <button key={p._id} onClick={() => add(p)}
                className="w-full text-left px-3.5 py-2 text-[14px] text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                {p.photoUrl
                  ? <img src={p.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                  : <span className="w-6 h-6 rounded-full bg-slate-100" />}
                {p.employeeId} {p.firstName} {p.lastName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmpGroups() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState('all');
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/employee-groups${scope === 'my' ? '?scope=my' : ''}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load groups'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [scope]);

  const openDetail = (g) => {
    api.get(`/employee-groups/${g._id}`)
      .then(r => setDetail(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not open that group'));
  };
  const refreshDetail = () => detail && openDetail({ _id: detail._id });

  const save = async () => {
    if (!String(form.name || '').trim()) return toast.error('Group name is required');
    if (!form.id && !(form.administrators || []).length) return toast.error('Choose an administrator');
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/employee-groups/${form.id}`, {
          name: form.name, description: form.description, email: form.email,
        });
        toast.success('Group updated');
      } else {
        const r = await api.post('/employee-groups', {
          name: form.name, description: form.description, email: form.email,
          administrators: (form.administrators || []).map(p => p._id),
          members: (form.members || []).map(p => p._id),
          notify: !!form.notify,
        });
        toast.success(r.data?.message || 'Group created');
      }
      setForm(null); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that group');
    } finally { setSaving(false); }
  };

  const setRole = async (employeeId, role) => {
    try {
      await api.put(`/employee-groups/${detail._id}/members/${employeeId}`, { role });
      toast.success('Role updated');
      refreshDetail();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not change that role');
    }
  };

  const removeMember = async (employeeId) => {
    try {
      await api.delete(`/employee-groups/${detail._id}/members/${employeeId}`);
      toast.success('Removed from group');
      refreshDetail(); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that person');
    }
  };

  const addMembers = async (people) => {
    try {
      await api.post(`/employee-groups/${detail._id}/members`, { employeeIds: people.map(p => p._id) });
      refreshDetail(); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add those people');
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2.5 mb-3">
        <select value={scope} onChange={e => setScope(e.target.value)}
          className="h-10 border border-slate-200 rounded-lg px-3 text-[15px] text-slate-700 bg-white focus:outline-none focus:border-brand-400">
          <option value="all">All groups</option>
          <option value="my">My groups</option>
        </select>
        <button onClick={() => setForm({ name: '', description: '', email: '', administrators: [], members: [] })}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium">
          <Plus size={16} /> Add Group
        </button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Group name</th>
              <th className="px-4 py-2.5 text-left font-medium">Group email address</th>
              <th className="px-4 py-2.5 text-left font-medium">Description</th>
              <th className="px-4 py-2.5 text-left font-medium w-24">Members</th>
              <th className="px-4 py-2.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-16 text-center">
                <div className="inline-block w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-16 text-center text-slate-400">No groups yet.</td></tr>
            ) : rows.map(g => (
              <tr key={g._id} onClick={() => openDetail(g)}
                className="border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer">
                <td className="px-4 py-2.5 text-slate-800">{g.name}</td>
                <td className="px-4 py-2.5 text-brand-600">{g.email || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-600">{g.description || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{g.memberCount}</td>
                <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setForm({ id: g._id, name: g.name, description: g.description, email: g.email })}
                      title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setToDelete(g)}
                      title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">{detail.name}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => { setForm({ id: detail._id, name: detail.name, description: detail.description, email: detail.email }); setDetail(null); }}
                  title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                  <Pencil size={16} />
                </button>
                <button onClick={() => setDetail(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="flex-1">
                <PersonPicker label="" chosen={[]} onChange={addMembers}
                  exclude={detail.members.map(m => m.employeeId)} />
              </div>
              <span className="text-[14px] text-slate-500 whitespace-nowrap mt-1">
                Total Users <span className="text-slate-800 font-medium">{detail.members.length}</span>
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <table className="w-full text-[15px]">
                <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">User</th>
                    <th className="px-4 py-2.5 text-left font-medium w-48">Role</th>
                    <th className="px-4 py-2.5 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {detail.members.length === 0 && (
                    <tr><td colSpan={3} className="py-10 text-center text-slate-400">Nobody in this group yet.</td></tr>
                  )}
                  {detail.members.map(m => (
                    <tr key={m._id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {m.photoUrl
                            ? <img src={m.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                            : <span className="w-8 h-8 rounded-full bg-slate-100" />}
                          <span className="text-slate-400 text-[13.5px]">{m.code}</span>
                          <span className="text-slate-800 font-medium">{m.firstName} {m.lastName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select value={m.role} onChange={e => setRole(m.employeeId, e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[14px] focus:outline-none focus:border-brand-400">
                          <option value="admin">Group admin</option>
                          <option value="member">Group member</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => removeMember(m.employeeId)} title="Remove"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-slate-100">
              <button onClick={() => setDetail(null)}
                className="border border-slate-200 text-slate-600 px-6 py-2 rounded-xl text-[15px] hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit */}
      {form && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setForm(null)} />
          <div className="relative bg-white w-full max-w-lg h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">
                {form.id ? 'Edit Group' : 'Add Group'}
              </h3>
              <button onClick={() => setForm(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className={label}>Group name <span className="text-rose-500">*</span></label>
                <input className={input} value={form.name || ''} autoFocus
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Description</label>
                <textarea className={`${input} h-28 resize-none`} value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Group email address</label>
                <input className={input} value={form.email || ''}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              {!form.id && (
                <>
                  <PersonPicker label="Administrator *" chosen={form.administrators || []}
                    onChange={v => setForm(f => ({ ...f, administrators: v }))} />
                  <PersonPicker label="Members" chosen={form.members || []}
                    onChange={v => setForm(f => ({ ...f, members: v }))} />
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!form.notify}
                      onChange={e => setForm(f => ({ ...f, notify: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-brand-600" />
                    <span className="text-[14px] text-slate-700">
                      Notify newly added employees.
                      {/* Recorded, never acted on. Nothing here emails anybody. */}
                      <span className="block text-[13px] text-amber-700 mt-0.5">
                        Recorded only — no email is sent automatically.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
              <button onClick={save} disabled={saving}
                className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setForm(null)}
                className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Delete "{toDelete.name}"?</h3>
            <p className="text-[14px] text-slate-500 mt-2">
              {toDelete.memberCount} member(s) will lose this group. Their records are untouched.
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setToDelete(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={async () => {
                  try {
                    await api.delete(`/employee-groups/${toDelete._id}`);
                    toast.success('Group deleted'); setToDelete(null); load();
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Could not delete that group');
                  }
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl text-[15px] font-medium">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
