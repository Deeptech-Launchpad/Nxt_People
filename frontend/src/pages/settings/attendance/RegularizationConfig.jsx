import React from 'react';
import { Card, Check, Note, selectClass, useConfigSection, SaveBar, Spinner } from '../configKit';
import { ListEditor, FieldVisibilityTable } from './kit';

// Regularization — what an employee may fix, how often, and what the request
// has to say. Every rule here is enforced on submission, not only drawn on the
// form: the route re-reads this before it accepts a request.

const FIELDS = [
  { key: 'description', label: 'Description' },
  { key: 'document', label: 'Supporting document' },
];

export default function RegularizationConfig() {
  const { config, set, setIn, loading, saving, dirty, save } =
    useConfigSection('regularization', 'Regularization', 'attendance-config');

  if (loading || !config) return <Spinner />;

  const restrictions = config.restrictions || {};
  const within = restrictions.withinDays || {};
  const per = restrictions.perPeriod || {};
  const setRestriction = changes => set({ restrictions: { ...restrictions, ...changes } });

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Regularization"
        description="An option given to employees to raise a request and rectify their incorrect or missed attendance entries"
      >
        <Note>
          Approval routing for regularization requests is set in Approvals, and uses the same hierarchy
          as leave and on duty.
        </Note>

        <div className="mt-6 space-y-6">
          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-2.5">Regularization entries will</p>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="entryMode" checked={config.entryMode !== 'replace'}
                  onChange={() => set({ entryMode: 'create' })} className="w-4 h-4 accent-blue-600 mt-0.5" />
                <span>
                  <span className="block text-[14px] text-slate-700">Create a new check-in / check-out entry</span>
                  <span className="block text-[13px] text-slate-500 mt-0.5">
                    Added alongside whatever is already recorded. The day then runs from the earliest
                    check-in to the latest check-out, and its hours are the sum of both.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="entryMode" checked={config.entryMode === 'replace'}
                  onChange={() => set({ entryMode: 'replace' })} className="w-4 h-4 accent-blue-600 mt-0.5" />
                <span>
                  <span className="block text-[14px] text-slate-700">Replace the existing first check-in / last check-out entry</span>
                  <span className="block text-[13px] text-slate-500 mt-0.5">
                    The approved times overwrite what was recorded for that day.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <Check
              checked={Array.isArray(config.reasons) && config.reasons.length > 0}
              onChange={v => set({ reasons: v ? ['Forgot to check-in'] : [], reasonMandatory: v ? config.reasonMandatory : false })}
              label="Add reasons to select while raising a regularization request"
            />
            {Array.isArray(config.reasons) && config.reasons.length > 0 && (
              <div className="mt-3 ml-6">
                <ListEditor
                  items={config.reasons}
                  onChange={reasons => set({ reasons })}
                  addLabel="Add Reason"
                  placeholder="Reason"
                />
                <p className="text-[13px] text-slate-500 mt-2.5 max-w-[560px]">
                  Once reasons are listed they become the only accepted answers — a request with anything
                  else is refused, so the reports can group by reason.
                </p>
              </div>
            )}
          </div>

          <Check
            checked={config.reasonMandatory}
            onChange={v => set({ reasonMandatory: v })}
            label="Make reason mandatory for regularization request"
          />

          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-3">Visibility and mandatory settings</p>
            <FieldVisibilityTable
              rows={FIELDS}
              values={config.fields}
              onChange={(key, value) => setIn('fields', { [key]: value })}
            />
          </div>

          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-3">Restrictions</p>
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <Check
                  checked={within.enabled}
                  onChange={v => setRestriction({ withinDays: { ...within, enabled: v } })}
                  label="Regularization requests can be raised within"
                />
                <input
                  type="number" min={1} max={365} disabled={!within.enabled}
                  value={within.days ?? 5}
                  onChange={e => setRestriction({ withinDays: { ...within, days: Number(e.target.value) } })}
                  className="w-[70px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <span className="text-[14px] text-slate-600">days from the date to be regularized</span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Check
                  checked={per.enabled}
                  onChange={v => setRestriction({ perPeriod: { ...per, enabled: v } })}
                  label="Regularization requests can be raised for"
                />
                <input
                  type="number" min={1} max={100} disabled={!per.enabled}
                  value={per.count ?? 1}
                  onChange={e => setRestriction({ perPeriod: { ...per, count: Number(e.target.value) } })}
                  className="w-[62px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <span className="text-[14px] text-slate-600">day per</span>
                <select
                  value={per.period || 'month'} disabled={!per.enabled}
                  onChange={e => setRestriction({ perPeriod: { ...per, period: e.target.value } })}
                  className={selectClass}
                >
                  <option value="week">week</option>
                  <option value="month">month</option>
                  <option value="year">year</option>
                </select>
              </div>

              <Check
                checked={restrictions.allowFutureDates}
                onChange={v => setRestriction({ allowFutureDates: v })}
                label="Allow regularization requests for future dates and times"
              />
            </div>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
