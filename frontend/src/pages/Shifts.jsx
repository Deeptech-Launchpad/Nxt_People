import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Clock } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const COLORS = ['#4F46E5','#0891B2','#7C3AED','#DC2626','#059669','#D97706','#DB2777'];
const initForm = { name:'', startTime:'09:00', endTime:'18:00', graceMinutes:15, workingDays:['Mon','Tue','Wed','Thu','Fri'], color:'#4F46E5' };

export default function Shifts() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editShift, setEditShift] = useState(null);
  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);

  const load = () => { setLoading(true); api.get('/shifts').then(r=>setShifts(r.data.data)).catch(console.error).finally(()=>setLoading(false)); };
  useEffect(load, []);

  const toggleDay = (day) => setForm(f => ({ ...f, workingDays: f.workingDays.includes(day) ? f.workingDays.filter(d=>d!==day) : [...f.workingDays, day] }));

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editShift) { await api.put(`/shifts/${editShift._id}`, form); toast.success('Shift updated'); }
      else { await api.post('/shifts', form); toast.success('Shift created'); }
      setModal(false); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this shift?')) return;
    try { await api.delete(`/shifts/${id}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => { setEditShift(null); setForm(initForm); setModal(true); }}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
          <Plus size={16}/> Create Shift
        </button>
      </div>

      {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shifts.map(s => (
            <div key={s._id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <div className="h-2" style={{backgroundColor: s.color}}/>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display font-semibold text-slate-800">{s.name}</h3>
                    {s.isDefault && <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full mt-1 inline-block">Default</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditShift(s); setForm({name:s.name,startTime:s.startTime,endTime:s.endTime,graceMinutes:s.graceMinutes,workingDays:s.workingDays||[],color:s.color}); setModal(true); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(s._id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-slate-600">
                  <Clock size={16} style={{color: s.color}}/>
                  <span className="font-semibold text-sm">{s.startTime} — {s.endTime}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Grace period: {s.graceMinutes} minutes</p>
                <div className="flex gap-1.5 mt-4 flex-wrap">
                  {DAYS.map(d => (
                    <span key={d} className={`text-xs px-2 py-1 rounded-lg font-medium ${s.workingDays?.includes(d) ? 'text-white' : 'bg-slate-100 text-slate-400'}`} style={s.workingDays?.includes(d) ? {backgroundColor:s.color} : {}}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-lg">{editShift ? 'Edit Shift' : 'Create Shift'}</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Shift Name</label>
                <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required placeholder="e.g. General Shift" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Start Time</label>
                  <input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">End Time</label>
                  <input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Grace Period (minutes)</label>
                <input type="number" value={form.graceMinutes} onChange={e=>setForm({...form,graceMinutes:parseInt(e.target.value)})} min={0} max={60} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Working Days</label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS.map(d => (
                    <button key={d} type="button" onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${form.workingDays.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Color</label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm({...form,color:c})} className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${form.color===c?'ring-2 ring-offset-2 ring-slate-400 scale-110':''}`} style={{backgroundColor:c}}/>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
                  {saving ? 'Saving...' : editShift ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
