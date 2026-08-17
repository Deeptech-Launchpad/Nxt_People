import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CalendarCheck, CalendarDays } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { visibleServices, BASE } from './serviceCatalog';

// Settings — a hub of services rather than one page of tabs. Each tile opens
// that service's own workspace, which carries its own tab bar and left rail.
//
// Everything the old single-page Settings screen held still exists; it moved to
// the service that owns it. Company details and the security policy are under
// Manage Accounts, the location rules under Attendance, leave accrual and the
// weekend calendar under Leave Tracker.
const ICONS = { Users, CalendarCheck, CalendarDays };

export default function ServiceHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const services = visibleServices(user?.role);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-12rem)]">
      <div className="px-6 py-5 border-b border-slate-100">
        <h2 className="text-[18px] font-semibold text-slate-900">Settings</h2>
        <p className="text-[15px] text-slate-500 mt-1">
          Choose a service to configure how it behaves for everyone in the organization.
        </p>
      </div>

      <div className="p-6">
        <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Services</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {services.map(s => {
            const Icon = ICONS[s.icon] || Users;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => navigate(`${BASE}/${s.key}`)}
                title={`Open ${s.label}`}
                className="group text-left flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-md p-5 transition-all"
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-blue-50 group-hover:bg-blue-100 transition-colors">
                  <Icon size={22} className="text-blue-600" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-slate-900">{s.label}</p>
                  <p className="text-[13px] text-slate-500 mt-1 leading-snug">{s.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {services.length === 0 && (
          <p className="text-[14px] text-slate-500">
            No services are available to your role.
          </p>
        )}
      </div>
    </div>
  );
}
