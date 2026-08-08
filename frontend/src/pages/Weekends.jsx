import React, { useRef, useState } from 'react';
import { X, Check, ChevronRight, Briefcase } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import WeekendRulesEditor from '../components/WeekendRulesEditor';
import { useWeekendRules } from '../context/WeekendRulesContext';

const DAY_KEYS    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_PRETTY  = { sun:'Sunday', mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday' };
const ORDINAL     = ['1st', '2nd', '3rd', '4th', '5th'];

const weekOfMonthForWeekday = (d) => Math.floor((d.getDate() - 1) / 7) + 1;
// Local-time YYYY-MM-DD. `toISOString()` would convert to UTC first, which
// shifts the date back a day for IST (UTC+5:30) users — clicking May 11 in
// the calendar would set startDate to May 10. Use locale-aware formatting.
const isoDate                = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/* ── Recurrence presets built from a clicked date ────────────────────── */
function buildPresets(date) {
  const dayKey   = DAY_KEYS[date.getDay()];
  const dayName  = DAY_PRETTY[dayKey];
  const wom      = weekOfMonthForWeekday(date);
  const ord      = ORDINAL[wom - 1];
  const start    = isoDate(date);

  return [
    {
      key: 'once',
      label: 'Does not repeat',
      hint: `Only ${dayName}, ${date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`,
      rule: {
        name: `${dayName} ${date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`,
        daysOfWeek: [dayKey],
        weeksOfMonth: [],
        intervalWeeks: 1,
        startDate: start,
        endType: 'on',
        endDate: start,
        isActive: true,
      },
    },
    {
      key: 'weekly',
      label: `Weekly on ${dayName}`,
      hint: `Every ${dayName} starting ${date.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}`,
      rule: {
        name: `Every ${dayName}`,
        daysOfWeek: [dayKey],
        weeksOfMonth: [],
        intervalWeeks: 1,
        startDate: start,
        endType: 'never',
        isActive: true,
      },
    },
    {
      key: 'monthly',
      label: `Monthly on the ${ord} ${dayName}`,
      hint: `${ord} ${dayName} of every month`,
      rule: {
        name: `${ord} ${dayName}`,
        daysOfWeek: [dayKey],
        weeksOfMonth: [wom],
        intervalWeeks: 1,
        startDate: start,
        endType: 'never',
        isActive: true,
      },
    },
  ];
}

/* ── Preset picker dialog ────────────────────────────────────────────── */
function PresetDialog({ date, onClose, onCustom, onSaved, isWeekend }) {
  const [saving, setSaving] = useState(null);
  if (!date) return null;

  const presets = buildPresets(date);

  const apply = async (preset) => {
    if (!confirm(`Create this rule — "${preset.label}"? This changes attendance, leave, and reports app-wide.`)) return;
    setSaving(preset.key);
    try {
      await api.post('/weekend-rules', preset.rule);
      toast.success('Rule created');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(null); }
  };

  /** Working Day Exception — flips a single weekend into a working day.
   *  Implemented via the holidays table (type='working_day'), not the
   *  weekend_rules table, because it's a per-date override. */
  const addWorkingDayException = async () => {
    if (!confirm('Mark this date as a working day? This overrides the weekend rule for this date across attendance, leave, and reports.')) return;
    setSaving('working_day');
    try {
      const yearFromDate = date.getFullYear();
      await api.post('/holidays', {
        name: `Working Day (${date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})`,
        date: isoDate(date),
        type: 'working_day',
        year: yearFromDate,
        description: 'Created via Weekends preview',
      });
      toast.success('Marked as working day');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(null); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-[17px] font-semibold text-slate-800">Edit this date</h3>
            <p className="text-[14px] text-slate-500 mt-0.5">
              {date.toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
              {isWeekend && <span className="ml-2 text-amber-600 font-semibold">· currently a weekend</span>}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">
            <X size={15} />
          </button>
        </div>

        <div className="py-2">
          {/* Weekend presets */}
          <p className="px-5 pt-1 pb-1 text-[12px] font-bold uppercase tracking-wider text-slate-400">Make this a weekend</p>
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => apply(p)}
              disabled={saving !== null}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-blue-50/50 text-left transition-colors disabled:opacity-50"
            >
              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                {saving === p.key ? <span className="text-[12px]">…</span> : <Check size={13} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-slate-800">{p.label}</p>
                <p className="text-[13px] text-slate-500">{p.hint}</p>
              </div>
            </button>
          ))}

          {/* Working Day Exception — only meaningful when the date is currently a weekend */}
          {isWeekend && (
            <>
              <div className="border-t border-slate-100 my-1" />
              <p className="px-5 pt-1 pb-1 text-[12px] font-bold uppercase tracking-wider text-slate-400">Or make it a working day</p>
              <button
                onClick={addWorkingDayException}
                disabled={saving !== null}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-emerald-50/50 text-left transition-colors disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  {saving === 'working_day' ? <span className="text-[12px]">…</span> : <Briefcase size={13} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-800">Working Day Exception</p>
                  <p className="text-[13px] text-slate-500">Override the weekend rule for just this date</p>
                </div>
              </button>
            </>
          )}

          <button
            onClick={() => { onClose(); onCustom?.(date); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-left transition-colors border-t border-slate-100"
          >
            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
              <ChevronRight size={14} />
            </div>
            <div className="flex-1">
              <p className="text-[13.5px] font-semibold text-slate-800">Custom…</p>
              <p className="text-[13px] text-slate-500">Pick weekdays, intervals, end date — or create a working-day exception</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 6-week calendar preview ────────────────────────────────────────── */
function CalendarPreview({ onDayClick }) {
  const { isWeekend } = useWeekendRules();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // viewMonth: first-day-of-month for whichever month is being shown.
  // Defaults to today's month. Arrow buttons step it ±1 month.
  const [viewMonth, setViewMonth] = useState(() => {
    const m = new Date(today); m.setDate(1); return m;
  });

  // Render a 6-week grid starting from the Sunday on/before the 1st of viewMonth.
  const gridStart = new Date(viewMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const cells = [];
  for (let w = 0; w < 6; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + w * 7 + d);
      cells.push(day);
    }
  }

  const shiftMonth = (delta) => {
    const m = new Date(viewMonth);
    m.setMonth(m.getMonth() + delta);
    setViewMonth(m);
  };
  const goToday = () => {
    const m = new Date(today); m.setDate(1); setViewMonth(m);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[16px] font-bold text-slate-800">Preview</h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shiftMonth(-1)} title="Previous month"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">‹</button>
          <button type="button" onClick={goToday} title="Today"
            className="text-[13px] font-semibold text-slate-600 hover:text-blue-600 px-2 py-0.5 rounded hover:bg-blue-50 min-w-[80px] text-center">
            {viewMonth.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
          </button>
          <button type="button" onClick={() => shiftMonth(1)} title="Next month"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">›</button>
        </div>
      </div>
      <p className="text-[13px] text-slate-500 mb-4">
        Click any date to mark it as a weekend. Amber = weekend by current rules.
      </p>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-[12px] font-bold text-slate-400 uppercase pb-1">{d}</div>
        ))}
        {cells.map((d, i) => {
          const isToday = d.getTime() === today.getTime();
          const isWknd  = isWeekend(d);
          const inMonth = d.getMonth() === viewMonth.getMonth();
          return (
            <button
              type="button"
              key={i}
              onClick={() => onDayClick?.(d)}
              title={`${d.toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'short', year:'numeric' })}`}
              className={`aspect-square flex items-center justify-center text-[14px] rounded-md border transition-all hover:ring-2 hover:ring-blue-300 hover:border-blue-300 ${
                isToday
                  ? 'bg-[#1a73e8] text-white border-[#1a73e8] font-bold'
                  : isWknd
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-white text-slate-700 border-slate-100'
              } ${!inMonth && !isToday ? 'opacity-50' : ''}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */
export default function Weekends() {
  const { reload, isWeekend } = useWeekendRules();
  const editorRef = useRef(null);

  // The preset dialog and the detailed editor share one date — when the
  // user picks "Custom…", we forward that date as the editor's prefill.
  const [presetDate, setPresetDate] = useState(null);

  const onCustom = (date) => {
    const dayKey = DAY_KEYS[date.getDay()];
    editorRef.current?.openNew({
      name: `${ORDINAL[weekOfMonthForWeekday(date) - 1]} ${DAY_PRETTY[dayKey]}`,
      daysOfWeek: [dayKey],
      weeksOfMonth: [weekOfMonthForWeekday(date)],
      intervalWeeks: 1,
      startDate: isoDate(date),
      endType: 'never',
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Weekend Configuration</h1>
        <p className="text-[15px] text-slate-500 mt-1">
          Manage which days count as weekends across attendance, leave, and reports.
          Rules combine — a date is a weekend if any active rule matches it.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <WeekendRulesEditor ref={editorRef} />
        </div>
        <div>
          <CalendarPreview onDayClick={setPresetDate} />
        </div>
      </div>

      <PresetDialog
        date={presetDate}
        isWeekend={presetDate ? isWeekend(presetDate) : false}
        onClose={() => setPresetDate(null)}
        onCustom={onCustom}
        onSaved={reload}
      />
    </div>
  );
}
