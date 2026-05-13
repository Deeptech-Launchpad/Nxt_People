import React, { useState } from 'react';
import { Plus, DollarSign, X } from 'lucide-react';

const TABS = ['All Claims', 'Pending', 'Approved', 'Rejected'];
const SAMPLE = [
  { id: 1, type: 'Medical', amount: 2500, date: '2026-04-20', description: 'Doctor visit', status: 'pending' },
  { id: 2, type: 'Travel',  amount: 1200, date: '2026-04-15', description: 'Client site trip', status: 'approved' },
];
const STATUS_COLOR = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600' };

export default function Compensation() {
  const [tab, setTab] = useState('All Claims');
  const [claims]      = useState(SAMPLE);
  const [modal, setModal] = useState(false);
  const [form, setForm]   = useState({ type: 'Medical', amount: '', date: '', description: '' });

  const filtered = tab === 'All Claims' ? claims : claims.filter(c => c.status.toLowerCase() === tab.toLowerCase());

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-800">Compensation Claims</h2>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
          <Plus size={13}/> Add Claim
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {['Type','Amount (₹)','Date','Description','Status'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-[13px] text-slate-400">No claims found</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-[12.5px] font-medium text-slate-800">{c.type}</td>
                <td className="px-4 py-3 text-[12.5px] font-bold text-slate-700">₹{c.amount.toLocaleString()}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{c.date}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{c.description}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[c.status]}`}>{c.status}</span>
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
              <div className="flex items-center gap-2"><DollarSign size={16} className="text-blue-500"/><h3 className="font-semibold text-slate-800">Add Claim</h3></div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <div className="p-5 space-y-4">
              {[['type','Type','select'],['amount','Amount (₹)','number'],['date','Date','date'],['description','Description','text']].map(([key,label,type]) => (
                <div key={key}>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">{label}</label>
                  {type === 'select'
                    ? <select value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400">
                        {['Medical','Travel','Food','Equipment','Other'].map(o => <option key={o}>{o}</option>)}
                      </select>
                    : <input type={type} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400"/>
                  }
                </div>
              ))}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={() => setModal(false)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold">Submit</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
