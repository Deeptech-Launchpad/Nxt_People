import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../../utils/api';

/* ── Holidays ───────────────────────────────────────────────────────────────
 *  The company calendar for a year. It decides which days the classifier will
 *  not judge anybody on and which days can earn a comp-off, so it is not a
 *  decorative list — adding a date here changes what every attendance report
 *  says about it.
 *
 *  Working Day Exceptions live in the same table under type 'working_day' and
 *  are deliberately NOT shown here; they are the opposite thing and have their
 *  own tab, exactly as Zoho separates them.
 * ────────────────────────────────────────────────────────────────────────── */
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

export default function OpsHolidays() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/holidays?year=${year}`)
      .then(r => setRows((r.data.data || []).filter(h => h.type !== 'working_day')))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load holidays'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year]);

  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/holidays', {
        name: form.name, date: form.date, description: form.description,
        type: 'company', year: parseInt(String(form.date).slice(0, 4), 10) || year,
      });
      toast.success('Holiday added');
      setModal(false); setForm({ name: '', date: '', description: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add that holiday');
    } finally { setSaving(false); }
  };

  const remove = async (h) => {
    // Removing a holiday re-judges every attendance day that fell on it, so
    // this asks first rather than treating it as a list edit.
    if (!window.confirm(`Remove "${h.name}" on ${fmt(h.date)}?\n\nAttendance on that day will be judged as a normal working day.`)) return;
    try {
      await api.delete(`/holidays/${h._id || h.id}`);
      toast.success('Holiday removed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that holiday');
    }
  };

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];
  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-[15px] font-medium">
          <Plus size={16} /> Add Holiday
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No holidays for {year}.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-[15px]">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(h => (
                <tr key={h._id || h.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-700">{h.name}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(h.date)}</td>
                  <td className="px-4 py-3 text-slate-400">{h.description || '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(h)} title="Remove"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={add} className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="font-display font-semibold text-slate-800 text-xl">Add Holiday</h3>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                placeholder="e.g. Pongal Thirunal" className={field} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Date *</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required className={field} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={field} />
            </div>
            <p className="text-[13px] text-amber-600">
              Nobody is marked absent on a holiday, and working it can earn a comp-off.
            </p>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
                {saving ? 'Adding…' : 'Add Holiday'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
