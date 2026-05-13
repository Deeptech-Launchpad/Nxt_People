import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, LayoutList, CalendarDays, MoreHorizontal, Download, Upload, Plus, Trash2, X } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  if (typeof dateStr !== 'string' || dateStr.includes('T')) return new Date(dateStr);
  return new Date(dateStr + 'T00:00:00');
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
        {/* Left: empty or admin buttons */}
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#1557B0] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors">
              <Plus size={14} /> Add Holiday
            </button>
          )}
        </div>

        {/* Center: Year Navigation */}
        <div className="flex items-center gap-4 absolute left-1/2 -translate-x-1/2">
          <button onClick={() => setYear(y => y - 1)} className="text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-2 border border-[#1a73e8] rounded px-3 py-1 text-sm text-slate-700 font-medium">
             <Calendar size={14} className="text-slate-400" />
             <span>01/01/{year} - 31/12/{year}</span>
          </div>
          <button onClick={() => setYear(y => y + 1)} className="text-[#1a73e8] hover:text-[#1557B0]">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Right: View Toggles & Filter */}
        <div className="flex items-center gap-3">
          <div className="flex border border-slate-200 rounded text-slate-400">
             <button className="px-2.5 py-1.5 border-r border-slate-200 hover:bg-slate-50 text-[#1a73e8] bg-blue-50/50"><LayoutList size={16}/></button>
             <button className="px-2.5 py-1.5 hover:bg-slate-50"><CalendarDays size={16}/></button>
          </div>
          <select className="border border-slate-200 text-sm text-slate-700 font-medium rounded px-3 py-1.5 outline-none">
            <option>My Holidays</option>
            <option>All Holidays</option>
          </select>
          <button className="p-1.5 text-slate-400 hover:bg-slate-100 rounded">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100/50">
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 w-1/4">Name</th>
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 border-l border-white w-48">Date</th>
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 border-l border-white w-48">Location</th>
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 border-l border-white w-40">Shifts</th>
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 border-l border-white w-32">Classification</th>
              <th className="px-6 py-3.5 text-[13px] font-semibold text-slate-600 border-l border-white flex-1 min-w-[200px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
               <tr><td colSpan={6} className="py-12 text-center text-sm text-slate-400">Loading holidays...</td></tr>
            ) : holidays.length === 0 ? (
               <tr><td colSpan={6} className="py-12 text-center text-sm text-slate-400">No holidays found for {year}</td></tr>
            ) : (
               holidays.map((h, i) => {
                 const d = parseLocalDate(h.date);
                 return (
                   <tr key={h._id || i} className="hover:bg-slate-50 group">
                     <td className="px-6 py-4 text-[13px] text-slate-800">
                       <div className="flex items-center justify-between">
                         {h.name}
                         {user?.role === 'admin' && (
                           <button onClick={() => handleDelete(h._id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                             <Trash2 size={14} />
                           </button>
                         )}
                       </div>
                     </td>
                     <td className="px-6 py-4 text-[13px] text-slate-600 border-l border-slate-100">
                       {d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}, {d.toLocaleDateString('en-US', { weekday: 'short' })}
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className="inline-block px-2.5 py-1 bg-slate-100 rounded text-[12px] text-slate-500">
                         {h.location || 'Saibaba Colony, Coimbatore'}
                       </span>
                     </td>
                     <td className="px-6 py-4 border-l border-slate-100">
                       <span className="inline-block px-2.5 py-1 bg-slate-100 rounded text-[12px] text-slate-500">
                         {h.shifts || 'General Shift'}
                       </span>
                     </td>
                     <td className="px-6 py-4 text-[13px] text-slate-600 border-l border-slate-100">
                       Holiday
                     </td>
                     <td className="px-6 py-4 text-[12px] text-slate-500 border-l border-slate-100 whitespace-normal leading-relaxed">
                       {h.description || `Wishing you everyone a very Happy ${h.name}`}
                     </td>
                   </tr>
                 );
               })
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{form.type === 'working_day' ? 'Add Working Day Exception' : 'Add Holiday'}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!lastSaved}
                  placeholder={form.type === 'working_day' ? 'e.g. Working Day (Saturday)' : 'e.g. Diwali 2026'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={!!lastSaved}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
                    <option value="company">Company Holiday</option>
                    <option value="restricted">Restricted Holiday</option>
                    <option value="working_day">Working Day Exception</option>
                  </select>
                </div>
              </div>

              {form.type !== 'working_day' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Holiday Due to</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} disabled={!!lastSaved}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">Holiday Type</label>
                    <div className="flex gap-3">
                      {[
                        { v: false, label: 'Non-Compensatory', desc: 'No make-up day needed' },
                        { v: true,  label: 'Compensatory',     desc: 'Employees work another day in exchange' },
                      ].map(o => (
                        <label key={String(o.v)} className={`flex-1 px-3 py-2 rounded-lg border text-xs cursor-pointer ${form.isCompensatory === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
                          <input type="radio" name="iscomp" className="hidden" checked={form.isCompensatory === o.v} onChange={() => setForm({...form, isCompensatory: o.v})}/>
                          <p className="font-semibold">{o.label}</p>
                          <p className="text-[10.5px] mt-0.5 opacity-70">{o.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Mail Details <span className="text-slate-400 font-normal">(used by "Send Email" below)</span></label>
                    <textarea rows={3} value={form.mailBody} onChange={e => setForm({ ...form, mailBody: e.target.value })} disabled={!!lastSaved}
                      placeholder="e.g. Due to the Election the Company has declared a holiday for all employees on 23-Apr-2026. Please plan accordingly."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none disabled:bg-slate-50" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Working Day Due to</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} disabled={!!lastSaved}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
                      <option value="">Select…</option>
                      <option value="additional_workload">Additional Workload</option>
                      <option value="project_deadline">Project Deadline</option>
                      <option value="compensate_holiday">Compensate Previous Holiday</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Compensation Type</label>
                    <div className="flex gap-3">
                      {[
                        { v: 'future', label: 'Future Compensation',  desc: 'Employees get a future day off' },
                        { v: 'past',   label: 'For a Past Holiday',   desc: 'Makes up for a previously-given holiday' },
                      ].map(o => (
                        <label key={o.v} className={`flex-1 px-3 py-2 rounded-lg border text-xs cursor-pointer ${form.compensationType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${lastSaved ? 'opacity-60 pointer-events-none' : ''}`}>
                          <input type="radio" name="comptype" className="hidden" checked={form.compensationType === o.v} onChange={() => setForm({...form, compensationType: o.v})}/>
                          <p className="font-semibold">{o.label}</p>
                          <p className="text-[10.5px] mt-0.5 opacity-70">{o.desc}</p>
                        </label>
                      ))}
                    </div>
                  </div>
                  {form.compensationType === 'past' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Select Compensated Holiday <span className="text-slate-400 font-normal">(which past holiday is this making up for?)</span></label>
                      <select value={form.compensatedHolidayId} onChange={e => setForm({ ...form, compensatedHolidayId: e.target.value })} disabled={!!lastSaved}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50">
                        <option value="">Select…</option>
                        {holidays.filter(h => h.type !== 'working_day' && h.isCompensatory).map(h => (
                          <option key={h._id} value={h._id}>{new Date(h.date).toLocaleDateString('en-IN')} — {h.name}</option>
                        ))}
                      </select>
                      <p className="text-[10.5px] text-slate-400 mt-1">Only shows holidays marked Compensatory.</p>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} disabled={!!lastSaved}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" />
              </div>

              {/* After saving the holiday, switch the action bar to a
                  "Send Email" / "Done" pair so admin can decide whether to
                  notify employees. mail_body is empty → button disabled. */}
              {!lastSaved ? (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 pt-2 bg-emerald-50 -mx-5 -mb-5 px-5 py-4 border-t border-emerald-100 rounded-b-xl">
                  <button type="button" onClick={closeModal} className="flex-1 border border-slate-200 bg-white text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">Done</button>
                  <button type="button" onClick={handleNotify} disabled={notifying || !form.mailBody?.trim() || form.type === 'working_day'}
                    title={form.type === 'working_day' ? 'Email notifications are for holidays, not working day exceptions' : (!form.mailBody?.trim() ? 'Add a mail body before sending' : '')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
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
