import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Pencil, Eye, EyeOff, Loader2 } from 'lucide-react';
import api from '../../../utils/api';
import EmployeeDocuments from './EmployeeDocuments';
import EmployeeActivity from './EmployeeActivity';

/* The full employee record, over the list.
 *
 * Clicking a row used to navigate to User-specific Operations, which threw away
 * where you were and made "glance at somebody" a page change. The reference
 * opens the whole record in place and closes back to the same scroll position,
 * so this does too. The pencil switches the same modal into edit without a
 * second navigation.
 *
 * Identity numbers are dotted with an eye per field, and revealing goes through
 * the audited endpoint — the values are not in this payload until asked for.
 */
const fmtDate = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : null);
const fmtWhen = d => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);

/* Age from a date of birth, in the reference's "22 year(s) 5 month(s)" shape.
 * Computed rather than stored: an age column is wrong the day after it is
 * written. */
function ageOf(dob) {
  if (!dob) return null;
  const b = new Date(String(dob).slice(0, 10));
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  let months = now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return `${years} year(s) ${months} month(s)`;
}

const Row = ({ label, value, action }) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
    <span className="text-[14px] text-slate-500 flex-shrink-0">{label}</span>
    <span className="text-[15px] text-slate-800 text-right break-words min-w-0 flex items-center gap-1.5">
      {value === null || value === undefined || value === ''
        ? <span className="text-slate-300">—</span> : value}
      {action}
    </span>
  </div>
);

const Section = ({ title, children }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5">
    <h3 className="text-[16px] font-semibold text-slate-800 pb-3 mb-3 border-b border-slate-100">{title}</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">{children}</div>
  </div>
);

