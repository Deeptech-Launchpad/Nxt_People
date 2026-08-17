import React from 'react';
import { Card, Check, Note, useConfigSection, SaveBar, Spinner } from '../configKit';
import { ListEditor, FieldVisibilityTable } from './kit';

// On Duty — how a request may be raised and what it must carry. All of it is
// enforced on submission, including the attachment: turning that field on is
// what gives on_duty_requests.attachment_path something to hold.
//
// The reference also offers half day and quarter day durations. A request here
// is either a span of whole days or a range of hours within one day, with no
// fraction-of-a-day in between, so those two are absent rather than offered
// and quietly treated as a full day.

const FIELDS = [
  { key: 'description', label: 'Description' },
  { key: 'attachment', label: 'Attachment' },
];

export default function OnDutyConfig() {
  const { config, set, setIn, loading, saving, dirty, save } =
    useConfigSection('onduty', 'On Duty', 'attendance-config');

  if (loading || !config) return <Spinner />;

  const durations = config.durations || {};
  const noDuration = !durations.fullDay && !durations.hourly;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="On Duty"
        description="On duty is used to mark the presence of an employee who is working away from their office location such as a work site, client location or working from home"
      >
        <Note>
          Approval routing for on-duty requests is set in Approvals, and uses the same hierarchy as
          leave and regularization.
        </Note>

        <div className="mt-6 space-y-6">
          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-2.5">Allowed duration</p>
            <div className="flex flex-wrap items-center gap-6">
              <Check checked={durations.fullDay} onChange={v => setIn('durations', { fullDay: v })} label="Full day" />
              <Check checked={durations.hourly} onChange={v => setIn('durations', { hourly: v })} label="Hourly" />
            </div>
            {noDuration && (
              <p className="text-[13px] text-red-600 mt-2">
                At least one duration must stay allowed, or no on-duty request can be raised at all.
              </p>
            )}
          </div>

          <div>
            <Check
              checked={config.typesEnabled}
              onChange={v => set({ typesEnabled: v })}
              label="Types of On duty"
              hint="The appropriate type can be selected while raising an On duty request"
            />
            {config.typesEnabled && (
              <div className="mt-3 ml-6">
                <ListEditor
                  items={config.types}
                  onChange={types => set({ types })}
                  addLabel="Add Type"
                  placeholder="Type"
                />
                <p className="text-[13px] text-slate-500 mt-2.5 max-w-[560px]">
                  Renaming a type does not rewrite the requests already filed under the old name.
                </p>
              </div>
            )}
          </div>

          <Check
            checked={config.restrictFutureDates}
            onChange={v => set({ restrictFutureDates: v })}
            label="Restrict on-duty requests for future dates"
          />

          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-3">Visibility and mandatory settings</p>
            <FieldVisibilityTable
              rows={FIELDS}
              values={config.fields}
              onChange={(key, value) => setIn('fields', { [key]: value })}
            />
            <p className="text-[13px] text-slate-500 mt-2.5 max-w-[560px]">
              With Attachment shown, a request may carry one file up to 5&nbsp;MB —
              PDF, Word, Excel or an image.
            </p>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
