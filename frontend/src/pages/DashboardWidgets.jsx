import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import api from '../utils/api';

const Card = ({ title, children, icon: Icon, className = "" }) => (
  <div className={`bg-white rounded border border-slate-200 shadow-sm flex flex-col ${className}`}>
    <div className="px-5 py-4 flex items-center gap-2 border-b border-transparent">
      {Icon && <Icon size={14} className="text-slate-400" />}
      <h3 className="text-[15px] font-bold text-slate-800">{title}</h3>
    </div>
    <div className="flex-1 p-5 flex flex-col">
      {children}
    </div>
  </div>
);

const EmptyState = ({ text }) => (
  <div className="flex-1 flex items-center justify-center text-[14px] font-semibold text-slate-800">
    {text}
  </div>
);

export default function DashboardWidgets() {
  const [stats, setStats] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/stats').catch(() => ({ data: { data: {} } })),
      api.get('/holidays').catch(() => ({ data: { data: [] } })),
      api.get('/employees?limit=200&status=active').catch(() => ({ data: { data: [] } }))
    ]).then(([statsRes, holRes, empRes]) => {
      const sData = statsRes.data?.data || {};
      setStats(sData);
      setAnnouncements(sData.announcements || []);
      
      const upcomingHolidays = (holRes.data?.data || []).filter(h => new Date(h.date) >= new Date()).slice(0, 6);
      setHolidays(upcomingHolidays);

      setEmployees(empRes.data?.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const currentMonth = today.getMonth();
  
  // Find birthdays this month
  const birthdays = employees.filter(e => {
    if (!e.dateOfBirth) return false;
    const dob = new Date(e.dateOfBirth);
    return dob.getMonth() === currentMonth;
  });

  // Find new hires (joined in last 30 days)
  const newHires = employees.filter(e => {
    if (!e.joiningDate) return false;
    const jd = new Date(e.joiningDate);
    return (today - jd) / (1000 * 60 * 60 * 24) <= 30;
  });

  return (
    <div className="p-5 bg-[#f8f9fc] min-h-screen">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-min">
        
        {/* Row 1 */}
        <Card title="New Hires" className="min-h-[220px]">
          {newHires.length === 0 ? (
            <EmptyState text="No New Joinees in past 30 days." />
          ) : (
            <div className="space-y-3">
              {newHires.slice(0, 3).map((e, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                    <img src={`https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName || ''}&background=f8f9fc&color=475569`} alt="avatar" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-slate-800">{e.firstName} {e.lastName}</p>
                    <p className="text-[13px] text-slate-500">{e.designation}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="🎂 Birthday" className="min-h-[220px] p-0 overflow-auto">
          {birthdays.length === 0 ? (
            <div className="p-5 flex-1 flex items-center justify-center">
              <EmptyState text="No birthdays this month." />
            </div>
          ) : (
            birthdays.map((e, i) => (
              <div key={i} className="flex items-start gap-3 border border-slate-100 rounded-lg p-3 m-3 shadow-sm bg-white">
                <div className="w-12 h-12 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-50">
                  <img src={`https://ui-avatars.com/api/?name=${e.firstName}+${e.lastName || ''}&background=f8f9fc&color=475569`} alt="avatar" className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-slate-500 mb-1">{e.employeeId || `EMP-${i+1}`} - {e.firstName}</p>
                  <p className="text-[14px] text-slate-700 leading-snug">{e.designation || 'Employee'}</p>
                  <p className="text-[13px] text-slate-400 mt-1">{e.department || 'Unassigned'}</p>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="Favorites" className="min-h-[220px]">
          <EmptyState text="No Favorites found." />
        </Card>

        {/* Row 2 */}
        <Card title="Quick Links" className="min-h-[280px]">
          <EmptyState text="No quick links" />
        </Card>

        <Card title="Announcements" className="min-h-[280px]">
          {announcements.length === 0 ? (
            <EmptyState text="No announcements" />
          ) : (
            <div className="space-y-5 -mt-2">
              {announcements.map((ann, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-[14px] font-medium text-slate-700 leading-snug">{ann.title}</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">{new Date(ann.createdAt || new Date()).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="w-4 h-4 flex-shrink-0 mt-0.5">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zm0 0v7" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3" fill="#10b981" fillOpacity="0.4"/>
                      <path d="M12 16s1-1 4-1 4 1" fill="#3b82f6" fillOpacity="0.4"/>
                      <path d="M4 3s1 1 4 1 5-2 8-2v12" fill="#ef4444" fillOpacity="0.4"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Leave Report" className="min-h-[280px]">
          <div className="space-y-4 -mt-2">
            {[
              { name: 'Absent', count: '0', color: 'border-slate-200 text-slate-400' },
              { name: 'Casual Leave', sub: 'Available 10 Day(s)', count: '2', color: 'border-orange-200 text-orange-500' },
              { name: 'Compensatory Off', sub: 'Available 0 Day(s)', count: '0', color: 'border-emerald-200 text-emerald-500' },
              { name: 'Leave Without Pay', count: '0', color: 'border-rose-200 text-rose-500' },
              { name: 'Permission', sub: 'Available 47.74 Hour(s)', count: '0', color: 'border-amber-200 text-amber-500' },
            ].map((lr, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className={`w-8 h-8 rounded-full border-[3px] flex items-center justify-center text-[13px] font-bold ${lr.color}`}>
                  {lr.count}
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-slate-800">{lr.name}</p>
                  {lr.sub && <p className="text-[12px] text-slate-500 font-medium">{lr.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Row 3 */}
        <Card title="Upcoming Holidays" className="min-h-[220px]">
          {holidays.length === 0 ? (
            <EmptyState text="No upcoming holidays" />
          ) : (
            <div className="space-y-0 -m-5">
              {holidays.map((hol, i) => {
                const date = new Date(hol.date);
                return (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 last:border-b-0">
                    <p className="text-[14px] font-semibold text-slate-800">{hol.name}</p>
                    <div className="text-right">
                      <p className="text-[13px] font-bold text-slate-700">{date.toLocaleDateString('en-GB')}</p>
                      <p className="text-[12px] text-slate-400 capitalize">{date.toLocaleDateString('en-US', { weekday: 'long' })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="My Goals" className="md:col-span-2 min-h-[220px]">
          <EmptyState text="No Goals found" />
        </Card>

      </div>
    </div>
  );
}
