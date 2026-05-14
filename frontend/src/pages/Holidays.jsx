import React, { useState, useEffect, useRef } from 'react';
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
  const [form, setForm] = useState({ name: '', date: '', type: 'company', description: '', location: 'Saibaba Colony, Coimbatore', shifts: 'General Shift' });
  const [saving, setSaving] = useState(false);
  // Bulk import — hidden file input drives the visible "Import" button.
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/holidays?year=${year}`).then(r => setHolidays(r.data.data)).catch(console.error).finally(() => setLoading(false));
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

  useEffect(load, [year]);

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const yearFromDate = new Date(form.date + 'T00:00:00').getFullYear();
      await api.post('/holidays', { ...form, year: yearFromDate });
      toast.success('Holiday added!');
      setModal(false); setForm({ name: '', date: '', type: 'company', description: '', location: 'Saibaba Colony, Coimbatore', shifts: 'General Shift' }); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
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
            <>
              <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#1557B0] text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors">
                <Plus size={14} /> Add Holiday
              </button>
              <button
                onClick={handleDownloadTemplate}
                title="Download the xlsx template — fill it in, then click Import."
                className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded text-xs font-semibold transition-colors"
              >
                <Download size={14} /> Template
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title="Upload a filled-in template. Each row becomes one holiday."
                className="flex items-center gap-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-60"
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
          <div className="bg-white rounded w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Add Holiday</h3>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSave} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Holiday Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required className="w-full border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="company">Company Holiday</option>
                  <option value="restricted">Restricted Holiday</option>
                  <option value="working_day">Working Day Exception</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="w-full border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border border-slate-200 rounded px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium w-full">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
