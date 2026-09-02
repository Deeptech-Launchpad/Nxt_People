import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../../utils/api';

/* Edit Employee, over the list.
 *
 * Editing used to mean leaving for another page — and from User-specific
 * Operations it was a dead end that told you to go somewhere else entirely.
 * The reference edits in place, so this does.
 *
 * Department, Location, Designation and Employment Type carry the reference's
 * `+` for adding a value you do not have yet, because otherwise correcting one
 * person means abandoning the form, going to Settings, and starting again.
 * Only the three that are real lookup tables get it; Employment Type is free
 * text on our schema, so it is a plain input rather than a select that pretends
 * to be constrained.
 */
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] focus:outline-none focus:border-brand-400';
const label = 'block text-[13.5px] font-medium text-slate-600 mb-1.5';

const Section = ({ title, children }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5">
    <h3 className="text-[16px] font-semibold text-slate-800 pb-3 mb-4 border-b border-slate-100">{title}</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">{children}</div>
  </div>
);

/* A select backed by a lookup table, with the reference's inline add. */
function LookupSelect({ value, onChange, options, resource, onAdded, placeholder }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post(`/org-setup/${resource}`, { name: name.trim() });
      toast.success('Added');
      setName(''); setAdding(false);
      await onAdded(name.trim());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add that');
    } finally { setBusy(false); }
  };

  if (adding) {
    return (
      <div className="flex gap-2">
        <input className={input} value={name} autoFocus placeholder="New value"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} />
        <button onClick={add} disabled={busy}
          className="px-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-lg text-[14px]">
          Add
        </button>
        <button onClick={() => setAdding(false)}
          className="px-3 border border-slate-200 text-slate-600 rounded-lg text-[14px] hover:bg-slate-50">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select className={input} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder || 'Select'}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button onClick={() => setAdding(true)} title="Add a new one"
        className="w-9 h-[38px] flex-shrink-0 flex items-center justify-center border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">
        <Plus size={15} />
      </button>
    </div>
  );
}

/* Work experience and Dependents are rows in their own tables, with their own
 * add/edit/delete permissions, so they are not part of the employee payload and
 * cannot ride along on Submit. Each row saves on its own OK — which is stated
 * on the card, because a row that looked queued and then vanished when somebody
 * pressed Cancel would be the worst of both. */
