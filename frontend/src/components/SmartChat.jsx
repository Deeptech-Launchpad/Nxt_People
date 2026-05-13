import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, Home, CalendarCheck, Clock, CalendarDays, Trophy,
  LayoutGrid, Users, MessageSquare, User as UserIcon, FileText,
  Calendar, Megaphone, Settings, PieChart, Building2, LogOut, LogIn,
  CornerDownLeft, ChevronUp, ChevronDown, ArrowRight,
} from 'lucide-react';
import api from '../utils/api';

/**
 * Command palette / "Smart Chat" — global launcher triggered by Ctrl+Space
 * or by clicking the bottom-bar hint. Searches across pages, employees, and
 * quick actions, with full keyboard navigation (↑ / ↓ / Enter / Esc).
 */
const PAGES = [
  { label: 'Home',                  path: '/',                          icon: Home,         keywords: 'dashboard overview my space' },
  { label: 'Profile',               path: '/profile',                   icon: UserIcon,     keywords: 'me account personal' },
  { label: 'Calendar',              path: '/calendar',                  icon: Calendar,     keywords: 'leave calendar schedule' },
  { label: 'Announcements',         path: '/announcements',             icon: Megaphone,    keywords: 'news posts updates' },
  { label: 'Directory',             path: '/directory',                 icon: Users,        keywords: 'people contacts colleagues' },
  { label: 'Org Chart',             path: '/org-chart',                 icon: Building2,    keywords: 'organization structure hierarchy' },
  { label: 'My Attendance',         path: '/attendance/my',             icon: CalendarCheck,keywords: 'my attendance log' },
  { label: 'Check-in / Check-out',  path: '/attendance/checkin',        icon: LogIn,        keywords: 'clock in out punch' },
  { label: 'Team Attendance',       path: '/attendance/team',           icon: Users,        keywords: 'manager team attendance' },
  { label: 'Regularization',        path: '/attendance/regularization', icon: CalendarCheck,keywords: 'regularize correct missed' },
  { label: 'Time Logs',             path: '/time-tracker/timelogs',     icon: Clock,        keywords: 'time tracker hours' },
  { label: 'Timesheets',            path: '/time-tracker/timesheets',   icon: Clock,        keywords: 'weekly timesheet hours' },
  { label: 'Projects',              path: '/time-tracker/projects',     icon: LayoutGrid,   keywords: 'project tasks' },
  { label: 'Jobs',                  path: '/time-tracker/jobs',         icon: LayoutGrid,   keywords: 'jobs work' },
  { label: 'Leave Summary',         path: '/leave-tracker/summary',     icon: CalendarDays, keywords: 'leave balance summary' },
  { label: 'Apply Leave',           path: '/leave-tracker/requests',    icon: CalendarDays, keywords: 'apply leave request vacation off' },
  { label: 'Leave Balance',         path: '/leave-tracker/balance',     icon: CalendarDays, keywords: 'leave balance days remaining' },
  { label: 'Comp Off',              path: '/leave-tracker/comp-off',    icon: CalendarDays, keywords: 'compensatory off comp' },
  { label: 'Holidays',              path: '/leave-tracker/holidays',    icon: Calendar,     keywords: 'holidays public company' },
  { label: 'Work From Home',        path: '/wfh',                       icon: Home,         keywords: 'wfh remote work from home' },
  { label: 'Performance Goals',     path: '/performance/goals',         icon: Trophy,       keywords: 'goals okrs targets' },
  { label: 'Skill Matrix',          path: '/performance/skills',        icon: Trophy,       keywords: 'skills competency matrix' },
  { label: 'Performance Review',    path: '/performance',               icon: Trophy,       keywords: 'review appraisal feedback' },
  { label: 'Documents',             path: '/more-services/files',       icon: FileText,     keywords: 'documents files uploads' },
  { label: 'Travel Requests',       path: '/more-services/travel',      icon: ArrowRight,   keywords: 'travel trip request' },
  { label: 'HR Letters',            path: '/more-services/hr-letters',  icon: FileText,     keywords: 'hr letters experience offer' },
  { label: 'Chat',                  path: '/chat',                      icon: MessageSquare,keywords: 'chat message direct dm' },
  { label: 'Approvals',             path: '/approvals',                 icon: CalendarCheck,keywords: 'approvals pending approve' },
  { label: 'Employees',             path: '/employees',                 icon: Users,        keywords: 'employees list staff' },
  { label: 'Registrations',         path: '/registrations',             icon: Users,        keywords: 'pending registrations onboarding' },
  { label: 'Reports',               path: '/reports',                   icon: PieChart,     keywords: 'reports analytics export' },
  { label: 'Payroll',               path: '/payroll',                   icon: PieChart,     keywords: 'payroll salary' },
  { label: 'Shifts',                path: '/shifts',                    icon: Clock,        keywords: 'shifts schedule timing' },
  { label: 'Shift Roster',          path: '/shift-roster',              icon: Calendar,     keywords: 'shift roster planning' },
  { label: 'Companies',             path: '/companies',                 icon: Building2,    keywords: 'companies tenants' },
  { label: 'API Connections',       path: '/api-connections',           icon: Settings,     keywords: 'api connections integrations external' },
  { label: 'Settings',              path: '/settings',                  icon: Settings,     keywords: 'settings configuration admin' },
  { label: 'Exit Management',       path: '/exit',                      icon: LogOut,       keywords: 'exit resign offboarding' },
];

