import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Shared page frame for every dedicated report page — back link, title,
// an optional filter bar, and a loading/content area. Deliberately does
// NOT show the report catalog list — that lives only on the Reports
// landing page, never on the destination page itself.
export default function ReportShell({ title, subtitle, filters, actions, loading, children }) {
  const navigate = useNavigate();
  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">
      <div className="pt-5">
        <button onClick={() => navigate('/reports')} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors">
          <ChevronLeft size={16} /> Reports
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {filters && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-end gap-3">
          {filters}
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : children}
      </div>
    </div>
  );
}
