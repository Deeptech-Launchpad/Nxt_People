import React from 'react';
import { FileText } from 'lucide-react';

const POLICIES = [
  { title: 'Work From Home Policy',    updated: '2026-01-01', desc: 'Guidelines for remote work, eligibility and approval process.' },
  { title: 'Leave Policy',             updated: '2026-01-01', desc: 'Types of leave, entitlements, and application procedures.' },
  { title: 'Code of Conduct',          updated: '2026-01-01', desc: 'Expected behaviour, ethics, and disciplinary guidelines.' },
  { title: 'Data Privacy Policy',      updated: '2026-01-01', desc: 'How employee and company data is collected, stored and used.' },
  { title: 'Travel & Expense Policy',  updated: '2026-01-01', desc: 'Reimbursement rules for business travel and expenses.' },
];

export default function Policies() {
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-[17px] font-bold text-slate-800 mb-5">Company Policies</h2>
      <div className="space-y-3">
        {POLICIES.map(p => (
          <div key={p.title} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm flex items-start gap-4 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-blue-500"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-800">{p.title}</p>
              <p className="text-[14px] text-slate-500 mt-0.5 leading-snug">{p.desc}</p>
            </div>
            <p className="text-[13px] text-slate-400 flex-shrink-0">Updated {p.updated}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
