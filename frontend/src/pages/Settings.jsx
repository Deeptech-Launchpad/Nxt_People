import React, { useState, useEffect } from 'react';
import { Save, Building2, Clock, Calendar, Shield, MapPin, RefreshCw, TrendingUp, Repeat, Wallet } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import WeekendRulesEditor from '../components/WeekendRulesEditor';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TIMEZONES = ['Asia/Kolkata','America/New_York','America/Los_Angeles','Europe/London','Asia/Singapore','Australia/Sydney'];

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('company');

  useEffect(() => {
    api.get('/settings').then(r => setSettings(r.data.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await api.put('/settings', settings);
      setSettings(r.data.data);
      toast.success('Settings saved!');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const toggleWorkDay = (day) => {
    setSettings(s => ({
      ...s,
      workingDays: s.workingDays?.includes(day) ? s.workingDays.filter(d=>d!==day) : [...(s.workingDays||[]), day]
    }));
  };

  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'leave', label: 'Leave Policy', icon: Calendar },
    { id: 'accrual', label: 'Leave Accrual', icon: TrendingUp },
    { id: 'weekends', label: 'Weekends', icon: Repeat },
    { id: 'gps', label: 'GPS & Location', icon: MapPin },
    { id: 'payroll', label: 'Payroll', icon: Wallet },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${activeTab===t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <t.icon size={15}/> {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-6">
          {activeTab === 'company' && (
            <>
              <div>
                <h3 className="font-display font-semibold text-slate-800 mb-4">Company Information</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Company Name</label>
                    <input value={settings?.companyName||''} onChange={e=>setSettings({...settings,companyName:e.target.value})} className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Company Email</label>
                    <input type="email" value={settings?.companyEmail||''} onChange={e=>setSettings({...settings,companyEmail:e.target.value})} className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Timezone</label>
                    <select value={settings?.timezone||'Asia/Kolkata'} onChange={e=>setSettings({...settings,timezone:e.target.value})} className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                      {TIMEZONES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'attendance' && (
            <>
              <div>
                <h3 className="font-display font-semibold text-slate-800 mb-4">Work Schedule</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Work Start Time</label>
                      <input type="time" value={settings?.workStartTime||'09:00'} onChange={e=>setSettings({...settings,workStartTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Work End Time</label>
                      <input type="time" value={settings?.workEndTime||'18:00'} onChange={e=>setSettings({...settings,workEndTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-2">Working Days</label>
                    <div className="flex gap-2 flex-wrap">
                      {DAYS.map(d => (
                        <button key={d} type="button" onClick={() => toggleWorkDay(d)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${settings?.workingDays?.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-6">
                <h3 className="font-display font-semibold text-slate-800 mb-4">Attendance Rules</h3>
                <div className="space-y-4 max-w-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Late Mark After (minutes from midnight)</label>
                    <input type="number" value={settings?.lateAfterMinutes||570} onChange={e=>setSettings({...settings,lateAfterMinutes:parseInt(e.target.value)})}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                    <p className="text-xs text-slate-400 mt-1">570 = 9:30 AM</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Half Day if less than (hours)</label>
                    <input type="number" value={settings?.halfDayHours||4} onChange={e=>setSettings({...settings,halfDayHours:parseFloat(e.target.value)})} min={1} max={8} step={0.5}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={settings?.allowRemoteCheckIn||false} onChange={e=>setSettings({...settings,allowRemoteCheckIn:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Allow Remote Check-In</p>
                      <p className="text-xs text-slate-400">Allow employees to check in from outside office</p>
                    </div>
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'leave' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-4">Annual Leave Quota</h3>
              <div className="space-y-4 max-w-xs">
                {[['casualLeave','Casual Leave'],['sickLeave','Sick Leave'],['earnedLeave','Earned Leave']].map(([key,label])=>(
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">{label} (days/year)</label>
                    <input type="number" value={settings?.leavePolicy?.[key]||0} onChange={e=>setSettings({...settings,leavePolicy:{...settings.leavePolicy,[key]:parseInt(e.target.value)}})} min={0} max={60}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400"/>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'accrual' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">Monthly Leave Accrual</h3>
              <p className="text-slate-400 text-sm mb-5">Automatically credit leave balances to all active employees each month. Use the Payroll page to trigger accrual.</p>
              <div className="space-y-5 max-w-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={settings?.leaveAccrualEnabled||false} onChange={e=>setSettings({...settings,leaveAccrualEnabled:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Enable Monthly Accrual</p>
                    <p className="text-xs text-slate-400">Credit leave automatically when "Run Accrual" is triggered</p>
                  </div>
                </label>
                {[['casualAccrualPerMonth','Casual Leave per Month (days)'],['sickAccrualPerMonth','Sick Leave per Month (days)'],['earnedAccrualPerMonth','Earned Leave per Month (days)']].map(([key,label])=>(
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
                    <input type="number" value={settings?.[key]??''} onChange={e=>setSettings({...settings,[key]:parseFloat(e.target.value)||0})} min={0} max={5} step={0.25}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                  </div>
                ))}
                <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 text-xs text-brand-700">
                  💡 Standard: Casual 1/month, Sick 0.83/month (10/yr), Earned 1.25/month (15/yr)
                </div>
              </div>
            </div>
          )}

          {activeTab === 'weekends' && (
            <div className="p-6">
              <p className="text-[12.5px] text-slate-500 mb-4">
                Manage which days are weekends using Google-Calendar-style recurrence rules.
                Changes apply across attendance, leave, and reports.
              </p>
              <WeekendRulesEditor />
            </div>
          )}

          {activeTab === 'gps' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">GPS Check-In Location</h3>
              <p className="text-slate-400 text-sm mb-5">Set your office coordinates to enforce location-based check-in. Employees outside the radius will see a warning.</p>
              <div className="space-y-4 max-w-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={settings?.requireGps||false} onChange={e=>setSettings({...settings,requireGps:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Require GPS on Check-In</p>
                    <p className="text-xs text-slate-400">Block check-in from outside office radius</p>
                  </div>
                </label>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Office Latitude</label>
                  <input type="number" value={settings?.officeLatitude??''} onChange={e=>setSettings({...settings,officeLatitude:parseFloat(e.target.value)||null})} step="0.000001" placeholder="e.g. 13.0827"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Office Longitude</label>
                  <input type="number" value={settings?.officeLongitude??''} onChange={e=>setSettings({...settings,officeLongitude:parseFloat(e.target.value)||null})} step="0.000001" placeholder="e.g. 80.2707"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Allowed Radius (meters)</label>
                  <input type="number" value={settings?.gpsRadiusMeters||200} onChange={e=>setSettings({...settings,gpsRadiusMeters:parseInt(e.target.value)||200})} min={50} max={5000} step={50}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                  <p className="text-xs text-slate-400 mt-1">Recommended: 100–300 meters</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
                  📍 Tip: Use Google Maps to find your office coordinates. Right-click your office → "What's here?" to copy lat/lng.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payroll' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">Payroll Controls</h3>
              <p className="text-slate-400 text-sm mb-5">Org-wide policies that govern how payroll runs and locks.</p>
              <div className="space-y-5 max-w-md">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.requireManagerApprovalBeforeLock || false}
                    onChange={e => setSettings({ ...settings, requireManagerApprovalBeforeLock: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded accent-brand-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Require manager approval before lock</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      When ON, an admin cannot lock a payslip until the employee's reporting manager has reviewed
                      and approved it. Adds a two-eyes guarantee to monthly payroll. When OFF (default), admin can lock without manager sign-off.
                    </p>
                  </div>
                </label>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 leading-relaxed">
                  💡 Locking sends the employee their payslip PDF over email AND marks compensation claims as paid + applies loan recovery. Once locked, only a correction (supersede) can change the slip — turn this on if you want a second pair of eyes before that becomes irreversible.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-4">Security Settings</h3>
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-sm">JWT Token Expiry</p>
                  <p className="text-slate-400 text-xs mt-1">Current: 7 days — configure in .env file (JWT_EXPIRE)</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-sm">Password Policy</p>
                  <p className="text-slate-400 text-xs mt-1">Minimum 6 characters required for all users</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-sm">Role-Based Access</p>
                  <p className="text-slate-400 text-xs mt-1">Admin · Manager · Employee — 3 role levels configured</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25 disabled:opacity-60">
            <Save size={15}/>{saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
