import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CalendarCheck, CalendarDays, Clock, History } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { roleLabel } from '../../utils/roles';
import api from '../../utils/api';
import { visibleServices, BASE } from './serviceCatalog';

// Settings — a hub of services rather than one page of tabs. Each tile opens
// that service's own workspace, which carries its own tab bar and left rail.
//
// Tiles are deliberately small and square: this is a directory, and the label
// is what you read. Descriptions made three services fill the row a dozen would
// need, which reads as "there are only three things here" rather than "these
// are the three that are configurable".
//
// Everything the old single-page Settings screen held still exists; it moved to
// the service that owns it. Company details and the security policy are under
// Manage Accounts, the location rules under Attendance, leave accrual and the
// weekend calendar under Leave Tracker.
const ICONS = { Users, CalendarCheck, CalendarDays, Clock };

export default function ServiceHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const services = visibleServices(user?.role);
  const [org, setOrg] = useState({ name: null, headcount: null });

  useEffect(() => {
    let cancelled = false;
    api.get('/settings')
      .then(r => { if (!cancelled) setOrg(o => ({ ...o, name: r.data.data?.companyName || null })); })
      .catch(() => {});
    // Headcount, not a licence meter. The reference shows seats used against
    // seats bought; there is no licensing here, and inventing a denominator
    // would be putting a number on screen that means nothing.
    api.get('/employees?limit=1')
      .then(r => {
        const total = r.data?.total ?? r.data?.pagination?.total ?? null;
        if (!cancelled && total != null) setOrg(o => ({ ...o, headcount: total }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-slate-900 truncate">
            {org.name || 'Settings'}
          </p>
          {org.headcount != null && (
            <p className="text-[13.5px] text-slate-500 mt-0.5">
              {org.headcount} employee{org.headcount === 1 ? '' : 's'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-[13px] font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-slate-800 truncate">
              {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email}
            </p>
            <p className="text-[12.5px] text-slate-500">{roleLabel(user?.role)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 px-5 sm:px-6 py-5 min-h-[calc(100vh-18rem)]">
        <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-4">Services</h3>

        {services.length === 0 ? (
          <p className="text-[14px] text-slate-500">No services are available to your role.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {services.map(s => {
              const Icon = ICONS[s.icon] || Users;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => navigate(`${BASE}/${s.key}`)}
                  title={s.description}
                  className="group flex flex-col items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm px-2 py-5 transition-all"
                >
                  <Icon size={26} strokeWidth={1.6} className="text-blue-600" />
                  <span className="text-[13px] font-medium text-center leading-tight text-slate-800">
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Not a service — it configures nothing. It is the record of what the
            services above were changed to, and it belongs on this page because
            this is where somebody goes after asking "who changed that?". */}
        <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mt-8 mb-4">Records</h3>
        <button
          type="button"
          onClick={() => navigate('/audit')}
          className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm px-4 py-3.5 transition-all text-left"
        >
          <History size={22} strokeWidth={1.6} className="text-blue-600 flex-shrink-0" />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-slate-800">Change history</span>
            <span className="block text-[12.5px] text-slate-500">
              Every configuration change, who made it, and what it moved
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
