import React, { useState, useEffect } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const blank = () => ({ name: '', startDate: todayCA(), endDate: todayCA(), processEncashment: false });
const fmt = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '—');

// Pay Period configuration. A period is the range payroll runs over, and the
// three payroll-facing leave reports — Loss of pay, Leave encashment and Leave
// data for payroll — offer it as a chip so they can be run over exactly that
// range instead of a hand-picked one.
//
// "Process leave encashment" is what the Leave encashment report checks: with
// it off, that report says so and links back here rather than rendering an
// empty table that looks like missing data.
export default function PayPeriods() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/pay-periods')
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load pay periods'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = (e) => {
    e.preventDefault();
    setSaving(true);
    api.post('/pay-periods', form)
      .then(() => { toast.success(`${form.name} created`); setForm(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not create that pay period'))
      .finally(() => setSaving(false));
  };

  const patch = (row, changes) => {
    const previous = rows;
    setRows(rs => rs.map(r => (r._id === row._id ? { ...r, ...changes } : r)));
    setBusyId(row._id);
    api.patch(`/pay-periods/${row._id}`, changes)
      .then(() => toast.success(`${row.name} updated`))
      .catch(err => { setRows(previous); toast.error(err.response?.data?.message || 'Could not save that change'); })
      .finally(() => setBusyId(null));
  };

  const remove = (row) => {
    // Deleting only removes the period from the chip; nothing recorded against
    // it is stored, so there is no cascade to warn about.
    if (!window.confirm(`Delete the pay period "${row.name}"? Reports will fall back to their date range.`)) return;
    setBusyId(row._id);
    api.delete(`/pay-periods/${row._id}`)
      .then(() => { toast.success('Pay period deleted'); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not delete that pay period'))
      .finally(() => setBusyId(null));
  };

  return (
    <div className="w-full max-w-full min-w-0 px-4 py-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold text-slate-800">Pay Period</h1>
          <p className="text-sm text-slate-500 mt-1">
            The ranges payroll runs over. Loss of pay, Leave encashment and Leave data for
            payroll can be run against a period instead of a hand-picked date range.
          </p>
        </div>
        <button
          onClick={() => setForm(blank())}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-[13px] font-medium flex-shrink-0"
        >
          <Plus size={14} /> New pay period
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center">
          <p className="text-[14px] text-slate-600">No pay periods yet.</p>
          <p className="text-[13px] text-slate-400 mt-1">
            Until one exists, those three reports keep their From/To date navigator.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Pay period</th>
                <th className="text-left px-4 py-2.5">From</th>
                <th className="text-left px-4 py-2.5">To</th>
                <th className="text-center px-4 py-2.5">Process leave encashment</th>
                <th className="text-center px-4 py-2.5">Active</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} className={`border-b border-slate-100 last:border-0 ${busyId === row._id ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 text-[14px] text-slate-800">{row.name}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-600">{fmt(row.startDate)}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-600">{fmt(row.endDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox" checked={!!row.processEncashment}
                      onChange={e => patch(row, { processEncashment: e.target.checked })}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => patch(row, { isActive: !row.isActive })}
                      role="switch" aria-checked={row.isActive}
                      title={row.isActive ? 'Retire this period' : 'Offer this period again'}
                      className={`w-10 h-5 rounded-full transition-colors relative ${row.isActive ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${row.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(row)} title={`Delete ${row.name}`} className="text-slate-300 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={create} className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-[15px] font-semibold text-slate-800">New pay period</h2>
              <button type="button" onClick={() => setForm(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Name</label>
                <input
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  required maxLength={120} placeholder="e.g. ANXT Payroll"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-slate-600 mb-1.5">From</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-600 mb-1.5">To</label>
                  <input type="date" value={form.endDate} min={form.startDate} onChange={e => setForm({ ...form, endDate: e.target.value })} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-blue-500" />
                </div>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={form.processEncashment} onChange={e => setForm({ ...form, processEncashment: e.target.checked })} className="w-4 h-4 rounded accent-blue-600 mt-0.5" />
                <span>
                  <span className="block text-[13.5px] text-slate-700">Process leave encashment</span>
                  <span className="block text-[12.5px] text-slate-400">The Leave encashment report only reports on periods with this on.</span>
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button type="button" onClick={() => setForm(null)} className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 text-[13px]">Cancel</button>
              <button type="submit" disabled={saving} className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium disabled:opacity-50">
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
