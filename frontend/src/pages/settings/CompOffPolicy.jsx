import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// Compensatory Off configuration. Only one figure here is a policy choice —
// how long a credit stays usable. Who may earn one, and when it may be taken,
// are answered by the work calendar rather than set separately, so they are
// stated here and edited there. Two places to define "what is a weekend" is
// how they drift apart.
export default function CompOffPolicy() {
  const [months, setMonths] = useState(3);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(r => setMonths(parseInt(r.data.data?.compOffExpiryMonths, 10) || 3))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load comp-off settings'))
      .finally(() => setLoaded(true));
  }, []);

  const save = () => {
    setSaving(true);
    api.put('/settings', { compOffExpiryMonths: months })
      .then(() => toast.success('Comp-off validity updated'))
      .catch(err => toast.error(err.response?.data?.message || 'Could not save that change'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="w-full max-w-full min-w-0 px-4 py-5 space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold text-slate-800">Compensatory Off</h1>
        <p className="text-sm text-slate-500 mt-1">
          How comp-off credits are earned, taken and expire.
        </p>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-xl">
            <label className="block text-[14px] font-medium text-slate-700">Credit valid for</label>
            <p className="text-[13px] text-slate-500 mt-0.5 mb-2.5">
              A credit earned on a worked day must be taken within this many months of that day.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number" min="1" max="60" step="1" value={months}
                onChange={e => setMonths(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                className="w-24 text-[13px] rounded border border-slate-200 px-2.5 py-1.5 text-right"
              />
              <span className="text-[13px] text-slate-500">months</span>
              <button
                onClick={save} disabled={saving || !Number.isInteger(months) || months < 1 || months > 60}
                className="ml-2 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-[13px] font-medium disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-xl">
            <h2 className="text-[14px] font-semibold text-slate-800">Earning and taking</h2>
            <ul className="mt-2.5 space-y-2 text-[13px] text-slate-600 list-disc pl-5">
              <li>A credit is earned by working a day the work calendar treats as non-working — a weekend under the recurrence rules, or a holiday that closes the office.</li>
              <li>Attendance has to show a check-in on that day. A claim without one is rejected.</li>
              <li>A credit can only be taken on a future working day.</li>
              <li>A Working Day Exception counts as a working day on both sides; a restricted holiday is optional, so it leaves the day as the weekend rules found it.</li>
            </ul>
            <Link to="/leave-tracker/weekends" className="inline-block text-[12.5px] text-blue-600 hover:underline mt-3">
              Edit the work calendar →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
