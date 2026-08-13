import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// Methods — the ways of tracking leave that can be switched off wholesale.
// Only Compensatory Off is switchable: the others (a plain leave request, a
// balance) are not optional features, they are what the module is.
const METHODS = [
  {
    key: 'compOffEnabled',
    title: 'Compensatory Off',
    description: 'Compensatory Off is an entitled leave that an employee can take on a regular working day as compensation for working on a holiday or weekend',
  },
];

export default function LeaveMethods() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    api.get('/leave-types/methods')
      .then(r => setValues(r.data.data || {}))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load methods'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key, title) => {
    // Optimistic: one boolean, and reverting reads better than a toggle that
    // lags behind the finger that moved it.
    const previous = values;
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setSavingKey(key);
    api.patch('/leave-types/methods', { [key]: next[key] })
      .then(() => toast.success(`${title} ${next[key] ? 'enabled' : 'disabled'}`))
      .catch(err => {
        setValues(previous);
        toast.error(err.response?.data?.message || 'Could not save that change');
      })
      .finally(() => setSavingKey(null));
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
        <h1 className="text-[16px] font-semibold text-slate-800">Methods</h1>
        <p className="text-[13.5px] text-slate-500 mt-1.5">
          Select the methods that you commonly use in your organization to track your employee leaves
        </p>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-5">
            {METHODS.map(m => (
              <div key={m.key} className={`flex items-start gap-3.5 ${savingKey === m.key ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => toggle(m.key, m.title)}
                  role="switch" aria-checked={!!values[m.key]} aria-label={m.title}
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 mt-0.5 ${values[m.key] ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${values[m.key] ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-slate-800">{m.title}</p>
                  <p className="text-[13.5px] text-slate-500 mt-0.5">{m.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
