import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, Building2, Clock, Calendar, Shield, MapPin, RefreshCw, TrendingUp, Repeat, Wallet } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { roleLabel } from '../utils/roles';
import WeekendRulesEditor from '../components/WeekendRulesEditor';
import { PAYROLL_ENABLED } from '../config/features';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ?tab= lets the Leave Tracker Configuration hub land on the right section
  // instead of dropping the user on Company and leaving them to hunt.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') || 'company';
  const [activeTab, setActiveTab] = useState(
    requestedTab === 'payroll' && !PAYROLL_ENABLED ? 'company' : requestedTab
  );

  const selectTab = (id) => {
    setActiveTab(id);
    setSearchParams(id === 'company' ? {} : { tab: id }, { replace: true });
  };

  useEffect(() => {
    api.get('/settings').then(r => setSettings(r.data.data)).catch((err) => {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to load settings');
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) { toast.error('Settings failed to load — refresh the page and try again.'); return; }
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

  // Payroll is built but not live for this org — see config/features.
  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'leave', label: 'Leave Policy', icon: Calendar },
    { id: 'accrual', label: 'Leave Accrual', icon: TrendingUp },
    { id: 'weekends', label: 'Weekends', icon: Repeat },
    { id: 'gps', label: 'GPS & Location', icon: MapPin },
    ...(PAYROLL_ENABLED ? [{ id: 'payroll', label: 'Payroll', icon: Wallet }] : []),
    { id: 'security', label: 'Security', icon: Shield },
  ];

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100">
          {tabs.map(t => (
            <button key={t.id} onClick={() => selectTab(t.id)}
              className={`flex items-center gap-2 px-6 py-4 text-base font-medium border-b-2 transition-colors ${activeTab===t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
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
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Company Name</label>
                    <input value={settings?.companyName||''} onChange={e=>setSettings({...settings,companyName:e.target.value})} className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Company Email</label>
                    <input type="email" value={settings?.companyEmail||''} onChange={e=>setSettings({...settings,companyEmail:e.target.value})} className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Timezone</label>
                    <input value="Asia/Kolkata" disabled readOnly className="w-full max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-base bg-slate-50 text-slate-500 cursor-not-allowed"/>
                    <p className="text-sm text-slate-400 mt-1">This deployment is India-only — attendance, payroll, and cron scheduling all assume Asia/Kolkata throughout the system and aren't safe to change independently.</p>
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
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Work Start Time</label>
                      <input type="time" value={settings?.workStartTime||'09:00'} onChange={e=>setSettings({...settings,workStartTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Work End Time</label>
                      <input type="time" value={settings?.workEndTime||'18:00'} onChange={e=>setSettings({...settings,workEndTime:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">Working Days</label>
                    <div className="flex gap-2 flex-wrap">
                      {DAYS.map(d => (
                        <button key={d} type="button" onClick={() => toggleWorkDay(d)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${settings?.workingDays?.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
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
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Late Mark After (minutes from midnight)</label>
                    <input type="number" value={settings?.lateAfterMinutes||570} onChange={e=>{ const v = parseInt(e.target.value); setSettings({...settings,lateAfterMinutes: Number.isNaN(v) ? settings.lateAfterMinutes : v}); }}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                    <p className="text-sm text-slate-400 mt-1">570 = 9:30 AM</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Half Day if less than (hours)</label>
                    <input type="number" value={settings?.halfDayHours??4} onChange={e=>{ const v = parseFloat(e.target.value); setSettings({...settings,halfDayHours: Number.isNaN(v) ? settings.halfDayHours : v}); }} min={1} max={8} step={0.5}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Full Day at least (hours)</label>
                    <input type="number" value={settings?.fullDayHours??7.5} onChange={e=>{ const v = parseFloat(e.target.value); setSettings({...settings,fullDayHours: Number.isNaN(v) ? settings.fullDayHours : v}); }} min={1} max={12} step={0.5}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                    <p className="text-sm text-slate-400 mt-1">Below this counts as a half day; below the half-day figure counts as absent.</p>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={settings?.allowRemoteCheckIn||false} onChange={e=>setSettings({...settings,allowRemoteCheckIn:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                    <div>
                      <p className="text-base font-medium text-slate-700">Allow Remote Check-In</p>
                      <p className="text-sm text-slate-400">Allow employees to check in from outside office</p>
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
                {[['casualLeave','Casual Leave']].map(([key,label])=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} (days/year)</label>
                    <input type="number" value={settings?.leavePolicy?.[key]||0} onChange={e=>setSettings({...settings,leavePolicy:{...settings.leavePolicy,[key]:parseInt(e.target.value)}})} min={0} max={60}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'accrual' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">Monthly Leave Accrual</h3>
              <p className="text-slate-400 text-base mb-5">Automatically credit leave balances to all active employees each month. Use the Payroll page to trigger accrual.</p>
              <div className="space-y-5 max-w-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={settings?.leaveAccrualEnabled||false} onChange={e=>setSettings({...settings,leaveAccrualEnabled:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                  <div>
                    <p className="text-base font-medium text-slate-700">Enable Monthly Accrual</p>
                    <p className="text-sm text-slate-400">Credit leave automatically when "Run Accrual" is triggered</p>
                  </div>
                </label>
                {[['casualAccrualPerMonth','Casual Leave per Month (days)']].map(([key,label])=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
                    <input type="number" value={settings?.[key]??''} onChange={e=>setSettings({...settings,[key]:parseFloat(e.target.value)||0})} min={0} max={5} step={0.25}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                  </div>
                ))}
                <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 text-sm text-brand-700">
                  💡 Standard: Casual 1/month
                </div>
              </div>
            </div>
          )}

          {activeTab === 'weekends' && (
            <div>
              <p className="text-[14px] text-slate-500 mb-4">
                Manage which days are weekends using Google-Calendar-style recurrence rules.
                Changes apply across attendance, leave, and reports.
              </p>
              <WeekendRulesEditor />
            </div>
          )}

          {activeTab === 'gps' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">GPS Check-In Location</h3>
              <p className="text-slate-400 text-base mb-5">Set your office coordinates to enforce location-based check-in. Employees outside the radius will see a warning.</p>
              <div className="space-y-4 max-w-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={settings?.requireGps||false} onChange={e=>setSettings({...settings,requireGps:e.target.checked})} className="w-4 h-4 rounded accent-brand-600"/>
                  <div>
                    <p className="text-base font-medium text-slate-700">Require GPS on Check-In</p>
                    <p className="text-sm text-slate-400">Block check-in from outside office radius</p>
                  </div>
                </label>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Office Latitude</label>
                  <input type="number" value={settings?.officeLatitude??''} onChange={e=>setSettings({...settings,officeLatitude:parseFloat(e.target.value)||null})} step="0.000001" placeholder="e.g. 13.0827"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Office Longitude</label>
                  <input type="number" value={settings?.officeLongitude??''} onChange={e=>setSettings({...settings,officeLongitude:parseFloat(e.target.value)||null})} step="0.000001" placeholder="e.g. 80.2707"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1.5">Allowed Radius (meters)</label>
                  <input type="number" value={settings?.gpsRadiusMeters||200} onChange={e=>setSettings({...settings,gpsRadiusMeters:parseInt(e.target.value)||200})} min={50} max={5000} step={50}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                  <p className="text-sm text-slate-400 mt-1">Recommended: 100–300 meters</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
                  📍 Tip: Use Google Maps to find your office coordinates. Right-click your office → "What's here?" to copy lat/lng.
                </div>
              </div>
            </div>
          )}

          {PAYROLL_ENABLED && activeTab === 'payroll' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-1">Payroll Controls</h3>
              <p className="text-slate-400 text-base mb-5">Org-wide policies that govern how payroll runs and locks.</p>
              <div className="space-y-5 max-w-md">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.requireManagerApprovalBeforeLock || false}
                    onChange={e => setSettings({ ...settings, requireManagerApprovalBeforeLock: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded accent-brand-600"
                  />
                  <div>
                    <p className="text-base font-medium text-slate-700">Require manager approval before lock</p>
                    <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                      When ON, an admin cannot lock a payslip until the employee's reporting person has reviewed
                      and approved it. Adds a two-eyes guarantee to monthly payroll. When OFF (default), admin can lock without manager sign-off.
                    </p>
                  </div>
                </label>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700 leading-relaxed">
                  💡 Locking sends the employee their payslip PDF over email AND marks compensation claims as paid + applies loan recovery. Once locked, only a correction (supersede) can change the slip — turn this on if you want a second pair of eyes before that becomes irreversible.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h3 className="font-display font-semibold text-slate-800 mb-4">Security Settings</h3>
              <div className="space-y-4">
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                  <p className="font-medium text-slate-700 text-base">Require MFA for these roles</p>
                  <p className="text-slate-400 text-sm mt-1 mb-3">
                    Users in the selected roles will be forced through MFA enrolment on next login.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {['admin', 'director', 'manager', 'team_member'].map(r => {
                      const list = Array.isArray(settings?.mfaRequiredRoles) ? settings.mfaRequiredRoles : [];
                      const on = list.includes(r);
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setSettings(s => ({
                            ...s,
                            mfaRequiredRoles: on
                              ? list.filter(x => x !== r)
                              : [...list, r],
                          }))}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                            on
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'
                          }`}
                        >
                          {roleLabel(r)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-base">JWT Token Expiry</p>
                  <p className="text-slate-400 text-sm mt-1">Current: 7 days — configure in .env file (JWT_EXPIRE)</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-base">Password Policy</p>
                  <p className="text-slate-400 text-sm mt-1">Minimum 6 characters required for all users</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="font-medium text-slate-700 text-base">Role-Based Access</p>
                  <p className="text-slate-400 text-sm mt-1">Super Admin · HR · Team Lead · Employee — 4 role levels configured</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={handleSave} disabled={saving || !settings}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25 disabled:opacity-60">
            <Save size={15}/>{saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
