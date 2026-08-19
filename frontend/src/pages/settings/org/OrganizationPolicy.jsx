import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Note, NotWired, Spinner, selectClass } from '../configKit';

// Organization Setup → Organization Policy.
//
// The reference saves this page in two halves — one Save on Alert & Chat
// covering everything down to Cover image preference, another on Locale &
// Display format. That is not cosmetic: the locale settings change how every
// date and name in the product reads, and being able to save them without also
// committing half-finished permission changes is the point.
//
// So each half posts only its own keys and the route merges, rather than
// replacing the whole blob and blanking whatever was not on screen.
//
// Notifications, Chat and the whole Locale half do real work. The rest is
// stored and says so: employee-controlled visibility of a birthday, a profile
// picture approval flow and a My Space cover image are features this product
// does not have yet, and the switch is what they will read when it does.

const NAME_FORMATS = [
  ['first_name', 'First name'],
  ['first_last', 'First name Last name'],
  ['last_first', 'Last name First name'],
  ['employee_id_first', 'Employee ID - First name'],
];
const DATE_FORMATS = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MMM-yyyy'];
const PICTURE_ACTORS = [
  ['employee', 'Employee'],
  ['admin', 'Administrator'],
  ['employee_and_admin', 'Employee and administrator'],
];
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Singapore', 'United Arab Emirates', 'Australia'];

