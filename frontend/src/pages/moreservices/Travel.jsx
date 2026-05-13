import React, { useState } from 'react';
import { Plus, Plane, X } from 'lucide-react';

const SAMPLE = [
  { id: 1, destination: 'Chennai', purpose: 'Client Meeting', from: '2026-05-10', to: '2026-05-12', transport: 'Flight', status: 'pending' },
];
const STATUS_COLOR = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600' };

export default function Travel() {
  const [requests, setRequests] = useState(SAMPLE);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ destination: '', purpose: '', from: '', to: '', transport: 'Flight' });

  const handleSubmit = (e) => {
    e.preventDefault();
    setRequests(r => [...r, { ...form, id: Date.now(), status: 'pending' }]);
    setModal(false);
    setForm({ destination: '', purpose: '', from: '', to: '', transport: 'Flight' });
  };

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-800">Travel Requests</h2>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
          <Plus size={13}/> New Request
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {['Destination','Purpose','From','To','Transport','Status'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {requests.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-[12.5px] font-medium text-slate-800">{r.destination}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.purpose}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.from}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.to}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.transport}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2"><Plane size={16} className="text-blue-500"/><h3 className="font-semibold text-slate-800">New Travel Request</h3></div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {[['destination','Destination','text'],['purpose','Purpose','text'],['from','From Date','date'],['to','To Date','date']].map(([key,label,type]) => (
                <div key={key}>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">{label}</label>
                  <input type={type} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400"/>
                </div>
              ))}
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Transport</label>
                <select value={form.transport} onChange={e => setForm({...form, transport: e.target.value})}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400">
                  {['Flight','Train','Bus','Car'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
