import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Check, X, Trash2, GripVertical, Lock } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Policy -> Employee Status.
 *
 * A status has a name and a TYPE, and only the type matters to the rest of the
 * product: active means the person is working, inactive means they are not.
 * Terminated, Resigned and Deceased are three names for the second.
 *
 * That distinction is the point of the screen. `employees.status` is a free
 * string today, which is why the live database has 153 rows saying 'active'
 * while only 57 people are current, and why the Employees list has to filter
 * on two separate criteria to find them.
 *
 * The two built-in statuses cannot be retyped or removed — every other query
 * means "working" or "not working" by them, so changing one would move the
 * employee list, the headcount and every report at once. The server refuses
 * it too; this only explains why.
 */
export default function EmployeeStatuses() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'inactive' });
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/employee-info-settings/statuses')
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load statuses'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    if (!draft.name.trim()) return toast.error('Enter a name');
    try {
      await api.post('/employee-info-settings/statuses', draft);
      setAdding(false); setDraft({ name: '', type: 'inactive' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add that status');
    }
  };

  const setType = async (row, type) => {
    if (row.isSystem) {
      return toast.error(`"${row.name}" is built in — its type cannot be changed.`);
    }
    try {
      await api.patch(`/employee-info-settings/statuses/${row._id}`, { type });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not change that');
    }
  };

  const rename = async (row, name) => {
    setEditing(null);
    if (!name.trim() || name === row.name) return;
    try {
      await api.patch(`/employee-info-settings/statuses/${row._id}`, { name });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not rename that');
    }
  };

  const remove = async (row) => {
    try {
      await api.delete(`/employee-info-settings/statuses/${row._id}`);
      toast.success('Removed'); load();
    } catch (err) {
      // The server explains exactly why — how many people are on it, or that
      // it is built in. Passing that through beats a generic failure.
      toast.error(err.response?.data?.message || 'Could not remove that status');
    }
  };

  const TypeRadio = ({ row, value, label }) => (
    <label className={`flex items-center gap-2 ${row.isSystem ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      title={row.isSystem ? 'Built-in status — its type is fixed' : undefined}>
      <input type="radio" checked={row.type === value} disabled={row.isSystem}
        onChange={() => setType(row, value)}
        className="w-4 h-4 accent-brand-600 disabled:opacity-50" />
      <span className={`text-[14.5px] ${row.type === value ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
        {label}
      </span>
    </label>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-[14px] text-slate-500 max-w-2xl">
          <strong className="text-slate-700">Active</strong> means the person is working.{' '}
          <strong className="text-slate-700">Inactive</strong> means they are not. Everything else in the
          product — the employee list, headcount, reports — asks that question and never the name, so a
          status called Resigned or Terminated is simply another name for Inactive.
        </p>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium whitespace-nowrap">
          <Plus size={16} /> Add Employee Status
        </button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium w-[260px]">Type</th>
              <th className="px-4 py-2.5 text-left font-medium w-[120px]">In use</th>
              <th className="px-4 py-2.5 w-14" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-14 text-center">
                <div className="inline-block w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : rows.map(row => (
              <tr key={row._id} className="border-t border-slate-100 group">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-slate-300 opacity-0 group-hover:opacity-100" />
                    {editing === row._id ? (
                      <input autoFocus defaultValue={row.name}
                        onBlur={e => rename(row, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') rename(row, e.target.value);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="border border-brand-400 rounded-lg px-2.5 py-1 text-[15px] focus:outline-none" />
                    ) : (
                      <button onClick={() => setEditing(row._id)}
                        className="text-slate-800 hover:text-brand-600 text-left">
                        {row.name}
                      </button>
                    )}
                    {row.isSystem && (
                      <span title="Built in — the product relies on this one"
                        className="inline-flex items-center gap-1 text-[12px] text-slate-400">
                        <Lock size={11} /> built in
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-6">
                    <TypeRadio row={row} value="active" label="Active" />
                    <TypeRadio row={row} value="inactive" label="Inactive" />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">
                  {row.inUse > 0
                    ? <span className="text-slate-700">{row.inUse}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {!row.isSystem && (
                    <button onClick={() => remove(row)} title="Remove"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {adding && (
              <tr className="border-t border-slate-100 bg-brand-50/30">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-slate-300" />
                    <input autoFocus value={draft.name} placeholder="Enter name"
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
                      className="border border-brand-400 rounded-lg px-2.5 py-1 text-[15px] focus:outline-none" />
                    <button onClick={add} className="text-emerald-600 hover:text-emerald-700"><Check size={17} /></button>
                    <button onClick={() => setAdding(false)} className="text-rose-500 hover:text-rose-600"><X size={17} /></button>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-6">
                    {['active', 'inactive'].map(v => (
                      <label key={v} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={draft.type === v}
                          onChange={() => setDraft(d => ({ ...d, type: v }))}
                          className="w-4 h-4 accent-brand-600" />
                        <span className="text-[14.5px] capitalize text-slate-600">{v}</span>
                      </label>
                    ))}
                  </div>
                </td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
