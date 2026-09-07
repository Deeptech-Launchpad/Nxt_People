import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Note, Toggle, Check, Spinner } from '../configKit';
import EmployeeFilter from '../../reports/EmployeeFilter';

// Which reports exist, and whether their cadence is fixed by what the report
// IS (the original seven — Payroll Feed can't sensibly run on a random
// Tuesday) or a setting the admin picks (the widened catalog, reusing
// reports that already exist elsewhere in the app).
const REPORTS = [
  { key: 'dailyAttendance', label: 'Daily Attendance', fixedCadence: 'Every working day', covers: 'Yesterday' },
  { key: 'weeklyAttendance', label: 'Weekly Attendance', fixedCadence: 'Once a week', covers: 'The week just closed' },
  { key: 'onboardingData', label: 'Onboarding Data', fixedCadence: 'Once a week', covers: 'New joiners that week' },
  { key: 'musterRoll', label: 'Muster Roll', fixedCadence: 'Once a week', covers: 'Per-employee totals for the week' },
  { key: 'monthlyAttendance', label: 'Monthly Attendance', fixedCadence: '26th, else 27th, else 28th', covers: 'The closing pay period' },
  { key: 'payrollFeed', label: 'Payroll Feed', fixedCadence: 'Same day as Monthly', covers: 'That period’s LOP, for payroll' },
  { key: 'lopData', label: 'LOP Data', fixedCadence: 'Same day as Monthly', covers: 'That period’s Loss-of-Pay days' },
];

const EXTRA_REPORTS = [
  { key: 'headcount', label: 'Headcount', covers: 'Active headcount by department' },
  { key: 'additionTrend', label: 'Addition Trend', covers: 'New joiners in the period' },
  { key: 'attritionTrend', label: 'Attrition Trend', covers: 'Exits in the period' },
  { key: 'experienceExit', label: 'Experience & Exit', covers: 'Exits, with tenure' },
];

const CADENCE_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const ROLE_LABELS = {
  admin: 'Admin', director: 'Director', hr_admin: 'HR Admin',
  manager: 'Manager', team_incharge: 'Team Incharge',
};

