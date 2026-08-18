import React, { useEffect, useState } from 'react';
import { CalendarCheck, Clock, MapPin, Briefcase, Settings, Repeat } from 'lucide-react';
import ModuleLanding from '../../components/ModuleLanding.jsx';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import api from '../../utils/api';

export default function AttendanceLanding() {
  const { user } = useAuth();
  // Regularization and On Duty can each be switched off in Configuration →
  // Methods. While one is off its tile goes, because the route behind it
  // refuses the request anyway and a tile that leads to a 403 is worse than
  // no tile. The default is on, so a failed load still shows everything.
  const [methods, setMethods] = useState({ regularization: true, onDuty: true });

  useEffect(() => {
    let cancelled = false;
    api.get('/attendance-config/methods')
      .then(r => { if (!cancelled && r.data?.data) setMethods(r.data.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const items = [
    { key: 'my-attendance', label: 'My Attendance', icon: CalendarCheck, color: 'text-blue-600', to: '/attendance/my' },
    methods.regularization !== false &&
      { key: 'regularization', label: 'Regularization', icon: Clock, color: 'text-amber-600', to: '/attendance/regularization' },
    methods.onDuty !== false &&
      { key: 'on-duty', label: 'On Duty', icon: Briefcase, color: 'text-violet-600', to: '/attendance/on-duty' },
    // Shift Change is a request about when you work, so it sits with
    // regularization and on duty rather than behind Settings.
    { key: 'shift-change', label: 'Shift Change', icon: Repeat, color: 'text-teal-600', to: '/shift-change' },
    { key: 'location', label: 'Location History', icon: MapPin, color: 'text-rose-600', to: '/attendance/location' },
    isFullAccess(user?.role) &&
      { key: 'configuration', label: 'Configuration', icon: Settings, color: 'text-slate-600', to: '/attendance/configuration' },
  ].filter(Boolean);

  return (
    <ModuleLanding
      title="Attendance"
      description="Manage your attendance, request regularizations and on duty, and view location history."
      items={items}
      colsLg={5}
    />
  );
}
