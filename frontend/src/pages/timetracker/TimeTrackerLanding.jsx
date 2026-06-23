import React from 'react';
import { Clock, FileText, Briefcase, Calendar } from 'lucide-react';
import ModuleLanding from '../../components/ModuleLanding.jsx';

export default function TimeTrackerLanding() {
  const items = [
    { key: 'timelogs', label: 'Time Logs', icon: Clock, color: 'text-blue-600', to: '/time-tracker/timelogs' },
    { key: 'timesheets', label: 'Timesheets', icon: FileText, color: 'text-emerald-600', to: '/time-tracker/timesheets' },
    { key: 'projects', label: 'Projects', icon: Briefcase, color: 'text-purple-600', to: '/time-tracker/projects' },
    { key: 'schedule', label: 'Job Schedule', icon: Calendar, color: 'text-amber-600', to: '/time-tracker/schedule' },
  ];

  return (
    <ModuleLanding
      title="Time Tracker"
      description="Track time, manage timesheets, and view your job schedule."
      items={items}
      colsLg={4}
    />
  );
}
