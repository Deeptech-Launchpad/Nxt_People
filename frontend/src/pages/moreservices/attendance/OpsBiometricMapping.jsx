import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Search } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from '../leavetracker/useEmployeeList';

/* ── Biometric ID mapping ─────────────────────────────────────────────────
 *  Which employee a biometric device's numeric user ID belongs to, matching
 *  Zoho's own description: "Map biometric user IDs to Zoho People User IDs
 *  to facilitate biometric based check-in system for employees."
 *
 *  Said plainly rather than left to be discovered later: nothing in this
 *  project talks to a biometric device yet. This screen records the mapping;
 *  a device sync that reads it is separate work. */
export default function OpsBiometricMapping() {
  const { people } = useEmployeeList();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [biometricId, setBiometricId] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/biometric-id-mapping')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load the mappings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Already-mapped employees do not clutter the picker for a new mapping —
  // the backend would refuse them anyway, so offering them is a click that
  // was always going to fail.
  const mappedIds = new Set(rows.map(r => r.employeeId));
  const matches = empQuery.trim()
    ? people.filter(p => !mappedIds.has(p._id) && labelOf(p).toLowerCase().includes(empQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  const openAdd = () => { setAdding(true); setPicked(null); setEmpQuery(''); setBiometricId(''); };

  const save = async (e) => {
    e.preventDefault();
    if (!picked) return toast.error('Pick an employee first');
    if (!biometricId.trim()) return toast.error('Enter the biometric device user ID');
    setSaving(true);
    try {
      await api.post('/biometric-id-mapping', { employeeId: picked._id, biometricId: biometricId.trim() });
      toast.success(`${labelOf(picked)} mapped`);
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that mapping');
    } finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove the biometric mapping for ${row.firstName} ${row.lastName || ''}?`)) return;
    try {
      await api.delete(`/biometric-id-mapping/${row._id}`);
      toast.success('Mapping removed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that mapping');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-[13.5px] text-slate-500 max-w-xl">
          Map biometric user IDs to employees to facilitate a biometric based check-in system.
        </p>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-[15px] font-medium flex-shrink-0">
          <Plus size={16} /> Add User ID Mapping
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No user IDs mapped currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Biometric ID</th>
                <th className="px-4 py-3 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60 group">
                  <td className="px-4 py-3 text-slate-700">
                    {r.employeeCode ? `${r.employeeCode} — ` : ''}{r.firstName} {r.lastName || ''}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.department || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-[13.5px]">{r.biometricId}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => remove(r)} title="Remove"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
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

      {adding && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={save} className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Add User ID Mapping</h3>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Employee Name *</label>
              {picked ? (
                <div className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2.5">
                  <span className="text-[15px] text-slate-700">{labelOf(picked)}</span>
                  <button type="button" onClick={() => { setPicked(null); setEmpQuery(''); }}
                    className="text-[13px] text-brand-600 hover:underline">Change</button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input
                    value={empQuery} onChange={e => setEmpQuery(e.target.value)}
                    placeholder="Search Employee" autoFocus
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400"
                  />
                  {matches.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
                      {matches.map(p => (
                        <button key={p._id} type="button"
                          onClick={() => { setPicked(p); setEmpQuery(''); }}
                          className="w-full text-left px-3 py-2 text-[14px] text-slate-700 hover:bg-slate-50">
                          {labelOf(p)}{p.department ? ` — ${p.department}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Biometric device user ID *</label>
              <input value={biometricId} onChange={e => setBiometricId(e.target.value)}
                placeholder="e.g. 42" required
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
            </div>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setAdding(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
