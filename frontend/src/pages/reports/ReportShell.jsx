import React, { useState } from 'react';
import { ChevronDown, Home } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { REPORT_CATALOG } from './catalogData';
import ReportMenu from './ReportMenu';

// Shared page frame for every dedicated report page — back link, title
// (optionally a switcher dropdown), an optional filter bar, and a
// loading/content area. Deliberately does NOT show the full report catalog
// list on the page — that lives only on the Reports landing page. The
// switcher is different: a collapsed, click-to-open dropdown scoped to one
// category, not a persistently-visible list, so it lets you jump straight
// to a sibling report without leaving this page.
// `breadcrumbChip` renders inline after the report name, matching where Zoho
// puts the "Type : Location" selector on Distribution/Diversity — it's part
// of the breadcrumb trail there, not part of the filter panel.
export default function ReportShell({ title, subtitle, filters, actions, loading, children, switcherCategory, breadcrumbChip, periodNav, menuItems = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const catalogEntry = switcherCategory ? REPORT_CATALOG.find(c => c.category === switcherCategory) : null;
  const siblings = catalogEntry ? catalogEntry.reports.filter(r => r.to.split('?')[0] !== location.pathname) : [];

  return (
    // Full viewport width, not a centred max-w-6xl column: the calendar grids
    // are as wide as the period being viewed, and capping the page at 1152px
    // meant a month of days scrolled inside a narrow box with dead margins on
    // either side. Charts and tables read fine at full width; the grids need it.
    <div className="w-full px-4 space-y-4 pb-10 report-shell">
      {/* One header bar: home, breadcrumb, a centred period navigator, then
          the icon cluster (view toggles, funnel, overflow menu) — the layout
          every report page in the reference shares. */}
      <div className="flex items-center gap-3 pt-5 report-hide-print">
        <button
          onClick={() => navigate('/reports')}
          title="All reports"
          className="p-2 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex-shrink-0"
        >
          <Home size={16} />
        </button>
        <div>
          {siblings.length > 0 ? (
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[17px] font-semibold whitespace-nowrap">
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
                {breadcrumbChip && <><span className="text-slate-300">›</span>{breadcrumbChip}</>}
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
            <h1 className="text-[17px] font-semibold text-slate-800">{title}</h1>
          )}
        </div>

        {/* Period navigator sits centred between the breadcrumb and the icons. */}
        <div className="flex-1 flex justify-center min-w-0">{periodNav}</div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
          <ReportMenu items={menuItems} />
        </div>
      </div>
      {subtitle && <p className="text-sm text-slate-500 -mt-2 report-hide-print">{subtitle}</p>}
      {filters && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-end gap-3 report-hide-print">
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
