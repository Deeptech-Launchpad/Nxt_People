import React from 'react';
import { Card, Check, Toggle, Note, NotWired, selectClass, useConfigSection, SaveBar, Spinner } from '../configKit';

// Attendance Policy — how a day's hours are counted, and which days are paid.
//
// The expected-hours block edits settings.expected_hours_mode / _per_day /
// _half_day_hours, the same columns every report already reads. It is not a
// second copy in JSONB: two answers to "how long is a full day" is what
// produced the 8h00-vs-8h30 discrepancy across three reports.
//
// Note the two are genuinely different numbers here, as they are in the
// reference: expected hours (08:00) drive payable and expected figures, while
// the shift span (09:30–18:00, so 08:30) drives Early/Late and the maximum.

const Radio = ({ name, checked, onChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="radio" name={name} checked={!!checked} onChange={() => onChange()}
      className="w-4 h-4 accent-blue-600" />
    <span className="text-[14px] text-slate-700">{label}</span>
  </label>
);

// Hours are held as a number but read far better as HH:mm — "08:30", not "8.5".
const toHHmm = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const h = Math.floor(n);
  return `${String(h).padStart(2, '0')}:${String(Math.round((n - h) * 60)).padStart(2, '0')}`;
};
const fromHHmm = s => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(s).trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
};

// "Late mark after" is stored as minutes from midnight but only reads as a
// time — 570 means nothing, 09:30 means everything.
const minutesToTime = mins => {
  const n = Number(mins);
  if (!Number.isFinite(n)) return '09:30';
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};
const timeToMinutes = value => {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(value).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 570;
};

function HoursField({ label, value, onChange, disabled }) {
  const [text, setText] = React.useState(toHHmm(value));
  // Re-sync when the loaded config arrives, but never while the field is being
  // typed into — reformatting mid-keystroke fights the person editing it.
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => { if (!focused) setText(toHHmm(value)); }, [value, focused]);

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13.5px] text-slate-600 w-[68px]">{label}<span className="text-red-500 ml-0.5">*</span></span>
      <input
        value={text} disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={e => {
          setText(e.target.value);
          const parsed = fromHHmm(e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => { setFocused(false); setText(toHHmm(value)); }}
        placeholder="HH:mm"
        className="w-[92px] text-[14px] rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
      />
      <span className="text-[13.5px] text-slate-500">hours</span>
    </div>
  );
}

