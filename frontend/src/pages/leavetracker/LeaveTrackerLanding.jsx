import React from 'react';
import { Calendar, FileText, Gift, Calendar as CalendarIcon, SlidersHorizontal } from 'lucide-react';
import ModuleLanding from '../../components/ModuleLanding.jsx';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';

export default function LeaveTrackerLanding() {
  const { user } = useAuth();
  const items = [
    { key: 'summary', label: 'Leave Summary', icon: Calendar, color: 'text-blue-600', to: '/leave-tracker/summary' },
    { key: 'requests', label: 'Leave Requests', icon: FileText, color: 'text-emerald-600', to: '/leave-tracker/requests' },
    { key: 'comp-off', label: 'Comp-Off', icon: Gift, color: 'text-green-600', to: '/leave-tracker/comp-off' },
    { key: 'holidays', label: 'Holidays', icon: CalendarIcon, color: 'text-rose-600', to: '/leave-tracker/holidays' },
    // Configuration is admin-only, matching the route guard. Showing a tile
    // that lands on a permission wall is worse than not showing it.
    ...(isFullAccess(user)
      ? [{ key: 'configuration', label: 'Configuration', icon: SlidersHorizontal, color: 'text-slate-600', to: '/reports/configuration' }]
      : []),
  ];

  return (
    <ModuleLanding
      title="Leave Tracker"
      description="Manage leave requests, comp-offs, and view holiday calendars."
      items={items}
      colsLg={5}
    />
  );
}
