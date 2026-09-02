import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Policy -> Basic Details.
 *
 * Two switches that change what the employee record offers. They are written
 * the moment they are toggled rather than behind a Save, matching the
 * reference — a lone switch with a Save button underneath invites people to
 * flip it and walk away.
 */
function Toggle({ on, onChange, disabled }) {
  return (
    <button
      role="switch" aria-checked={on} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative
        ${on ? 'bg-brand-600' : 'bg-slate-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all
        ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

const Card = ({ title, description, children }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5">
    <h3 className="text-[16px] font-semibold text-slate-800">{title}</h3>
    <p className="text-[14px] text-slate-500 mt-1">{description}</p>
    <div className="mt-4">{children}</div>
  </div>
);

export default function BasicDetails() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.get('/employee-info-settings/basic-details')
      .then(r => setCfg(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load these settings'));
  }, []);

  const save = async (key, value) => {
    const before = cfg;
    setCfg(c => ({ ...c, [key]: value }));    // optimistic: a switch that lags reads as broken
    setBusy(key);
    try {
      const r = await api.patch('/employee-info-settings/basic-details', { [key]: value });
      setCfg(r.data.data);
      toast.success('Saved');
    } catch (err) {
      setCfg(before);                          // put it back rather than lie about the state
      toast.error(err.response?.data?.message || 'Could not save that');
    } finally { setBusy(''); }
  };

  if (!cfg) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="Dual reporting"
        description="This option will enable dual reporting manager for all employees.">
        <div className="flex items-center gap-3">
          <Toggle on={cfg.dualReporting} disabled={busy === 'dualReporting'}
            onChange={v => save('dualReporting', v)} />
          <span className="text-[15px] text-slate-700">Enable/Disable</span>
        </div>
        {/* The column already exists and the editor already writes it, so this
            governs whether the field is offered, not whether it can be stored. */}
        <p className="text-[13px] text-slate-400 mt-2">
          Shows Secondary Reporting Manager on the employee record and its editor.
        </p>
      </Card>

      <Card title="Streams"
        description="Use this feature to group related designations or employees together under one stream.">
        <div className="flex items-center gap-3">
          <Toggle on={cfg.streams} disabled={busy === 'streams'}
            onChange={v => save('streams', v)} />
          <span className="text-[15px] text-slate-700">Enable/Disable</span>
        </div>
        <p className="text-[13px] text-slate-400 mt-2">
          Adds a Streams section to this policy where the groupings are managed.
        </p>
      </Card>
    </div>
  );
}
