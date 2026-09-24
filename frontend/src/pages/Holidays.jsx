import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, LayoutList, CalendarDays, MoreHorizontal, Download, Upload, Plus, Pencil, Trash2, X, RotateCw } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import BackButton from '../components/BackButton';
import { isFullAccess } from '../utils/roles';
import { parseLocalDate as parseLocalDateUtil, fmtDate } from '../utils/dateFormat';
import useSortable from '../components/table/useSortable';
import SortableTh from '../components/table/SortableTh';
import ScopePicker, { useScopeOptions, scopeLabel } from './moreservices/leavetracker/ScopePicker';

/* ── Holidays, and Exception Working Days ─────────────────────────────────
 *  Two tabs, one record — a row in `holidays` — and only which way it points
 *  differs:
 *    a closing type  the office shuts. Nobody is judged on the day, and
 *                    working it can earn a comp-off.
 *    working_day     the opposite: a weekend the company is working, so
 *                    everyone IS judged on it and working it earns nothing.
 *  Zoho keeps them as two tabs so a working-day exception can never be
 *  mistaken for a holiday in the list; `mode` is what used to be a "Working
 *  Day Exception" option buried inside the Type dropdown, which is exactly
 *  how one ended up saved as a working day but read, everywhere else, as an
 *  ordinary holiday — the Classification column said "Holiday" for every
 *  row regardless of type, and there was nowhere separate to check it.
 *
 *  Location and Shifts are real scoping now (ScopePicker/useScopeOptions),
 *  not the two fixed strings this page used to print under every row.
 * ────────────────────────────────────────────────────────────────────────── */

// Holiday returned after Save — lets the admin click "Send Email" right after.
function parseLocalDate(dateStr) {
  return parseLocalDateUtil(dateStr) || new Date();
}
const isWeekendDate = (ymd) => {
  if (!ymd) return false;
  const day = new Date(String(ymd).slice(0, 10) + 'T00:00:00').getDay();
  return day === 0 || day === 6;
};

const CLASSIFICATIONS = [
  ['company',    'Company Holiday'],
  ['national',   'National Holiday'],
  ['restricted', 'Restricted Holiday'],
];
const CLASS_LABEL = Object.fromEntries(CLASSIFICATIONS.map(([v, l]) => [v, l]));

const BLANK_FORM = (workingDay, year) => ({
  name: '', date: workingDay ? '' : `${year}-01-01`, description: '',
  type: workingDay ? 'working_day' : 'company',
  locationIds: [], shiftIds: [],
  category: '', mailBody: '',
  compensationType: '', compensatedHolidayId: '',
  dayType: 'full', reminderDays: 0, notifyFeeds: false, reprocessLeave: false,
  preference: 'except_shift_based',
});

// Summary line for the two "on save" actions — shown once, right after Save.
function actionsSummary(actions) {
  if (!actions) return null;
  const parts = [];
  if (actions.feedsNotified != null) parts.push(`Notified ${actions.feedsNotified} employee(s) via feeds`);
  if (actions.leaveReprocessed) parts.push(`Reprocessed ${actions.leaveReprocessed.recomputed} of ${actions.leaveReprocessed.scanned} leave application(s)`);
  return parts.length ? parts.join(' · ') : null;
}

