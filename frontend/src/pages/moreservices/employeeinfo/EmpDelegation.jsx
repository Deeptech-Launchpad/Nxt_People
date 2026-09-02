import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Trash2, Pencil, ArrowRight, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';

/* Operations -> Employee Information -> Delegation.
 *
 * Records who is covering whose approvals and for how long. The records exist
 * and are enforced against overlap; the approval engine does NOT read them yet,
 * because rerouting live approvals the moment a row is saved would change who
 * can approve leave and pay without anybody asking for it. The banner says so
 * rather than letting the screen imply otherwise.
 */
const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
const label = 'block text-[14px] font-medium text-slate-600 mb-1.5';
const fmt = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—');

function PersonSelect({ value, onChange, placeholder }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?limit=8&search=${encodeURIComponent(q.trim())}`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2.5">
        <span className="text-[15px] text-slate-800">
          {value.employeeId} {value.firstName} {value.lastName}
        </span>
        <button onClick={() => onChange(null)} className="text-slate-400 hover:text-rose-600"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={input} value={q} placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true); }} />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-56 overflow-y-auto">
          {results.map(p => (
            <button key={p._id} onClick={() => { onChange(p); setQ(''); setOpen(false); }}
              className="w-full text-left px-3.5 py-2 text-[14px] text-slate-700 hover:bg-slate-50">
              {p.employeeId} {p.firstName} {p.lastName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EmpDelegation() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/delegations')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load delegations'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async () => {
    if (!form.delegator) return toast.error('Choose who is delegating');
    if (!form.delegatee) return toast.error('Choose who is covering');
    setSaving(true);
    try {
      const body = {
        delegatorId: form.delegator._id, delegateeId: form.delegatee._id,
        type: form.type, startsAt: form.startsAt || null, endsAt: form.endsAt || null,
        notify: form.notify, description: form.description || null,
      };
      if (form.id) await api.put(`/delegations/${form.id}`, body);
      else {
        const r = await api.post('/delegations', body);
        toast.success(r.data?.message || 'Delegation saved');
      }
      if (form.id) toast.success('Delegation updated');
      setForm(null); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that delegation');
    } finally { setSaving(false); }
  };

  const blank = {
    delegator: null, delegatee: null, type: 'temporary',
    startsAt: '', endsAt: '', notify: 'both', description: '',
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[14px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            Delegations are recorded here, but approvals are <strong>not</strong> rerouted yet —
            wiring that changes who can approve leave and pay, so it is a separate deliberate step.
          </span>
        </p>
        <button onClick={() => setForm(blank)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium whitespace-nowrap">
          <Plus size={16} /> Add Delegation
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-slate-200 rounded-xl bg-white py-20 text-center">
          <p className="text-slate-700 text-[17px] font-medium">No delegations added currently.</p>
          <p className="text-slate-500 text-[15px] mt-1.5 max-w-md mx-auto">
            Delegation lets you reassign approvals from one employee to another for a specific time frame.
          </p>
          <button onClick={() => setForm(blank)}
            className="mt-5 bg-brand-600 hover:bg-brand-500 text-white px-5 py-2.5 rounded-xl text-[15px] font-medium">
            Add Delegation
          </button>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl bg-white overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Delegator</th>
                <th className="px-4 py-2.5 text-left font-medium" />
                <th className="px-4 py-2.5 text-left font-medium">Delegatee</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">From</th>
                <th className="px-4 py-2.5 text-left font-medium">To</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d._id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 text-slate-800">{d.delegator.firstName} {d.delegator.lastName}</td>
                  <td className="px-2 text-slate-300"><ArrowRight size={15} /></td>
                  <td className="px-4 py-2.5 text-slate-800">{d.delegatee.firstName} {d.delegatee.lastName}</td>
                  <td className="px-4 py-2.5 text-slate-600 capitalize">{d.type}</td>
                  <td className="px-4 py-2.5 text-slate-600">{fmt(d.startsAt)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{fmt(d.endsAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[13px] px-2 py-0.5 rounded-full font-medium ${
                      d.inEffect ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {d.inEffect ? 'In effect' : d.isActive ? 'Scheduled' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button title="Edit"
                        onClick={() => setForm({
                          id: d._id,
                          delegator: { _id: d.delegator.id, employeeId: d.delegator.code, firstName: d.delegator.firstName, lastName: d.delegator.lastName },
                          delegatee: { _id: d.delegatee.id, employeeId: d.delegatee.code, firstName: d.delegatee.firstName, lastName: d.delegatee.lastName },
                          type: d.type, startsAt: (d.startsAt || '').slice(0, 10),
                          endsAt: (d.endsAt || '').slice(0, 10), notify: d.notify, description: d.description || '',
                        })}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                        <Pencil size={15} />
                      </button>
                      <button title="Delete" onClick={() => setToDelete(d)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setForm(null)} />
          <div className="relative bg-white w-full max-w-lg h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Setup Delegation</h3>
              <button onClick={() => setForm(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className={label}>Delegator <span className="text-rose-500">*</span></label>
                <PersonSelect value={form.delegator} placeholder="Search employee"
                  onChange={v => setForm(f => ({ ...f, delegator: v }))} />
              </div>
              <div>
                <label className={label}>Delegatee <span className="text-rose-500">*</span></label>
                <PersonSelect value={form.delegatee} placeholder="Select"
                  onChange={v => setForm(f => ({ ...f, delegatee: v }))} />
              </div>
              <div>
                <label className={label}>Type</label>
                <select className={input} value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="temporary">Temporary</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              {form.type === 'temporary' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>From <span className="text-rose-500">*</span></label>
                    <input type="date" className={input} value={form.startsAt}
                      onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>To <span className="text-rose-500">*</span></label>
                    <input type="date" className={input} value={form.endsAt}
                      onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
                  </div>
                </div>
              )}
              <div>
                <label className={label}>Notification</label>
                <div className="flex gap-5">
                  {[{ v: 'both', l: 'Delegator and Delegatee' }, { v: 'delegatee', l: 'Delegatee' }].map(o => (
                    <label key={o.v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="notify" checked={form.notify === o.v}
                        onChange={() => setForm(f => ({ ...f, notify: o.v }))}
                        className="w-4 h-4 accent-brand-600" />
                      <span className="text-[14px] text-slate-700">{o.l}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[13px] text-amber-700 mt-1.5">
                  Recorded only — no email is sent automatically.
                </p>
              </div>
              <div>
                <label className={label}>Description</label>
                <textarea className={`${input} h-28 resize-none`} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
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
            <h3 className="font-display font-semibold text-slate-800 text-xl">Remove this delegation?</h3>
            <p className="text-[15px] text-slate-500 mt-2">
              {toDelete.delegator.firstName} → {toDelete.delegatee.firstName}
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setToDelete(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={async () => {
                  try {
                    await api.delete(`/delegations/${toDelete._id}`);
                    toast.success('Delegation removed'); setToDelete(null); load();
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Could not remove that delegation');
                  }
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl text-[15px] font-medium">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