const QUICK_ACTIONS = [
  { label: 'Open Chat',          path: '/chat',                       icon: MessageSquare, badge: 'Action' },
  { label: 'Apply Leave',        path: '/leave-tracker/requests',     icon: CalendarDays,  badge: 'Action' },
  { label: 'Check In Now',       path: '/attendance/checkin',         icon: LogIn,         badge: 'Action' },
];

export default function SmartChat({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [employees, setEmployees] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Reset whenever the palette is opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setEmployees([]);
      // Defer focus until after the DOM paints the input.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced employee search — only fires once the user stops typing.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!open || query.trim().length < 2) {
      setEmployees([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      api.get(`/employees?search=${encodeURIComponent(query.trim())}&limit=6`)
        .then(r => setEmployees(r.data.data || []))
        .catch(() => setEmployees([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  // Build a flat list of matching results in display order so arrow-keys can
  // step through every section uniformly.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedActions = q
      ? QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q))
      : QUICK_ACTIONS;
    const matchedPages = q
      ? PAGES.filter(p =>
          p.label.toLowerCase().includes(q) ||
          (p.keywords || '').toLowerCase().includes(q)
        ).slice(0, 8)
      : PAGES.slice(0, 6);
    const peopleResults = employees.map(e => ({
      type: 'employee',
      label: `${e.firstName} ${e.lastName}`,
      subtitle: `${e.designation || ''}${e.department ? ' · ' + e.department : ''}`.trim() || e.email,
      path: '/directory', // Directory is the only place that lists colleagues.
      icon: UserIcon,
      employeeId: e.employeeId,
    }));
    return [
      ...matchedActions.map(a => ({ ...a, type: 'action' })),
      ...matchedPages.map(p => ({ ...p, type: 'page' })),
      ...peopleResults,
    ];
  }, [query, employees]);

  // Keep the active index inside the bounds of the current result list.
  useEffect(() => { if (activeIdx >= results.length) setActiveIdx(0); }, [results, activeIdx]);

  const choose = (r) => {
    if (!r) return;
    navigate(r.path);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[activeIdx]);
    }
  };

  if (!open) return null;

  // Group results by type for visual section headers.
  const sections = [
    { title: 'Quick Actions', items: results.filter(r => r.type === 'action') },
    { title: 'Pages',         items: results.filter(r => r.type === 'page')   },
    { title: 'People',        items: results.filter(r => r.type === 'employee') },
  ].filter(s => s.items.length > 0);

  // Stable index lookup so each rendered row knows its position in `results`.
  const indexOf = (item) => results.findIndex(r => r === item);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, people, or actions…"
            className="flex-1 outline-none text-[14px] text-slate-800 placeholder:text-slate-400 bg-transparent"
          />
          {loading && <span className="text-[11px] text-slate-400">searching…</span>}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {sections.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-slate-400">
              No matches for &ldquo;{query}&rdquo;.
            </div>
          )}

          {sections.map((s) => (
            <div key={s.title} className="mb-2">
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {s.title}
              </div>
              {s.items.map((item) => {
                const idx = indexOf(item);
                const Icon = item.icon || ArrowRight;
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={`${s.title}-${idx}`}
                    onClick={() => choose(item)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2 transition-colors ${
                      isActive ? 'bg-blue-50 text-[#1a73e8]' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-[#1a73e8] text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate">{item.label}</p>
                      {item.subtitle && (
                        <p className="text-[11.5px] text-slate-400 truncate">{item.subtitle}</p>
                      )}
                    </div>
                    {item.badge && (
                      <span className="text-[10px] font-bold uppercase text-slate-400">{item.badge}</span>
                    )}
                    {item.employeeId && (
                      <span className="text-[10.5px] text-slate-400 font-mono">{item.employeeId}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div className="border-t border-slate-100 px-4 py-2 flex items-center justify-between text-[11px] text-slate-500 bg-slate-50">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><ChevronUp size={11}/><ChevronDown size={11}/> Navigate</span>
            <span className="flex items-center gap-1"><CornerDownLeft size={11}/> Open</span>
            <span><kbd className="font-mono">Esc</kbd> Close</span>
          </div>
          <span className="text-slate-400">Smart Chat · Ctrl+Space</span>
        </div>
      </div>
    </div>
  );
}
