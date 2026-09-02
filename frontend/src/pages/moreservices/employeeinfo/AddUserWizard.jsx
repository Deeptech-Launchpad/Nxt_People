import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Mail, Check, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';

/* Add User(s).
 *
 * The reference runs a four-step wizard — Selection, Create User Account, Edit
 * User Data, Alerts — where step 1 chooses a source (Invitation, Zoho Mail,
 * Google Workspace, Microsoft 365) and step 2's Create SENDS AN INVITATION
 * EMAIL immediately.
 *
 * Ours deliberately does not. Creating the record and emailing the person are
 * separated: Create writes the employee, and sending the preboarding invite is
 * a second, explicit press with its recipient shown first. Nothing in this
 * module emails anybody as a side effect of saving — on the live server there
 * is no allowlist standing between a send and a real inbox.
 *
 * Directory sources (Google Workspace / Microsoft 365) are shown because they
 * are the reference's shape, and marked as not built rather than omitted, so
 * the screen does not imply a capability we do not have.
 */
const STEPS = ['Selection', 'Create User Account', 'Send Invite'];

const SOURCES = [
  { id: 'invitation', label: 'Invitation', icon: <Mail size={20} />,
    blurb: 'Create the employee record now. You can send them a preboarding invite afterwards.' },
  { id: 'google', label: 'Google Workspace', icon: <span className="font-bold text-[15px]">G</span>,
    blurb: 'Import users from Google Workspace.', disabled: true },
  { id: 'microsoft', label: 'Microsoft 365', icon: <span className="font-bold text-[15px]">M</span>,
    blurb: 'Import users from Microsoft 365.', disabled: true },
];

const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';
const label = 'block text-[14px] font-medium text-slate-600 mb-1.5';

export default function AddUserWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('invitation');
  const [form, setForm] = useState({ employeeId: '', firstName: '', lastName: '', email: '' });
  const [lastId, setLastId] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  /* The reference hints the LAST id used; ours computes the NEXT free one,
   * which is the more useful half of the same fact — so the hint says what it
   * actually is rather than mislabelling it. */
  useEffect(() => {
    api.get('/employees/next-id')
      .then(r => setLastId(r.data?.data?.suggested || ''))
      .catch(() => {});
  }, []);

  const generate = async () => {
    try {
      const r = await api.get('/employees/next-id');
      const next = r.data?.data?.suggested;
      if (next) setForm(f => ({ ...f, employeeId: next }));
      else toast.error('Could not generate an ID');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not generate an ID');
    }
  };

  const create = async () => {
    if (!form.employeeId.trim()) return toast.error('Employee ID is required');
    if (!form.firstName.trim()) return toast.error('First Name is required');
    if (!form.lastName.trim()) return toast.error('Last Name is required');
    if (!form.email.trim()) return toast.error('Email address is required');
    setSaving(true);
    try {
      const r = await api.post('/employees', {
        employeeId: form.employeeId.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
      });
      setCreated({ ...form, _id: r.data?.data?._id });
      toast.success('Employee record created. No email has been sent.');
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not create that employee');
    } finally { setSaving(false); }
  };

  const sendInvite = async () => {
    setSending(true);
    try {
      await api.post('/employees/send-onboarding', {
        email: created.email,
        candidateName: `${created.firstName} ${created.lastName}`.trim(),
      });
      setSent(true);
      toast.success(`Preboarding invite sent to ${created.email}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send that invite');
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Add User(s)</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 px-6 py-5 border-b border-slate-50">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-medium
                  ${i < step ? 'bg-emerald-500 text-white'
                    : i === step ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {i < step ? <Check size={15} /> : i + 1}
                </div>
                <span className={`text-[13px] ${i === step ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className="w-16 h-px bg-slate-200 mb-5" />}
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="space-y-3">
              {SOURCES.map(s => (
                <button key={s.id} disabled={s.disabled}
                  title={s.disabled ? 'Not built yet' : undefined}
                  onClick={() => setSource(s.id)}
                  className={`w-full flex items-start gap-4 text-left border rounded-xl px-4 py-4 transition-colors
                    ${s.disabled ? 'border-slate-100 opacity-50 cursor-not-allowed'
                      : source === s.id ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 flex-shrink-0">
                    {s.icon}
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium text-slate-800">{s.label}</span>
                    <span className="block text-[14px] text-slate-500 mt-0.5">
                      {s.blurb}{s.disabled ? ' Not built yet.' : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 max-w-xl">
              {/* The opposite of the reference's banner, and deliberately so. */}
              <p className="text-[14px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
                Creating the record does <strong>not</strong> email anyone. You will get the chance to
                send the preboarding invite on the next step, and it only goes when you press it.
              </p>
              <div>
                <label className={label}>Employee ID <span className="text-rose-500">*</span></label>
                <div className="flex gap-2">
                  <input className={input} value={form.employeeId}
                    onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} />
                  <button onClick={generate}
                    className="px-4 border border-slate-200 rounded-xl text-[14px] text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                    Generate
                  </button>
                </div>
                {lastId && <p className="text-[13px] text-slate-400 mt-1">Next available ID {lastId}</p>}
              </div>
              <div>
                <label className={label}>First Name <span className="text-rose-500">*</span></label>
                <input className={input} value={form.firstName}
                  onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Last Name <span className="text-rose-500">*</span></label>
                <input className={input} value={form.lastName}
                  onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
              </div>
              <div>
                <label className={label}>Email address <span className="text-rose-500">*</span></label>
                <input className={input} type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
          )}

          {step === 2 && created && (
            <div className="max-w-xl space-y-4">
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3.5">
                <Check size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                <p className="text-[14px] text-emerald-800">
                  <strong>{created.firstName} {created.lastName}</strong> has been created
                  as {created.employeeId}. Nobody has been emailed.
                </p>
              </div>

              <div className="border border-slate-200 rounded-xl p-4">
                <p className="text-[15px] font-medium text-slate-800">Send the preboarding invite?</p>
                <p className="text-[14px] text-slate-500 mt-1">
                  This emails a registration link so they can fill in their own details.
                </p>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 mt-3">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[13.5px] text-amber-800">
                    This sends a real email to <strong>{created.email}</strong>. It is the only
                    thing on this screen that contacts anybody.
                  </p>
                </div>
                <button onClick={sendInvite} disabled={sending || sent}
                  className={`mt-3 px-5 py-2.5 rounded-xl text-[15px] font-medium
                    ${sent ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                      : 'bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50'}`}>
                  {sent ? 'Invite sent' : sending ? 'Sending…' : `Send invite to ${created.email}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button onClick={step === 0 ? onClose : () => setStep(s => s - 1)}
            disabled={step === 2}
            className="text-[15px] text-slate-500 hover:text-slate-700 disabled:opacity-0">
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step === 0 && (
            <button onClick={() => setStep(1)}
              className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              Next
            </button>
          )}
          {step === 1 && (
            <button onClick={create} disabled={saving}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              {saving ? 'Creating…' : 'Create'}
            </button>
          )}
          {step === 2 && (
            <button onClick={onCreated}
              className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
