/**
 * Employee → Tax Declaration
 * Once-a-year form for old-regime exemptions (HRA rent, 80C, 80D, etc.).
 * Submitted → admin reviews → approved/rejected. After approval the
 * declaration feeds Phase 5 TDS computation. New-regime path zeroes
 * out the exemption fields (no exemptions allowed there other than
 * standard deduction, which is automatic).
 */
import React, { useEffect, useState } from 'react';
import { FileText, IndianRupee, CheckCircle2, AlertCircle, Save, Info, Lock } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { fmtINR, currentFY, StatusPill, fmtDate, fmtDateTime } from './_shared';

const OLD_REGIME_FIELDS = [
  { key: 'hraAnnualRent',     label: 'HRA — Annual rent paid', hint: 'Used to compute HRA exemption against your HRA component' },
  { key: 'section80c',        label: 'Section 80C',           hint: 'PPF, ELSS, life insurance, principal repayment. Cap ₹1,50,000' },
  { key: 'section80d',        label: 'Section 80D',           hint: 'Health insurance premium. Cap ₹25,000 (₹50K for senior parents)' },
  { key: 'section80e',        label: 'Section 80E',           hint: 'Education loan interest. No cap, 8 years' },
  { key: 'homeLoanInterest',  label: 'Home loan interest',    hint: 'Self-occupied: cap ₹2,00,000. Let-out: no cap' },
  { key: 'otherDeductions',   label: 'Other deductions',      hint: 'NPS additional 50K, 80G donations, etc.' },
];