function ChildTable({ title, columns, rows, empty }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-[16px] font-semibold text-slate-800 pb-3 mb-3 border-b border-slate-100">{title}</h3>
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">{empty}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {r.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-700">{cell ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EmployeeRecordModal({ employeeId, onClose, onEdit, onChanged }) {
  const [emp, setEmp] = useState(null);
  const [education, setEducation] = useState([]);
  const [experience, setExperience] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [health, setHealth] = useState(undefined);        // undefined = form is off
  const [vaccinations, setVaccinations] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState(null);   // revealed values, if asked for
  const [revealing, setRevealing] = useState(false);
  const [editField, setEditField] = useState(null);   // which identity number
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/employees/${employeeId}`)
      .then(r => {
        setEmp(r.data.data);
        setEducation(r.data.data?.education || []);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Could not open that record'))
      .finally(() => setLoading(false));

    /* The child sections are their own tables and their own permissions, so
     * they are fetched separately and a refusal on one leaves the rest of the
     * record readable rather than blanking the whole modal. */
    api.get(`/employee-records/${employeeId}/experience`)
      .then(r => setExperience(r.data.data || [])).catch(() => setExperience([]));
    api.get(`/employee-records/${employeeId}/dependents`)
      .then(r => setDependents(r.data.data || [])).catch(() => setDependents([]));

    /* Health and Vaccination are optional forms. The endpoint refuses while the
     * form is switched off, and that refusal is what hides the section — so a
     * disabled form leaves no trace on the record rather than an empty card
     * inviting somebody to fill it in. */
    api.get(`/employee-records/${employeeId}/health`)
      .then(r => setHealth(r.data.data || null)).catch(() => setHealth(undefined));
    api.get(`/employee-records/${employeeId}/vaccinations`)
      .then(r => setVaccinations(r.data.data || [])).catch(() => setVaccinations(undefined));
  }, [employeeId]);

  const reveal = async () => {
    if (identity) { setIdentity(null); return false; }
    setRevealing(true);
    try {
      const r = await api.post('/employee-io/reveal', {
        employeeIds: [employeeId], reason: 'viewed on the employee record',
      });
      setIdentity(r.data.data?.[0] || {});
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reveal those numbers');
      return false;
    } finally { setRevealing(false); }
  };

  const IDENTITY_LABEL = { uanNumber: 'UAN', panNumber: 'PAN', aadhaarNumber: 'Aadhaar' };

  /* Editing reveals first: correcting a number you cannot see is how a digit
   * gets changed by accident. The reveal is the audited one, so an edit
   * leaves the same trail a look does. */
  const startEdit = async (field) => {
    let known = identity;
    if (!known) {
      const ok = await reveal();
      if (!ok) return;
      known = null;   // set by reveal; the field below falls back to blank
    }
    setDraft((known || {})[field] || '');
    setEditField(field);
  };

  const saveIdentity = async () => {
    const value = String(draft || '').trim();
    setSaving(true);
    try {
      await api.put(`/employees/${employeeId}`, { [editField]: value || null });
      setIdentity(v => ({ ...(v || {}), [editField]: value }));
      toast.success('Saved');
      setEditField(null);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that');
    } finally { setSaving(false); }
  };

  const masked = (has, value) => {
    if (identity && value) return <span className="font-mono">{value}</span>;
    if (identity && !value) return <span className="text-slate-300">—</span>;
    return has ? <span className="text-slate-400 tracking-widest">•••••••••</span>
               : <span className="text-slate-300">—</span>;
  };

  /* Every identity row gets its own controls.
   *
   * Only UAN had an eye, so PAN and Aadhaar were dotted out with no way to
   * reach the reveal that already existed. One press still reveals all three,
   * because one audited call fetches all three — three separate calls would
   * put three entries in the audit trail for one decision.
   *
   * The pencil edits that one number in place. These were deliberately left
   * out of the edit form so opening it could not put somebody's Aadhaar on
   * screen; editing here keeps that true, because the value is only fetched
   * when the eye is pressed and that is recorded. */
  const controls = (field) => (
    <span className="inline-flex items-center gap-0.5 ml-1">
      <button onClick={reveal} disabled={revealing}
        title={identity ? 'Hide' : 'Show (recorded in the audit trail)'}
        className="w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        {revealing ? <Loader2 size={13} className="animate-spin" />
          : identity ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button onClick={() => startEdit(field)} title="Edit"
        className="w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        <Pencil size={12} />
      </button>
    </span>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-slate-50 rounded-2xl w-full max-w-5xl shadow-2xl my-4 flex flex-col max-h-[94vh]">
        <div className="flex items-center justify-between px-6 py-4 bg-white rounded-t-2xl border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            {emp?.photoUrl
              ? <img src={emp.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
              : <span className="w-9 h-9 rounded-full bg-slate-100 flex-shrink-0" />}
            <span className="text-[17px] font-semibold text-slate-800 truncate">
              {emp ? `${emp.employeeId} - ${emp.firstName} ${emp.lastName || ''}`.trim() : 'Loading…'}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => onEdit(employeeId)} title="Edit"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <Pencil size={17} />
            </button>
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <X size={19} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading || !emp ? (
            <div className="flex justify-center py-24">
              <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <Section title="Basic information">
                <Row label="Employee ID" value={emp.employeeId} />
                <Row label="Nick name" value={emp.nickName} />
                <Row label="First Name" value={emp.firstName} />
                <Row label="Email address" value={emp.email} />
                <Row label="Last Name" value={emp.lastName} />
                <Row label="Personal Email Address" value={emp.personalEmail} />
              </Section>

              <Section title="Work Information">
                <Row label="Department" value={emp.department} />
                <Row label="Role" value={String(emp.role || '').replace(/_/g, ' ')} />
                <Row label="Location" value={emp.workLocation} />
                <Row label="Employment Type" value={emp.employmentType} />
                <Row label="Designation" value={emp.designation} />
                <Row label="Employee Status" value={emp.status} />
                <Row label="Source of Hire" value={emp.sourceOfHire} />
                <Row label="Date of Joining" value={fmtDate(emp.dateOfJoining || emp.joiningDate)} />
                <Row label="Total Experience" value={emp.totalExperience} />
                <Row label="Attendance tracked" value={emp.attendanceTracked === false ? 'No' : 'Yes'} />
              </Section>

              <Section title="Hierarchy Information">
                <Row label="Reporting Manager" value={emp.manager
                  ? `${emp.manager.firstName || ''} ${emp.manager.lastName || ''}`.trim() : null} />
                <Row label="Secondary Reporting Manager" value={emp.secondaryManager
                  ? `${emp.secondaryManager.firstName || ''} ${emp.secondaryManager.lastName || ''}`.trim() : null} />
                <Row label="Approving Authority" value={emp.approvingAuthority
                  ? `${emp.approvingAuthority.firstName || ''} ${emp.approvingAuthority.lastName || ''}`.trim() : null} />
              </Section>

              <Section title="Personal Details">
                <Row label="Date of Birth" value={fmtDate(emp.dateOfBirth)} />
                <Row label="Ask me about/Expertise" value={emp.expertise} />
                <Row label="Age" value={ageOf(emp.dateOfBirth)} />
                <Row label="About Me" value={emp.aboutMe} />
                <Row label="Gender" value={emp.gender} />
                <Row label="Blood Group" value={emp.bloodGroup} />
                <Row label="Marital Status" value={emp.maritalStatus} />
                <Row label="Nationality" value={emp.nationality} />
              </Section>

              <Section title="Identity Information">
                <Row label="UAN" value={masked(emp.hasUan ?? !!emp.uanNumber, identity?.uanNumber)}
                  action={controls('uanNumber')} />
                <Row label="PAN" value={masked(emp.hasPan ?? !!emp.panNumber, identity?.panNumber)}
                  action={controls('panNumber')} />
                <Row label="Aadhaar" value={masked(emp.hasAadhaar ?? !!emp.aadhaarNumber, identity?.aadhaarNumber)}
                  action={controls('aadhaarNumber')} />
              </Section>

              <Section title="Contact Details">
                <Row label="Work Phone Number" value={emp.workPhone} />
                <Row label="Personal Mobile Number" value={emp.phone} />
                <Row label="Extension" value={emp.extension} />
                <Row label="Personal Email Address" value={emp.personalEmail} />
                <Row label="Seating Location" value={emp.seatingLocation} />
                <Row label="Tags" value={emp.tags} />
                <Row label="Present Address" value={emp.currentAddress || emp.address} />
                <Row label="Permanent Address" value={emp.permanentAddress} />
              </Section>

              <Section title="Separation Information">
                <Row label="Date of Exit" value={fmtDate(emp.exitDate)} />
                <Row label="Notice Period End" value={fmtDate(emp.noticePeriodEndDate)} />
              </Section>

              <Section title="System Fields">
                <Row label="Added By" value={emp.createdBy
                  ? `${emp.createdBy.firstName || ''} ${emp.createdBy.lastName || ''}`.trim() : null} />
                <Row label="Modified By" value={emp.updatedBy
                  ? `${emp.updatedBy.firstName || ''} ${emp.updatedBy.lastName || ''}`.trim() : null} />
                <Row label="Added Time" value={fmtWhen(emp.createdAt)} />
                <Row label="Modified Time" value={fmtWhen(emp.updatedAt)} />
                <Row label="Onboarding Status" value={emp.onboardingStatus} />
              </Section>

              <ChildTable
                title="Education Details"
                columns={['Institute Name', 'Degree/Diploma', 'Specialization', 'Year of Passing']}
                rows={education.map(e => [
                  e.universityOrInstitution || e.university_or_institution,
                  e.degree, e.course || e.highestQualification || e.highest_qualification,
                  e.yearOfPassing || e.year_of_passing,
                ])}
                empty="No rows found."
              />

              <ChildTable
                title="Work experience"
                columns={['Company name', 'Job Title', 'From Date', 'To Date', 'Job Description', 'Relevant']}
                rows={experience.map(e => [
                  e.companyName, e.jobTitle, fmtDate(e.fromDate), fmtDate(e.toDate),
                  e.jobDescription, e.relevant ? 'Yes' : 'No',
                ])}
                empty="No rows found."
              />

              <ChildTable
                title="Dependent Details"
                columns={['Name', 'Relationship', 'Date of Birth']}
                rows={dependents.map(d => [d.name, d.relationship, fmtDate(d.dateOfBirth)])}
                empty="No rows found."
              />

              {health !== undefined && (
                <Section title="Employee Health Data">
                  <Row label="Blood Group" value={health?.bloodGroup} />
                  <Row label="Emergency Contact" value={health?.emergencyContactName} />
                  <Row label="Height (cm)" value={health?.heightCm} />
                  <Row label="Emergency Contact Number" value={health?.emergencyContactPhone} />
                  <Row label="Weight (kg)" value={health?.weightKg} />
                  <Row label="Doctor" value={health?.doctorName} />
                  <Row label="Allergies" value={health?.allergies} />
                  <Row label="Doctor's Number" value={health?.doctorPhone} />
                  <Row label="Chronic Conditions" value={health?.chronicConditions} />
                  <Row label="Insurance Provider" value={health?.insuranceProvider} />
                  <Row label="Medications" value={health?.medications} />
                  <Row label="Policy Number" value={health?.insuranceNumber} />
                  <Row label="Notes" value={health?.notes} />
                  <Row label="Last Updated" value={fmtWhen(health?.updatedAt)} />
                </Section>
              )}

              {vaccinations !== undefined && (
                <ChildTable
                  title="Vaccination Status"
                  columns={['Vaccine', 'Dose', 'Vaccinated On', 'Notes']}
                  rows={vaccinations.map(v => [v.vaccine, v.dose, fmtDate(v.vaccinatedOn), v.notes])}
                  empty="No rows found."
                />
              )}

              <EmployeeDocuments employeeId={employeeId} canEdit={false} />

              {/* Last, because it is the section somebody scrolls TO rather
                  than past — the record above answers what is true now, this
                  answers how it got that way. */}
              <EmployeeActivity employeeId={employeeId} />

              {/* Related Forms — Asset, Benefit, Exit Details, Travel — are
                  separate modules rather than sections of this record, so they
                  are named rather than drawn as empty grids. */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-[16px] font-semibold text-slate-800 pb-3 mb-3 border-b border-slate-100">
                  Related Forms
                </h3>
                <p className="text-[14px] text-slate-500">
                  Asset, Benefit, Exit Details and Travel are modules of their own rather than sections
                  of this record. They are not linked here yet.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-white rounded-b-2xl border-t border-slate-100">
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2 rounded-xl text-[15px] hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>

      {editField && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
          onClick={() => setEditField(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-semibold text-slate-800 mb-1">
              Edit {IDENTITY_LABEL[editField] || 'number'}
            </h3>
            <p className="text-[13px] text-slate-500 mb-4">
              The change is recorded in the audit trail with its old and new value.
            </p>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveIdentity(); if (e.key === 'Escape') setEditField(null); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] font-mono focus:outline-none focus:border-brand-400" />
            <div className="flex gap-2 mt-4">
              <button onClick={saveIdentity} disabled={saving}
                className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[14px]">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditField(null)}
                className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[14px] hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
