import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, Clock, CalendarDays, Trophy, FileText, Plane, DollarSign, CheckSquare, FileCheck, MapPin, Link2 } from 'lucide-react';
import api from '../utils/api';
import { useFunctionAccess } from '../context/FunctionAccessContext';
import toast from 'react-hot-toast';

const SERVICE_TILES = [
  { icon: CalendarCheck, label: 'Attendance',          color: 'bg-blue-500',   to: '/attendance/my' },
  { icon: Clock,         label: 'Time Tracker',        color: 'bg-indigo-500', to: '/time-tracker/timelogs' },
  { icon: CalendarDays,  label: 'Leave Tracker',       color: 'bg-green-500',  to: '/leave-tracker/summary' },
  { icon: Trophy,        label: 'Performance',         color: 'bg-yellow-500', to: '/performance/goals' },
  { icon: FileText,      label: 'Files',               color: 'bg-purple-500', to: '/more-services/files' },
  { icon: Plane,         label: 'Travel',              color: 'bg-sky-500',    to: '/more-services/travel' },
  { icon: DollarSign,    label: 'Compensation',        color: 'bg-emerald-500',to: '/more-services/compensation' },
  { icon: CheckSquare,   label: 'Tasks',               color: 'bg-orange-500', to: '/dashboard' },
  { icon: FileCheck,     label: 'HR Letters',          color: 'bg-teal-500',   to: '/more-services/hr-letters' },
];

const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={`py-3 px-1 text-[15px] font-medium border-b-2 transition-all whitespace-nowrap
      ${active ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
    {children}
  </button>
);

export default function OrgOverview() {
  const navigate = useNavigate();
  const { can } = useFunctionAccess();
  const [tab, setTab] = useState('services');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/dashboard/stats')
      .then(r => setStats(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load org stats'));
  }, []);

  return (
    <div className="p-6 max-w-5xl">
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-6 px-5 border-b border-slate-100">
          {/* Location is the "Show location details in the organization tab" row
              under Function Based Permissions. Filtered out rather than
              disabled — a tab that cannot be opened is just clutter. */}
          {[['services','Services'],['location','Location'],['quicklinks','Quick Links']]
            .filter(([k]) => k !== 'location' || can('location_in_org_tab'))
            .map(([k,l]) => (
              <Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>
            ))}
        </div>

        <div className="p-6">
          {tab === 'services' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {SERVICE_TILES.map(({ icon: Icon, label, color, to }) => (
                <button key={label} onClick={() => navigate(to)}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group">
                  <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform`}>
                    <Icon size={22} className="text-white"/>
                  </div>
                  <span className="text-[13px] font-medium text-slate-600 text-center leading-snug">{label}</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'location' && (
            <div className="flex flex-col items-center py-12 text-center">
              <MapPin size={36} className="text-slate-300 mb-3"/>
              <p className="text-[15px] font-semibold text-slate-500">Office Location</p>
              <p className="text-[14px] text-slate-400 mt-1">Configure office location in Settings</p>
            </div>
          )}

          {tab === 'quicklinks' && (
            <div className="flex flex-col items-center py-12 text-center">
              <Link2 size={36} className="text-slate-300 mb-3"/>
              <p className="text-[15px] font-semibold text-slate-500">No Quick Links</p>
              <p className="text-[14px] text-slate-400 mt-1">Quick links can be added by your admin</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          {[
            { label: 'Total Employees', val: stats.totalEmployees, color: 'text-slate-700' },
            { label: 'Present Today',   val: stats.present,        color: 'text-emerald-600' },
            { label: 'On Leave',        val: stats.onLeave,        color: 'text-amber-600' },
            { label: 'Pending',         val: stats.pendingLeaves,  color: 'text-blue-600' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm text-center">
              <p className={`text-[22px] font-bold ${color}`}>{val ?? '—'}</p>
              <p className="text-[13px] text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
