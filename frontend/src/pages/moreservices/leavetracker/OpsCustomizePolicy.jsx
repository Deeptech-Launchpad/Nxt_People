import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

/* ── Customize Policy ───────────────────────────────────────────────────────
 *  How each leave type behaves: paid or not, granted annually or accrued
 *  monthly, how much, whether it carries forward.
 *
 *  These are the figures the accrual engine reads. Change accrualMode from
 *  monthly to annual and every balance in the company is computed differently
 *  from the next request onward — so the fields here are exactly the ones the
 *  API validates, nothing is free text, and the effect of each is stated on
 *  screen rather than left to be inferred from a label.
 * ────────────────────────────────────────────────────────────────────────── */
const PAY_TYPES = [
  ['paid', 'Paid'], ['unpaid', 'Unpaid — Loss of Pay'], ['comp_off', 'Comp-Off'],
];
const ACCRUAL_MODES = [
  ['annual', 'Annual — the whole year granted at once'],
  ['monthly', 'Monthly — accrues each month'],
  ['earned', 'Earned — credited when it is worked for'],
  ['none', 'None — no automatic grant'],
];
const UNITS = [['days', 'Days'], ['hours', 'Hours']];

export default function OpsCustomizePolicy() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/leave-types/policies')
      .then(r => setTypes(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load policies'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const open = (t) => {
    setOpenId(t._id);
    setDraft({
      payType: t.payType || 'paid',
      unit: t.unit || 'days',
      accrualMode: t.accrualMode || 'annual',
      accrualAmount: t.accrualAmount ?? 0,
      maxDaysPerYear: t.maxDaysPerYear ?? '',
      carryForward: !!t.carryForward,
      isActive: t.isActive !== false,
    });
  };

  const save = async (id) => {
    setSaving(true);
    try {
      const body = {
        ...draft,
        accrualAmount: parseFloat(draft.accrualAmount) || 0,
        maxDaysPerYear: draft.maxDaysPerYear === '' ? null : parseFloat(draft.maxDaysPerYear),
      };
      await api.patch(`/leave-types/policies/${id}`, body);
      toast.success('Policy updated');
      setOpenId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update that policy');
    } finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (types.length === 0) {
    return <p className="text-center text-slate-400 py-16">No leave types are configured.</p>;
  }

  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
  const label = 'block text-sm font-medium text-slate-600 mb-1.5';

  return (
    <div className="space-y-3">
      {types.map(t => (
        <div key={t._id} className="border border-slate-200 rounded-2xl overflow-hidden">
          <button
            onClick={() => (openId === t._id ? setOpenId(null) : open(t))}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 text-left"
          >
            <div>
              <p className="font-medium text-slate-800 text-[15px]">
                {t.name}
                {t.isActive === false && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
              </p>
              <p className="text-sm text-slate-400 mt-0.5">
                {(PAY_TYPES.find(p => p[0] === t.payType) || [, t.payType])[1]}
                {' · '}
                {(ACCRUAL_MODES.find(a => a[0] === t.accrualMode) || [, t.accrualMode])[1]?.split(' — ')[0]}
                {t.accrualAmount ? ` · ${t.accrualAmount} ${t.unit || 'days'}` : ''}
                {t.carryForward ? ' · carries forward' : ''}
              </p>
            </div>
            <span className="text-brand-600 text-sm font-medium">{openId === t._id ? 'Close' : 'Customize'}</span>
          </button>

          {openId === t._id && draft && (
            <div className="px-5 pb-5 pt-1 border-t border-slate-100 grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Pay type</label>
                <select value={draft.payType} onChange={e => setDraft({ ...draft, payType: e.target.value })} className={field}>
                  {PAY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Unit</label>
                <select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} className={field}>
                  {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={label}>How it accrues</label>
                <select value={draft.accrualMode} onChange={e => setDraft({ ...draft, accrualMode: e.target.value })} className={field}>
                  {ACCRUAL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <p className="text-[13px] text-slate-400 mt-1">
                  This drives every balance figure in the system, not just new requests.
                </p>
              </div>
              <div>
                <label className={label}>Amount granted</label>
                <input type="number" step="0.5" value={draft.accrualAmount}
                  onChange={e => setDraft({ ...draft, accrualAmount: e.target.value })} className={field} />
                <p className="text-[13px] text-slate-400 mt-1">
                  {draft.accrualMode === 'monthly' ? 'Per month.' : 'For the year.'}
                </p>
              </div>
              <div>
                <label className={label}>Maximum per year</label>
                <input type="number" step="0.5" value={draft.maxDaysPerYear} placeholder="No cap"
                  onChange={e => setDraft({ ...draft, maxDaysPerYear: e.target.value })} className={field} />
              </div>
              <label className="flex items-center gap-2.5 text-[15px] text-slate-600">
                <input type="checkbox" checked={draft.carryForward}
                  onChange={e => setDraft({ ...draft, carryForward: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300" />
                Unused balance carries into next year
              </label>
              <label className="flex items-center gap-2.5 text-[15px] text-slate-600">
                <input type="checkbox" checked={draft.isActive}
                  onChange={e => setDraft({ ...draft, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300" />
                Available for people to apply for
              </label>
              <div className="sm:col-span-2 flex gap-3 pt-1">
                <button onClick={() => setOpenId(null)}
                  className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={() => save(t._id)} disabled={saving}
                  className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save policy'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