export default function AttendancePolicy() {
  const { config, set, setIn, loading, saving, dirty, save } =
    useConfigSection('policy', 'Attendance policy', 'attendance-config');

  if (loading || !config) return <Spinner />;

  const max = config.maxHours || {};
  const pay = config.payDays || {};
  const night = config.lateNightHours || {};
  const shiftMode = config.expectedMode === 'shift';

  return (
    <div className="space-y-4 pb-4">
      <Card title="Working hours" description="Define how you want working hours to be calculated in your organization">
        <div className="space-y-6">
          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-2.5">Calculate total working hours from</p>
            <div className="flex flex-wrap items-center gap-6">
              <Radio name="calcFrom" label="First check-in and last check-out"
                checked={config.calculateHoursFrom === 'first_last'}
                onChange={() => set({ calculateHoursFrom: 'first_last' })} />
              <Radio name="calcFrom" label="Every valid check-in and check-out"
                checked={config.calculateHoursFrom !== 'first_last'}
                onChange={() => set({ calculateHoursFrom: 'every' })} />
            </div>
            <p className="text-[13px] text-slate-500 mt-2">
              {config.calculateHoursFrom === 'first_last'
                ? 'The day is measured from the first check-in to the last check-out, including any gap in between.'
                : 'Each check-in and check-out pair is counted, so time away between them is not paid.'}
            </p>
          </div>

          <div>
            <p className="text-[13.5px] font-medium text-slate-700 mb-2.5">Expected hours per day</p>
            <div className="flex flex-wrap items-center gap-6 mb-3">
              <Radio name="strictness" label="Strict mode" checked={config.strictMode !== false}
                onChange={() => set({ strictMode: true })} />
              <Radio name="strictness" label="Lenient mode" checked={config.strictMode === false}
                onChange={() => set({ strictMode: false })} />
              <NotWired>Strictness is saved, but not yet applied</NotWired>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block min-w-[290px]">
              <div className="flex flex-wrap items-center gap-5 mb-3.5">
                <Radio name="expectedMode" label="Set manually" checked={!shiftMode}
                  onChange={() => set({ expectedMode: 'manual' })} />
                <Radio name="expectedMode" label="Shift hours" checked={shiftMode}
                  onChange={() => set({ expectedMode: 'shift' })} />
              </div>
              {shiftMode ? (
                <p className="text-[13px] text-slate-500 max-w-[280px]">
                  Each employee&rsquo;s expected hours come from the length of their own shift.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <HoursField label="Full day" value={config.expectedFullDay}
                    onChange={v => set({ expectedFullDay: v })} />
                  <HoursField label="Half day" value={config.expectedHalfDay}
                    onChange={v => set({ expectedHalfDay: v })} />
                </div>
              )}
            </div>
            <p className="text-[13px] text-slate-500 mt-2.5 max-w-[620px]">
              Every expected and payable figure in the attendance reports follows from this, not from the
              shift timing. Early and late check-in are measured against the shift instead.
            </p>
          </div>

          <Check
            checked={config.allowOvertimeAndDeviation}
            onChange={v => set({ allowOvertimeAndDeviation: v })}
            label="Allow overtime and deviation"
            hint="If allowed, the system will calculate the extra and deficit time based on logged hours"
          />

          <div>
            <Check
              checked={max.enabled}
              onChange={v => setIn('maxHours', { enabled: v })}
              label="Impose maximum hours per day"
              hint="A day is never counted as longer than this, however long the punches say"
            />
            {max.enabled && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block mt-3 ml-6 space-y-2.5">
                <HoursField label="Full day" value={max.fullDay} onChange={v => setIn('maxHours', { fullDay: v })} />
                <HoursField label="Half day" value={max.halfDay} onChange={v => setIn('maxHours', { halfDay: v })} />
              </div>
            )}
          </div>

          <div className="flex items-start">
            <Check
              checked={config.roundOff}
              onChange={v => set({ roundOff: v })}
              label="Round-off"
              hint="Use this option to automatically adjust employee check-in, check-out, and total working hours to rounded time"
            />
            <NotWired />
          </div>
        </div>
      </Card>

      <Card
        title="Day classification"
        description="What a finished day is called once someone checks out, and when an arrival counts as late"
      >
        <div className="space-y-5">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block space-y-2.5">
            <HoursField label="Full day" value={config.presentAtLeastHours}
              onChange={v => set({ presentAtLeastHours: v })} />
            <HoursField label="Half day" value={config.halfDayAtLeastHours}
              onChange={v => set({ halfDayAtLeastHours: v })} />
          </div>
          <p className="text-[13px] text-slate-500 max-w-[620px] -mt-1">
            At or above the full-day figure the day is present; below it but at or above the half-day
            figure it is a half day; below that it is absent.
          </p>

          <div>
            <label className="block text-[13.5px] font-medium text-slate-700 mb-1.5">Late mark after</label>
            <input
              type="time"
              value={minutesToTime(config.lateAfterMinutes)}
              onChange={e => set({ lateAfterMinutes: timeToMinutes(e.target.value) })}
              className={selectClass}
            />
            <p className="text-[13px] text-slate-500 mt-1.5 max-w-[620px]">
              Used when an employee has no shift of their own. Anyone on a shift is measured against
              that shift's start time instead.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Pay days / hours calculation" description="Define how pay days / hours are to be calculated in your organization">
        <p className="text-[13.5px] font-medium text-slate-700 mb-3">Select the options to be included in payroll</p>
        <div className="space-y-2.5">
          <Check checked={pay.weekends} onChange={v => setIn('payDays', { weekends: v })} label="Weekends" />
          <Check checked={pay.holidays} onChange={v => setIn('payDays', { holidays: v })} label="Holidays" />
          <Check checked={pay.leave} onChange={v => setIn('payDays', { leave: v })} label="Leave" />
        </div>
        <p className="text-[13px] text-slate-500 mt-3 max-w-[620px]">
          Unticking one stops those days counting as payable in Attendance data for payroll, Presence hours
          break-up and Expected vs worked hours.
        </p>
      </Card>

      <Card title="Late-night work hours" description="Define a time range for late-night work. Hours within this period are tracked separately for pay calculations.">
        <div className="flex items-start">
          <Toggle checked={night.enabled} onChange={v => setIn('lateNightHours', { enabled: v })} label="Late-night work hours" />
          <NotWired />
        </div>
        {night.enabled && (
          <div className="flex items-center gap-3 mt-4 ml-14">
            <input type="time" value={night.from || '22:00'} onChange={e => setIn('lateNightHours', { from: e.target.value })} className={selectClass} />
            <span className="text-[13.5px] text-slate-500">to</span>
            <input type="time" value={night.to || '06:00'} onChange={e => setIn('lateNightHours', { to: e.target.value })} className={selectClass} />
          </div>
        )}
      </Card>

      <Card
        title="Effective date of policy for absent records"
        description="Select the date from which the absent records of your employees should be updated based on the policy defined above"
      >
        <input
          type="date"
          value={config.absentEffectiveFrom || ''}
          onChange={e => set({ absentEffectiveFrom: e.target.value || null })}
          className={selectClass}
        />
        {!config.absentEffectiveFrom && (
          <Note>
            With no date set, the policy applies to every attendance record there is. Set one to leave
            history before that date untouched.
          </Note>
        )}
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
