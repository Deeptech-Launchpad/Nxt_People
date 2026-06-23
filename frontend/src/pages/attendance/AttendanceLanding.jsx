import React from 'react';
import { CalendarCheck, Clock, MapPin } from 'lucide-react';
import ModuleLanding from '../../components/ModuleLanding.jsx';

export default function AttendanceLanding() {
  const items = [
    { key: 'my-attendance', label: 'My Attendance', icon: CalendarCheck, color: 'text-blue-600', to: '/attendance/my' },
    { key: 'regularization', label: 'Regularization', icon: Clock, color: 'text-amber-600', to: '/attendance/regularization' },
    { key: 'location', label: 'Location History', icon: MapPin, color: 'text-rose-600', to: '/attendance/location' },
  ];

  return (
    <ModuleLanding
      title="Attendance"
      description="Manage your attendance, request regularizations, and view location history."
      items={items}
      colsLg={4}
    />
  );
}
