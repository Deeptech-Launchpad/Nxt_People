import React, { useEffect, useMemo, useState } from 'react';
import { Search, User } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from './useEmployeeList';

/* ── User-specific Operations ───────────────────────────────────────────────
 *  Zoho's first tab, and the one that explains the whole section: type a name,
 *  and everything below is about THAT person rather than about you.
 *
 *  It opens on an empty search deliberately. Loading a hundred and fifty
 *  people's balances to show a screen where you are about to pick one is work
 *  nobody asked for, and Zoho does the same — "Please begin typing to search
 *  for an employee".
 * ────────────────────────────────────────────────────────────────────────── */
export default function OpsUserSpecific() {
  const { people, loading } = useEmployeeList();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [balances, setBalances] = useState(null);
  const [loadingBal, setLoadingBal] = useState(false);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return people
      .filter(p => labelOf(p).toLowerCase().includes(needle)
        || String(p.department || '').toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, people]);

  useEffect(() => {
    if (!picked) { setBalances(null); return; }
    let live = true;
    setLoadingBal(true);
    api.get(`/leave-types/balances?employeeId=${picked._id}`)
      .then(r => { if (live) setBalances(r.data.data || []); })
      .catch(() => { if (live) setBalances([]); })
      .finally(() => { if (live) setLoadingBal(false); });
    return () => { live = false; };
  }, [picked]);

  return (
    <div>
      <div className="max-w-2xl mx-auto">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPicked(null); }}
            placeholder="Search Employee"
            className="w-full border border-slate-200 rounded-xl pl-11 pr-4 py-3.5 text-base focus:outline-none focus:border-brand-400"
          />
        </div>

        {q.trim() && !picked && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
            {loading ? (
              <p className="px-4 py-3 text-slate-400 text-sm">Loading employees…</p>
            ) : matches.length === 0 ? (
              <p className="px-4 py-3 text-slate-400 text-sm">Nobody matches that.</p>
            ) : matches.map(p => (
              <button
                key={p._id}
                onClick={() => { setPicked(p); setQ(labelOf(p)); }}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0"
              >
                <span className="text-slate-700 text-[15px]">{labelOf(p)}</span>
                {p.department && <span className="text-slate-400 text-sm"> · {p.department}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!picked && (
        <div className="text-center py-20">
          <User size={34} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-[15px]">Please begin typing to search for an employee</p>
        </div>
      )}

      {picked && (
        <div className="mt-8 max-w-4xl mx-auto">
          <div className="mb-4">
            <h2 className="font-display text-xl font-semibold text-slate-800">{labelOf(picked)}</h2>
            <p className="text-sm text-slate-400">{picked.department || 'No department'}{picked.designation ? ` · ${picked.designation}` : ''}</p>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide">Leave balance</p>
            </div>
            {loadingBal ? (
              <p className="px-5 py-6 text-slate-400 text-sm">Loading…</p>
            ) : !balances || balances.length === 0 ? (
              <p className="px-5 py-6 text-slate-400 text-sm">No leave types are configured.</p>
            ) : (
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-left text-slate-400 text-sm">
                    <th className="px-5 py-2.5 font-medium">Leave type</th>
                    <th className="px-5 py-2.5 font-medium text-right">Available</th>
                    <th className="px-5 py-2.5 font-medium text-right">Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map(b => (
                    <tr key={b._id} className="border-t border-slate-50">
                      <td className="px-5 py-3 text-slate-700">{b.name}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{b.available ?? '—'}</td>
                      <td className="px-5 py-3 text-right text-slate-400">{b.booked ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-sm text-slate-400 mt-3">
            To change any of these figures, use <span className="font-medium text-slate-500">Customize Balance</span>.
          </p>
        </div>
      )}
    </div>
  );
}
