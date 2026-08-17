import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../../../utils/api';
import { Card, Check, Note, Toggle, selectClass, Spinner } from '../configKit';

// Email Alerts — when the scheduled mail goes out, to whom, and using which
// wording.
//
// These are not new. The check-in and check-out reminders have always been sent
// by cron at 09:00 and 18:00 to every active employee, with the wording inline
// in the mailer. This is the same two emails, with the time, the recipients and
// the template made editable.
//
// The event is fixed per alert and not offered as a field: each one is wired to
// code that knows how to gather its recipients, so a free-text event would let
// someone create an alert nothing ever fires.
export default function EmailAlerts({ service = 'attendance' }) {
  const [alerts, setAlerts] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/automation/alerts?service=${service}`)
      .then(r => setAlerts(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load alerts'); setAlerts([]); });
  }, [service]);

  useEffect(() => {
    load();
    api.get(`/automation/templates?service=${service}`).then(r => setTemplates(r.data.data || [])).catch(() => {});
    api.get('/org-setup/departments').then(r => setDepartments(r.data.data || [])).catch(() => {});
    api.get('/org-setup/locations').then(r => setLocations(r.data.data || [])).catch(() => {});
  }, [load, service]);

  const save = () => {
    setBusy(true);
    api.put(`/automation/alerts/${editing.id}`, editing)
      .then(() => { toast.success('Alert saved'); setEditing(null); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setBusy(false));
  };

  const toggleActive = alert => {
    api.put(`/automation/alerts/${alert.id}`, { ...alert, isActive: !alert.isActive })
      .then(() => { toast.success(`${alert.name} ${alert.isActive ? 'switched off' : 'switched on'}`); load(); })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'));
  };

  if (alerts === null) return <Spinner />;

  const rec = editing?.recipients || { allEmployees: true, departmentIds: [], locationIds: [] };
  const setRec = changes => setEditing(e => ({ ...e, recipients: { ...rec, ...changes } }));
  const toggleIn = (key, id) => {
    const list = rec[key] || [];
    setRec({ [key]: list.includes(id) ? list.filter(x => x !== id) : [...list, id] });
  };

  const describeRecipients = a => {
    const r = a.recipients || {};
    if (r.allEmployees !== false) return 'All employees';
    const parts = [];
    if (r.departmentIds?.length) parts.push(`${r.departmentIds.length} department(s)`);
    if (r.locationIds?.length) parts.push(`${r.locationIds.length} location(s)`);
    return parts.join(' + ') || 'Nobody';
  };

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Email Alerts"
        description="Scheduled mail this service sends, and who receives it"
      >
        <Note>
          Reminders are never sent on a non-working day — Sundays, company holidays and the 1st and 3rd
          Saturday are skipped automatically.
        </Note>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Name</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Sent at</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Recipients</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Template</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5">Status</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {alerts.map(a => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{a.name}</td>
                  <td className="px-4 py-3 text-slate-700">{a.sendAt || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{describeRecipients(a)}</td>
                  <td className="px-4 py-3 text-slate-600">{a.templateName || <span className="text-slate-400">Default wording</span>}</td>
                  <td className="px-4 py-3"><Toggle checked={a.isActive} onChange={() => toggleActive(a)} label="" /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing({ ...a })} className="text-[13.5px] text-blue-600 hover:text-blue-500">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <p className="text-[16px] font-semibold text-slate-800">Edit Email Alert</p>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  Alert name<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  value={editing.name || ''} onChange={e => setEditing(v => ({ ...v, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Send at</label>
                <input type="time" value={editing.sendAt || '09:00'}
                  onChange={e => setEditing(v => ({ ...v, sendAt: e.target.value }))} className={selectClass} />
                <p className="text-[12.5px] text-slate-500 mt-1.5">Asia/Kolkata, on working days only.</p>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Template</label>
                <select
                  value={editing.templateId || ''}
                  onChange={e => setEditing(v => ({ ...v, templateId: e.target.value || null }))}
                  className={`${selectClass} w-full`}
                >
                  <option value="">Default wording</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <p className="text-[13px] font-medium text-slate-700 mb-2">Recipients</p>
                <Check
                  checked={rec.allEmployees !== false}
                  onChange={v => setRec({ allEmployees: v })}
                  label="All employees"
                />
                {rec.allEmployees === false && (
                  <div className="mt-3 space-y-4 ml-6">
                    <div>
                      <p className="text-[13px] text-slate-600 mb-2">Departments</p>
                      <div className="flex flex-wrap gap-1.5">
                        {departments.map(d => (
                          <button
                            key={d.id} type="button" onClick={() => toggleIn('departmentIds', d.id)}
                            className={`text-[12.5px] rounded-full px-2.5 py-1 border transition-colors ${
                              (rec.departmentIds || []).includes(d.id)
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                            }`}
                          >
                            {d.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[13px] text-slate-600 mb-2">Locations</p>
                      <div className="flex flex-wrap gap-1.5">
                        {locations.map(l => (
                          <button
                            key={l.id} type="button" onClick={() => toggleIn('locationIds', l.id)}
                            className={`text-[12.5px] rounded-full px-2.5 py-1 border transition-colors ${
                              (rec.locationIds || []).includes(l.id)
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                            }`}
                          >
                            {l.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[12.5px] text-slate-500">
                      Anyone in a chosen department <em>or</em> a chosen location receives it.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              <button onClick={save} disabled={busy || !String(editing.name || '').trim()}
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
