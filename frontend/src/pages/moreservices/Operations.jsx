import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Clock, Timer, CalendarDays, Trophy, FolderOpen, Users, Plane,
  Wallet, CheckSquare, Smile, Mail, UserPlus, Settings, Activity, CheckCircle, Database, Hourglass, DoorOpen,
} from 'lucide-react';

/* ── Operations services grid (Super Admin / HR) ──────────────────────────
 *  Zoho-People-style service tiles. Per spec, the tiles are presentational
 *  ONLY — exactly one tile ("Leave Tracker") is functional and opens the
 *  admin Leave Tracker. The rest are inert placeholders for UI parity.
 *  No business logic; purely navigation/display. */

// Functional tiles → their route. Everything else is a presentational placeholder.
const ROUTES = {
  'leave-tracker':    '/more-services/operations/leave-tracker',
  'permission-usage': '/more-services/operations/permission-usage',
  'conference':       '/more-services/operations/conference',
};

const SERVICES = [
  { key: 'attendance',   label: 'Attendance',          icon: CalendarCheck, color: 'text-rose-500' },
  { key: 'shift',        label: 'Shift',               icon: Clock,         color: 'text-sky-500' },
  { key: 'time-tracker', label: 'Time Tracker',        icon: Timer,         color: 'text-amber-500' },
  { key: 'leave-tracker',label: 'Leave Requests',      icon: CalendarDays,  color: 'text-blue-600' },
  { key: 'permission-usage', label: 'Permission Usage', icon: Hourglass,    color: 'text-purple-600' },
  { key: 'conference',   label: 'Conference',          icon: DoorOpen,      color: 'text-blue-600' },
  { key: 'performance',  label: 'Performance',         icon: Trophy,        color: 'text-yellow-500' },
  { key: 'files',        label: 'Files',               icon: FolderOpen,    color: 'text-indigo-500' },
  { key: 'emp-info',     label: 'Employee Information', icon: Users,         color: 'text-emerald-500' },
  { key: 'travel',       label: 'Travel',              icon: Plane,         color: 'text-cyan-500' },
  { key: 'compensation', label: 'Compensation',        icon: Wallet,        color: 'text-green-600' },
  { key: 'tasks',        label: 'Tasks',               icon: CheckSquare,   color: 'text-orange-500' },
  { key: 'engagement',   label: 'Employee Engagement', icon: Smile,         color: 'text-pink-500' },
  { key: 'hr-letters',   label: 'HR Letters',          icon: Mail,          color: 'text-violet-500' },
  { key: 'onboarding',   label: 'Onboarding',          icon: UserPlus,      color: 'text-teal-500' },
  { key: 'general',      label: 'General',             icon: Settings,      color: 'text-slate-500' },
  { key: 'health',       label: 'Employee Health Data',icon: Activity,      color: 'text-red-500' },
  { key: 'approvals',    label: 'Approvals',           icon: CheckCircle,   color: 'text-emerald-600' },
  { key: 'data-admin',   label: 'Data Administration', icon: Database,      color: 'text-slate-600' },
];

export default function Operations() {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-12rem)]">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="text-[18px] font-semibold text-slate-900">Services</h2>
        <p className="text-[15px] text-slate-500 mt-1">Operations workspace — open <span className="font-semibold text-blue-700">Leave Requests</span> to manage all leave requests.</p>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {SERVICES.map(({ key, label, icon: Icon, color }) => {
            const functional = !!ROUTES[key];
            return (
              <button
                key={key}
                type="button"
                onClick={functional ? () => navigate(ROUTES[key]) : undefined}
                title={functional ? `Open ${label}` : 'View only'}
                disabled={!functional}
                className={`group flex flex-col items-center justify-center gap-3 rounded-2xl border p-5 transition-all ${
                  functional
                    ? 'border-blue-200 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-300 hover:shadow-md cursor-pointer'
                    : 'border-slate-100 bg-white cursor-default opacity-70'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${functional ? 'bg-blue-100' : 'bg-slate-50'}`}>
                  <Icon size={24} className={color} strokeWidth={1.8} />
                </div>
                <span className={`text-[14px] font-semibold text-center leading-tight ${functional ? 'text-slate-900' : 'text-slate-400'}`}>
                  {label}
                </span>
                {functional && (
                  <span className="text-[12px] font-semibold text-blue-700 uppercase tracking-wide">Open</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
