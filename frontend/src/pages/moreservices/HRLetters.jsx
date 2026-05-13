import React, { useState } from 'react';
import { Plus, FileCheck, X } from 'lucide-react';

const LETTER_TABS = ['Address Proof', 'Bonafide Letter', 'Experience Letter'];

const SAMPLE = {
  'Address Proof':     [{ id: 1, empId: 'ANXT001', status: 'approved', approver: 'HR Manager', approvalTime: '2026-04-10 10:30 AM' }],
  'Bonafide Letter':   [],
  'Experience Letter': [],
};

const STATUS_COLOR = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600' };

export default function HRLetters() {
  const [tab, setTab]     = useState('Address Proof');
  const [modal, setModal] = useState(false);
  const records = SAMPLE[tab] || [];

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <h2 className="text-[15px] font-bold text-slate-800">HR Letters</h2>

      {/* Letter type tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {LETTER_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-[13px] font-bold text-slate-800">{tab}</h3>
          <button onClick={() => setModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
            <Plus size={13}/> Add Record
          </button>
        </div>

        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {['Employee ID', 'Status', 'Approver', 'Approval Time', 'Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {records.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-14 text-center">
                  <FileCheck size={32} className="text-slate-200 mx-auto mb-3"/>
                  <p className="text-[13px] font-semibold text-slate-400">No records for {tab}</p>
                  <p className="text-[12px] text-slate-300 mt-1">Click "Add Record" to submit a request</p>
                </td>
              </tr>
            ) : records.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-[12.5px] font-mono font-medium text-slate-700">{r.empId}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.approver}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{r.approvalTime}</td>
                <td className="px-4 py-3">
                  <button className="text-[11.5px] text-blue-600 hover:underline font-medium">Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Record modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileCheck size={16} className="text-blue-500"/>
                <h3 className="font-semibold text-slate-800">Request {tab}</h3>
              </div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Purpose / Reason</label>
                <textarea rows={3} placeholder="Reason for requesting this letter…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={() => setModal(false)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold">Submit Request</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
