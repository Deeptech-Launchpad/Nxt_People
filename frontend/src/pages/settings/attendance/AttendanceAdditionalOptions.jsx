import React from 'react';
import { Card, Check, Toggle, useConfigSection, SaveBar, Spinner } from '../configKit';

// Additional Options — the two settings that belong to no other section.
export default function AttendanceAdditionalOptions() {
  const { config, set, loading, saving, dirty, save } =
    useConfigSection('additional', 'Additional options', 'attendance-config');

  if (loading || !config) return <Spinner />;

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Password protection for file export"
        description="Once enabled, all files with attendance data will be sent to your email, encrypted with a password"
      >
        <Toggle
          checked={config.passwordProtectExport}
          onChange={v => set({ passwordProtectExport: v })}
          label="Password protection"
        />
      </Card>

      <Card title="Display preferences">
        <Check
          checked={config.scaleViewInDayTimeline}
          onChange={v => set({ scaleViewInDayTimeline: v })}
          label="Scale view in day timeline"
          hint="Use the timescale view to display real time attendance data in the bottom of the list view"
        />
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
