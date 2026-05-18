/**
 * AppAccessPicker — controlled multi-select of "user-facing apps" the
 * admin can grant to one employee. Used in two places:
 *
 *   1. Registrations.jsx — Approve modal (loads all apps, no preselection)
 *   2. Employees.jsx     — Edit modal (loads apps + this employee's
 *                           current grants as preselection)
 *
 * Both consumers control the `selected` Set via props and submit the
 * final list via `PUT /api/employees/:id/app-access` after their own
 * primary save (approve or edit) succeeds.
 *
 * Props:
 *   apps        — array from /api/employees/:id/app-access (or [])
 *   selected    — Set<string> of api_connection ids that are checked
 *   onChange    — (newSelectedSet) => void
 *   loading     — show a skeleton while apps are being fetched
 *   compact     — true for the Approve modal (smaller tiles, fewer columns)
 */
import React from 'react';
import {
  Layers, Globe, BookOpen, BarChart3, Briefcase, Calendar, Cloud, Cog,
  Database, FileText, Image, Lock, Mail, Map, Phone, Server, Star, Tag,
  Check, AppWindow,
} from 'lucide-react';

const ICONS = {
  Layers, Globe, BookOpen, BarChart3, Briefcase, Calendar, Cloud, Cog,
  Database, FileText, Image, Lock, Mail, Map, Phone, Server, Star, Tag,
};
const Icon = ({ name, ...rest }) => {
  const Cmp = ICONS[name] || Layers;
  return <Cmp {...rest} />;
};

export default function AppAccessPicker({ apps, selected, onChange, loading, compact = false }) {
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else              next.add(id);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(apps.map(a => a.id)));
  const selectNone = () => onChange(new Set());

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[12px] text-slate-400 text-center">
        Loading apps…
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[12px] text-slate-500 flex items-center gap-2">
        <AppWindow size={14} className="text-slate-400" />
        No internal apps registered yet. Add one in <strong className="font-semibold">More Services → Apps</strong>.
      </div>
    );
  }

  const grid = compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">
          <strong className="text-slate-700">{selected.size}</strong> of {apps.length} selected
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={selectAll}
            className="text-[11px] font-semibold text-blue-700 hover:underline">Select all</button>
          <span className="text-slate-300">·</span>
          <button type="button" onClick={selectNone}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 hover:underline">Clear</button>
        </div>
      </div>

      <div className={`grid ${grid} gap-2`}>
        {apps.map(app => {
          const checked = selected.has(app.id);
          return (
            <button
              type="button"
              key={app.id}
              onClick={() => toggle(app.id)}
              className={`relative text-left rounded-xl border transition-all p-2.5 flex items-center gap-2.5 ${
                checked
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${app.color || 'from-blue-500 to-indigo-600'} text-white flex items-center justify-center flex-shrink-0`}>
                <Icon name={app.icon} size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[12.5px] font-bold truncate ${checked ? 'text-blue-900' : 'text-slate-800'}`}>{app.name}</p>
                {app.description && !compact && (
                  <p className="text-[10.5px] text-slate-500 truncate">{app.description}</p>
                )}
              </div>
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
              }`}>
                {checked && <Check size={10} className="text-white" strokeWidth={3.5} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