export default function ScheduledReportEmails() {
  const [cfg, setCfg] = useState(null);
  const [approverRoles, setApproverRoles] = useState([]);
  const [cadenceOptions, setCadenceOptions] = useState(['daily', 'weekly', 'monthly']);
  const [editing, setEditing] = useState(null); // { key, ...reportCfg }
  const [editingEmployees, setEditingEmployees] = useState([]); // hydrated employee objects for the picker
  const [busy, setBusy] = useState(false);

  const [recipientsPopup, setRecipientsPopup] = useState(null); // { key, loading, data }
  const [contentPopup, setContentPopup] = useState(null);       // { key, loading, preview, subject, body }

  const load = useCallback(() => {
    api.get('/report-email-config')
      .then(r => {
        setCfg(r.data.data);
        setApproverRoles(r.data.approverRoles || []);
        setCadenceOptions(r.data.cadenceOptions || ['daily', 'weekly', 'monthly']);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report email settings'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = (body) => api.patch('/report-email-config', body)
    .then(r => { setCfg(r.data.data); return r.data.data; });

  const toggleReport = (key) => {
    patch({ [key]: { enabled: !cfg[key].enabled } })
      .then(() => toast.success(`${(REPORTS.concat(EXTRA_REPORTS)).find(r => r.key === key)?.label || key} ${cfg[key].enabled ? 'switched off' : 'switched on'}`))
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  const toggleReminder = () => {
    patch({ regularizationReminder: { enabled: !cfg.regularizationReminder.enabled } })
      .then(() => toast.success(`Regularization reminder ${cfg.regularizationReminder.enabled ? 'switched off' : 'switched on'}`))
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  const openEdit = (key) => {
    setEditing({ key, ...cfg[key] });
    const ids = cfg[key].employeeIds || [];
    if (!ids.length) { setEditingEmployees([]); return; }
    Promise.all(ids.map(id => api.get(`/employees/${id}`).then(r => r.data.data).catch(() => null)))
      .then(list => setEditingEmployees(list.filter(Boolean)));
  };

  const save = () => {
    setBusy(true);
    const { key, ...body } = editing;
    body.employeeIds = editingEmployees.map(e => e._id);
    patch({ [key]: body })
      .then(() => { toast.success('Saved'); setEditing(null); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const openRecipients = (key) => {
    setRecipientsPopup({ key, loading: true, data: null });
    api.get(`/report-email-config/${key}/recipients`)
      .then(r => setRecipientsPopup({ key, loading: false, data: r.data.data }))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load recipients'); setRecipientsPopup(null); });
  };

  const openContent = (key) => {
    setContentPopup({ key, loading: true, preview: null, subject: cfg[key].customSubject || '', body: cfg[key].customBody || '' });
    api.get(`/report-email-config/${key}/preview`)
      .then(r => setContentPopup(v => (v && v.key === key ? { ...v, loading: false, preview: r.data.data } : v)))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load a preview'); setContentPopup(null); });
  };

  const saveContent = () => {
    if (!contentPopup) return;
    setBusy(true);
    patch({ [contentPopup.key]: { customSubject: contentPopup.subject, customBody: contentPopup.body } })
      .then(() => { toast.success('Saved'); openContent(contentPopup.key); }) // reload the preview with the new wording
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  if (!cfg) return <Spinner />;

  const describeCount = (r) => {
    const parts = [];
    if (r.employeeIds?.length) parts.push(`${r.employeeIds.length} employee(s)`);
    if (r.recipients?.length) parts.push(`${r.recipients.length} address(es)`);
    if (r.roles?.length) parts.push(r.roles.map(k => ROLE_LABELS[k] || k).join(', '));
    return parts.join(' + ') || 'Nobody yet';
  };

  const label = (key) => (REPORTS.concat(EXTRA_REPORTS)).find(r => r.key === key)?.label;
  const hasNonWorkingToggle = (key) => key !== 'monthlyAttendance' && key !== 'payrollFeed' && key !== 'lopData';
  const isChoosableCadence = (key) => EXTRA_REPORTS.some(r => r.key === key);

  const renderRow = (r, isExtra) => (
    <tr key={r.key} className="border-t border-slate-100">
      <td className="px-4 py-3 text-slate-800 font-medium">{r.label}</td>
      <td className="px-4 py-3 text-slate-600">{isExtra ? (CADENCE_LABEL[cfg[r.key].cadence] || 'Weekly') : r.fixedCadence}</td>
      <td className="px-4 py-3 text-slate-500 text-[13px]">{r.covers}</td>
      <td className="px-4 py-3">
        <button onClick={() => openRecipients(r.key)} className="text-slate-600 hover:text-blue-600 hover:underline text-left">
          {describeCount(cfg[r.key])}
        </button>
      </td>
      <td className="px-4 py-3">
        <button onClick={() => openContent(r.key)} className="text-blue-600 hover:text-blue-500 text-[13.5px]">View</button>
      </td>
      <td className="px-4 py-3"><Toggle checked={cfg[r.key].enabled} onChange={() => toggleReport(r.key)} label="" /></td>
      <td className="px-4 py-3 text-right">
        <button onClick={() => openEdit(r.key)} className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
      </td>
    </tr>
  );

  const tableHead = (
    <thead className="bg-slate-50">
      <tr>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Report</th>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Cadence</th>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Content covers</th>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Recipients</th>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Email Content</th>
        <th className="text-left font-medium text-slate-600 px-4 py-2.5">Enabled</th>
        <th className="w-16" />
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4 pb-4">
      <Card title="Scheduled Reports" description="Which reports go out automatically, on what schedule, and to whom">
        <Note>
          Every report ships switched off. Turning one on here is the only way it ever starts sending — nothing
          fires on its own just because this screen exists. Click Recipients to see exactly who it resolves to right
          now, or Email Content to preview and edit the wording.
        </Note>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px]">
            {tableHead}
            <tbody>
              {REPORTS.map(r => renderRow(r, false))}
              <tr className="border-t border-slate-200 bg-slate-50/50">
                <td className="px-4 py-3 text-slate-800 font-medium">Regularization Pending Reminder</td>
                <td className="px-4 py-3 text-slate-600">Same day as Monthly</td>
                <td className="px-4 py-3 text-slate-500 text-[13px]">Each recipient's own pending approvals</td>
                <td className="px-4 py-3">
                  <button onClick={() => openRecipients('regularizationReminder')} className="text-slate-600 hover:text-blue-600 hover:underline text-left text-[13px]">
                    Team Incharge, Manager, HR Admin, Admin — whoever has something pending
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openContent('regularizationReminder')} className="text-blue-600 hover:text-blue-500 text-[13.5px]">View</button>
                </td>
                <td className="px-4 py-3"><Toggle checked={cfg.regularizationReminder.enabled} onChange={toggleReminder} label="" /></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit('regularizationReminder')} className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="More Reports" description="Existing reports elsewhere in NxtPeople, scheduled on a cadence you choose">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            {tableHead}
            <tbody>
              {EXTRA_REPORTS.map(r => renderRow(r, true))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Edit: recipients, roles, cadence, weekend/holiday override ── */}
      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">
                {editing.key === 'regularizationReminder' ? 'Regularization Pending Reminder' : label(editing.key)}
              </p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              {isChoosableCadence(editing.key) && (
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">How often</label>
                  <div className="flex gap-2">
                    {cadenceOptions.map(c => (
                      <button key={c} type="button" onClick={() => setEditing(v => ({ ...v, cadence: c }))}
                        className={`text-[13px] rounded-md px-3 py-1.5 border transition-colors ${
                          editing.cadence === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                        }`}>
                        {CADENCE_LABEL[c] || c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {editing.key !== 'regularizationReminder' && (
                <>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Recipient email addresses</label>
                    <textarea
                      rows={2}
                      value={(editing.recipients || []).join(', ')}
                      onChange={e => setEditing(v => ({ ...v, recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      placeholder="hr@company.com, admin@company.com"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                    <p className="text-[12.5px] text-slate-500 mt-1.5">Comma-separated. Sent as-is, no per-employee substitution.</p>
                  </div>

                  <div>
                    <p className="text-[13px] font-medium text-slate-700 mb-2">Also send to specific employees</p>
                    <EmployeeFilter value={editingEmployees} onChange={setEditingEmployees} multiple />
                    <p className="text-[12.5px] text-slate-500 mt-1.5">
                      Resolved by their current, real email at send time — someone who later exits is dropped automatically.
                    </p>
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
                  </div>
                </>
              )}

              {hasNonWorkingToggle(editing.key) && (
                <Check
                  checked={!!editing.includeNonWorkingDays}
                  onChange={v => setEditing(x => ({ ...x, includeNonWorkingDays: v }))}
                  label="Send on weekends and holidays too"
                  hint="Off by default — the usual rule is to skip a non-working day entirely."
                />
              )}

              <p className="text-[12.5px] text-slate-500">
                Subject and message wording are edited from the "Email Content" column, not here.
              </p>
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

      {/* ── Recipients: who this actually resolves to right now ── */}
      {recipientsPopup && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Recipients — {label(recipientsPopup.key) || 'Regularization Pending Reminder'}</p>
              <button onClick={() => setRecipientsPopup(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 overflow-y-auto">
              {recipientsPopup.loading ? <Spinner /> : (
                <>
                  {recipientsPopup.data?.structural && (
                    <Note>{recipientsPopup.data.note}</Note>
                  )}
                  {(recipientsPopup.data?.emails || []).length === 0 ? (
                    <p className="text-[13.5px] text-slate-500">Nobody configured yet.</p>
                  ) : (
                    <ul className="space-y-1.5 mt-2">
                      {recipientsPopup.data.emails.map(e => (
                        <li key={e} className="text-[13.5px] text-slate-700 bg-slate-50 rounded px-3 py-1.5">{e}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200">
              <button onClick={() => setRecipientsPopup(null)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Email Content: live preview, plus subject/message editing ── */}
      {contentPopup && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Email Content — {label(contentPopup.key) || 'Regularization Pending Reminder'}</p>
              <button onClick={() => setContentPopup(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Custom subject</label>
                <input
                  value={contentPopup.subject}
                  onChange={e => setContentPopup(v => ({ ...v, subject: e.target.value }))}
                  placeholder={`Default: "${contentPopup.preview?.subject || label(contentPopup.key)}"`}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Custom message</label>
                <textarea
                  rows={4}
                  value={contentPopup.body}
                  onChange={e => setContentPopup(v => ({ ...v, body: e.target.value }))}
                  placeholder="Leave blank to use the built-in wording shown in the preview below."
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <p className="text-[12.5px] text-slate-500 mt-1.5">
                  Plain text — no code or HTML needed. This replaces only the wording; the data in the preview below always stays live and correct.
                </p>
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">
                  Preview — what this would look like if sent today
                </p>
                {contentPopup.loading ? <Spinner /> : contentPopup.preview ? (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={contentPopup.preview.html}
                      className="w-full h-80 bg-white"
                    />
                  </div>
                ) : (
                  <p className="text-[13.5px] text-slate-500">Preview unavailable.</p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={saveContent} disabled={busy}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-5 py-2 rounded text-[14px] font-medium">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setContentPopup(null)}
                className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-5 py-2 rounded text-[14px] font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
