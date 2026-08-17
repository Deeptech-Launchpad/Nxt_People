import React from 'react';
import { Card, Check, Toggle, Note, useConfigSection, SaveBar, Spinner } from '../configKit';
import { PermissionMatrix } from './kit';

// Reports — who may look at attendance data they did not record, and how the
// Expected vs worked hours ledger behaves at the end of a pay period.
//
// The reference's view preferences also cover paid and unpaid break. Breaks are
// not tracked here, so only payable hours is offered.

const COLUMNS = [
  { key: 'manager', label: 'Reporting manager' },
  { key: 'employee', label: 'Employee (for self)' },
];
const ROWS = [
  { key: 'view', label: 'View' },
  // Edit cannot be granted to someone who cannot see the report.
  { key: 'edit', label: 'Edit', requires: 'view' },
];

export default function AttendanceReportsConfig() {
  const { config, set, loading, saving, dirty, save } =
    useConfigSection('reports', 'Attendance reports', 'attendance-config');

  if (loading || !config) return <Spinner />;

  const evw = config.expectedVsWorked || {};
  const prefs = config.viewPreferences || {};

  const setCell = (row, col, value) => set({
    expectedVsWorked: {
      ...evw,
      [row]: { ...(evw[row] || {}), [col]: value },
      // Clearing View has to clear the Edit that depended on it, or an
      // unreachable Edit stays true and comes back the moment View returns.
      ...(row === 'view' && !value ? { edit: { ...(evw.edit || {}), [col]: false } } : {}),
    },
  });

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Allow reporting manager to access attendance reports"
        description="If allowed, reporting manager will be able to view their reportee's attendance reports"
      >
        <Toggle checked={config.managerAccess} onChange={v => set({ managerAccess: v })} label="Allow access" />
      </Card>

      <Card
        title="Expected vs worked hours report"
        description="Control who can view and edit the employees expected vs worked hours report"
      >
        <PermissionMatrix columns={COLUMNS} rows={ROWS} values={evw} onChange={setCell} />

        <div className="mt-5">
          <Check
            checked={config.carryForwardBalanceHours}
            onChange={v => set({ carryForwardBalanceHours: v })}
            label="Carry forward balance hours to the next pay period"
            hint="The running balance continues across pay periods instead of restarting at zero each time"
          />
        </div>
        {!config.carryForwardBalanceHours && (
          <Note>
            With carry-forward off, every pay period opens at zero — an overtime surplus or a shortfall
            from the period before it is not brought across.
          </Note>
        )}
      </Card>

      <Card title="View preferences" description="Set preferences for viewing specific attendance details">
        <p className="text-[13.5px] text-slate-600 mb-3">
          Show or hide the payment-related attendance hours for your employees. Select to display the details.
        </p>
        <Check
          checked={prefs.payableHours}
          onChange={v => set({ viewPreferences: { ...prefs, payableHours: v } })}
          label="Payable hours"
        />
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
