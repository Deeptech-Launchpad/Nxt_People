import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Reusable module landing page with card/tile navigation.
 * Shows all child modules as selectable cards, matching Operations pattern.
 *
 * Props:
 *   - title: Module name (e.g., "Attendance")
 *   - description: Brief description of the module
 *   - items: Array of { key, label, icon: Icon, color, to: '/path' }
 *   - colsLg: Grid columns on large screens (default: 6)
 */
const GRID_COLS = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

export default function ModuleLanding({ title, description, items, colsLg = 6 }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-12rem)]">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="text-[18px] font-semibold text-slate-900">{title}</h2>
        <p className="text-[15px] text-slate-500 mt-1">{description}</p>
      </div>

      <div className="p-6">
        <div className={`grid grid-cols-3 sm:grid-cols-4 ${GRID_COLS[colsLg] || 'lg:grid-cols-6'} gap-4`}>
          {items.map(({ key, label, icon: Icon, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(items.find(i => i.key === key).to)}
              title={`Open ${label}`}
              className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-300 hover:shadow-md p-5 transition-all cursor-pointer"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100">
                <Icon size={24} className={color} strokeWidth={1.8} />
              </div>
              <span className="text-[14px] font-semibold text-center leading-tight text-slate-900">
                {label}
              </span>
              <span className="text-[12px] font-semibold text-blue-700 uppercase tracking-wide">Open</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
