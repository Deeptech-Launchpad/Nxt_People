import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Card, Check, Toggle, Note, selectClass, useConfigSection, SaveBar, Spinner } from '../configKit';

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

// "Update older attendance entries". Asks first, in two steps: a dry run that
// reports what would move, then an apply the person has to choose. Only the
// day's status changes — punches and hours are the record of what happened.
function UpdateOlderEntries({ dirty }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const run = async (apply) => {
    setBusy(true);
    try {
      const r = await api.post('/attendance-config/policy/reprocess', { apply });
      if (apply) { setDone(r.data.data); setPreview(null); }
      else setPreview(r.data.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not read the older entries');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="text-[13.5px] font-medium text-slate-700 mb-2">Update older attendance entries</p>

      {/* Running this against a policy that has been edited but not saved would
          re-apply the OLD one, which reads as the button not working. */}
      {dirty ? (
        <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
          Save your changes first — this re-applies the saved policy, not the edits on screen.
        </p>
      ) : (
        <button
          onClick={() => run(false)} disabled={busy}
          className="border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 px-4 py-1.5 rounded-md text-[13.5px] font-semibold"
        >
          {busy && !preview ? 'Checking…' : 'Update'}
        </button>
      )}

      {done && (
        <div className="mt-3 text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5 max-w-[620px]">
          {done.written} older {done.written === 1 ? 'day' : 'days'} updated to match the current policy.
        </div>
      )}

      {preview && (
        <div className="mt-3 border border-slate-200 rounded-lg px-4 py-3.5 max-w-[620px] bg-white">
          {preview.changed === 0 ? (
            <p className="text-[13.5px] text-slate-600">
              Nothing to update — all {preview.finished} finished {preview.finished === 1 ? 'day' : 'days'} since{' '}
              {preview.from} already match the current policy.
            </p>
          ) : (
            <>
              <p className="text-[13.5px] text-slate-800 font-medium">
                {preview.changed} of {preview.finished} finished days would change.
              </p>
              <p className="text-[12.5px] text-slate-500 mt-0.5">
                Counting from {preview.from}. Only the day&rsquo;s status moves — check-in,
                check-out and hours stay exactly as recorded.
              </p>
              <div className="mt-2.5 space-y-1">
                {preview.transitions.map(t => (
                  <div key={t.label} className="flex items-center gap-2 text-[13px]">
                    <span className="tabular-nums text-slate-800 font-medium w-12">{t.count}</span>
                    <span className="text-slate-600">{t.label}</span>
                  </div>
                ))}
              </div>
              {preview.sample?.length > 0 && (
                <details className="mt-2.5">
                  <summary className="text-[12.5px] text-slate-500 cursor-pointer hover:text-slate-700">
                    Show examples
                  </summary>
                  <div className="mt-2 space-y-1 max-h-[190px] overflow-y-auto">
                    {preview.sample.map(s => (
                      <div key={s.id} className="text-[12.5px] text-slate-500 tabular-nums">
                        {s.code} &middot; {s.date} &middot; {Number(s.hours).toFixed(2)}h of {s.owed}h owed
                        &nbsp;<span className="text-slate-400">{s.from} &rarr;</span>{' '}
                        <span className="text-slate-700">{s.to}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  onClick={() => run(true)} disabled={busy}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-1.5 rounded-md text-[13.5px] font-semibold"
                >
                  {busy ? 'Updating…' : `Update ${preview.changed} ${preview.changed === 1 ? 'day' : 'days'}`}
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-md text-[13.5px] text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
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
  // An older saved policy has strictMode but no mode. Deriving it here keeps
  // that policy on the setting it already had rather than showing Custom.
  const mode = ['strict', 'lenient', 'custom'].includes(config.mode)
    ? config.mode
    : (config.strictMode === false ? 'lenient' : 'strict');
  // A half-day figure only means something where a half day can occur. Lenient
  // never makes one, and Custom set to "absent" never makes one either, so both
  // collapse to a single expected figure and a single ceiling.
  const oneFigure = mode === 'lenient'
    || (mode === 'custom' && config.shortDayBecomes !== 'half_day');

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
              <Radio name="strictness" label="Strict mode" checked={mode === 'strict'}
                onChange={() => set({ mode: 'strict', strictMode: true })} />
              <Radio name="strictness" label="Lenient mode" checked={mode === 'lenient'}
                onChange={() => set({ mode: 'lenient', strictMode: false })} />
              <Radio name="strictness" label="Custom" checked={mode === 'custom'}
                onChange={() => set({ mode: 'custom', strictMode: true })} />
            </div>

            <p className="text-[13px] text-slate-500 mb-3 max-w-[620px]">
              {mode === 'strict'
                ? 'Hours decide the day. At or above the full-day figure it is present; between the half-day and full-day figures it is half present and half absent; below the half-day figure it is absent.'
                : mode === 'lenient'
                  ? 'The punch decides the day. Any check-in or check-out marks the person present however few hours they worked. The shortfall is still reported.'
                  : 'The same rule with its decisions set below. Strict and Lenient are presets of this — Custom just unlocks them.'}
            </p>

            {mode === 'custom' && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 mb-4 space-y-4 max-w-[620px]">
                <div>
                  <p className="text-[13.5px] font-medium text-slate-700 mb-2">A day short of the expected hours becomes</p>
                  <div className="flex flex-wrap items-center gap-6">
                    <Radio name="shortDay" label="Absent"
                      checked={config.shortDayBecomes !== 'half_day'}
                      onChange={() => set({ shortDayBecomes: 'absent' })} />
                    <Radio name="shortDay" label="A half day"
                      checked={config.shortDayBecomes === 'half_day'}
                      onChange={() => set({ shortDayBecomes: 'half_day' })} />
                  </div>
                  <p className="text-[12px] text-slate-400 mt-1.5">
                    &ldquo;A half day&rdquo; is what the reference does. &ldquo;Absent&rdquo; means someone
                    a few minutes short loses the whole day.
                  </p>
                </div>

                <div>
                  <p className="text-[13.5px] font-medium text-slate-700 mb-2">Tolerance</p>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="number" min="0" max="240"
                      value={config.toleranceMinutes ?? 0}
                      onChange={e => set({ toleranceMinutes: e.target.value === '' ? 0 : Number(e.target.value) })}
                      aria-label="Tolerance in minutes"
                      className="w-24 text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white"
                    />
                    <span className="text-[13px] text-slate-500">minutes short still counts as a full day</span>
                  </div>
                </div>

                <div className="space-y-2.5 pt-1">
                  <Check
                    checked={config.leaveReducesExpected !== false}
                    onChange={v => set({ leaveReducesExpected: v })}
                    label="Half-day leave halves what is expected that day"
                    hint="Off means someone on approved half-day leave still has to work a full day to avoid being marked short."
                  />
                  <Check
                    checked={config.permissionReducesExpected !== false}
                    onChange={v => set({ permissionReducesExpected: v })}
                    label="Approved permission reduces what is expected that day"
                    hint="Off means two hours of permission and six hours worked is marked short, which makes permission a punishment."
                  />
                  <Check
                    checked={!!config.exemptOnDuty}
                    onChange={v => set({ exemptOnDuty: v })}
                    label="On-duty days are exempt from the hours rule"
                    hint="For people at a client site with nothing to punch. Off means an on-duty day is judged on hours like any other."
                  />
                </div>

                <div>
                  <p className="text-[13.5px] font-medium text-slate-700 mb-2">On a half-day leave, the other half counts as</p>
                  <div className="flex flex-wrap items-center gap-6">
                    <Radio name="otherHalf" label="Leave"
                      checked={config.halfDayLeaveOtherHalf !== 'absent'}
                      onChange={() => set({ halfDayLeaveOtherHalf: 'leave' })} />
                    <Radio name="otherHalf" label="Absent"
                      checked={config.halfDayLeaveOtherHalf === 'absent'}
                      onChange={() => set({ halfDayLeaveOtherHalf: 'absent' })} />
                  </div>
                  <p className="text-[12px] text-slate-400 mt-1.5">
                    &ldquo;Absent&rdquo; takes the day off their balance and marks them away for it.
                  </p>
                </div>
              </div>
            )}

            <div className="mb-4">
              <p className="text-[13.5px] font-medium text-slate-700 mb-2">Apply this rule from</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="date"
                  value={config.ruleEffectiveFrom || ''}
                  onChange={e => set({ ruleEffectiveFrom: e.target.value || null })}
                  aria-label="Rule effective from"
                  className="text-[14px] rounded-md border border-slate-300 px-3 py-1.5 bg-white"
                />
                {config.ruleEffectiveFrom && (
                  <button
                    onClick={() => set({ ruleEffectiveFrom: null })}
                    className="text-[13px] text-blue-600 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[12px] text-slate-400 mt-1.5 max-w-[620px]">
                {config.ruleEffectiveFrom
                  ? 'Days before this date keep whatever rule was in force when they were worked, so an already-reported month cannot change underneath you.'
                  : 'Left blank, a change applies to every day ever recorded — including months that have already been reported on.'}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block min-w-[290px]">
              <div className="flex flex-wrap items-center gap-5 mb-3.5">
                <Radio name="expectedMode" label="Set manually" checked={!shiftMode}
                  onChange={() => set({ expectedMode: 'manual' })} />
                <Radio name="expectedMode" label="Shift hours" checked={shiftMode}
                  onChange={() => set({ expectedMode: 'shift' })} />
              </div>
              {/* Lenient never produces a half day — the punch decides the whole
                  day — so asking for a half-day figure there would be asking for
                  a number nothing reads. The reference collapses the box to one
                  field for exactly that reason, and to "Duration of the shift"
                  when the figures come from the shift. */}
              {shiftMode ? (
                <div className="space-y-1.5 text-[13.5px] text-slate-700">
                  {oneFigure ? (
                    <p>Expected hours per day : <span className="text-slate-500">Duration of the shift</span></p>
                  ) : (
                    <>
                      <p>Full day : <span className="text-slate-500">Duration of the shift</span></p>
                      <p>Half day : <span className="text-slate-500">Half of the shift duration</span></p>
                    </>
                  )}
                </div>
              ) : oneFigure ? (
                <HoursField label="Expected hours per day" value={config.expectedFullDay}
                  onChange={v => set({ expectedFullDay: v })} />
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
            {/* Same reason as the expected-hours box: with no half day to cap,
                the reference shows a single "Per Day" ceiling instead. */}
            {max.enabled && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-4 inline-block mt-3 ml-6 space-y-2.5">
                {oneFigure ? (
                  <HoursField label="Per day" value={max.fullDay} onChange={v => setIn('maxHours', { fullDay: v })} />
                ) : (
                  <>
                    <HoursField label="Full day" value={max.fullDay} onChange={v => setIn('maxHours', { fullDay: v })} />
                    <HoursField label="Half day" value={max.halfDay} onChange={v => setIn('maxHours', { halfDay: v })} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* A day's status is written at check-out under the policy in force
              that afternoon, so changing the policy leaves older days saying
              what the old rule said. This re-applies the current one. It shows
              what would change before it changes anything — the reference has a
              bare Update button, and a bare button here would rewrite thousands
              of days on one click. */}
          <UpdateOlderEntries dirty={dirty} />

          <div>
            <Check
              checked={config.roundOff}
              onChange={v => set({ roundOff: v })}
              label="Round-off"
              hint="Use this option to automatically adjust employee check-in, check-out, and total working hours to rounded time"
            />
            {/* "Rounded" has to say rounded to what, so the interval and the
                direction are asked for here. Reports round; the stored punch
                always keeps the real time. */}
            {config.roundOff && (
              <div className="ml-6 mt-3 flex flex-wrap items-center gap-2.5 text-[14px] text-slate-700">
                <span>Round worked hours</span>
                <select
                  value={config.roundOffMode || 'nearest'}
                  onChange={e => set({ roundOffMode: e.target.value })}
                  aria-label="Rounding direction"
                  className={selectClass}
                >
                  <option value="nearest">to the nearest</option>
                  <option value="up">up to the next</option>
                  <option value="down">down to the previous</option>
                </select>
                <select
                  value={config.roundOffMinutes || 15}
                  onChange={e => set({ roundOffMinutes: Number(e.target.value) })}
                  aria-label="Rounding interval"
                  className={selectClass}
                >
                  {[5, 10, 15, 30].map(m => <option key={m} value={m}>{m} minutes</option>)}
                </select>
              </div>
            )}
            <p className="text-[12px] text-slate-400 mt-2 ml-6 max-w-[46rem]">
              Applied when a report is read, never to the stored check-in and check-out — the
              recorded times stay exactly as they were punched.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="Late arrival"
        description="When an arrival counts as late"
      >
        {/* This card used to hold a second Full day / Half day pair, which was
            a duplicate of Expected hours per day above and could drift from it.
            Expected hours decides the day now, as it does in the reference.
            Late marking is a genuinely separate question, so it stays. */}
        <div className="space-y-5">
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
        <Toggle checked={night.enabled} onChange={v => setIn('lateNightHours', { enabled: v })} label="Late-night work hours" />
        <p className="text-[12px] text-slate-400 mt-2 ml-14 max-w-[46rem]">
          Reported as its own column on Presence hours break-up. It is a premium band, so what the
          hours are worth stays a payroll decision rather than something this setting applies.
        </p>
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