export default function Holidays({ mode = 'holiday' }) {
  const workingDay = mode === 'working_day';
  const { user } = useAuth();
  const [allHolidays, setAllHolidays] = useState([]);   // unfiltered, so "Select Compensated Holiday" can see the other tab too
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState(null);   // holiday _id being edited, or null for Add
  const [form, setForm] = useState(BLANK_FORM(workingDay, new Date().getFullYear()));
  const [saving, setSaving]   = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [notifying, setNotifying] = useState(false);
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [moreOpen, setMoreOpen] = useState(false);
  const { locations, shifts } = useScopeOptions();

  const holidays = allHolidays.filter(h => workingDay ? h.type === 'working_day' : h.type !== 'working_day');

  const sort = useSortable(holidays, {
    id: `holidays-list-${mode}`,
    columns: {
      name: { get: h => h.name, type: 'text' },
      date: { get: h => (h.date ? String(h.date).slice(0, 10) : null), type: 'date' },
      location: { get: h => scopeLabel(h.locationIds, locations), type: 'text' },
      shifts: { get: h => scopeLabel(h.shiftIds, shifts), type: 'text' },
      type: { get: h => CLASS_LABEL[h.type] || h.type, type: 'text' },
      description: { get: h => h.description, type: 'text' },
    },
  });
  const moreMenuRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e) => { if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const weekendOk = !workingDay || !form.date || isWeekendDate(form.date);

  // Export the holidays currently visible (filtered by the year nav above)
  // as a plain CSV — admin can open in Excel / share over email.
  const handleExportCsv = () => {
    if (!holidays.length) { toast.error('Nothing to export'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Name,Date,Classification,Location,Shifts,Description\n';
    const rows = holidays.map(h => [
      h.name, fmtDate(h.date, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      CLASS_LABEL[h.type] || h.type, scopeLabel(h.locationIds, locations), scopeLabel(h.shiftIds, shifts), h.description,
    ].map(esc).join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${workingDay ? 'working-days' : 'holidays'}-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // GET /api/holidays/template — fetches the xlsx template the backend
  // builds at runtime, then triggers a browser download.
  const handleDownloadTemplate = async () => {
    try {
      const r = await api.get('/holidays/template', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'holidays_template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Download failed');
    }
  };

  // POST /api/holidays/import — upload a filled-in template. Backend parses
  // every row, converts dates (handles both DD/MM/YYYY strings and Excel
  // serial numbers), and INSERTs one holiday per row. Reports the count back.
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const r = await api.post('/holidays/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(r.data.message || 'Imported');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const load = () => {
    setLoading(true);
    api.get(`/holidays?year=${year}`).then(r => setAllHolidays(r.data.data || [])).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, [year]);

  const openAdd = () => {
    setEditingId(null);
    setForm(BLANK_FORM(workingDay, year));
    setModal(true);
  };

  const openEdit = (h) => {
    setEditingId(h._id);
    setForm({
      name: h.name || '', date: String(h.date).slice(0, 10), description: h.description || '',
      type: h.type || (workingDay ? 'working_day' : 'company'),
      locationIds: h.locationIds || [], shiftIds: h.shiftIds || [],
      category: h.category || '', mailBody: h.mailBody || '',
      compensationType: h.compensationType || '', compensatedHolidayId: h.compensatedHolidayId || '',
      dayType: h.dayType === 'half' ? 'half' : 'full', reminderDays: h.reminderDays || 0,
      notifyFeeds: false, reprocessLeave: false,
      preference: h.preference === 'all' ? 'all' : 'except_shift_based',
    });
    setModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (workingDay && !weekendOk) {
      toast.error('That date is already a working day. Pick a Saturday or Sunday to declare an exception.');
      return;
    }
    setSaving(true);
    try {
      const yearFromDate = new Date(form.date + 'T00:00:00').getFullYear();
      const body = { ...form, year: yearFromDate };
      if (editingId) {
        const r = await api.put(`/holidays/${editingId}`, body);
        toast.success('Saved');
        const summary = actionsSummary(r.data.actions);
        if (summary) toast(summary, { icon: 'ℹ️' });
        setModal(false);
        setEditingId(null);
        setForm(BLANK_FORM(workingDay, year));
        load();
      } else {
        const r = await api.post('/holidays', body);
        toast.success(workingDay ? 'Working day added' : 'Holiday saved!');
        const summary = actionsSummary(r.data.actions);
        if (summary) toast(summary, { icon: 'ℹ️' });
        setLastSaved(r.data.data);   // keeps the modal open so admin can hit "Send Email"
        load();
      }
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const closeModal = () => {
    setModal(false);
    setLastSaved(null);
    setEditingId(null);
    setForm(BLANK_FORM(workingDay, year));
  };

  // Send the holiday's mail_body to every active employee. Idempotent on
  // the backend — admin can re-trigger if they edit the message later.
  const handleNotify = async () => {
    if (!lastSaved?._id) return;
    if (!confirm('Send the announcement email to ALL active employees? This will reach every employee with an email on record.')) return;
    setNotifying(true);
    try {
      const r = await api.post(`/holidays/${lastSaved._id}/notify`);
      const s = r.data;
      toast.success(`Email sent to ${s.sent} employee(s)${s.failed ? `, ${s.failed} failed` : ''}`);
      closeModal();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send email');
    } finally {
      setNotifying(false);
    }
  };

  const handleDelete = async (h) => {
    const consequence = workingDay
      ? 'That date goes back to being a weekend — nobody will be judged on it, and working it can earn a comp-off again.'
      : 'Attendance on that day will be judged as a normal working day.';
    if (!confirm(`Remove "${h.name}" on ${fmtDate(h.date, { day: '2-digit', month: '2-digit', year: 'numeric' })}?\n\n${consequence}`)) return;
    try { await api.delete(`/holidays/${h._id}`); toast.success('Removed'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const title = workingDay ? 'Exception Working Day' : 'Holiday';
  const colSpan = workingDay ? 5 : 6;

  return (
    <div className="bg-white min-h-[calc(100vh-8rem)]">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 px-6 py-4 border-b border-slate-200">
        {/* Left: back nav + admin buttons */}
        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <BackButton to="/leave-tracker" label="Leave Tracker" />
          {isFullAccess(user) && (
            <>
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#1557B0] text-white px-3 py-1.5 rounded text-sm font-semibold transition-colors"
              >
                <Plus size={14} /> Add {title}
              </button>
              {!workingDay && (
                <>
                  <button
                    onClick={handleDownloadTemplate}
                    title="Download the xlsx template — fill it in, then click Import."
                    className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded text-sm font-semibold transition-colors"
                  >
                    <Download size={14} /> Template
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    title="Upload a filled-in template. Each row becomes one holiday."
                    className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    <Upload size={14} /> {importing ? 'Importing…' : 'Import'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImport}
                    className="hidden"
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* Center: Year Navigation */}
        <div className="flex items-center gap-4 flex-1 justify-center min-w-max">
          <button onClick={() => setYear(y => y - 1)} aria-label="Previous year" className="shrink-0 text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-2 border border-[#1a73e8] rounded px-3 py-1 text-base text-slate-700 font-medium">
             <Calendar size={14} className="text-slate-400" />
             <span className="whitespace-nowrap">01/01/{year} - 31/12/{year}</span>
          </div>
          <button onClick={() => setYear(y => y + 1)} aria-label="Next year" className="shrink-0 text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Right: view toggle + kebab menu */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex border border-slate-200 rounded text-slate-400">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="List view"
              className={`px-2.5 py-1.5 border-r border-slate-200 transition-colors ${viewMode === 'list' ? 'text-[#1a73e8] bg-blue-50/50' : 'hover:bg-slate-50'}`}
            >
              <LayoutList size={16}/>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              title="Calendar view"
              className={`px-2.5 py-1.5 transition-colors ${viewMode === 'calendar' ? 'text-[#1a73e8] bg-blue-50/50' : 'hover:bg-slate-50'}`}
            >
              <CalendarDays size={16}/>
            </button>
          </div>
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setMoreOpen(o => !o)}
              title="More actions"
              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"
            >
              <MoreHorizontal size={18} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                <button
                  type="button"
                  onClick={() => { load(); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[15px] text-slate-700 hover:bg-slate-50"
                >
                  <RotateCw size={13} /> Refresh
                </button>
                <button
                  type="button"
                  onClick={() => { handleExportCsv(); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[15px] text-slate-700 hover:bg-slate-50"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body — list (table) OR calendar (12-month grid) depending on viewMode */}
      {viewMode === 'calendar' ? (
        <CalendarYearGrid year={year} holidays={holidays} parseLocalDate={parseLocalDate} />
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100/50">
              <SortableTh sort={sort} k="name" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 w-1/4">Name</SortableTh>
              <SortableTh sort={sort} k="date" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-48">Date</SortableTh>
              <SortableTh sort={sort} k="location" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-48">Location</SortableTh>
              <SortableTh sort={sort} k="shifts" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-40">Shifts</SortableTh>
              {!workingDay && <SortableTh sort={sort} k="type" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-40">Classification</SortableTh>}
              <SortableTh sort={sort} k="description" className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white flex-1 min-w-[200px]">Description</SortableTh>
              {isFullAccess(user) && <th className="px-4 py-3.5 border-l border-white w-20"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
               <tr><td colSpan={colSpan} className="py-12 text-center text-base text-slate-400">Loading…</td></tr>
            ) : holidays.length === 0 ? (
               <tr><td colSpan={colSpan} className="py-12 text-center text-base text-slate-400">
                 {workingDay ? `No exception working days for ${year}` : `No holidays found for ${year}`}
               </td></tr>
            ) : (
               sort.sorted.map((h, i) => {
                 const d = parseLocalDate(h.date);
                 return (
                   <tr key={h._id || i} className="hover:bg-slate-50 group">
                     <td className="px-6 py-4 text-[15px] text-slate-800">{h.name}</td>
                     <td className="px-6 py-4 text-[15px] text-slate-600 border-l border-slate-100">
                       {fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' })}, {fmtDate(d, { weekday: 'short' })}
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className={`inline-block px-2.5 py-1 rounded text-[14px] ${h.locationIds?.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                         {scopeLabel(h.locationIds, locations)}
                       </span>
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className={`inline-block px-2.5 py-1 rounded text-[14px] ${h.shiftIds?.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                         {scopeLabel(h.shiftIds, shifts)}
                       </span>
                     </td>
                     {!workingDay && (
                       <td className="px-6 py-4 text-[15px] text-slate-600 border-l border-slate-100">
                         <span className={`inline-block px-2.5 py-1 rounded text-[13px] ${h.type === 'restricted' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                           {CLASS_LABEL[h.type] || h.type}
                         </span>
                       </td>
                     )}
                     <td className="px-6 py-4 text-[14px] text-slate-500 border-l border-slate-100 whitespace-normal leading-relaxed">
                       {h.description || '—'}
                     </td>
                     {isFullAccess(user) && (
                       <td className="px-4 py-4 border-l border-slate-100">
                         <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => openEdit(h)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                             <Pencil size={14} />
                           </button>
                           <button onClick={() => handleDelete(h)} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                             <Trash2 size={14} />
                           </button>
                         </div>
                       </td>
                     )}
                   </tr>
                 );
               })
            )}
          </tbody>
        </table>
      </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{editingId ? 'Edit' : 'Add'} {title}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!lastSaved}
                  placeholder={workingDay ? 'e.g. Working Day (Saturday)' : 'e.g. Diwali 2026'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>
              <div className={workingDay ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
                  {form.date && (
                    <p className="text-[13px] text-slate-400 mt-1">
                      Will be added under year <span className="font-semibold text-slate-600">{new Date(form.date + 'T00:00:00').getFullYear()}</span>
                    </p>
                  )}
                  {workingDay && form.date && !weekendOk && (
                    <p className="text-[13px] text-rose-600 mt-1">
                      {fmtDate(form.date, { day: '2-digit', month: '2-digit', year: 'numeric' })} is already a working day. Only a Saturday or Sunday can be declared an exception.
                    </p>
                  )}
                </div>
                {!workingDay && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Day Type</label>
                    <div className="flex gap-2">
                      {[['full', 'Full Day'], ['half', 'Half Day']].map(([v, l]) => (
                        <label key={v} className={`flex-1 text-center px-2 py-2 rounded-lg border text-sm cursor-pointer ${form.dayType === v ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
                          <input type="radio" name="dayType" className="hidden" checked={form.dayType === v} onChange={() => setForm({ ...form, dayType: v })} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {!workingDay && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Classification</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50">
                    {CLASSIFICATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {form.type === 'restricted' && (
                    <p className="text-[13px] text-slate-400 mt-1">
                      Optional — the office stays open and the day still counts as a working day.
                    </p>
                  )}
                </div>
              )}

              <ScopePicker
                locationIds={form.locationIds}
                shiftIds={form.shiftIds}
                locations={locations}
                shifts={shifts}
                onChange={(next) => setForm({ ...form, ...next })}
              />

              {!workingDay && form.locationIds.length > 0 && form.shiftIds.length === 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Preference</label>
                  <div className="space-y-2">
                    {[
                      ['all', 'All users tagged to selected locations'],
                      ['except_shift_based', 'All users tagged to selected locations except employees tagged to shift-based holidays'],
                    ].map(([v, label]) => (
                      <label key={v} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.preference === v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
                        <input type="radio" name="preference" className="mt-0.5" checked={form.preference === v} onChange={() => setForm({ ...form, preference: v })} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {form.preference !== 'all' && (
                    <p className="text-[12px] text-slate-400 mt-1">
                      Applicable to all the employees assigned to selected locations except employees applicable to shift-based holidays on selected holiday dates.
                    </p>
                  )}
                </div>
              )}
              {!workingDay && form.locationIds.length > 0 && form.shiftIds.length > 0 && (
                <p className="text-[12px] text-amber-600 -mt-2">
                  Shift based holiday will override the location based holiday.
                </p>
              )}

              {!workingDay ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Mail Details <span className="text-slate-400 font-normal">(used by "Send Email" below)</span></label>
                    <textarea rows={3} value={form.mailBody} onChange={e => setForm({ ...form, mailBody: e.target.value })} disabled={!!lastSaved}
                      placeholder="e.g. Due to the Election the Company has declared a holiday for all employees on 23-Apr-2026. Please plan accordingly."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 resize-none disabled:bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      No. of day(s) before to send a reminder email <span className="text-slate-400 font-normal">(0 = no reminder)</span>
                    </label>
                    <input type="number" min="0" max="60" value={form.reminderDays} disabled={!!lastSaved}
                      onChange={e => setForm({ ...form, reminderDays: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
                  </div>
                  {!lastSaved && (
                    <div className="space-y-2 pt-1">
                      <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={form.notifyFeeds} onChange={e => setForm({ ...form, notifyFeeds: e.target.checked })} className="mt-0.5" />
                        Notify applicable employees via feeds
                      </label>
                      <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={form.reprocessLeave} onChange={e => setForm({ ...form, reprocessLeave: e.target.checked })} className="mt-0.5" />
                        Reprocess leave applications based on this {editingId ? 'updated' : 'added'} holiday
                      </label>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Working Day Due to</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500">
                      <option value="">Select…</option>
                      <option value="additional_workload">Additional Workload</option>
                      <option value="project_deadline">Project Deadline</option>
                      <option value="compensate_holiday">Compensate Previous Holiday</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Compensation Type</label>
                    <div className="flex gap-3">
                      {[
                        { v: 'future', label: 'Future Compensation',  desc: 'Employees get a future day off' },
                        { v: 'past',   label: 'For a Past Holiday',   desc: 'Makes up for a previously-given holiday' },
                      ].map(o => (
                        <label key={o.v} className={`flex-1 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.compensationType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                          <input type="radio" name="comptype" className="hidden" checked={form.compensationType === o.v} onChange={() => setForm({...form, compensationType: o.v})}/>
                          <p className="font-semibold">{o.label}</p>
                          <p className="text-[12px] mt-0.5 opacity-70">{o.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  {form.compensationType === 'past' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1">Select Compensated Holiday <span className="text-slate-400 font-normal">(which past holiday is this making up for?)</span></label>
                      <select value={form.compensatedHolidayId} onChange={e => setForm({ ...form, compensatedHolidayId: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500">
                        <option value="">Select…</option>
                        {allHolidays.filter(h => h.type !== 'working_day').map(h => (
                          <option key={h._id} value={h._id}>{fmtDate(h.date, { day: '2-digit', month: '2-digit', year: 'numeric' })} — {h.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="text-[13px] text-amber-600">
                    Everyone in scope is judged on this day as a normal working day, and working it will no longer earn a comp-off.
                  </p>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} disabled={!!lastSaved}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>

              {/* After saving a NEW holiday, switch the action bar to a
                  "Send Email" / "Done" pair so admin can decide whether to
                  notify employees. Editing an existing row skips this — it
                  goes straight back to the list, like Zoho's Edit popup does. */}
              {!lastSaved ? (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-base font-medium hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={saving || (workingDay && !weekendOk)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-base font-semibold disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 pt-2 bg-emerald-50 -mx-5 -mb-5 px-5 py-4 border-t border-emerald-100 rounded-b-xl">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 bg-white text-slate-600 py-2 rounded-lg text-base font-medium hover:bg-slate-50">Done</button>
                  <button type="button" onClick={handleNotify} disabled={notifying || !form.mailBody?.trim() || workingDay}
                    title={workingDay ? 'Email notifications are for holidays, not working day exceptions' : (!form.mailBody?.trim() ? 'Add a mail body before sending' : '')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-base font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
                    {notifying ? 'Sending…' : '📧 Send Email to All Employees'}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─ Calendar view: 12 mini-month boxes in a 4x3 grid ─
 * Days that have an entry get a red background + tooltip with the name.
 * Pure read-only — clicking a day does nothing right now (add later if
 * the team wants click-to-edit behaviour). */
function CalendarYearGrid({ year, holidays, parseLocalDate }) {
  // Build a map of day-of-year keys ("Y-M-D") to every holiday name landing
  // on that day, so two holidays sharing a date both surface in the tooltip
  // instead of the second one silently disappearing.
  const map = {};
  for (const h of holidays) {
    const d = parseLocalDate(h.date);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map[k]) map[k] = [];
    map[k].push(h.name);
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DOW    = ['S','M','T','W','T','F','S'];

  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50">
      {MONTHS.map((mName, mIdx) => {
        const firstDow    = new Date(year, mIdx, 1).getDay();
        const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);

        return (
          <div key={mIdx} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
            <h4 className="text-[15px] font-bold text-slate-800 mb-2 text-center">{mName} {year}</h4>
            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {DOW.map((d, i) => (
                <div key={i} className="text-[11px] text-slate-400 font-semibold text-center uppercase">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, idx) => {
                if (day === null) return <div key={idx} className="h-6" />;
                const k = `${year}-${mIdx}-${day}`;
                const names = map[k];
                const isWeekendCol = idx % 7 === 0 || idx % 7 === 6;
                return (
                  <div
                    key={idx}
                    title={names ? names.map(n => `${day} ${mName}: ${n}`).join('\n') : ''}
                    className={`relative h-6 flex items-center justify-center text-[13px] rounded ${
                      names
                        ? 'bg-red-100 text-red-700 font-bold cursor-help'
                        : isWeekendCol ? 'bg-amber-50 text-amber-700' : 'text-slate-600'
                    }`}
                  >
                    {day}
                    {names && names.length > 1 && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
