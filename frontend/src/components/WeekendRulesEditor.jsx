import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Plus, Pencil, Trash2, X, Save, Repeat } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { isFullAccess } from '../utils/roles';
import { useWeekendRules } from '../context/WeekendRulesContext';

const DAY_LABELS = [
  { key: 'sun', label: 'S' },
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
];

const DAY_FULL = { sun:'Sunday', mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday' };

const blankRule = () => ({
  // mode: 'weekend' creates a row in weekend_rules.
  //       'working_day' creates a row in holidays with type='working_day'.
  mode: 'weekend',
  name: '',
  daysOfWeek: [],
  weeksOfMonth: [],
  intervalWeeks: 1,
  // Local-time YYYY-MM-DD (not UTC) — see Weekends.jsx isoDate() for why.
  startDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(),
  endType: 'never',
  endDate: '',
  endCount: 13,
  isActive: true,
  description: '',
  // Future Compensation flag — when TRUE on a recurring weekend rule, a
  // Working Day Exception can pick this rule from its dropdown to make up
  // for one of its occurrences.
  isCompensatory: false,
  // Working Day Exception extras (only used when mode === 'working_day').
  // Stored in the holidays table by the same POST /holidays endpoint.
  category: '',
  compensationType: '',
  compensatedHolidayId: '',
  // When the compensated source is a weekend rule (not a holiday), we still
  // send compensatedHolidayId to the backend but tag it here so the UI can
  // display the rule's name in subsequent edits.
  compensatedRuleId: '',
});

/** Human-readable summary of a rule — shown in the list view. */
function summarise(rule) {
  if (!rule?.daysOfWeek?.length) return 'No days selected';
  const days = rule.daysOfWeek.map(d => DAY_FULL[d]).join(', ');
  const weeks = (rule.weeksOfMonth && rule.weeksOfMonth.length > 0)
    ? `${rule.weeksOfMonth.map(w => ['1st','2nd','3rd','4th','5th'][w - 1]).join(' & ')} `
    : '';
  const interval = (rule.intervalWeeks || 1) > 1 ? `every ${rule.intervalWeeks} weeks` : 'every week';
  let end = '';
  if (rule.endType === 'on'    && rule.endDate)  end = `, until ${new Date(rule.endDate).toLocaleDateString('en-IN')}`;
  if (rule.endType === 'after' && rule.endCount) end = `, ${rule.endCount} occurrences`;
  return `${weeks}${days}, ${interval}${end}`;
}

const WeekendRulesEditor = forwardRef(function WeekendRulesEditor(_props, ref) {
  const { user } = useAuth();
  const { rules: contextRules, holidays: contextHolidays, reload } = useWeekendRules();

  // Compensatory sources for the Working Day Exception dropdown — merged
  // list of holidays + weekend rules, both filtered to those marked
  // "Future Compensation = Yes". Each entry carries a kind discriminator
  // so onChange can decide which backend field to populate.
  const compensatorySources = React.useMemo(() => {
    const fromHolidays = (contextHolidays || [])
      .filter(h => h.type !== 'working_day' && h.isCompensatory === true)
      .map(h => ({
        kind: 'holiday',
        id: h._id || h.id,
        label: `${new Date(h.date).toLocaleDateString('en-IN')} — ${h.name}`,
        date: h.date,
      }));
    const fromRules = (contextRules || [])
      .filter(r => r.isCompensatory === true && r.isActive !== false)
      .map(r => ({
        kind: 'rule',
        id: r.id,
        label: `🔁 Rule: ${r.name}${r.startDate ? ` (from ${new Date(r.startDate).toLocaleDateString('en-IN')})` : ''}`,
        date: r.startDate,
      }));
    return [...fromHolidays, ...fromRules];
  }, [contextHolidays, contextRules]);
  const isAdmin = isFullAccess(user);

  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);     // either an existing rule or a blank one
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState(null);   // id of the rule currently being removed/toggled

  // Hydrate local state from the shared context so we don't re-fetch.
  useEffect(() => { if (contextRules) setRules(contextRules); }, [contextRules]);

  const openNew  = (prefill) => setEditing({ ...blankRule(), ...(prefill || {}) });
  // YYYY-MM-DD in LOCAL time. toLocaleDateString('en-CA') is the timezone-
  // safe way — toISOString().slice(0,10) would shift the date back a day
  // in IST. Used to feed <input type="date"> from API timestamps.
  const toLocalYMD = (v) => v ? new Date(v).toLocaleDateString('en-CA') : '';

  const openEdit = (r) => setEditing({
    // Start from blankRule so newly-added fields (isCompensatory, mode, etc.)
    // have sensible defaults if the rule predates them.
    ...blankRule(),
    ...r,
    mode: 'weekend',
    // Date inputs expect YYYY-MM-DD; Postgres returns full ISO timestamps.
    // Use local-time conversion so the date doesn't shift in IST.
    startDate: toLocalYMD(r.startDate),
    endDate:   toLocalYMD(r.endDate),
    endCount:  r.endCount  || 13,
    endType:   r.endType   || 'never',
    isCompensatory: !!r.isCompensatory,
  });
  const closeEditor = () => setEditing(null);

  // Allow parent components (e.g. the calendar preview) to open the editor
  // pre-filled with values derived from a clicked date.
  useImperativeHandle(ref, () => ({ openNew, openEdit }), [openNew, openEdit]);

  const save = async () => {
    if (!editing.name.trim()) return toast.error('Please name the rule');

    // Working Day Exception path — write to /api/holidays with type='working_day'.
    // Only single-date supported (recurring exceptions would explode the holidays table).
    if (editing.mode === 'working_day') {
      if (!editing.startDate) return toast.error('Pick a date');
      setSaving(true);
      try {
        await api.post('/holidays', {
          name: editing.name.trim(),
          date: editing.startDate,
          type: 'working_day',
          year: new Date(editing.startDate).getFullYear(),
          description: editing.description || '',
          // Meeting feedback: capture why this working day was declared and
          // (if it's making up for a past holiday or weekend rule) link to it.
          category:               editing.category || null,
          compensationType:       editing.compensationType || null,
          compensatedHolidayId:   editing.compensatedHolidayId || null,
          compensatedRuleId:      editing.compensatedRuleId    || null,
        });
        toast.success('Working day exception added');
        closeEditor();
        reload();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Save failed');
      } finally { setSaving(false); }
      return;
    }

    // Weekend rule path — original validation and endpoint.
    if (!editing.daysOfWeek.length) return toast.error('Pick at least one weekday');
    if (editing.endType === 'on' && !editing.endDate) return toast.error('Pick an end date');
    if (editing.endType === 'after' && !editing.endCount) return toast.error('Set the occurrence count');
    setSaving(true);
    try {
      const payload = { ...editing };
      delete payload.mode;
      delete payload.description;
      if (editing.id) await api.put(`/weekend-rules/${editing.id}`, payload);
      else            await api.post('/weekend-rules', payload);
      toast.success(editing.id ? 'Rule updated' : 'Rule created');
      closeEditor();
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    setActingId(rule.id);
    try {
      await api.delete(`/weekend-rules/${rule.id}`);
      toast.success('Rule deleted');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    } finally { setActingId(null); }
  };

  const toggleActive = async (rule) => {
    setActingId(rule.id);
    try {
      await api.put(`/weekend-rules/${rule.id}`, { ...rule, isActive: !rule.isActive });
      reload();
    } catch (err) { toast.error('Toggle failed'); }
    finally { setActingId(null); }
  };

  /* ── Rule editor form (modal) ───────────────────────────────────── */
  const toggleDay = (k) => {
    const has = editing.daysOfWeek.includes(k);
    setEditing({ ...editing, daysOfWeek: has ? editing.daysOfWeek.filter(d => d !== k) : [...editing.daysOfWeek, k] });
  };
  const toggleWeek = (n) => {
    const has = editing?.weeksOfMonth?.includes(n);
    setEditing({ ...editing, weeksOfMonth: has ? editing.weeksOfMonth.filter(w => w !== n) : [...(editing.weeksOfMonth || []), n].sort((a,b) => a-b) });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="text-[16px] font-bold text-slate-800">Weekend Rules</h3>
          <p className="text-[14px] text-slate-500 mt-0.5">
            Define which days are weekends. Rules combine — a date is a weekend if any active rule matches.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557B0] text-white text-[14px] font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Rule
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {rules.length === 0 && (
          <div className="px-5 py-8 text-center text-[15px] text-slate-400">
            No weekend rules configured. {isAdmin ? 'Click "New Rule" to add one.' : 'Ask an admin to add one.'}
          </div>
        )}
        {rules.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-5 py-3.5 ${r.isActive === false ? 'opacity-50' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
              <Repeat size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-slate-800 truncate">{r.name}</p>
              <p className="text-[13px] text-slate-500 truncate">{summarise(r)}</p>
            </div>
            {isAdmin && (
              <>
                <label className="inline-flex items-center gap-2 text-[13px] text-slate-500 cursor-pointer select-none mr-2">
                  <input
                    type="checkbox"
                    checked={r.isActive !== false}
                    disabled={actingId === r.id}
                    onChange={() => toggleActive(r)}
                    className="rounded disabled:opacity-50"
                  />
                  Active
                </label>
                <button onClick={() => openEdit(r)} disabled={actingId === r.id} className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-50"><Pencil size={14} /></button>
                <button onClick={() => remove(r)} disabled={actingId === r.id} className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-600 disabled:opacity-50"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Editor modal (Google-Calendar-style custom recurrence) ── */}
      {editing && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h3 className="text-[17px] font-semibold text-slate-800">
                {editing.id ? 'Edit Rule' : 'New Weekend Rule'}
              </h3>
              <button onClick={closeEditor} className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">

              {/* Mode toggle — choose between recurring Weekend rule or one-off Working Day Exception */}
              {!editing.id && (
                <div>
                  <label className="block text-[14px] font-semibold text-slate-700 mb-2">What does this rule do?</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing({ ...editing, mode: 'weekend' })}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                        editing.mode === 'weekend'
                          ? 'border-blue-300 bg-blue-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <p className="text-[14px] font-semibold text-slate-800">Make a Weekend</p>
                      <p className="text-[13px] text-slate-500">Recurring non-working day</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ ...editing, mode: 'working_day' })}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                        editing.mode === 'working_day'
                          ? 'border-emerald-300 bg-emerald-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <p className="text-[14px] font-semibold text-slate-800">Working Day Exception</p>
                      <p className="text-[13px] text-slate-500">One-off override for a single date</p>
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Name</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder={editing.mode === 'working_day' ? 'e.g. Working Saturday (project deadline)' : 'e.g. 1st & 3rd Saturdays'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                />
              </div>

              {/* Working Day Exception — minimal form: just the date + an optional description */}
              {editing.mode === 'working_day' && (
                <>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Date</label>
                    <input
                      type="date"
                      value={editing.startDate}
                      onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                    />
                    <p className="text-[13px] text-slate-500 mt-1">
                      Even if this date would normally be a weekend, it'll be treated as a working day.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Working Day Due to</label>
                    <select
                      value={editing.category || ''}
                      onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                    >
                      <option value="">Select…</option>
                      <option value="additional_workload">Additional Workload</option>
                      <option value="project_deadline">Project Deadline</option>
                      <option value="compensate_holiday">Compensate Previous Holiday</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Compensation Type</label>
                    <div className="flex gap-2">
                      {[
                        { v: 'future', label: 'Future Compensation', desc: 'Employees get a future day off' },
                        { v: 'past',   label: 'For a Past Holiday',  desc: 'Makes up for an already-given holiday' },
                      ].map(o => (
                        <label
                          key={o.v}
                          className={`flex-1 px-3 py-2 rounded-lg border text-[13px] cursor-pointer ${editing.compensationType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                        >
                          <input
                            type="radio"
                            name="comp_type"
                            className="hidden"
                            checked={editing.compensationType === o.v}
                            onChange={() => setEditing({ ...editing, compensationType: o.v })}
                          />
                          <p className="font-semibold">{o.label}</p>
                          <p className="text-[12px] mt-0.5 opacity-70">{o.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  {editing.compensationType === 'past' && (
                    <div>
                      <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                        Select Compensated Source
                        <span className="text-slate-400 font-normal ml-1">(holiday OR weekend rule marked Future Compensation = Yes)</span>
                      </label>
                      <select
                        value={
                          editing.compensatedHolidayId
                            ? `holiday:${editing.compensatedHolidayId}`
                            : editing.compensatedRuleId
                              ? `rule:${editing.compensatedRuleId}`
                              : ''
                        }
                        onChange={(e) => {
                          const [kind, id] = e.target.value.split(':');
                          const src = compensatorySources.find(x => x.kind === kind && x.id === id);
                          // For holidays, the working-day Date should match
                          // the holiday's date (the day being overridden).
                          // For weekend rules, leave the date as-is — admin
                          // picks the specific occurrence manually.
                          const autoDate = (kind === 'holiday' && src?.date) ? String(src.date).slice(0, 10) : editing.startDate;
                          setEditing({
                            ...editing,
                            compensatedHolidayId: kind === 'holiday' ? id : null,
                            compensatedRuleId:    kind === 'rule'    ? id : null,
                            startDate: autoDate,
                          });
                        }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                      >
                        <option value="">Select…</option>
                        {compensatorySources.map(s => (
                          <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>{s.label}</option>
                        ))}
                      </select>
                      <p className="text-[13px] text-slate-500 mt-1">
                        Picking a <strong>holiday</strong> auto-fills the Date above. <strong>Weekend rules</strong> keep your typed date (you pick the specific occurrence).
                      </p>
                      {compensatorySources.length === 0 && (
                        <p className="text-[13px] text-amber-600 mt-1">
                          No compensatory sources yet. Create a Holiday OR a Weekend Rule with <strong>Future Compensation = Yes</strong> first.
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Description (optional)</label>
                    <input
                      value={editing.description || ''}
                      onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      placeholder="Why is this a working day?"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </>
              )}

              {/* Everything below this only applies to the recurring Weekend rule path. */}
              {editing.mode !== 'working_day' && (<>

              <div className="flex items-center gap-3">
                <label className="text-[14px] text-slate-600">Repeat every</label>
                <input
                  type="number"
                  min={1}
                  value={editing.intervalWeeks}
                  onChange={(e) => setEditing({ ...editing, intervalWeeks: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-[15px] text-center focus:outline-none focus:border-blue-400"
                />
                <span className="text-[14px] text-slate-600">week(s)</span>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Repeat on</label>
                <div className="flex items-center gap-1.5">
                  {DAY_LABELS.map(d => {
                    const active = editing.daysOfWeek.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => toggleDay(d.key)}
                        className={`w-8 h-8 rounded-full text-[14px] font-bold transition-colors ${
                          active
                            ? 'bg-[#1a73e8] text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                  Only on these weeks of the month <span className="text-slate-400 font-normal">(optional — leave blank for every week)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  {[1,2,3,4,5].map(n => {
                    const active = (editing.weeksOfMonth || []).includes(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => toggleWeek(n)}
                        className={`px-3 h-8 rounded-full text-[13px] font-bold transition-colors ${
                          active
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {['1st','2nd','3rd','4th','5th'][n - 1]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Start date</label>
                <input
                  type="date"
                  value={editing.startDate}
                  onChange={(e) => {
                    // Keep endDate locked to startDate while "Does not repeat" mode is active.
                    const newStart = e.target.value;
                    const isOneOff = editing.endType === 'on' && editing.endDate === editing.startDate;
                    setEditing({
                      ...editing,
                      startDate: newStart,
                      endDate: isOneOff ? newStart : editing.endDate,
                    });
                  }}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[14px] font-semibold text-slate-700 mb-1">When should this rule stop?</label>
                <p className="text-[13px] text-slate-500 mb-2">Pick one of the four options below.</p>

                {/* The four "Ends" modes map onto two backend fields (endType + endDate/endCount).
                 *  Mode "Does not repeat" is encoded as endType='on' with endDate forced to startDate. */}
                {(() => {
                  const isOneOff = editing.endType === 'on' && editing.endDate === editing.startDate;
                  const mode = editing.endType === 'never'
                    ? 'never'
                    : isOneOff
                      ? 'once'
                      : editing.endType === 'on'
                        ? 'on'
                        : 'after';
                  const setMode = (m) => {
                    if (m === 'never') setEditing({ ...editing, endType: 'never', endDate: '', endCount: null });
                    else if (m === 'once')  setEditing({ ...editing, endType: 'on', endDate: editing.startDate });
                    else if (m === 'on')    setEditing({ ...editing, endType: 'on', endDate: editing.endDate && editing.endDate !== editing.startDate ? editing.endDate : '' });
                    else if (m === 'after') setEditing({ ...editing, endType: 'after', endCount: editing.endCount || 13 });
                  };
                  return (
                <div className="space-y-1.5">
                  {/* Does not repeat — one-off, fires only on the start date */}
                  <label
                    className={`flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border transition-colors ${
                      mode === 'once'
                        ? 'border-blue-300 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={mode === 'once'}
                      onChange={() => setMode('once')}
                    />
                    <div>
                      <p className="text-[15px] font-semibold text-slate-800">Does not repeat</p>
                      <p className="text-[13px] text-slate-500">
                        Marks only the start date as a weekend — fires once and stops.
                      </p>
                    </div>
                  </label>

                  {/* Never */}
                  <label
                    className={`flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border transition-colors ${
                      mode === 'never'
                        ? 'border-blue-300 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={mode === 'never'}
                      onChange={() => setMode('never')}
                    />
                    <div>
                      <p className="text-[15px] font-semibold text-slate-800">Never expires</p>
                      <p className="text-[13px] text-slate-500">The rule keeps running forever.</p>
                    </div>
                  </label>

                  {/* On a specific date */}
                  <label
                    className={`flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border transition-colors ${
                      mode === 'on'
                        ? 'border-blue-300 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={mode === 'on'}
                      onChange={() => setMode('on')}
                    />
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-slate-800">Stop on a specific date</p>
                      <p className="text-[13px] text-slate-500 mb-1.5">
                        After this date, the rule no longer applies.
                      </p>
                      <input
                        type="date"
                        value={editing.endDate || ''}
                        disabled={mode !== 'on'}
                        onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-[14px] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                      />
                    </div>
                  </label>

                  {/* After N occurrences */}
                  <label
                    className={`flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border transition-colors ${
                      mode === 'after'
                        ? 'border-blue-300 bg-blue-50/40'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={mode === 'after'}
                      onChange={() => setMode('after')}
                    />
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-slate-800">Stop after a number of times</p>
                      <p className="text-[13px] text-slate-500 mb-1.5">
                        e.g. "stop after the 12th time it fires."
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] text-slate-500">After</span>
                        <input
                          type="number"
                          min={1}
                          value={editing.endCount || 1}
                          disabled={mode !== 'after'}
                          onChange={(e) => setEditing({ ...editing, endCount: parseInt(e.target.value, 10) })}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-[14px] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                        />
                        <span className="text-[14px] text-slate-500">time(s)</span>
                      </div>
                    </div>
                  </label>
                </div>
                  );
                })()}
              </div>

              {/* Future Compensation flag — TRUE means this weekend rule will
                  later be made up for by a Working Day Exception. The exception's
                  dropdown picks the rule up from this flag. */}
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Future Compensation?</label>
                <div className="flex gap-2">
                  {[
                    { v: false, label: 'No',  desc: 'No make-up working day needed.' },
                    { v: true,  label: 'Yes', desc: 'A Working Day Exception will be declared later. This rule will appear in that dropdown.' },
                  ].map(o => (
                    <label
                      key={String(o.v)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-[13px] cursor-pointer ${editing.isCompensatory === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                      <input
                        type="radio"
                        name="rule_iscomp"
                        className="hidden"
                        checked={editing.isCompensatory === o.v}
                        onChange={() => setEditing({ ...editing, isCompensatory: o.v })}
                      />
                      <p className="font-semibold">{o.label}</p>
                      <p className="text-[12px] mt-0.5 opacity-70">{o.desc}</p>
                    </label>
                  ))}
                </div>
              </div>

              </>)}
              {/* End of weekend-only fields. */}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0 bg-white">
              <button
                onClick={closeEditor}
                className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[14px] font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557B0] text-white px-4 py-2 rounded-lg text-[14px] font-semibold transition-colors disabled:opacity-60"
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default WeekendRulesEditor;
