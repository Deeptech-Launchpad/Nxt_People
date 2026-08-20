import React from 'react';
import { MinusCircle } from 'lucide-react';
import { Card, Check, Toggle, Note, NotWired, SaveBar, Spinner, selectClass, useConfigSection } from './configKit';

const PARTS = [
  ['employee_id', 'Employee Id'],
  ['employee_name', 'Employee Name'],
  ['leave_policy_name', 'Leave policy name'],
  ['leave_type', 'Leave type'],
];
const partLabel = v => (PARTS.find(p => p[0] === v) || [])[1] || v;

// Additional Options — the settings that did not belong to any other section.
// Sandwich leave and the calendar integration are switches for features that do
// not exist here yet; they are stored so the feature has something to read, and
// labelled so nobody mistakes a saved setting for a working one.
export default function LeaveAdditionalOptions() {
  const { config, set, setIn, loading, saving, dirty, save } = useConfigSection('additional', 'Additional options');
  if (loading) return <Spinner />;
  if (!config) return null;

  const sandwich = config.sandwichLeave || {};
  const cal = config.calendarSync || {};
  const format = cal.format || [];

  return (
    <div className="space-y-4 pb-20">
      <Card
        title="General sandwich leave policy"
        description="Configure whether weekends and holidays between leave periods are treated as leave days based on the number of leave days taken"
      >
        <Toggle
          label="Sandwich leave policy"
          checked={sandwich.enabled}
          onChange={v => setIn('sandwichLeave', { enabled: v })}
        />
        <p className="text-[12px] text-slate-400 mt-1.5 ml-14">
          Leave day counts do not bridge weekends and holidays yet.<NotWired />
        </p>

        {/* Auto-reverse only means something while the policy is on, so it is
            disabled rather than hidden — hiding it made the card change height
            on every toggle. */}
        <div className="mt-5">
          <Check
            label="Auto-reverse sandwiched weekends and holidays when associated absences are converted to attendance entry"
            checked={sandwich.autoReverse}
            disabled={!sandwich.enabled}
            onChange={v => setIn('sandwichLeave', { autoReverse: v })}
          />
        </div>
      </Card>

      <Card
        title="Password protection for file export"
        description="The file is emailed to you inside a password-protected zip. The password is shown here, once, rather than mailed alongside it."
      >
        <Toggle
          label="Password protection"
          checked={config.passwordProtectExports}
          onChange={v => set({ passwordProtectExports: v })}
        />
      </Card>

      <Card
        title="Google calendar and Microsoft 365 calendar integration"
        description="Specify the leave display format for synced leaves"
      >
        <div className="flex flex-wrap items-center gap-2">
          {format.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-slate-400">-</span>}
              <select
                value={part}
                onChange={e => setIn('calendarSync', { format: format.map((p, j) => (j === i ? e.target.value : p)) })}
                aria-label={`Format part ${i + 1}`}
                className={selectClass}
              >
                {PARTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </React.Fragment>
          ))}
          {/* At least one part has to remain, or the synced event has no title. */}
          {format.length > 1 && (
            <button
              onClick={() => setIn('calendarSync', { format: format.slice(0, -1) })}
              aria-label="Remove last format part"
              className="text-rose-500 hover:text-rose-600"
            >
              <MinusCircle size={18} />
            </button>
          )}
          {format.length < PARTS.length && (
            <button
              onClick={() => setIn('calendarSync', {
                format: [...format, PARTS.map(p => p[0]).find(p => !format.includes(p))],
              })}
              className="text-[13px] text-blue-600 hover:underline"
            >
              + Add part
            </button>
          )}
        </div>

        <div className="mt-4">
          <Note>Format : {format.map(partLabel).join(' - ')}</Note>
        </div>

        <div className="mt-5 border border-slate-200 rounded-lg px-4 py-3">
          <Check
            label="Update Microsoft 365 and Google calendar event status by leave type"
            hint="Enable and set the preferred calendar event-status for leave types. If no preference is set, the event-status for synced leave will be 'Busy' by default."
            checked={cal.updateEventStatusByType}
            onChange={v => setIn('calendarSync', { updateEventStatusByType: v })}
          />
        </div>
        <p className="text-[12px] text-slate-400 mt-2">
          Leave is not synced to an external calendar yet.<NotWired />
        </p>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
