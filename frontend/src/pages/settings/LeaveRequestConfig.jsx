import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../utils/api';
import { Card, Check, Note, NotWired, SaveBar, Spinner, selectClass, useConfigSection } from './configKit';

const ROWS = [
  ['past_within_pay_period', 'Past leaves within current pay period', 'With no pay period configured this row can never match, and a past leave falls through to the calendar-year row below.'],
  ['current_and_upcoming', 'Current day & upcoming leave requests'],
  ['past_within_calendar_year', 'Past leave request within current calendar year'],
];
const ACTORS = [['self', 'Employees (Self)'], ['manager', 'Reporting managers'], ['approver', 'Approvers']];

// A leave matches exactly one row: still running or yet to start is
// current-and-upcoming; otherwise the pay-period row if it fits the live cycle,
// and the calendar-year row if not. A leave from a previous year matches no row
// and so is cancellable by nobody.
//
// Shared by cancellation and extension because they ask the same question of
// the same three actors — two copies drifted apart the moment one gained a
// column.
function PermissionMatrix({ rows, perms, onToggle, firstRowExtra }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border border-slate-200 rounded-lg">
        <thead className="bg-slate-50 text-[13px] font-semibold text-slate-600">
          <tr>
            <th className="text-left px-4 py-2.5">Permissions</th>
            {ACTORS.map(([, l]) => <th key={l} className="px-4 py-2.5 font-semibold whitespace-nowrap">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, l, hint], i) => (
            <tr key={key} className="border-t border-slate-100">
              <td className="px-4 py-3 text-[14px] text-slate-700 align-top">
                <span className="inline-flex items-center gap-1.5">
                  {l}
                  {hint && <span title={hint} className="text-amber-500"><Info size={13} /></span>}
                </span>
                {i === 0 && firstRowExtra}
              </td>
              {ACTORS.map(([actor]) => (
                <td key={actor} className="px-4 py-3 text-center align-middle">
                  <input type="checkbox" checked={!!perms[key]?.[actor]}
                    aria-label={`${l} — ${actor}`}
                    onChange={() => onToggle(key, actor)}
                    className="w-4 h-4 accent-blue-600 cursor-pointer" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Leave Request configuration — cancellation, extension and how far ahead leave
// can be booked. Cancellation and extension are permissions matrices rather
// than single switches because who may act depends on when the leave was.
//
// The cancellation matrix is enforced: /leaves DELETE and PUT :id/cancel both
// resolve the row and the actor through it. Before it existed an employee could
// withdraw any unapproved leave of their own from any month of the year.
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
  const cancel = config.cancellation || {};
  const cancelPerms = cancel.permissions || {};

  const togglePolicy = code => setIn('extension', {
    policies: selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code],
  });

  const togglePerm = (row, actor) => setIn('extension', {
    permissions: { ...perms, [row]: { ...(perms[row] || {}), [actor]: !perms[row]?.[actor] } },
  });

  const toggleCancelPerm = (row, actor) => setIn('cancellation', {
    permissions: { ...cancelPerms, [row]: { ...(cancelPerms[row] || {}), [actor]: !cancelPerms[row]?.[actor] } },
  });

  const toggleCancelPolicy = code => {
    const list = cancel.policies || [];
    setIn('cancellation', { policies: list.includes(code) ? list.filter(c => c !== code) : [...list, code] });
  };

  return (
    <div className="space-y-4 pb-20">
      <Card title="Leave cancellation" description="Specify who can cancel leave requests and make cancellation reason mandatory">
        <PermissionMatrix
          rows={ROWS}
          perms={cancelPerms}
          onToggle={toggleCancelPerm}
          firstRowExtra={(
            <div className="mt-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {[['custom', 'Custom pay period'], ['current', 'Current pay period']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer text-[13.5px] text-slate-700">
                    <input type="radio" name="pastScope" checked={(cancel.pastScope || 'current') === v}
                      onChange={() => setIn('cancellation', { pastScope: v })}
                      className="w-4 h-4 accent-blue-600" />
                    {l}
                  </label>
                ))}
              </div>

              <div className="inline-flex rounded-md bg-slate-100 p-0.5">
                {[['all', 'All requests'], ['specific', 'Specific requests']].map(([v, l]) => (
                  <label key={v}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-[13.5px] cursor-pointer ${
                      (cancel.requestScope || 'all') === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                    }`}>
                    <input type="radio" name="requestScope" checked={(cancel.requestScope || 'all') === v}
                      onChange={() => setIn('cancellation', { requestScope: v })}
                      className="w-3.5 h-3.5 accent-blue-600" />
                    {l}
                  </label>
                ))}
              </div>

              {cancel.requestScope === 'specific' && (
                <div className="border border-slate-200 rounded-lg p-3 max-w-[380px] max-h-[150px] overflow-y-auto space-y-2">
                  {policies.length === 0 && <p className="text-[13px] text-slate-400">No leave policies found</p>}
                  {policies.map(p => (
                    <label key={p._id} className="flex items-center gap-2.5 cursor-pointer text-[13.5px] text-slate-700">
                      <input type="checkbox" checked={(cancel.policies || []).includes(p.code)}
                        onChange={() => toggleCancelPolicy(p.code)} className="w-4 h-4 accent-blue-600" />
                      <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: p.color || '#94a3b8' }} />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}

              {/* A custom window has to say how far back it reaches, or the
                  word "custom" carries no rule at all. */}
              {cancel.pastScope === 'custom' && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[13px] text-slate-600">Cancellable up to</span>
                  <input
                    type="number" min="1" max="366"
                    value={cancel.customDays ?? 30}
                    onChange={e => setIn('cancellation', {
                      customDays: e.target.value === '' ? 30 : Number(e.target.value) })}
                    aria-label="Days back a past leave stays cancellable"
                    className="w-20 text-[13.5px] rounded-md border border-slate-300 px-2.5 py-1.5 bg-white"
                  />
                  <span className="text-[13px] text-slate-600">days back, instead of the pay period</span>
                </div>
              )}

              {cancel.requestScope === 'specific' && (
                <p className="text-[12px] text-slate-400 max-w-[420px]">
                  Anything not ticked cannot be cancelled once approved, whoever asks.
                </p>
              )}

              {/* The one that can disagree with money already paid. */}
              <div className="border-t border-slate-200 pt-3 mt-1">
                <p className="text-[13px] font-medium text-slate-700 mb-2">
                  When payroll has already run for that month
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {[['block', 'Do not allow'], ['flag', 'Allow, and warn'], ['allow', 'Allow silently']].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer text-[13.5px] text-slate-700">
                      <input type="radio" name="payrollRun" className="w-4 h-4 accent-blue-600"
                        checked={(cancel.payrollRun || 'block') === v}
                        onChange={() => setIn('cancellation', { payrollRun: v })} />
                      {l}
                    </label>
                  ))}
                </div>
                <p className="text-[12px] text-slate-400 mt-1.5 max-w-[440px]">
                  {(cancel.payrollRun || 'block') === 'allow'
                    ? 'The record will disagree with a payslip already issued, and nothing will say so.'
                    : (cancel.payrollRun === 'flag'
                      ? 'The cancellation goes through, with a warning that the payslip will not match.'
                      : 'A payslip already issued cannot be contradicted. HR adjusts it instead.')}
                </p>
              </div>
            </div>
          )}
        />

        <div className="mt-4">
          <Note>Leave cancellation requests follow the approval chain configured for leave.</Note>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <Check
              label="Allow partial leave cancellation"
              checked={cancel.allowPartial}
              onChange={v => setIn('cancellation', { allowPartial: v })}
            />
            <p className="text-[12px] text-slate-400 mt-1 ml-[26px]">
              Cancelling part of a range splits the request in two: the days before the cancelled part stay on the original request, and the days after become a second one linked back to it.
            </p>
          </div>
          <Check
            label="Make reason for leave cancellation mandatory"
            checked={config.cancellationReasonMandatory}
            onChange={v => set({ cancellationReasonMandatory: v })}
          />
        </div>
      </Card>

      <Card
        title="Leave extension"
        description="Specify who can extend leave requests that are already submitted, approved, or pending approval"
      >
        <p className="text-[14px] text-slate-700 mb-2">
          Select applicable leave policies
          <NotWired>Not built, deliberately</NotWired>
        </p>
        <p className="text-[12px] text-slate-500 mb-3 max-w-[520px]">
          Raise a new request for the extra days instead. Extending an approved leave
          would move its end date without the added day passing the approval chain —
          a manager extending is level one, so higher levels would never see it.
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

        <div className="mt-5">
          <PermissionMatrix rows={ROWS} perms={perms} onToggle={togglePerm} />
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