function ChildRows({ title, employeeId, path, fields, addLabel }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = () => api.get(`/employee-records/${employeeId}/${path}`)
    .then(r => { setRows(r.data.data || []); setDenied(false); })
    .catch(err => { if (err.response?.status === 403) setDenied(true); });

  useEffect(() => { load(); }, [employeeId]);

  const blank = () => Object.fromEntries(fields.map(f => [f.key, f.type === 'check' ? false : '']));

  const editRow = (row) => {
    const d = { _id: row._id };
    for (const f of fields) {
      d[f.key] = f.type === 'check' ? !!row[f.key]
        : f.type === 'date' ? String(row[f.key] || '').slice(0, 10)
        : (row[f.key] ?? '');
    }
    setDraft(d);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (draft._id) await api.put(`/employee-records/${employeeId}/${path}/${draft._id}`, draft);
      else await api.post(`/employee-records/${employeeId}/${path}`, draft);
      toast.success('Saved');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that row');
    } finally { setBusy(false); }
  };

  const remove = async (row) => {
    const what = row[fields[0].key] || 'this row';
    if (!window.confirm(`Remove ${what}? This deletes the row straight away.`)) return;
    try {
      await api.delete(`/employee-records/${employeeId}/${path}/${row._id}`);
      toast.success('Removed');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove that row');
    }
  };

  if (denied) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
        <h3 className="text-[16px] font-semibold text-slate-800">{title}</h3>
        <button onClick={() => setDraft(blank())}
          className="flex items-center gap-1.5 text-[13.5px] text-brand-600 hover:text-brand-500">
          <Plus size={15} /> {addLabel || 'Add'}
        </button>
      </div>

      {rows.length === 0 && !draft ? (
        <p className="text-[14px] text-slate-400">No rows yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row._id}
              className="flex items-center gap-3 border border-slate-100 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0 text-[14px] text-slate-700 truncate">
                {fields.filter(f => f.type !== 'textarea').map(f => {
                  const v = f.type === 'check' ? (row[f.key] ? 'Yes' : 'No')
                    : f.type === 'date' ? (row[f.key]
                        ? new Date(String(row[f.key]).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '')
                    : row[f.key];
                  return v ? (
                    <span key={f.key} className="mr-3">
                      <span className="text-slate-400">{f.label}: </span>{v}
                    </span>
                  ) : null;
                })}
              </div>
              <button onClick={() => editRow(row)} title="Edit"
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                <Pencil size={14} />
              </button>
              <button onClick={() => remove(row)} title="Remove"
                className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="mt-3 border border-brand-200 bg-brand-50/40 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {fields.map(f => (
              <div key={f.key} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
                {f.type === 'check' ? (
                  <label className="flex items-center gap-2 cursor-pointer mt-6">
                    <input type="checkbox" checked={!!draft[f.key]}
                      onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.checked }))}
                      className="w-4 h-4 rounded border-slate-300 accent-brand-600" />
                    <span className="text-[14px] text-slate-700">{f.label}</span>
                  </label>
                ) : (
                  <>
                    <label className={label}>
                      {f.label}{f.required && <span className="text-rose-500"> *</span>}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea className={`${input} h-20 resize-none`} value={draft[f.key] || ''}
                        onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} />
                    ) : (
                      <input type={f.type === 'date' ? 'date' : 'text'} className={input}
                        value={draft[f.key] || ''}
                        onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={busy}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[14px]">
              {busy ? 'Saving…' : 'OK'}
            </button>
            <button onClick={() => setDraft(null)}
              className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[14px] hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeeEditModal({ employeeId, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ departments: [], designations: [], locations: [] });
  const [people, setPeople] = useState([]);

  const loadMeta = async () => {
    const [d, g, l] = await Promise.all([
      api.get('/org-setup/departments').catch(() => ({ data: { data: [] } })),
      api.get('/org-setup/designations').catch(() => ({ data: { data: [] } })),
      api.get('/org-setup/locations').catch(() => ({ data: { data: [] } })),
    ]);
    setMeta({
      departments: (d.data.data || []).map(x => x.name),
      designations: (g.data.data || []).map(x => x.name),
      locations: (l.data.data || []).map(x => x.name),
    });
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/employees/${employeeId}`),
      loadMeta(),
      api.get('/employees?limit=200').catch(() => ({ data: { data: [] } })),
    ])
      .then(([r, , p]) => {
        const e = r.data.data;
        setPeople(p.data.data || []);
        setForm({
          employeeId: e.employeeId || '', firstName: e.firstName || '', lastName: e.lastName || '',
          nickName: e.nickName || '', email: e.email || '', personalEmail: e.personalEmail || '',
          department: e.department || '', designation: e.designation || '',
          workLocation: e.workLocation || '', employmentType: e.employmentType || '',
          status: e.status || 'active', sourceOfHire: e.sourceOfHire || '',
          joiningDate: (e.dateOfJoining || e.joiningDate || '').toString().slice(0, 10),
          totalExperience: e.totalExperience || '',
          reportingManagerId: e.reportingManagerId || '', secondaryManagerId: e.secondaryManagerId || '',
          approvingAuthorityId: e.approvingAuthorityId || '',
          dateOfBirth: (e.dateOfBirth || '').toString().slice(0, 10),
          gender: e.gender || '', maritalStatus: e.maritalStatus || '',
          bloodGroup: e.bloodGroup || '', nationality: e.nationality || '',
          aboutMe: e.aboutMe || '', expertise: e.expertise || '',
          workPhone: e.workPhone || '', extension: e.extension || '', phone: e.phone || '',
          seatingLocation: e.seatingLocation || '', tags: e.tags || '',
          address: e.currentAddress || e.address || '', permanentAddress: e.permanentAddress || '',
          exitDate: (e.exitDate || '').toString().slice(0, 10),
          onboardingStatus: e.onboardingStatus || '',
        });
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not open that record'))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.firstName.trim()) return toast.error('First Name is required');
    if (!form.lastName.trim()) return toast.error('Last Name is required');
    setSaving(true);
    try {
      await api.put(`/employees/${employeeId}`, form);
      toast.success('Employee updated');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save those changes');
    } finally { setSaving(false); }
  };

  const nameOf = p => `${p.firstName || ''} ${p.lastName || ''} ${p.employeeId || ''}`.trim();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-slate-50 rounded-2xl w-full max-w-5xl shadow-2xl my-4 flex flex-col max-h-[94vh]">
        <div className="flex items-center justify-between px-6 py-4 bg-white rounded-t-2xl border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">Edit Employee</h3>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading || !form ? (
            <div className="flex justify-center py-24">
              <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <Section title="Basic information">
                <div>
                  <label className={label}>Employee ID <span className="text-rose-500">*</span></label>
                  <input className={input} value={form.employeeId} onChange={e => set('employeeId', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Nick name</label>
                  <input className={input} value={form.nickName} onChange={e => set('nickName', e.target.value)} />
                </div>
                <div>
                  <label className={label}>First Name <span className="text-rose-500">*</span></label>
                  <input className={input} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Email address</label>
                  <input className={input} value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Last Name <span className="text-rose-500">*</span></label>
                  <input className={input} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Personal Email Address</label>
                  <input className={input} value={form.personalEmail} onChange={e => set('personalEmail', e.target.value)} />
                </div>
              </Section>

              <Section title="Work Information">
                <div>
                  <label className={label}>Department</label>
                  <LookupSelect value={form.department} onChange={v => set('department', v)}
                    options={meta.departments} resource="departments"
                    onAdded={async (n) => { await loadMeta(); set('department', n); }} />
                </div>
                <div>
                  <label className={label}>Employee Status</label>
                  <select className={input} value={form.status} onChange={e => set('status', e.target.value)}>
                    {['active', 'inactive', 'notice_period', 'resigned', 'terminated'].map(x =>
                      <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Location</label>
                  <LookupSelect value={form.workLocation} onChange={v => set('workLocation', v)}
                    options={meta.locations} resource="locations"
                    onAdded={async (n) => { await loadMeta(); set('workLocation', n); }} />
                </div>
                <div>
                  <label className={label}>Employment Type</label>
                  {/* Free text on our schema, so no select pretending otherwise. */}
                  <input className={input} value={form.employmentType}
                    placeholder="e.g. Permanent, Trainee"
                    onChange={e => set('employmentType', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Designation</label>
                  <LookupSelect value={form.designation} onChange={v => set('designation', v)}
                    options={meta.designations} resource="designations"
                    onAdded={async (n) => { await loadMeta(); set('designation', n); }} />
                </div>
                <div>
                  <label className={label}>Source of Hire</label>
                  <input className={input} value={form.sourceOfHire} onChange={e => set('sourceOfHire', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Date of Joining</label>
                  <input type="date" className={input} value={form.joiningDate} onChange={e => set('joiningDate', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Total Experience</label>
                  <input className={input} value={form.totalExperience} onChange={e => set('totalExperience', e.target.value)} />
                </div>
              </Section>

              <Section title="Hierarchy Information">
                <div>
                  <label className={label}>Reporting Manager</label>
                  <select className={input} value={form.reportingManagerId}
                    onChange={e => set('reportingManagerId', e.target.value)}>
                    <option value="">Select</option>
                    {people.map(p => <option key={p._id} value={p._id}>{nameOf(p)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Secondary Reporting Manager</label>
                  <select className={input} value={form.secondaryManagerId}
                    onChange={e => set('secondaryManagerId', e.target.value)}>
                    <option value="">Select</option>
                    {people.map(p => <option key={p._id} value={p._id}>{nameOf(p)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Approving Authority</label>
                  <select className={input} value={form.approvingAuthorityId}
                    onChange={e => set('approvingAuthorityId', e.target.value)}>
                    <option value="">Select</option>
                    {people.map(p => <option key={p._id} value={p._id}>{nameOf(p)}</option>)}
                  </select>
                </div>
              </Section>

              <Section title="Personal Details">
                <div>
                  <label className={label}>Date of Birth</label>
                  <input type="date" className={input} value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Ask me about/Expertise</label>
                  <input className={input} value={form.expertise} onChange={e => set('expertise', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Gender</label>
                  <select className={input} value={form.gender} onChange={e => set('gender', e.target.value)}>
                    <option value="">Select</option>
                    {['Male', 'Female', 'Other'].map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Marital Status</label>
                  <select className={input} value={form.maritalStatus} onChange={e => set('maritalStatus', e.target.value)}>
                    <option value="">Select</option>
                    {['Single', 'Married', 'Divorced', 'Widowed'].map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Blood Group</label>
                  <input className={input} value={form.bloodGroup} onChange={e => set('bloodGroup', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Nationality</label>
                  <input className={input} value={form.nationality} onChange={e => set('nationality', e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>About Me</label>
                  <textarea className={`${input} h-20 resize-none`} value={form.aboutMe}
                    onChange={e => set('aboutMe', e.target.value)} />
                </div>
              </Section>

              <Section title="Contact Details">
                <div>
                  <label className={label}>Work Phone Number</label>
                  <input className={input} value={form.workPhone} onChange={e => set('workPhone', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Personal Mobile Number</label>
                  <input className={input} value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Extension</label>
                  <input className={input} value={form.extension} onChange={e => set('extension', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Seating Location</label>
                  <input className={input} value={form.seatingLocation} onChange={e => set('seatingLocation', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Tags</label>
                  <input className={input} value={form.tags} onChange={e => set('tags', e.target.value)} />
                </div>
                <div />
                <div className="md:col-span-2">
                  <label className={label}>Present Address</label>
                  <textarea className={`${input} h-20 resize-none`} value={form.address}
                    onChange={e => set('address', e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>Permanent Address</label>
                  <textarea className={`${input} h-20 resize-none`} value={form.permanentAddress}
                    onChange={e => set('permanentAddress', e.target.value)} />
                </div>
              </Section>

              <Section title="Separation Information">
                <div>
                  <label className={label}>Date of Exit</label>
                  <input type="date" className={input} value={form.exitDate} onChange={e => set('exitDate', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Onboarding Status</label>
                  <input className={input} value={form.onboardingStatus}
                    onChange={e => set('onboardingStatus', e.target.value)} />
                </div>
              </Section>

              <ChildRows
                title="Work experience" employeeId={employeeId} path="experience"
                addLabel="Add experience"
                fields={[
                  { key: 'companyName', label: 'Company name', type: 'text', required: true },
                  { key: 'jobTitle', label: 'Job Title', type: 'text' },
                  { key: 'fromDate', label: 'From Date', type: 'date' },
                  { key: 'toDate', label: 'To Date', type: 'date' },
                  { key: 'relevant', label: 'Relevant', type: 'check' },
                  { key: 'jobDescription', label: 'Job Description', type: 'textarea' },
                ]} />

              <ChildRows
                title="Dependent Details" employeeId={employeeId} path="dependents"
                addLabel="Add dependent"
                fields={[
                  { key: 'name', label: 'Name', type: 'text', required: true },
                  { key: 'relationship', label: 'Relationship', type: 'text' },
                  { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' },
                ]} />

              <p className="text-[13.5px] text-slate-500 px-1">
                Work experience and Dependent rows save when you press OK on the row, not with
                Submit — they are separate records with their own permissions. Cancel below leaves
                them as they are.
              </p>

              {/* Identity numbers are deliberately absent. Editing them belongs
                  behind the audited reveal, not in a form that would show every
                  admin a PAN just because they opened Edit. */}
              <p className="text-[13.5px] text-slate-500 px-1">
                Aadhaar, PAN and UAN are not editable here — they sit behind the audited reveal so
                opening this form does not put them on screen.
              </p>
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 bg-white rounded-b-2xl border-t border-slate-100">
          <button onClick={save} disabled={saving || loading}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {saving ? 'Saving…' : 'Submit'}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
