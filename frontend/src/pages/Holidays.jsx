import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, LayoutList, CalendarDays, MoreHorizontal, Download, Upload, Plus, Trash2, X, RotateCw } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import BackButton from '../components/BackButton';
import { isFullAccess } from '../utils/roles';
import { parseLocalDate as parseLocalDateUtil, fmtDate } from '../utils/dateFormat';

// Holidays.jsx historically defaults a blank date to "today" rather than
// null (used as a display fallback in a couple of spots below).
function parseLocalDate(dateStr) {
  return parseLocalDateUtil(dateStr) || new Date();
}

export default function Holidays() {
  const { user } = useAuth();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    name: '', date: '', type: 'company', description: '',
    location: 'Saibaba Colony, Coimbatore', shifts: 'General Shift',
    category: '', isCompensatory: false, mailBody: '',
    compensationType: '', compensatedHolidayId: '',
  });
  const [saving, setSaving]   = useState(false);
  // Holiday returned after Save — lets the admin click "Send Email" right after.
  const [lastSaved, setLastSaved] = useState(null);
  const [notifying, setNotifying] = useState(false);
  // Bulk import — hidden file input drives the visible "Import" button.
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  // View toggle: 'list' (default table) vs 'calendar' (12-month grid).
  const [viewMode, setViewMode] = useState('list');
  // 3-dot kebab menu state + ref for click-outside-to-close.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e) => { if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  // Export the holidays currently visible (filtered by the year nav above)
  // as a plain CSV — admin can open in Excel / share over email.
  const handleExportCsv = () => {
    if (!holidays.length) { toast.error('No holidays to export'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Name,Date,Type,Location,Shifts,Description\n';
    const rows = holidays.map(h => {
      return [h.name, fmtDate(h.date, { day: '2-digit', month: '2-digit', year: 'numeric' }), h.type, h.location, h.shifts, h.description].map(esc).join(',');
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `holidays-${year}.csv`; a.click();
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
      // Reset so the same file can be picked again after fixing rows.
      e.target.value = '';
    }
  };

  const load = () => {
    setLoading(true);
    api.get(`/holidays?year=${year}`).then(r => setHolidays(r.data.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, [year]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const yearFromDate = new Date(form.date + 'T00:00:00').getFullYear();
      const r = await api.post('/holidays', { ...form, year: yearFromDate });
      toast.success('Holiday saved!');
      setLastSaved(r.data.data);   // keeps the modal open so admin can hit "Send Email"
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const closeModal = () => {
    setModal(false);
    setLastSaved(null);
    setForm({
      name: '', date: '', type: 'company', description: '',
      location: 'Saibaba Colony, Coimbatore', shifts: 'General Shift',
      category: '', isCompensatory: false, mailBody: '',
      compensationType: '', compensatedHolidayId: '',
    });
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

  const handleDelete = async (id) => {
    if (!confirm('Delete this holiday?')) return;
    try { await api.delete(`/holidays/${id}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div className="bg-white min-h-[calc(100vh-8rem)]">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        {/* Left: back nav + admin buttons */}
        <div className="flex gap-2 items-center">
          <BackButton to="/leave-tracker" label="Leave Tracker" />
          {isFullAccess(user) && (
            <>
              <button
                onClick={() => {
                  // Pre-fill the date with Jan 1 of the year currently being
                  // viewed in the table so admins don't think the form is
                  // year-less. They can then change day/month freely — the
                  // year comes along automatically.
                  setForm(f => ({ ...f, date: `${year}-01-01` }));
                  setModal(true);
                }}
                className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#1557B0] text-white px-3 py-1.5 rounded text-sm font-semibold transition-colors"
              >
                <Plus size={14} /> Add Holiday
              </button>
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
        </div>

        {/* Center: Year Navigation */}
        <div className="flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
          <button onClick={() => setYear(y => y - 1)} className="text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-2 border border-[#1a73e8] rounded px-3 py-1 text-base text-slate-700 font-medium">
             <Calendar size={14} className="text-slate-400" />
             <span>01/01/{year} - 31/12/{year}</span>
          </div>
          <button onClick={() => setYear(y => y + 1)} className="text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Right: view toggle + kebab menu. Both now have real handlers. */}
        <div className="flex items-center gap-3">
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
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 w-1/4">Name</th>
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-48">Date</th>
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-48">Location</th>
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-40">Shifts</th>
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white w-32">Classification</th>
              <th className="px-6 py-3.5 text-[15px] font-semibold text-slate-600 border-l border-white flex-1 min-w-[200px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
               <tr><td colSpan={6} className="py-12 text-center text-base text-slate-400">Loading holidays...</td></tr>
            ) : holidays.length === 0 ? (
               <tr><td colSpan={6} className="py-12 text-center text-base text-slate-400">No holidays found for {year}</td></tr>
            ) : (
               holidays.map((h, i) => {
                 const d = parseLocalDate(h.date);
                 return (
                   <tr key={h._id || i} className="hover:bg-slate-50 group">
                     <td className="px-6 py-4 text-[15px] text-slate-800">
                       <div className="flex items-center justify-between">
                         {h.name}
                         {isFullAccess(user) && (
                           <button onClick={() => handleDelete(h._id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                             <Trash2 size={14} />
                           </button>
                         )}
                       </div>
                     </td>
                     <td className="px-6 py-4 text-[15px] text-slate-600 border-l border-slate-100">
                       {fmtDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' })}, {fmtDate(d, { weekday: 'short' })}
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className="inline-block px-2.5 py-1 bg-slate-100 rounded text-[14px] text-slate-500">
                         {h.location || 'Saibaba Colony, Coimbatore'}
                       </span>
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className="inline-block px-2.5 py-1 bg-slate-100 rounded text-[14px] text-slate-500">
                         {h.shifts || 'General Shift'}
                       </span>
                     </td>
                     <td className="px-6 py-4 text-[15px] text-slate-600 border-l border-slate-100">
                       Holiday
                     </td>
                     <td className="px-6 py-4 text-[14px] text-slate-500 border-l border-slate-100 whitespace-normal leading-relaxed">
                       {h.description || `Wishing you everyone a very Happy ${h.name}`}
                     </td>
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
              <h3 className="font-semibold text-slate-800">{form.type === 'working_day' ? 'Add Working Day Exception' : 'Add Holiday'}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!lastSaved}
                  placeholder={form.type === 'working_day' ? 'e.g. Working Day (Saturday)' : 'e.g. Diwali 2026'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
                  {form.date && (
                    <p className="text-[13px] text-slate-400 mt-1">
                      Will be added under year <span className="font-semibold text-slate-600">{new Date(form.date + 'T00:00:00').getFullYear()}</span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50">
                    <option value="company">Company Holiday</option>
                    <option value="restricted">Restricted Holiday</option>
                    <option value="working_day">Working Day Exception</option>
                  </select>
                  {form.type === 'restricted' && (
                    <p className="text-[13px] text-slate-400 mt-1">
                      Optional — the office stays open and the day still counts as a working day.
                    </p>
                  )}
                </div>
              </div>

              {form.type !== 'working_day' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Holiday Due to</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} disabled={!!lastSaved}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50">
                      <option value="">Select…</option>
                      <option value="election">Election</option>
                      <option value="no_workload">No Work Load</option>
                      <option value="general_maintenance">General Maintenance</option>
                      <option value="power_shutdown">Power Shutdown</option>
                      <option value="festival">Festival</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Future Compensation?</label>
                    <div className="flex gap-3">
                      {[
                        { v: false, label: 'No',  desc: 'No make-up working day needed' },
                        { v: true,  label: 'Yes', desc: 'A Working Day Exception will be declared later to compensate. This holiday will then appear in the "Select Compensated Holiday" dropdown.' },
                      ].map(o => (
                        <label key={String(o.v)} className={`flex-1 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.isCompensatory === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
                          <input type="radio" name="iscomp" className="hidden" checked={form.isCompensatory === o.v} onChange={() => setForm({...form, isCompensatory: o.v})}/>
                          <p className="font-semibold">{o.label}</p>
                          <p className="text-[12px] mt-0.5 opacity-70">{o.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Mail Details <span className="text-slate-400 font-normal">(used by "Send Email" below)</span></label>
                    <textarea rows={3} value={form.mailBody} onChange={e => setForm({ ...form, mailBody: e.target.value })} disabled={!!lastSaved}
                      placeholder="e.g. Due to the Election the Company has declared a holiday for all employees on 23-Apr-2026. Please plan accordingly."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 resize-none disabled:bg-slate-50" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Working Day Due to</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} disabled={!!lastSaved}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50">
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
                        <label key={o.v} className={`flex-1 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.compensationType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
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
                      <select value={form.compensatedHolidayId} onChange={e => setForm({ ...form, compensatedHolidayId: e.target.value })} disabled={!!lastSaved}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50">
                        <option value="">Select…</option>
                        {holidays.filter(h => h.type !== 'working_day' && h.isCompensatory).map(h => (
                          <option key={h._id} value={h._id}>{fmtDate(h.date)} — {h.name}</option>
                        ))}
                      </select>
                      <p className="text-[12px] text-slate-400 mt-1">Only shows holidays marked Compensatory.</p>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} disabled={!!lastSaved}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>

              {/* After saving the holiday, switch the action bar to a
                  "Send Email" / "Done" pair so admin can decide whether to
                  notify employees. mail_body is empty → button disabled. */}
              {!lastSaved ? (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-base font-medium hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-base font-semibold disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 pt-2 bg-emerald-50 -mx-5 -mb-5 px-5 py-4 border-t border-emerald-100 rounded-b-xl">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 bg-white text-slate-600 py-2 rounded-lg text-base font-medium hover:bg-slate-50">Done</button>
                  <button type="button" onClick={handleNotify} disabled={notifying || !form.mailBody?.trim() || form.type === 'working_day'}
                    title={form.type === 'working_day' ? 'Email notifications are for holidays, not working day exceptions' : (!form.mailBody?.trim() ? 'Add a mail body before sending' : '')}
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
 * Days that have a holiday get a red background + tooltip with the name.
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
