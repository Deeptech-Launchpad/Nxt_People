import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { History, RefreshCw, X } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from './useEmployeeList';

/* ── Customize Policy ───────────────────────────────────────────────────────
 *  Zoho's screen is PER EMPLOYEE: pick a person, see their leave policies with
 *  the balance in force, and behind each one a history — every accrual and
 *  every day taken, in order, with a running balance:
 *
 *      01/01/2026   Accrual        +12          12
 *      13/01/2026   Leave Taken          1      11
 *
 *  The first version of this tab edited the GLOBAL leave-type settings instead,
 *  which is a different screen answering a different question. The ledger is
 *  the part HR actually uses, because it is what you show somebody who says
 *  their balance is wrong.
 *
 *  Rerun Policy removes an override and lets the calculation stand again. It
 *  does not invent a figure — a stored balance exists because somebody
 *  corrected something, and the honest way to undo that is to delete it.
 * ────────────────────────────────────────────────────────────────────────── */
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const TYPE_LABEL = { paid: 'Paid', unpaid: 'Unpaid', comp_off: 'Comp-Off' };

export default function OpsCustomizePolicy() {
  const { people } = useEmployeeList();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [employeeId, setEmployeeId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(null);
  const [rerunning, setRerunning] = useState('');

  const load = () => {
    if (!employeeId) { setRows([]); return; }
    setLoading(true);
    api.get(`/leave-types/ledger?employeeId=${employeeId}&year=${year}`)
      .then(r => setRows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load policies'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId, year]);

  const rerun = async (row) => {
    if (!window.confirm(
      `Rerun ${row.name} for this employee?\n\n` +
      `The stored balance of ${row.stored} will be removed and the balance will follow the policy again — ` +
      `${row.computed} by this calculation.`)) return;
    setRerunning(row.leaveTypeId);
    try {
      const r = await api.post('/leave-types/ledger/rerun', { employeeId, leaveTypeId: row.leaveTypeId, year });
      toast.success(r.data.message || 'Policy rerun');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not rerun that policy');
    } finally { setRerunning(''); }
  };

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];
  const field = 'border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={`${field} flex-1 min-w-[260px]`}>
          <option value="">Select an employee</option>
          {people.map(p => <option key={p._id} value={p._id}>{labelOf(p)}</option>)}
        </select>
        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className={field}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {!employeeId ? (
        <p className="text-center text-slate-400 py-16">Pick an employee to see their leave policies.</p>
      ) : loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No leave types are configured.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[15px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <th className="px-4 py-3 font-medium">Leave policy</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 font-medium text-right">Balance</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.leaveTypeId} className="border-t border-slate-50 hover:bg-slate-50/60 group">
                  <td className="px-4 py-3 text-slate-700">{r.name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] px-2 py-0.5 rounded-md ${
                      r.payType === 'unpaid' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'
                    }`}>{TYPE_LABEL[r.payType] || r.payType}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 capitalize">{r.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={Number(r.balance) < 0 ? 'text-rose-600 font-medium' : 'text-slate-700'}>
                      {r.balance}
                    </span>
                    {/* An overridden balance and a calculated one look identical
                        on screen unless something says so. */}
                    {r.overridden && (
                      <span className="block text-[13px] text-amber-600">
                        overridden · policy says {r.computed}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setHistory(r)}
                        className="flex items-center gap-1.5 text-blue-600 hover:bg-blue-50 px-2.5 py-1 rounded-lg text-sm font-medium">
                        <History size={13} /> View History
                      </button>
                      <button onClick={() => rerun(r)} disabled={!r.overridden || rerunning === r.leaveTypeId}
                        title={r.overridden ? 'Remove the override' : 'Nothing to rerun — this already follows the policy'}
                        className="flex items-center gap-1.5 text-slate-600 hover:bg-slate-100 px-2.5 py-1 rounded-lg text-sm font-medium disabled:opacity-30 disabled:hover:bg-transparent">
                        <RefreshCw size={13} /> Rerun Policy
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setHistory(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="font-display font-semibold text-slate-800 text-xl">{history.name}</h3>
                <p className="text-sm text-slate-400 mt-0.5">
                  {year} · granted {history.granted} · taken {history.used} · balance {history.balance}
                </p>
              </div>
              <button onClick={() => setHistory(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto">
              {history.events.length === 0 ? (
                <p className="text-center text-slate-400 py-12">Nothing has accrued or been taken this year.</p>
              ) : (
                <table className="w-full text-[15px]">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-left text-slate-500 text-sm">
                      <th className="px-5 py-2.5 font-medium">Date</th>
                      <th className="px-5 py-2.5 font-medium">Type</th>
                      <th className="px-5 py-2.5 font-medium text-right">Added</th>
                      <th className="px-5 py-2.5 font-medium text-right">Used</th>
                      <th className="px-5 py-2.5 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.events.map((e, i) => (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{fmt(e.date)}</td>
                        <td className="px-5 py-2.5 text-slate-700">
                          {e.type === 'accrual' ? 'Accrual' : 'Leave Taken'}
                          {e.note && <span className="block text-[13px] text-slate-400">{e.note}</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-emerald-600">{e.added ?? '—'}</td>
                        <td className="px-5 py-2.5 text-right text-rose-500">{e.used ?? '—'}</td>
                        <td className="px-5 py-2.5 text-right text-slate-700 font-medium">{e.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {history.overridden && (
              <div className="px-6 py-3 border-t border-slate-100 bg-amber-50 text-[13px] text-amber-700">
                A stored balance of {history.stored} overrides this calculation, which ends at {history.computed}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