export default function TaxDeclaration() {
  const fy = currentFY();
  const [form, setForm] = useState({
    regime: 'new',
    hraAnnualRent: 0, section80c: 0, section80d: 0, section80e: 0,
    homeLoanInterest: 0, otherDeductions: 0,
  });
  const [existing, setExisting] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [window_, setWindow]    = useState(null);
  const [windowLoading, setWindowLoading] = useState(true);

  useEffect(() => {
    api.get(`/payroll/declaration-windows/current?fy=${fy}`)
      .then(r => setWindow(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to check the declaration window status'))
      .finally(() => setWindowLoading(false));
    api.get('/payroll/declarations/my')
      .then(r => {
        const d = r.data.data;
        if (d) {
          setExisting(d);
          setForm({
            regime: d.regime || 'new',
            hraAnnualRent:    d.hraAnnualRent || 0,
            section80c:       d.section80c || 0,
            section80d:       d.section80d || 0,
            section80e:       d.section80e || 0,
            homeLoanInterest: d.homeLoanInterest || 0,
            otherDeductions:  d.otherDeductions || 0,
          });
        }
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const total = Object.entries(form)
    .filter(([k]) => k !== 'regime')
    .reduce((s, [, v]) => s + Number(v || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/payroll/declarations', form);
      toast.success('Declaration submitted — HR will review shortly');
      const r = await api.get('/payroll/declarations/my');
      setExisting(r.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submit failed');
    } finally { setSaving(false); }
  };

  const locked = existing?.status === 'approved';
  const now = new Date();
  const opensInFuture = !!(window_?.opensAt && now < new Date(window_.opensAt));
  const closedAlready  = !!(window_?.closesAt && now > new Date(window_.closesAt));
  // windowLoading gates this so the closed-banner never flashes true before
  // the window-status fetch has actually resolved.
  const windowClosed = !windowLoading && (!window_ || !window_.isOpen || opensInFuture || closedAlready);
  const windowClosedReason = opensInFuture
    ? `This window opens on ${fmtDateTime(window_.opensAt)}. Come back then to submit.`
    : closedAlready
      ? `This window closed on ${fmtDateTime(window_.closesAt)}. Contact HR if you still need to submit.`
      : `The declaration window for FY ${fy} is currently closed. Contact HR if you need to submit or revise your declaration.`;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Tax Declaration · {fy}</h1>
        <p className="text-[15px] text-slate-500 mt-1">
          Declare your investments and rent to reduce TDS. Submit once a year — HR approves and the values feed your monthly payslip from the next run.
        </p>
      </div>

      {/* Declaration window banner — only shown when submission is actually blocked */}
      {windowClosed && !locked && (
        <div className="rounded-xl px-4 py-3 border border-slate-200 bg-slate-50 flex items-center gap-3">
          <Lock size={16} className="text-slate-500" />
          <p className="text-[14px] text-slate-700">{windowClosedReason}</p>
        </div>
      )}

      {/* Current status banner */}
      {existing && (
        <div className={`rounded-xl px-4 py-3 border flex items-center justify-between ${
          existing.status === 'approved' ? 'bg-emerald-50 border-emerald-200' :
          existing.status === 'rejected' ? 'bg-rose-50 border-rose-200' :
          'bg-blue-50 border-blue-200'
        }`}>
          <div className="flex items-center gap-3">
            {existing.status === 'approved'
              ? <CheckCircle2 size={18} className="text-emerald-600" />
              : existing.status === 'rejected'
                ? <AlertCircle size={18} className="text-rose-600" />
                : <Info size={18} className="text-blue-600" />}
            <div>
              <p className="text-[15px] font-bold text-slate-800">
                {existing.status === 'approved' ? 'Approved by HR'
                 : existing.status === 'rejected' ? 'Returned for revision'
                 : 'Awaiting HR review'}
              </p>
              <p className="text-[13px] text-slate-600 mt-0.5">
                {existing.status === 'rejected'
                  ? (existing.rejectionReason || 'Reason not provided — please contact HR')
                  : `Last updated ${fmtDate(existing.updatedAt)}`}
              </p>
            </div>
          </div>
          <StatusPill status={existing.status === 'submitted' ? 'locked' : existing.status === 'approved' ? 'paid' : 'draft'} />
        </div>
      )}

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Regime */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-[13px] font-bold uppercase tracking-wider text-slate-500 mb-2">Tax regime</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'new',  title: 'New regime', desc: 'Lower slabs, no exemptions (default).' },
              { v: 'old',  title: 'Old regime', desc: 'Higher slabs, exemptions claimable.' },
            ].map(o => (
              <label key={o.v}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  form.regime === o.v ? 'border-blue-400 bg-blue-50/30 ring-2 ring-blue-100' : 'border-slate-200 hover:bg-slate-50'
                } ${locked ? 'opacity-60 pointer-events-none' : ''}`}>
                <input type="radio" name="regime" value={o.v} checked={form.regime === o.v}
                       onChange={() => setForm(f => ({ ...f, regime: o.v }))} className="hidden" />
                <p className="text-[15px] font-bold text-slate-800">{o.title}</p>
                <p className="text-[13px] text-slate-500 mt-0.5">{o.desc}</p>
              </label>
            ))}
          </div>
        </div>

        {/* Old-regime fields — disabled if new is selected */}
        <div className={`px-5 py-4 ${form.regime !== 'old' ? 'opacity-40 pointer-events-none' : ''}`}>
          <p className="text-[13px] font-bold uppercase tracking-wider text-slate-500 mb-3">Annual exemption amounts</p>
          <div className="space-y-3">
            {OLD_REGIME_FIELDS.map(f => (
              <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 sm:items-center">
                <div>
                  <p className="text-[14px] font-semibold text-slate-700">{f.label}</p>
                  <p className="text-[13px] text-slate-400">{f.hint}</p>
                </div>
                <div className="relative">
                  <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form[f.key] || 0}
                    onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    disabled={locked}
                    className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-[15px] focus:outline-none focus:border-blue-400 text-right disabled:bg-slate-50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Total + submit */}
        <div className="bg-gradient-to-r from-slate-50 to-blue-50 border-t border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wider text-slate-500">Total claimed</p>
            <p className="text-[20px] font-bold text-blue-700 mt-0.5">{fmtINR(form.regime === 'old' ? total : 0)}</p>
            {form.regime === 'new' && <p className="text-[13px] text-slate-400">No exemptions under new regime</p>}
          </div>
          <button type="submit"
                  disabled={saving || locked || loading || windowClosed}
                  title={windowClosed ? 'Declaration window is closed' : undefined}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
            <Save size={13} /> {saving ? 'Submitting…' : existing ? 'Resubmit' : 'Submit Declaration'}
          </button>
        </div>
      </form>

      {/* Note about new regime */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-[14px]">
        <Info size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-amber-800">
          <p className="font-semibold">Choose carefully</p>
          <p className="mt-0.5">You can switch regimes once per financial year. Talk to HR or a tax advisor before deciding — old regime is usually better if you have ≥ ₹2L worth of declared investments + HRA + home loan, otherwise new regime usually wins.</p>
        </div>
      </div>
    </div>
  );
}
