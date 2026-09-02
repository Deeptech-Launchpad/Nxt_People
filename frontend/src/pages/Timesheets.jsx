import React, { useState, useEffect } from 'react';
import { Plus, X, Send, ChevronDown } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

const STATUS_STYLE = { draft:'bg-slate-100 text-slate-600', submitted:'bg-amber-100 text-amber-700', approved:'bg-emerald-100 text-emerald-700', rejected:'bg-red-100 text-red-700' };

const getWeekDates = (offset = 0) => {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
};

const emptyEntry = () => ({ date: new Date().toISOString().split('T')[0], project: '', task: '', hours: '', description: '' });

export default function Timesheets() {
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [entries, setEntries] = useState([emptyEntry()]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);

  const { start, end } = getWeekDates();
  const weekLabel = `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

  const load = () => {
    setLoading(true);
    api.get('/timesheets/my').then(r => setTimesheets(r.data.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSave = async (submit = false) => {
    setSaving(true);
    try {
      const payload = { weekStartDate: start, weekEndDate: end, entries: entries.filter(e => e.project && e.hours), notes, status: submit ? 'submitted' : 'draft' };
      await api.post('/timesheets', payload);
      toast.success(submit ? 'Timesheet submitted!' : 'Draft saved!');
      setModal(false); setEntries([emptyEntry()]); setNotes(''); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleSubmitExisting = async (id) => {
    setSubmittingId(id);
    try { await api.put(`/timesheets/${id}/submit`); toast.success('Submitted!'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSubmittingId(null); }
  };

  const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);

  return (
    <div className="p-5 space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/time-tracker" label="Time Tracker" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">My Timesheets</h3>
            <p className="text-slate-400 text-base mt-0.5">Current week: {weekLabel}</p>
          </div>
          <button onClick={() => { setEntries([emptyEntry()]); setNotes(''); setModal(true); }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16}/> New Timesheet
          </button>
        </div>

        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div> : (
          <div className="divide-y divide-slate-50">
            {timesheets.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-slate-400 font-medium">No timesheets yet</p>
                <p className="text-slate-300 text-base mt-1">Log your work hours for the week</p>
              </div>
            ) : timesheets.map(ts => (
              <div key={ts._id}>
                <div className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === ts._id ? null : ts._id)}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 font-display font-bold text-base">
                      {ts.totalHours?.toFixed(0)}h
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">
                        {new Date(ts.weekStartDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})} – {new Date(ts.weekEndDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                      </p>
                      <p className="text-base text-slate-400">{ts.entries?.length} entries · {ts.totalHours?.toFixed(1)} hours total</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[ts.status]}`}>{ts.status}</span>
                    {ts.status === 'draft' && (
                      <button onClick={e => { e.stopPropagation(); handleSubmitExisting(ts._id); }}
                        disabled={submittingId === ts._id}
                        className="flex items-center gap-1.5 text-sm bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-100 transition-colors font-medium disabled:opacity-60">
                        <Send size={12}/> {submittingId === ts._id ? 'Submitting...' : 'Submit'}
                      </button>
                    )}
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${expandedId === ts._id ? 'rotate-180' : ''}`}/>
                  </div>
                </div>
                {expandedId === ts._id && (
                  <div className="bg-slate-50 px-5 pb-4 border-t border-slate-100">
                    <table className="w-full mt-3">
                      <thead><tr>{['Date','Project','Task','Hours','Notes'].map(h=><th key={h} className="text-left text-sm font-semibold text-slate-500 py-2 pr-4">{h}</th>)}</tr></thead>
                      <tbody>
                        {ts.entries?.map((e,i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="py-2 pr-4 text-base text-slate-600">{new Date(e.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</td>
                            <td className="py-2 pr-4 text-base text-slate-700 font-medium">{e.project}</td>
                            <td className="py-2 pr-4 text-base text-slate-600">{e.task}</td>
                            <td className="py-2 pr-4 text-base font-medium text-brand-600">{e.hours}h</td>
                            <td className="py-2 text-base text-slate-400">{e.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ts.notes && <p className="text-sm text-slate-400 mt-2 border-t border-slate-100 pt-2">Notes: {ts.notes}</p>}
                    {ts.rejectionReason && <p className="text-sm text-red-500 mt-2">Rejected: {ts.rejectionReason}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <div>
                <h3 className="font-display font-semibold text-slate-800 text-xl">New Timesheet</h3>
                <p className="text-slate-400 text-base mt-0.5">{weekLabel}</p>
              </div>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16}/></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              {entries.map((entry, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-slate-50 rounded-xl p-3">
                  <input type="date" value={entry.date} onChange={e => { const n=[...entries]; n[idx].date=e.target.value; setEntries(n); }} className="col-span-3 border border-slate-200 rounded-lg px-2 py-2 text-base focus:outline-none focus:border-brand-400 bg-white"/>
                  <input placeholder="Project" value={entry.project} onChange={e => { const n=[...entries]; n[idx].project=e.target.value; setEntries(n); }} className="col-span-3 border border-slate-200 rounded-lg px-2 py-2 text-base focus:outline-none focus:border-brand-400 bg-white"/>
                  <input placeholder="Task" value={entry.task} onChange={e => { const n=[...entries]; n[idx].task=e.target.value; setEntries(n); }} className="col-span-2 border border-slate-200 rounded-lg px-2 py-2 text-base focus:outline-none focus:border-brand-400 bg-white"/>
                  <input type="number" placeholder="Hrs" min="0" max="24" step="0.5" value={entry.hours} onChange={e => { const n=[...entries]; n[idx].hours=e.target.value; setEntries(n); }} className="col-span-1 border border-slate-200 rounded-lg px-2 py-2 text-base focus:outline-none focus:border-brand-400 bg-white"/>
                  <input placeholder="Description" value={entry.description} onChange={e => { const n=[...entries]; n[idx].description=e.target.value; setEntries(n); }} className="col-span-2 border border-slate-200 rounded-lg px-2 py-2 text-base focus:outline-none focus:border-brand-400 bg-white"/>
                  <button onClick={() => setEntries(entries.filter((_,i)=>i!==idx))} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"><X size={14}/></button>
                </div>
              ))}
              <button onClick={() => setEntries([...entries, emptyEntry()])} className="w-full border border-dashed border-slate-300 text-slate-400 hover:text-brand-600 hover:border-brand-400 py-2.5 rounded-xl text-base transition-colors flex items-center justify-center gap-2">
                <Plus size={14}/> Add Row
              </button>
              <div className="flex items-center justify-between bg-brand-50 rounded-xl px-4 py-3">
                <span className="text-base font-medium text-brand-700">Total Hours</span>
                <span className="font-display font-bold text-brand-700 text-xl">{totalHours.toFixed(1)}h</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Notes (optional)</label>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Any notes for this week..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 resize-none"/>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3 flex-shrink-0">
              <button onClick={()=>setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={()=>handleSave(false)} disabled={saving} className="flex-1 border border-brand-300 text-brand-600 py-2.5 rounded-xl text-base font-medium hover:bg-brand-50 transition-colors disabled:opacity-60">Save Draft</button>
              <button onClick={()=>handleSave(true)} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2">
                <Send size={14}/>{saving ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
