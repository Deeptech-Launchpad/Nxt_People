import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

// Methods — the ways of recording attendance that can be switched off for the
// whole organization. Switching one off is not cosmetic: the routes refuse the
// write too, so a tab left open on a request form cannot still file one.
//
// The reference lists four more — Break, Kiosk, Office In / Remote In and
// Location Tracking. None of them exists here, and a switch for a feature that
// does not exist is worse than no switch at all, so they are absent rather
// than present-and-inert.
const METHODS = [
  {
    key: 'regularization',
    title: 'Regularization',
    description: 'An option given to employees to raise a request and rectify their incorrect or missed attendance entries',
  },
  {
    key: 'onDuty',
    title: 'On Duty',
    description: 'On duty is used to mark the presence of an employee who is working away from their office location such as a work site, client location or working from home',
  },
  {
    key: 'hourlyPermission',
    title: 'Hourly Permission',
    description: 'Set up hourly permissions for short requests for time away from work during office hours',
  },
];

export default function AttendanceMethods() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    api.get('/attendance-config/methods')
      .then(r => setValues(r.data.data || {}))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load methods'))
      .finally(() => setLoading(false));
  }, []);

  // Optimistic, and reverting on failure reads better than a switch that lags
  // behind the finger that moved it. The whole section is sent because the
  // route validates and stores it whole.
  const toggle = (key, title) => {
    const previous = values;
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setSavingKey(key);
    api.patch('/attendance-config/methods', next)
      .then(r => {
        setValues(r.data.data);
        toast.success(`${title} ${next[key] ? 'enabled' : 'disabled'}`);
      })
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
          Select the methods that you commonly use in your organization to track your employee attendance
        </p>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-5">
            {METHODS.map(m => (
              <div key={m.key} className={`flex items-start gap-3.5 ${savingKey === m.key ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => toggle(m.key, m.title)}
                  disabled={savingKey === m.key}
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
