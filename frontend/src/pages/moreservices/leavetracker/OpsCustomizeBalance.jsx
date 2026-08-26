import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Check, X } from 'lucide-react';
import api from '../../../utils/api';

/* ── Customize Balance ──────────────────────────────────────────────────────
 *  Zoho's grid: people down the side, leave types across the top, every cell
 *  editable. This is where a balance gets corrected when somebody was granted
 *  the wrong number, and it changes what people are allowed to take — so:
 *
 *    one cell is saved at a time, on Enter or on the tick. There is no "save
 *    all", because a screen that writes a hundred and fifty rows when you
 *    fumbled one keystroke is not a screen anybody should have.
 *
 *    every figure is CALCULATED — what the policy has granted by now minus what
 *    has been taken. It used to print the leave type's annual maximum whenever
 *    nobody had stored a figure, so a hundred and fifty people all read "12"
 *    and Loss of Pay read "999". A balance is not a constant.
 *
 *    a stored figure is an OVERRIDE and is marked as one, with the calculation
 *    it replaced on hover. "Nobody touched this" and "somebody corrected this
 *    to the same number" are different facts.
 *
 *  Zoho allows negatives here, and so does this — a balance can legitimately go
 *  below zero when leave was approved past the entitlement.
 * ────────────────────────────────────────────────────────────────────────── */
export default function OpsCustomizeBalance() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [types, setTypes] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);   // `${empId}|${typeId}`
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/leave-types/balances/all?year=${year}`)
      .then(r => { setTypes(r.data.types || []); setRows(r.data.data || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not load balances'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year]);

  // The grouped header only lines up if the columns are in group order.
  const ordered = useMemo(() => {
    const rank = { paid: 0, comp_off: 1, unpaid: 2 };
    return [...types].sort((a, b) => (rank[a.payType || 'paid'] ?? 0) - (rank[b.payType || 'paid'] ?? 0));
  }, [types]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      `${r.employeeCode} ${r.name} ${r.department || ''}`.toLowerCase().includes(needle));
  }, [q, rows]);

  const startEdit = (empId, typeId, current) => {
    setEditing(`${empId}|${typeId}`);
    setDraft(current == null ? '' : String(current));
  };

  const save = async (empId, typeId) => {
    const value = parseFloat(draft);
    if (!Number.isFinite(value)) { toast.error('That is not a number.'); return; }
    setSaving(true);
    try {
      await api.put(`/leave-types/balances/${empId}`, { leaveTypeId: typeId, available: value, year });
      // Patch the cell in place. Reloading the whole grid to change one number
      // would scroll a long list back to the top under the person editing it.
      setRows(rs => rs.map(r => r._id !== empId ? r : {
        ...r,
        balances: r.balances.map(b => b.leaveTypeId !== typeId ? b : { ...b, available: value, overridden: true }),
      }));
      setEditing(null);
      toast.success('Balance updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update that balance');
    } finally { setSaving(false); }
  };

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search employee, code or department…"
            className="w-full border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400"
          />
        </div>
        <select
          value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No active employees.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              {/* Zoho groups the columns by whether the leave is paid, because
                  that is the distinction that decides whether a negative
                  balance costs somebody money. */}
              <tr className="text-center text-slate-400 text-[13px] uppercase tracking-wide">
                <th className="px-4 pt-3 sticky left-0 bg-slate-50 z-10"></th>
                {['paid', 'comp_off', 'unpaid'].map(group => {
                  const n = types.filter(t => (t.payType || 'paid') === group).length;
                  if (!n) return null;
                  return (
                    <th key={group} colSpan={n} className="px-4 pt-3 pb-1 font-medium border-b border-slate-200">
                      {group === 'unpaid' ? 'Unpaid' : group === 'comp_off' ? 'Comp-Off' : 'Paid'}
                    </th>
                  );
                })}
              </tr>
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium sticky left-0 bg-slate-50 z-10">Employee</th>
                {ordered.map(t => (
                  <th key={t._id} className="px-4 py-3 font-medium text-right whitespace-nowrap">
                    {t.name}
                    {t.unit === 'hours' && <span className="block text-[12px] text-slate-300 font-normal">hours</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r._id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="text-slate-400 text-sm"> · {r.employeeCode}</span>
                  </td>
                  {ordered.map(t => {
                    const b = r.balances.find(x => x.leaveTypeId === t._id);
                    const key = `${r._id}|${t._id}`;
                    if (editing === key) {
                      return (
                        <td key={t._id} className="px-2 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              autoFocus type="number" step="0.5" value={draft}
                              onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') save(r._id, t._id);
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              className="w-20 border border-brand-400 rounded-lg px-2 py-1 text-right text-[15px] focus:outline-none"
                            />
                            <button onClick={() => save(r._id, t._id)} disabled={saving}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setEditing(null)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200">
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={t._id} className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => startEdit(r._id, t._id, b?.available)}
                          title={b?.overridden
                            ? `Overridden. The policy calculates ${b.granted} granted minus ${b.used} taken.`
                            : `From the policy: ${b?.granted ?? 0} granted, ${b?.used ?? 0} taken`}
                          className={`px-2 py-0.5 rounded-md hover:bg-brand-50 hover:text-brand-700 transition-colors ${
                            Number(b?.available) < 0 ? 'text-rose-600 font-medium'
                              : b?.overridden ? 'text-amber-700 font-medium' : 'text-slate-700'
                          }`}
                        >
                          {b?.available == null ? '—' : b.available}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-slate-400 mt-3">
        Every figure is calculated from the leave policy and what has actually been taken &mdash; not a default.
        <span className="text-amber-700"> Amber</span> means somebody overrode the calculation;
        hover any cell to see what the policy says. Click to change it, saved one cell at a time.
      </p>
    </div>
  );
}
