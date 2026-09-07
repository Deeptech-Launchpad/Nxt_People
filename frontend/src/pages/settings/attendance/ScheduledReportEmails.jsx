import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Toggle, Spinner } from '../configKit';

// Which reports exist, their fixed cadence (not editable — payroll's own
// cutoff depends on it), and whether recipients are a free choice or
// structural (the regularization reminder always routes to whoever is a
// pending approver, never to an arbitrary address).
const REPORTS = [
  { key: 'dailyAttendance', label: 'Daily Attendance', cadence: 'Every working day', covers: 'Yesterday' },
  { key: 'weeklyAttendance', label: 'Weekly Attendance', cadence: 'Once a week', covers: 'The week just closed' },
  { key: 'onboardingData', label: 'Onboarding Data', cadence: 'Once a week', covers: 'New joiners that week' },
  { key: 'musterRoll', label: 'Muster Roll', cadence: 'Once a week', covers: 'Per-employee totals for the week' },
  { key: 'monthlyAttendance', label: 'Monthly Attendance', cadence: '26th, else 27th, else 28th', covers: 'The closing pay period' },
  { key: 'payrollFeed', label: 'Payroll Feed', cadence: 'Same day as Monthly', covers: 'That period’s LOP, for payroll' },
  { key: 'lopData', label: 'LOP Data', cadence: 'Same day as Monthly', covers: 'That period’s Loss-of-Pay days' },
];

const ROLE_LABELS = {
  admin: 'Admin', director: 'Director', hr_admin: 'HR Admin',
  manager: 'Manager', team_incharge: 'Team Incharge',
};

export default function ScheduledReportEmails() {
  const [cfg, setCfg] = useState(null);
  const [approverRoles, setApproverRoles] = useState([]);
  const [editing, setEditing] = useState(null); // { key, ...reportCfg }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/report-email-config')
      .then(r => { setCfg(r.data.data); setApproverRoles(r.data.approverRoles || []); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report email settings'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = (body) => api.patch('/report-email-config', body)
    .then(r => { setCfg(r.data.data); return r.data.data; });

  const toggleReport = (key) => {
    patch({ [key]: { enabled: !cfg[key].enabled } })
      .then(() => toast.success(`${REPORTS.find(r => r.key === key)?.label || key} ${cfg[key].enabled ? 'switched off' : 'switched on'}`))
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  const toggleReminder = () => {
    patch({ regularizationReminder: { enabled: !cfg.regularizationReminder.enabled } })
      .then(() => toast.success(`Regularization reminder ${cfg.regularizationReminder.enabled ? 'switched off' : 'switched on'}`))
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  const save = () => {
    setBusy(true);
    const { key, ...body } = editing;
    patch({ [key]: body })
      .then(() => { toast.success('Saved'); setEditing(null); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  if (!cfg) return <Spinner />;

  const describe = (r) => {
    const parts = [];
    if (r.recipients?.length) parts.push(`${r.recipients.length} address(es)`);
    if (r.roles?.length) parts.push(r.roles.map(k => ROLE_LABELS[k] || k).join(', '));
    return parts.join(' + ') || 'Nobody yet';
  };

  return (
    <div className="space-y-4 pb-4">
      <Card title="Scheduled Reports" description="Which reports go out automatically, on what schedule, and to whom">
        <Note>
          Every report ships switched off. Turning one on here is the only way it ever starts sending — nothing
          fires on its own just because this screen exists. The Daily report skips weekends and holidays
          automatically; the weekly and monthly cadences move forward a day when their usual date falls on one.
        </Note>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Report</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Cadence</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Content covers</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Recipients</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Enabled</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {REPORTS.map(r => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800 font-medium">{r.label}</td>
                  <td className="px-4 py-3 text-slate-600">{r.cadence}</td>
                  <td className="px-4 py-3 text-slate-500 text-[13px]">{r.covers}</td>
                  <td className="px-4 py-3 text-slate-600">{describe(cfg[r.key])}</td>
                  <td className="px-4 py-3"><Toggle checked={cfg[r.key].enabled} onChange={() => toggleReport(r.key)} label="" /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing({ key: r.key, ...cfg[r.key] })} className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50/50">
                <td className="px-4 py-3 text-slate-800 font-medium">Regularization Pending Reminder</td>
                <td className="px-4 py-3 text-slate-600">Same day as Monthly</td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">Each recipient's own pending approvals</td>
                <td className="px-4 py-3 text-slate-600">Team Incharge, Manager, HR Admin, Admin — whoever has something pending</td>
                <td className="px-4 py-3"><Toggle checked={cfg.regularizationReminder.enabled} onChange={toggleReminder} label="" /></td>
                <td className="px-4 py-3" />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {REPORTS.find(r => r.key === editing.key)?.label}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Recipient email addresses</label>
                <textarea
                  rows={3}
                  value={(editing.recipients || []).join(', ')}
                  onChange={e => setEditing(v => ({ ...v, recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                  placeholder="hr@company.com, admin@company.com"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <p className="text-[12.5px] text-slate-500 mt-1.5">Comma-separated. Sent as-is, no per-employee substitution.</p>
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">Also send to everyone holding a role</p>
                <div className="flex flex-wrap gap-1.5">
                  {approverRoles.map(role => (
                    <button
                      key={role} type="button"
                      onClick={() => setEditing(v => {
                        const roles = v.roles || [];
                        return { ...v, roles: roles.includes(role) ? roles.filter(x => x !== role) : [...roles, role] };
                      })}
                      className={`text-[12.5px] rounded-full px-2.5 py-1 border transition-colors ${
                        (editing.roles || []).includes(role)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                      }`}
                    >
                      {ROLE_LABELS[role] || role}
                    </button>
                  ))}
                </div>
                <p className="text-[12.5px] text-slate-500 mt-2">Active users in a chosen role receive it, in addition to the addresses above.</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={save} disabled={busy}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
