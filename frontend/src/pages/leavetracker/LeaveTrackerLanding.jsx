import React from 'react';
import { Calendar, FileText, Gift, Lightbulb, Calendar as CalendarIcon } from 'lucide-react';
import ModuleLanding from '../../components/ModuleLanding.jsx';

export default function LeaveTrackerLanding() {
  const items = [
    { key: 'summary', label: 'Leave Summary', icon: Calendar, color: 'text-blue-600', to: '/leave-tracker/summary' },
    { key: 'requests', label: 'Leave Requests', icon: FileText, color: 'text-emerald-600', to: '/leave-tracker/requests' },
    { key: 'comp-off', label: 'Comp-Off', icon: Gift, color: 'text-green-600', to: '/leave-tracker/comp-off' },
    { key: 'holidays', label: 'Holidays', icon: CalendarIcon, color: 'text-rose-600', to: '/leave-tracker/holidays' },
  ];

  return (
    <ModuleLanding
      title="Leave Tracker"
      description="Manage leave requests, comp-offs, and view holiday calendars."
      items={items}
      colsLg={4}
    />
  );
}
