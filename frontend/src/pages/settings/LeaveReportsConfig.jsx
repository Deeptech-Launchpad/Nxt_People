import React from 'react';
import { Card, Check, Toggle, NotWired, SaveBar, Spinner, selectClass, useConfigSection } from './configKit';

const ACCESS = [
  ['administrators', 'Allow only administrators to view all data'],
  ['department_heads', "Allow only department heads to view their department's data"],
  ['employees_own_department', "Allow employees to view only their department's data"],
  ['all_employees', 'Allow all employees to view all data'],
];

// Reports configuration — who can see leave data, and how the two payroll-facing
// reports treat weekends, holidays and unpaid leave.
export default function LeaveReportsConfig() {
  const { config, set, setIn, loading, saving, dirty, save } = useConfigSection('reports', 'Reports');
  if (loading) return <Spinner />;
  if (!config) return null;

  const payroll = config.payrollReport || {};
  const lop = config.lossOfPay || {};

  return (
    <div className="space-y-4 pb-20">
      <Card
        title="Resource availability report and leave calendar access"
        description="Define who can access the leave calendar and the resource availability report, which contains details on employees' leave and absences"
      >
        <label className="block text-[14px] text-slate-700 mb-2">Access permissions for employees</label>
        <select
          value={config.resourceAccess}
          onChange={e => set({ resourceAccess: e.target.value })}
          className={`${selectClass} w-full max-w-[420px]`}
        >
          {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p className="text-[12px] text-slate-400 mt-1.5">
          Applied on top of each report's own role check — this narrows who sees which rows, and
          never grants access a role does not already have.
        </p>

        <div className="mt-5">
          <Check
            label="Show leave policy types"
            hint="Displays the type of leave employees have taken in the report and calendar views. If disabled, all leaves will be displayed as 'L' (Leave)."
            checked={config.showLeaveTypes}
            onChange={v => set({ showLeaveTypes: v })}
          />
          {/* The grids now carry a display code separately from the real one,
              so collapsing to 'L' cannot move an unpaid day into the paid
              bucket of the roll-ups. */}
          <p className="text-[12px] text-slate-400 mt-1.5 ml-[26px]">
            Payable-day arithmetic still uses the real leave type either way.
          </p>
        </div>
      </Card>

      <Card title="Leave data for payroll report" description="Only administrators can view this report when enabled">
        <Toggle
          label="Leave data for payroll report"
          checked={payroll.enabled}
          onChange={v => setIn('payrollReport', { enabled: v })}
        />
        {payroll.enabled && (
          <div className="mt-5 space-y-4">
            <Check
              label="Include weekends as payable days"
              hint="When enabled, weekends are considered as payable days. The report will not include a separate column for weekends. Disable to maintain separate column and treat weekends as non payable."
              checked={payroll.includeWeekendsAsPayable}
              onChange={v => setIn('payrollReport', { includeWeekendsAsPayable: v })}
            />
            <Check
              label="Include holidays as payable days"
              hint="When enabled, holidays are considered as payable days. The report will not include a separate column for holidays. Disable to maintain separate column and treat holidays as non payable."
              checked={payroll.includeHolidaysAsPayable}
              onChange={v => setIn('payrollReport', { includeHolidaysAsPayable: v })}
            />
          </div>
        )}
      </Card>

      <Card title="Loss of pay details report" description="Define preferences related to loss of pay">
        <p className="text-[14px] text-slate-700 mb-3">
          Unpaid leave will be
          {lop.unpaidLeave === 'carry_over' && (
            <NotWired>Carrying over is not applied — unpaid leave is still reported as LOP</NotWired>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2.5">
          {[['lop', 'treated as LOP'], ['carry_over', 'carried over to next pay period']].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2.5 cursor-pointer text-[14px] text-slate-700">
              <input type="radio" name="unpaidLeave" checked={lop.unpaidLeave === v}
                onChange={() => setIn('lossOfPay', { unpaidLeave: v })}
                className="w-4 h-4 accent-blue-600" />
              {l}
            </label>
          ))}
        </div>

        <p className="text-[14px] text-slate-700 mt-5 mb-3">The maximum number of LOP allowed per pay period</p>
        <div className="bg-slate-50 rounded-lg p-4 inline-flex items-center gap-2.5">
          <input
            type="number" min="0" max="366"
            value={lop.maxPerPeriod ?? ''}
            onChange={e => setIn('lossOfPay', { maxPerPeriod: e.target.value === '' ? null : e.target.value })}
            aria-label="Maximum LOP per pay period"
            className="w-24 text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white"
          />
          <span className="text-[13px] text-slate-500">day</span>
          {/* Blank is meaningful here and easy to misread as unset-by-accident. */}
          <span className="text-[12px] text-slate-400">leave blank for no limit</span>
        </div>

        <div className="mt-5">
          <Toggle
            label={<>LOP reversal</>}
            hint="Allows reversal of LOP entries from past pay periods when the corresponding leave is converted to an attendance entry"
            checked={lop.reversal}
            onChange={v => setIn('lossOfPay', { reversal: v })}
          />
          <p className="text-[12px] text-slate-400 mt-1.5 ml-14">
            Converting leave to an attendance entry does not reverse LOP yet.<NotWired />
          </p>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
