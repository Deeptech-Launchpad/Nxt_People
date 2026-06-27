/**
 * Admin → Tax Slabs (read-only viewer)
 * Side-by-side view of the old- vs new-regime income-tax slabs that
 * the TDS engine uses for monthly deductions. Editing the slabs is
 * a DB-level operation (rare event — only when the FY rolls over);
 * this page just lets admin verify what's currently active.
 */
import React, { useEffect, useState } from 'react';
import { Scale, Info, Calculator } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR, currentFY } from './_shared';

export default function TaxSlabs() {
  const [fy, setFy] = useState(currentFY());
  const [slabs, setSlabs] = useState({ old: [], new: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/payroll/admin/tax-slabs?fy=${fy}`)
      .then(r => setSlabs(r.data.data || { old: [], new: [] }))
      .catch(err => toast.error(err.response?.data?.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [fy]);

  const SlabTable = ({ title, rows, palette }) => (
    <div className={`rounded-2xl border-2 ${palette.border} bg-white overflow-hidden`}>
      <div className={`px-5 py-4 ${palette.headerBg}`}>
        <p className={`text-[13px] uppercase tracking-wider font-bold ${palette.headerLabel}`}>{palette.tag}</p>
        <p className={`text-[18px] font-bold ${palette.headerText} mt-0.5`}>{title}</p>
        <p className={`text-[14px] ${palette.headerSub} mt-1`}>{palette.subtitle}</p>
      </div>
      <table className="w-full text-[15px]">
        <thead className={palette.thBg}>
          <tr className="text-[13px] uppercase tracking-wider text-slate-500">
            <th className="text-left px-4 py-2.5">Income Bracket</th>
            <th className="text-right px-4 py-2.5">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-400">No slabs configured</td></tr>
          ) : rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-800">
                  {fmtINR(r.from)} {r.to === null ? '& above' : `– ${fmtINR(r.to)}`}
                </p>
              </td>
              <td className="text-right px-4 py-3">
                <span className={`px-2.5 py-1 rounded-full text-[14px] font-bold ${
                  Number(r.ratePercent) === 0 ? 'bg-emerald-50 text-emerald-700'
                  : Number(r.ratePercent) >= 30 ? 'bg-rose-50 text-rose-700'
                  : 'bg-amber-50 text-amber-700'
                }`}>
                  {Number(r.ratePercent).toFixed(0)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800 flex items-center gap-2">
            <Scale size={20} className="text-indigo-500" /> Income Tax Slabs
          </h1>
          <p className="text-[15px] text-slate-500 mt-1">
            The slab tables used to compute monthly TDS for each employee.
          </p>
        </div>
        <select value={fy} onChange={e => setFy(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[15px] font-semibold">
          <option value="2026-27">FY 2026-27</option>
          <option value="2025-26">FY 2025-26</option>
          <option value="2024-25">FY 2024-25</option>
        </select>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-start gap-3">
        <Info size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
        <div className="text-[14px] text-indigo-900 leading-relaxed">
          <strong>How TDS works:</strong> the engine projects the employee's annual gross from their current monthly
          pay, subtracts the standard deduction (₹50K) and any approved declaration exemptions, then applies the
          relevant slab table below. The annual tax (plus 4% health & education cess) is divided by 12 and deducted
          each month. Employees on the <strong>new regime</strong> default to no exemptions; <strong>old regime</strong>
          requires an approved declaration to claim HRA / 80C / 80D / etc.
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">Loading slabs…</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          <SlabTable
            title="New Regime"
            rows={slabs.new}
            palette={{
              border: 'border-indigo-200',
              headerBg: 'bg-gradient-to-br from-indigo-500 to-blue-600',
              headerLabel: 'text-indigo-100',
              headerText: 'text-white',
              headerSub: 'text-indigo-100',
              thBg: 'bg-indigo-50',
              tag: 'Default · Simpler',
              subtitle: 'Standard deduction ₹50K, no other exemptions. Lower rates.',
            }}
          />
          <SlabTable
            title="Old Regime"
            rows={slabs.old}
            palette={{
              border: 'border-amber-200',
              headerBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
              headerLabel: 'text-amber-100',
              headerText: 'text-white',
              headerSub: 'text-amber-100',
              thBg: 'bg-amber-50',
              tag: 'Optional · Exemptions',
              subtitle: 'Higher rates but HRA, 80C, 80D, etc. deductible if declared.',
            }}
          />
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] text-slate-500 flex items-start gap-2">
        <Calculator size={14} className="flex-shrink-0 mt-0.5" />
        <div>
          <strong>Section 87A rebate:</strong> employees with taxable income up to ₹5L (old regime) or ₹7L (new regime)
          pay no tax. <strong>Cess:</strong> 4% health & education cess is added on top of the slab tax.
        </div>
      </div>
    </div>
  );
}