function Card({ title, description, actions, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
          {description && <p className="text-[13.5px] text-slate-500 mt-1.5">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, title, hint }) {
  return (
    <div className="flex items-start gap-3.5 py-2">
      <button
        onClick={() => onChange(!on)} role="switch" aria-checked={!!on} aria-label={title}
        className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 mt-0.5 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <div className="min-w-0">
        <p className="text-[14.5px] text-slate-800">{title}</p>
        {hint && <p className="text-[13.5px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

const SaveReset = ({ dirty, saving, onSave, onReset }) => (
  <div className="flex items-center gap-2 flex-shrink-0">
    <button onClick={onSave} disabled={!dirty || saving}
      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-[13.5px] font-medium">
      {saving ? 'Saving…' : 'Save'}
    </button>
    <button onClick={onReset} disabled={!dirty || saving}
      className="border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 px-4 py-1.5 rounded text-[13.5px] font-medium">
      Reset
    </button>
  </div>
);

export default function OrganizationPolicy() {
  const [saved, setSaved] = useState(null);   // last known server state
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingHalf, setSavingHalf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/org-details/policy')
      .then(r => { if (!cancelled) { setSaved(r.data.data || {}); setDraft(r.data.data || {}); } })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load organization policy'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || !draft) return <Spinner />;

  const group = (key, changes) => setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), ...changes } }));
  const same = keys => keys.every(k => JSON.stringify(draft[k]) === JSON.stringify(saved[k]));

  // Each half sends only the keys it owns, so saving one cannot discard edits
  // in progress on the other.
  const saveHalf = (half, keys) => {
    setSavingHalf(half);
    const patch = {};
    keys.forEach(k => { patch[k] = draft[k]; });
    api.patch('/org-details/policy', patch)
      .then(r => {
        setSaved(r.data.data);
        setDraft(d => { const next = { ...d }; keys.forEach(k => { next[k] = r.data.data[k]; }); return next; });
        toast.success('Saved');
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not save'))
      .finally(() => setSavingHalf(null));
  };

  const resetHalf = keys =>
    setDraft(d => { const next = { ...d }; keys.forEach(k => { next[k] = saved[k]; }); return next; });

  const TOP = ['alertAndChat', 'personalInformation', 'employeeSearch', 'profilePicture', 'coverImage'];
  const LOCALE = ['locale', 'recycleBin'];

  const alert = draft.alertAndChat || {};
  const personal = draft.personalInformation || {};
  const search = draft.employeeSearch || {};
  const picture = draft.profilePicture || {};
  const cover = draft.coverImage || {};
  const locale = draft.locale || {};
  const bin = draft.recycleBin || {};

  return (
    <div className="space-y-4 pb-4">
      <Card
        title="Alert & Chat"
        actions={
          <SaveReset dirty={!same(TOP)} saving={savingHalf === 'top'}
            onSave={() => saveHalf('top', TOP)} onReset={() => resetHalf(TOP)} />
        }
      >
        <Switch on={alert.notifications} onChange={v => group('alertAndChat', { notifications: v })}
          title="Notifications" hint="Disabling notifications will stop all email communications" />
        <Switch on={alert.chat} onChange={v => group('alertAndChat', { chat: v })}
          title="Chat" hint="Specify if you want the chat bar or not" />
      </Card>

      <Card
        title="Employee personal information"
        description="Define permissions to give employees the option to share or hide certain personal information in the dashboard with others in the organization."
        
      >
        <Switch on={personal.birthday} onChange={v => group('personalInformation', { birthday: v })}
          title="Birthday" hint="Enable to give employees the choice to share or hide their birth day." />
        <Switch on={personal.workAnniversary} onChange={v => group('personalInformation', { workAnniversary: v })}
          title="Work Anniversary" hint="Enable to give employees the choice to share or hide their work anniversary day." />
        <Switch on={personal.mobileNumber} onChange={v => group('personalInformation', { mobileNumber: v })}
          title="Mobile number" hint="Give employee the choice to share or hide their mobile number" />
      </Card>

      <Card title="Employee search">
        <Switch on={search.byMobileNumber} onChange={v => group('employeeSearch', { byMobileNumber: v })}
          title="Allow employee information to be searched using mobile number" />
      </Card>

      <Card
        title="Profile picture update"
        description="Define who can add or update an employee's profile picture."
        
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[13.5px] text-slate-700 mb-1.5">Profile picture can be updated by</label>
            <select value={picture.updatableBy || ''} onChange={e => group('profilePicture', { updatableBy: e.target.value || null })}
              className={`${selectClass} w-full max-w-[280px]`}>
              <option value="">Select</option>
              {PICTURE_ACTORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <Switch on={picture.mandateApproval} onChange={v => group('profilePicture', { mandateApproval: v })}
            title="Mandate approval for profile picture changes" />
          {picture.mandateApproval && (
            <div className="ml-14">
              <select value={picture.approver || ''} onChange={e => group('profilePicture', { approver: e.target.value || null })}
                className={`${selectClass} w-full max-w-[280px]`}>
                <option value="">Select</option>
                <option value="reporting_manager">Reporting manager</option>
                <option value="hr_admin">HR</option>
              </select>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Cover image preference"
        description="By default, the organization cover image set by the administrator is used as the My Space cover image for employees. Enable the options below to allow employees to choose a separate cover image for their My Space page."
        actions={<NotWired>No cover image upload exists yet, so there is nothing to govern</NotWired>}
      >
        <Switch on={cover.allowSystemOptions} onChange={v => group('coverImage', { allowSystemOptions: v })}
          title="Allow employees to choose a cover image for My Space from the system-provided options." />
        <Switch on={cover.allowCustomUpload} onChange={v => group('coverImage', { allowCustomUpload: v })}
          title="Allow employees to upload a custom My Space cover image." />
      </Card>

      <Card
        title="Locale & Display format"
        actions={
          <SaveReset dirty={!same(LOCALE)} saving={savingHalf === 'locale'}
            onSave={() => saveHalf('locale', LOCALE)} onReset={() => resetHalf(LOCALE)} />
        }
      >
        <div className="space-y-5">
          <div>
            <p className="text-[14px] text-slate-800">Country/Region</p>
            <p className="text-[13.5px] text-slate-500 mt-0.5 mb-2">Select the country from which your organization primarily operates</p>
            <select value={locale.country || 'India'} onChange={e => group('locale', { country: e.target.value })}
              className={`${selectClass} w-full max-w-[340px]`}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <p className="text-[14px] text-slate-800">Time zone</p>
            <p className="text-[13.5px] text-slate-500 mt-0.5 mb-2">Choose the time zone to be applied for your organization</p>
            <select value="Asia/Kolkata" disabled className={`${selectClass} w-full max-w-[340px]`}>
              <option value="Asia/Kolkata">India Standard Time (Asia/Kolkata)</option>
            </select>
            <Note>
              This deployment is India-only. Attendance, payroll and every cron job assume Asia/Kolkata,
              so the zone is not safe to change on its own.
            </Note>
          </div>

          <div>
            <p className="text-[14px] text-slate-800">Time</p>
            <p className="text-[13.5px] text-slate-500 mt-0.5 mb-2">Define if time must be shown in the 12 or 24 hour format in the account</p>
            <div className="flex items-center gap-6">
              {[['12', '12 - Hour(s)'], ['24', '24 - Hour(s)']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="timeFormat" checked={String(locale.timeFormat || '12') === k}
                    onChange={() => group('locale', { timeFormat: k })} className="w-4 h-4 accent-blue-600" />
                  <span className="text-[14px] text-slate-700">{l}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[14px] text-slate-800">Name</p>
            <p className="text-[13.5px] text-slate-500 mt-0.5 mb-2">Select how an employee&rsquo;s name must be shown in the account</p>
            <select value={locale.nameFormat || 'first_name'} onChange={e => group('locale', { nameFormat: e.target.value })}
              className={`${selectClass} w-full max-w-[340px]`}>
              {NAME_FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          <div>
            <p className="text-[14px] text-slate-800">Date</p>
            <p className="text-[13.5px] text-slate-500 mt-0.5 mb-2">Pick how dates must be displayed in the account</p>
            <select value={locale.dateFormat || 'dd/MM/yyyy'} onChange={e => group('locale', { dateFormat: e.target.value })}
              className={`${selectClass} w-full max-w-[340px]`}>
              {DATE_FORMATS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card
        title="Recycle bin preference"
        description="Specify how long deleted data is retained before permanent removal."
        
      >
        <label className="block text-[14px] text-slate-800 mb-2">Set the duration (in months) for record retention</label>
        <input
          type="number" min={1} max={120}
          value={bin.retentionMonths ?? 1}
          onChange={e => group('recycleBin', { retentionMonths: Number(e.target.value) })}
          className="w-[110px] border border-slate-300 rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <p className="text-[13px] text-slate-500 mt-2 max-w-[560px]">
          Deleting somebody already keeps their record — this is how long that lasts before a purge
          removes it. Nothing purges today, so nothing is lost either way.
        </p>
      </Card>
    </div>
  );
}
