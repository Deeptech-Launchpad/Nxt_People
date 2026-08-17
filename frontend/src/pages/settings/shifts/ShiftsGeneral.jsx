import React from 'react';
import { Card, Check, Note, NotWired, selectClass, useConfigSection, SaveBar, Spinner } from '../configKit';
import { PermissionMatrix } from '../attendance/kit';

// Shifts → General.
//
// One setting here does real work: the default work shift. Until now nothing
// read shifts.is_default — every employee had a shift only because a migration
// linked all 152 by hand, and the next person created would have had none, so
// their expected hours and late marking would have fallen back to org-wide
// values without saying so. New employees now start on whichever shift is
// marked here.
//
// The rest is stored and not yet applied, and says so. Shift mapping has no
// screen of its own, there is no shift-change request to make a reason
// mandatory on, and no shift allowance reaches payroll. They are shown because
// they are the reference's own settings and hiding them would make a partial
// configuration look complete — but nothing here pretends to work.

const COLUMNS = [
  { key: 'manager', label: 'Reporting manager' },
  { key: 'employee', label: 'Employee (for self)' },
];
const ROWS = [
  { key: 'view', label: 'Employee shift mapping can be viewed by' },
  { key: 'edit', label: 'Employee shift mapping can be edited by' },
  { key: 'editPastWithinPayPeriod', label: 'Edit past shift schedules within current pay period' },
  { key: 'editPastWithinCalendarYear', label: 'Edit past shift schedules within current calendar year' },
];

export default function ShiftsGeneral() {
  const { config, set, loading, saving, dirty, save } =
    useConfigSection('general', 'Shift', 'shift-config');

  if (loading || !config) return <Spinner />;

  const shifts = config.shifts || [];
  const perms = config.mappingPermissions || {};
  const notify = config.notifyOnShiftChange || {};
  const allowance = config.shiftAllowance || {};

  const setCell = (row, col, value) =>
    set({ mappingPermissions: { ...perms, [row]: { ...(perms[row] || {}), [col]: value } } });

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Select the default work shift for employees"
        description="By default, employees are mapped to this shift unless they are specifically mapped to another"
      >
        <select
          value={config.defaultShiftId || ''}
          onChange={e => set({ defaultShiftId: e.target.value })}
          className={`${selectClass} min-w-[280px]`}
        >
          {shifts.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} [{s.startTime} – {s.endTime}]
            </option>
          ))}
        </select>

        {shifts.length === 0 && (
          <Note>
            No shifts exist yet. Add one under Manage Shifts — without a shift, expected hours and
            late marking fall back to the org-wide figures for everyone.
          </Note>
        )}
        {shifts.length > 0 && (
          <p className="text-[13px] text-slate-500 mt-3 max-w-[620px]">
            A new employee starts on this shift. Existing employees keep the shift they already have.
          </p>
        )}
      </Card>

      <Card
        title="Shift mapping permission"
        description="Define settings related to shift mapping permissions"
        actions={<NotWired />}
      >
        <PermissionMatrix columns={COLUMNS} rows={ROWS} values={perms} onChange={setCell} />

        <div className="mt-5 space-y-2.5">
          <Check
            checked={config.allowViewDepartmentSchedules}
            onChange={v => set({ allowViewDepartmentSchedules: v })}
            label="Allow employees to view their department members' shift schedules"
          />
          <Check
            checked={config.reasonMandatoryOnShiftChange}
            onChange={v => set({ reasonMandatoryOnShiftChange: v })}
            label="Make reason mandatory for shift change"
          />
        </div>

        <Note>
          Approval routing for changes to a shift is set under the Approvals tab, on the same
          hierarchy as every other request.
        </Note>
      </Card>

      <Card
        title="Notify employees on a shift change"
        description="Send an automated notification when an employee's shift is changed"
        actions={<NotWired />}
      >
        <div className="flex flex-wrap items-center gap-6">
          <Check checked={notify.email} onChange={v => set({ notifyOnShiftChange: { ...notify, email: v } })} label="Email" />
          <Check checked={notify.feeds} onChange={v => set({ notifyOnShiftChange: { ...notify, feeds: v } })} label="Feeds" />
        </div>
      </Card>

      <Card
        title="Eligibility for shift allowance"
        description="Provide a shift allowance only when an employee clocks at least the minimum hours set below"
        actions={<NotWired />}
      >
        <Check
          checked={allowance.enabled}
          onChange={v => set({ shiftAllowance: { ...allowance, enabled: v } })}
          label="Require a minimum number of hours"
        />
        {allowance.enabled && (
          <div className="mt-3 ml-6 flex items-center gap-2.5">
            <input
              value={allowance.minimumHours || '04:00'}
              onChange={e => set({ shiftAllowance: { ...allowance, minimumHours: e.target.value } })}
              placeholder="HH:mm"
              className="w-[92px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <span className="text-[13.5px] text-slate-500">hours</span>
          </div>
        )}
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
