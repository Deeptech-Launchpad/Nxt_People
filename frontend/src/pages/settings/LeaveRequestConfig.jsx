import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../utils/api';
import { Card, Check, Note, NotWired, SaveBar, Spinner, selectClass, useConfigSection } from './configKit';

const ROWS = [
  ['past_within_pay_period', 'Past leaves within current pay period', 'Only meaningful once a pay period exists — the period decides what counts as past.'],
  ['current_and_upcoming', 'Current day & upcoming leave requests'],
  ['past_within_calendar_year', 'Past leave request within current calendar year'],
];
const ACTORS = [['self', 'Employees (Self)'], ['manager', 'Reporting managers'], ['approver', 'Approvers']];

// Leave Request configuration — cancellation, extension and how far ahead leave
// can be booked. Extension is a permissions matrix rather than a single switch
// because who may extend depends on when the leave was.
export default function LeaveRequestConfig() {
  const { config, set, setIn, loading, saving, dirty, save } = useConfigSection('request', 'Leave request');
  const [policies, setPolicies] = useState([]);

  useEffect(() => {
    api.get('/leave-types/policies')
      .then(r => setPolicies(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(() => setPolicies([]));
  }, []);

  if (loading) return <Spinner />;
  if (!config) return null;

  const ext = config.extension || {};
  const perms = ext.permissions || {};
  const selected = ext.policies || [];

  const togglePolicy = code => setIn('extension', {
    policies: selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code],
  });

  const togglePerm = (row, actor) => setIn('extension', {
    permissions: { ...perms, [row]: { ...(perms[row] || {}), [actor]: !perms[row]?.[actor] } },
  });

  return (
    <div className="space-y-4 pb-20">
      <Card title="Leave cancellation" description="Specify who can cancel leave requests and make cancellation reason mandatory">
        <Check
          label="Make reason for leave cancellation mandatory"
          checked={config.cancellationReasonMandatory}
          onChange={v => set({ cancellationReasonMandatory: v })}
        />
      </Card>

      <Card
        title="Leave extension"
        description="Specify who can extend leave requests that are already submitted, approved, or pending approval"
      >
        <p className="text-[14px] text-slate-700 mb-2">
          Select applicable leave policies
          <NotWired>Extension is not built yet</NotWired>
        </p>
        {/* A checkbox list rather than a combo box: there are a handful of
            policies, and seeing which are selected matters more than saving
            vertical space. */}
        <div className="border border-slate-200 rounded-lg p-3 max-w-[420px] max-h-[180px] overflow-y-auto space-y-2">
          {policies.length === 0 && <p className="text-[13px] text-slate-400">No leave policies found</p>}
          {policies.map(p => (
            <label key={p._id} className="flex items-center gap-2.5 cursor-pointer text-[14px] text-slate-700">
              <input type="checkbox" checked={selected.includes(p.code)}
                onChange={() => togglePolicy(p.code)} className="w-4 h-4 accent-blue-600" />
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: p.color || '#94a3b8' }} />
              {p.name}
            </label>
          ))}
        </div>

        <div className="overflow-x-auto mt-5">
          <table className="w-full min-w-[560px] border border-slate-200 rounded-lg">
            <thead className="bg-slate-50 text-[13px] font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Permissions</th>
                {ACTORS.map(([, l]) => <th key={l} className="px-4 py-2.5 font-semibold">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, l, hint]) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-[14px] text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      {l}
                      {hint && <span title={hint} className="text-amber-500"><Info size={13} /></span>}
                    </span>
                  </td>
                  {ACTORS.map(([actor]) => (
                    <td key={actor} className="px-4 py-3 text-center">
                      <input type="checkbox" checked={!!perms[key]?.[actor]}
                        aria-label={`${l} — ${actor}`}
                        onChange={() => togglePerm(key, actor)}
                        className="w-4 h-4 accent-blue-600 cursor-pointer" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <Note>Leave extension requests follow the approval chain configured for leave.</Note>
        </div>

        <div className="mt-4">
          <Check
            label="Make reason for leave extension mandatory"
            checked={ext.reasonMandatory}
            onChange={v => setIn('extension', { reasonMandatory: v })}
          />
        </div>
      </Card>

      <Card title="Leave requests for future dates" description="Specify how much in advance employees can request for leave">
        <div className="flex flex-wrap items-center gap-2.5 text-[14px] text-slate-700">
          <span>Allow Leave requests until the next</span>
          <select
            value={config.futureRequestYears}
            onChange={e => set({ futureRequestYears: Number(e.target.value) })}
            aria-label="Future leave request limit"
            className={selectClass}
          >
            {[1, 2, 3].map(y => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
          </select>
          <span>in advance</span>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
