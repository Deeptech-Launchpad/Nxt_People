import React from 'react';
import { Card, Check, Note, NotWired, useConfigSection, SaveBar, Spinner } from '../configKit';

// Check In and Check Out — who may record attendance, who may see and change
// someone else's, and what the system says when a day looks wrong.
//
// The reference splits every permission across a Web and a Mobile column, and
// adds a facial-recognition block and a rule about entries made through the iOS
// assistant. There is no native app and no photo capture here, so those are not
// shown: the web column is the only one, and it is presented as a plain list.

function TimeBox({ value, onChange, hint, disabled }) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        value={value || ''} disabled={disabled} placeholder="HH:mm"
        onChange={e => onChange(e.target.value)}
        className="w-[92px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
      />
      <span className="text-[13.5px] text-slate-500">{hint}</span>
    </div>
  );
}

export default function CheckInOutConfig() {
  const { config, set, setIn, loading, saving, dirty, save } =
    useConfigSection('checkin', 'Check in and check out', 'attendance-config');

  if (loading || !config) return <Spinner />;

  const notify = config.notifyOnReporteeEdit || {};
  const reminders = config.reminders || {};
  const ci = reminders.checkIn || {};
  const co = reminders.checkOut || {};
  const alerts = config.deviationAlerts || {};
  const missed = alerts.missedCheckIn || {};
  const insufficient = alerts.insufficientHours || {};

  const setReminder = (key, changes) =>
    setIn('reminders', { [key]: { ...(reminders[key] || {}), ...changes } });
  const setAlert = changes => set({ deviationAlerts: { ...alerts, ...changes } });

  return (
    <div className="space-y-4 pb-4">
      <Card title="Default access permissions" description="Configure access permission for default attendance actions">
        <div className="space-y-2.5">
          <Check checked={config.webCheckInEnabled} onChange={v => set({ webCheckInEnabled: v })}
            label="Enable check-in and check-out through the web app" />
          <Check checked={config.locationMandatory} onChange={v => set({ locationMandatory: v })}
            label="Make location sharing mandatory during check-in and check-out" />
          <Check checked={config.trackLocation} onChange={v => set({ trackLocation: v })}
            label="Track and show check-in and check-out location" />
          <Check checked={config.showAllEntries} onChange={v => set({ showAllEntries: v })}
            label="Show all check-in and check-out entries" />
          <Check checked={config.restrictOnApprovedLeave} onChange={v => set({ restrictOnApprovedLeave: v })}
            label="Restrict attendance entries on approved leave"
            hint="An employee on approved leave for the day cannot check in" />
          <Check checked={config.showCurrentStatus} onChange={v => set({ showCurrentStatus: v })}
            label="Show current in/out attendance status" />
          <Check checked={config.showEarlyLateInfo} onChange={v => set({ showEarlyLateInfo: v })}
            label="Show early/late information for check-in and check-out entries" />
        </div>
        {!config.webCheckInEnabled && (
          <Note>
            With web check-in off, nobody can record attendance themselves. Days will only be created by
            an approved regularization or by someone editing entries on their behalf.
          </Note>
        )}
      </Card>

      <Card
        title="Permissions to view, add and edit entries"
        description="Set permission for employees and managers to view or add and edit the attendance entries"
      >
        <div className="space-y-2.5">
          <Check checked={config.allowEditOwnEntries} onChange={v => set({ allowEditOwnEntries: v })}
            label="Allow adding and editing an employee's own attendance entries" />
          <Check checked={config.allowViewReporteeEntries} onChange={v => set({ allowViewReporteeEntries: v })}
            label="Allow viewing reportees' entries" />
          <Check
            checked={config.allowEditReporteeEntries}
            disabled={!config.allowViewReporteeEntries}
            onChange={v => set({ allowEditReporteeEntries: v })}
            label="Allow adding and editing reportees' attendance entries"
            hint={!config.allowViewReporteeEntries ? 'Needs viewing reportees’ entries first' : undefined}
          />
          {config.allowEditReporteeEntries && (
            <div className="ml-6 mt-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5 inline-flex items-center gap-3 flex-wrap">
              <Check checked={notify.enabled} onChange={v => setIn('notifyOnReporteeEdit', { enabled: v })} label="Notify" />
              <input
                type="email" value={notify.email || ''} disabled={!notify.enabled}
                placeholder="name@company.com"
                onChange={e => setIn('notifyOnReporteeEdit', { email: e.target.value })}
                className="w-[240px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
              <NotWired>Editing a reportee's entry is not built, so there is nothing to notify about</NotWired>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Check-in / check-out reminders"
        description="Automatically send check-in / check-out reminders to employees just before and after their shift time"
      >
        <Note>
          The daily reminders themselves live in Automation → Email Alerts, where their time, wording
          and recipients are set. These offsets are a per-shift refinement of that and are not yet
          applied.
        </Note>
        <div className="space-y-5">
          <div>
            <Check checked={ci.enabled} onChange={v => setReminder('checkIn', { enabled: v })}
              label="Remind employees to check-in for shift" />
            {ci.enabled && (
              <div className="ml-6 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block space-y-2.5">
                <TimeBox value={ci.beforeShift} onChange={v => setReminder('checkIn', { beforeShift: v })} hint="Hrs before shift starts" />
                <TimeBox value={ci.afterShift} onChange={v => setReminder('checkIn', { afterShift: v })} hint="Hrs after shift starts" />
              </div>
            )}
          </div>
          <div>
            <Check checked={co.enabled} onChange={v => setReminder('checkOut', { enabled: v })}
              label="Remind employees to check-out after shift" />
            {co.enabled && (
              <div className="ml-6 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block space-y-2.5">
                <TimeBox value={co.beforeShift} onChange={v => setReminder('checkOut', { beforeShift: v })} hint="Hrs before shift ends" />
                <TimeBox value={co.afterShift} onChange={v => setReminder('checkOut', { afterShift: v })} hint="Hrs after shift ends" />
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Attendance deviation alerts"
        description="Notify reporting managers and employees based on shift schedule and working hours violations"

      >
        <div className="space-y-3.5">
          <Check checked={alerts.lateCheckIn} onChange={v => setAlert({ lateCheckIn: v })} label="Late check-in" />
          <Check checked={alerts.earlyCheckOut} onChange={v => setAlert({ earlyCheckOut: v })} label="Early check-out" />

          <div>
            <Check
              checked={missed.enabled}
              onChange={v => setAlert({ missedCheckIn: { ...missed, enabled: v } })}
              label="Missed check-in"
            />
            {missed.enabled && (
              <div className="ml-6 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5 inline-flex items-center gap-2.5 flex-wrap">
                <span className="text-[13.5px] text-slate-600">Notify reporting manager if reportees not checked in within</span>
                <TimeBox
                  value={missed.hoursAfterShiftStart}
                  onChange={v => setAlert({ missedCheckIn: { ...missed, hoursAfterShiftStart: v } })}
                  hint="Hrs after shift start time"
                />
              </div>
            )}
          </div>

          <div>
            <Check
              checked={insufficient.enabled}
              onChange={v => setAlert({ insufficientHours: { ...insufficient, enabled: v } })}
              label="Insufficient working hours"
            />
            {insufficient.enabled && (
              <div className="ml-6 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3.5 inline-block">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-[13.5px] text-slate-600">Notify when daily working hours are</span>
                  <TimeBox
                    value={insufficient.hours}
                    onChange={v => setAlert({ insufficientHours: { ...insufficient, hours: v } })}
                    hint="Hrs less than the expected hours"
                  />
                </div>
                <div className="flex items-center gap-6 mt-3">
                  <Check checked={insufficient.notifyManager}
                    onChange={v => setAlert({ insufficientHours: { ...insufficient, notifyManager: v } })}
                    label="Reporting Manager" />
                  <Check checked={insufficient.notifyEmployee}
                    onChange={v => setAlert({ insufficientHours: { ...insufficient, notifyEmployee: v } })}
                    label="Employee" />
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
