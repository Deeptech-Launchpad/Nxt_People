import React, { useState } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { REPORT_CATALOG } from './catalogData';

// Shared page frame for every dedicated report page — back link, title
// (optionally a switcher dropdown), an optional filter bar, and a
// loading/content area. Deliberately does NOT show the full report catalog
// list on the page — that lives only on the Reports landing page. The
// switcher is different: a collapsed, click-to-open dropdown scoped to one
// category, not a persistently-visible list, so it lets you jump straight
// to a sibling report without leaving this page.
export default function ReportShell({ title, subtitle, filters, actions, loading, children, switcherCategory }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const catalogEntry = switcherCategory ? REPORT_CATALOG.find(c => c.category === switcherCategory) : null;
  const siblings = catalogEntry ? catalogEntry.reports.filter(r => r.to.split('?')[0] !== location.pathname) : [];

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-5 pb-10">
      <div className="pt-5">
        <button onClick={() => navigate('/reports')} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors">
          <ChevronLeft size={16} /> Reports
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {siblings.length > 0 ? (
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[20px] font-bold">
                <button onClick={() => navigate('/reports')} className="text-slate-400 hover:text-slate-600 transition-colors">
                  {switcherCategory}
                </button>
                <span className="text-slate-300">›</span>
                <button
                  onClick={() => setSwitcherOpen(o => !o)}
                  className="flex items-center gap-1.5 text-slate-800 hover:text-blue-600 transition-colors"
                >
                  {title}
                  <ChevronDown size={18} className={`text-slate-400 transition-transform ${switcherOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {switcherOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                  <div className="absolute z-20 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-2">
                    {siblings.map(r => (
                      <button
                        key={r.to}
                        onClick={() => { setSwitcherOpen(false); navigate(r.to); }}
                        className="w-full text-left px-4 py-2.5 text-[14px] text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <h1 className="text-[20px] font-bold text-slate-800">{title}</h1>
          )}
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
