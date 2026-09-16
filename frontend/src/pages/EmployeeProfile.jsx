import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, MessageSquare, Building2, Users,
  Eye, EyeOff, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { isFullAccess, isApprover, ROLES } from '../utils/roles';
import { fmtDate } from '../utils/dateFormat';
import { formatTime, formatInstantTime } from '../utils/datetime';

/* ── One employee, one tabbed screen ──────────────────────────────────────
 *  Reachable from the topbar search, the Employee / Department tree popup's
 *  eye button and SmartChat. `/api/employees/:id` answers every authenticated
 *  caller with a `viewLevel`, and the two levels differ in how much of the
 *  record comes back, not in which screen is drawn:
 *    'full'      — the subject themselves or a full-access role; every field.
 *    'colleague' — everyone else; identity, department, location, shift, work
 *                  email, presence and manager. Everything else is undefined,
 *                  so a section with nothing in it is left out rather than
 *                  drawn as a card full of dashes.
 *
 *  Leave, Attendance, Files and Related Data are the person's own, their
 *  reporting line's and full access's. Their tabs are dropped for anybody
 *  else rather than opened and answered with a 403, and each one is both
 *  code-split and fetched only when it is first pressed — then kept mounted,
 *  so switching back does not re-run somebody's year.
 * ───────────────────────────────────────────────────────────────────────── */

const LeaveTabs = lazy(() => import('./moreservices/leavetracker/OpsUserSpecific')
  .then(m => ({ default: m.UserLeaveTabs })));
const AttendanceTabs = lazy(() => import('./moreservices/attendance/OpsUserSpecific')
  .then(m => ({ default: m.UserAttendanceTabs })));
const EmployeeDocuments = lazy(() => import('./moreservices/employeeinfo/EmployeeDocuments'));

const DATE_OPTS = { day: '2-digit', month: '2-digit', year: 'numeric' };

// Same status → {label, color} mapping as Employees.jsx's STATUS_OPTIONS,
// kept in sync so this profile's status pill matches the admin list view.
const STATUS_META = [
  { value: 'active',        label: 'Active (Current Employee)', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'notice_period', label: 'Notice Period',             color: 'bg-amber-100 text-amber-700' },
  { value: 'resigned',      label: 'Resigned',                  color: 'bg-slate-100 text-slate-600' },
  { value: 'terminated',    label: 'Terminated',                color: 'bg-red-100 text-red-700' },
  { value: 'inactive',      label: 'Inactive',                  color: 'bg-slate-100 text-slate-500' },
];
const statusMeta = (s) => STATUS_META.find(o => o.value === s) || STATUS_META[0];

const PRESENCE_META = {
  in:           { label: 'In',              color: 'bg-emerald-100 text-emerald-700' },
  out:          { label: 'Out',             color: 'bg-slate-100 text-slate-600'     },
  yetToCheckIn: { label: 'Yet to check-in', color: 'bg-amber-100 text-amber-700'     },
};

const fullNameOf = (p) => `${p?.firstName || ''} ${p?.lastName || ''}`.trim();
const codeName = (p) => (p?.employeeId ? `${p.employeeId} - ${fullNameOf(p)}` : fullNameOf(p));
const same = (a, b) => a != null && b != null && String(a) === String(b);

// A value the record does not carry is not the same as one it carries empty,
// but both read as "-" in a label/value row — so one test covers both.
const filled = (v) => v !== null && v !== undefined && v !== '';
const any = (...vs) => vs.some(filled);

// fmtDate answers '—' for a missing date; every empty value on this page is a
// '-', so the absence is turned back into one before it reaches a row.
const dateOr = (d) => (d ? fmtDate(d, DATE_OPTS) : null);

const fmtWhen = d => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);

/* Age from a date of birth, in the reference's "22 year(s) 5 month(s)" shape.
 * Computed rather than stored: an age column is wrong the day after it is
 * written. Same helper as the Employee Information record. */
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

// A shift row is only worth showing as a time range when both ends are on
// file; a half-filled shift reads as a real window that nobody works.
const shiftRange = (shift) => {
  if (!shift?.startTime || !shift?.endTime) return null;
  return `${formatTime(shift.startTime, '12')} – ${formatTime(shift.endTime, '12')}`;
};

const Row = ({ label, children, action }) => (
  <div className="grid grid-cols-[minmax(110px,160px)_1fr] gap-4 items-start py-3 border-b border-slate-100 last:border-b-0">
    <span className="text-[15px] text-slate-500">{label}</span>
    <span className="text-[15px] text-slate-800 font-medium break-words flex items-start gap-1.5">
      {filled(children) ? children : <span className="text-slate-300">-</span>}
      {action}
    </span>
  </div>
);

const Section = ({ title, children }) => (
  <section className="bg-white border border-slate-200 rounded-md">
    <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">
      {title}
    </h3>
    <div className="px-6 py-1 grid grid-cols-1 md:grid-cols-2 md:gap-x-12">
      {children}
    </div>
  </section>
);

/* The child sections — experience, education, dependents — are rows rather
 * than fields, and a table is the only honest shape for "none on file". */
const ChildTable = ({ title, columns, rows, empty }) => (
  <section className="bg-white border border-slate-200 rounded-md">
    <h3 className="px-6 py-4 text-[17px] font-bold text-slate-800 border-b border-slate-100">{title}</h3>
    <div className="p-6 pt-4 overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-slate-50 text-slate-500">
          <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-700">{filled(cell) ? cell : '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

function Avatar({ photoUrl, initials, size = 80 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [photoUrl]);
  const style = { width: size, height: size };
  return (photoUrl && !broken) ? (
    <img src={photoUrl} alt="" style={style} onError={() => setBroken(true)}
      className="rounded-full object-cover border border-slate-200 flex-shrink-0" />
  ) : (
    <div style={style}
      className="rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold border border-slate-200 flex-shrink-0"
      >
      <span style={{ fontSize: Math.round(size / 3.6) }}>{initials || '?'}</span>
    </div>
  );
}

const initialsOf = (p) =>
  `${p?.firstName?.[0] || ''}${p?.lastName?.[0] || ''}`.toUpperCase() || '?';

const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

// Same card as Directory.jsx, so Department / Peers look like the directory
// everybody already knows.
function PersonCard({ emp, onOpen }) {
  const [imgError, setImgError] = useState(false);
  const hasPhoto = emp.photoUrl && !imgError;
  return (
    <button
      type="button"
      onClick={() => onOpen(emp._id)}
      className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all duration-200 overflow-hidden flex flex-col items-center p-6 text-left"
    >
      <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-end justify-center overflow-hidden mb-4 border border-slate-200">
        {hasPhoto ? (
          <img src={emp.photoUrl} alt={`${emp.firstName} ${emp.lastName}`} className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 text-slate-300 translate-y-2">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        )}
      </div>
      <h3 className="font-semibold text-slate-800 text-[16px] text-center truncate max-w-full">{emp.firstName} {emp.lastName}</h3>
      <p className="text-[14px] text-slate-500 mt-1 text-center">{emp.designation || '—'}</p>

      <div className="w-full mt-5 space-y-2 border-t border-slate-100 pt-4">
        {emp.email && (
          <div className="flex items-center gap-2 text-[13px] text-slate-600" title={emp.email}>
            <Mail size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.email}</span>
          </div>
        )}
        {emp.phone && (
          <div className="flex items-center gap-2 text-[13px] text-slate-600">
            <Phone size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.phone}</span>
          </div>
        )}
        {emp.employeeId && (
          <div className="flex items-center gap-2 text-[13px] text-slate-600">
            <Building2 size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.employeeId}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function PeopleGrid({ loading, failed, people, emptyText, onOpen }) {
  if (loading) return <Spinner />;
  if (failed) {
    return (
      <div className="bg-white border border-slate-200 rounded-md text-center py-16 text-slate-500 text-base">
        Could not load this list.
      </div>
    );
  }
  if (!people.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-md text-center py-16">
        <Users size={40} className="text-slate-200 mx-auto mb-3" />
        <p className="text-slate-400 font-medium text-base">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {people.map(p => <PersonCard key={p._id} emp={p} onOpen={onOpen} />)}
    </div>
  );
}

/* ── Identity Information ─────────────────────────────────────────────────
 *  The same dots-and-an-eye the Employee Information record uses. Looking at
 *  somebody else's numbers goes through the audited reveal, so the look is
 *  written down; your own are already in your own payload, and /employee-io
 *  is full-access only, so revealing your own is done in the browser rather
 *  than by asking an endpoint that would refuse most people.
 */
function IdentitySection({ employee, viewer }) {
  const [identity, setIdentity] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const audited = isFullAccess(viewer) && !same(viewer?._id, employee._id);

  const reveal = async () => {
    if (identity) { setIdentity(null); return; }
    if (!audited) {
      setIdentity({
        uanNumber: employee.uanNumber,
        panNumber: employee.panNumber,
        aadhaarNumber: employee.aadhaarNumber,
      });
      return;
    }
    setRevealing(true);
    try {
      const r = await api.post('/employee-io/reveal', {
        employeeIds: [employee._id], reason: 'viewed on the employee profile',
      });
      setIdentity(r.data.data?.[0] || {});
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reveal those numbers');
    } finally { setRevealing(false); }
  };

  const masked = (has, value) => {
    if (identity && value) return <span className="font-mono">{value}</span>;
    if (identity && !value) return <span className="text-slate-300">-</span>;
    return has ? <span className="text-slate-400 tracking-widest">•••••••••</span>
               : <span className="text-slate-300">-</span>;
  };

  // One press reveals all three, because one audited call fetches all three —
  // three separate calls would put three entries in the trail for one decision.
  const eye = (
    <button type="button" onClick={reveal} disabled={revealing}
      title={identity ? 'Hide' : audited ? 'Show (recorded in the audit trail)' : 'Show'}
      className="w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
      {revealing ? <Loader2 size={13} className="animate-spin" />
        : identity ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  );

  return (
    <Section title="Identity information">
      <Row label="UAN" action={eye}>{masked(employee.hasUan ?? !!employee.uanNumber, identity?.uanNumber)}</Row>
      <Row label="PAN" action={eye}>{masked(employee.hasPan ?? !!employee.panNumber, identity?.panNumber)}</Row>
      <Row label="Aadhaar" action={eye}>{masked(employee.hasAadhaar ?? !!employee.aadhaarNumber, identity?.aadhaarNumber)}</Row>
    </Section>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────── */

function ProfileTab({ emp, viewLevel, viewer }) {
  const [experience, setExperience] = useState(null);
  const [dependents, setDependents] = useState(null);

  /* Experience and dependents are their own tables behind their own rule —
   * self or full access, managers deliberately excluded — so they are fetched
   * separately and a refusal on one leaves the rest of the profile readable.
   * The colleague payload cannot reach them at all, so nothing is asked for. */
  useEffect(() => {
    if (viewLevel !== 'full') return;
    let live = true;
    api.get(`/employee-records/${emp._id}/experience`)
      .then(r => { if (live) setExperience(r.data.data || []); })
      .catch(() => { if (live) setExperience(undefined); });
    api.get(`/employee-records/${emp._id}/dependents`)
      .then(r => { if (live) setDependents(r.data.data || []); })
      .catch(() => { if (live) setDependents(undefined); });
    return () => { live = false; };
  }, [emp._id, viewLevel]);

  const range = shiftRange(emp.shift);
  const manager = emp.manager?.id ? emp.manager : null;
  const approver = emp.approvingAuthority?.id ? emp.approvingAuthority : null;
  const secondary = emp.secondaryManager?.id ? emp.secondaryManager : null;
  const education = emp.education || null;
  const address = emp.currentAddress || emp.address;

  return (
    <div className="space-y-4">
      {any(emp.employeeId, emp.nickName, emp.firstName, emp.lastName, emp.email, emp.personalEmail) && (
        <Section title="Basic information">
          <Row label="Employee ID">{emp.employeeId}</Row>
          <Row label="Nick name">{emp.nickName}</Row>
          <Row label="First name">{emp.firstName}</Row>
          <Row label="Last name">{emp.lastName}</Row>
          <Row label="Email address">{emp.email}</Row>
          <Row label="Personal email address">{emp.personalEmail}</Row>
        </Section>
      )}

      {any(emp.department, emp.workLocation, emp.designation, emp.employmentType, emp.status,
           emp.sourceOfHire, emp.dateOfJoining, emp.joiningDate, emp.totalExperience,
           emp.company, emp.division, emp.shift?.name) && (
        <Section title="Work information">
          <Row label="Department">{emp.department}</Row>
          <Row label="Location">{emp.workLocation}</Row>
          <Row label="Designation">{emp.designation}</Row>
          <Row label="Employment type">{emp.employmentType}</Row>
          <Row label="Employee status">{emp.status ? statusMeta(emp.status).label : null}</Row>
          <Row label="Source of hire">{emp.sourceOfHire}</Row>
          <Row label="Date of joining">{dateOr(emp.dateOfJoining || emp.joiningDate)}</Row>
          <Row label="Total experience">{emp.totalExperience}</Row>
          <Row label="Company">{emp.company}</Row>
          <Row label="Division">{emp.division}</Row>
          <Row label="Shift">
            {emp.shift?.name
              ? <>{emp.shift.name}{range && <span className="text-slate-500 font-normal"> · {range}</span>}</>
              : null}
          </Row>
        </Section>
      )}

      {(manager || approver || secondary) && (
        <Section title="Hierarchy">
          <Row label="Reporting manager">{manager ? codeName(manager) : null}</Row>
          <Row label="Secondary reporting manager">{secondary ? codeName(secondary) : null}</Row>
          <Row label="Approving authority">{approver ? codeName(approver) : null}</Row>
        </Section>
      )}

      {any(emp.dateOfBirth, emp.gender, emp.maritalStatus, emp.bloodGroup,
           emp.nationality, emp.expertise, emp.aboutMe) && (
        <Section title="Personal details">
          <Row label="Date of birth">{dateOr(emp.dateOfBirth)}</Row>
          <Row label="Age">{ageOf(emp.dateOfBirth)}</Row>
          <Row label="Gender">{emp.gender}</Row>
          <Row label="Marital status">{emp.maritalStatus}</Row>
          <Row label="Blood group">{emp.bloodGroup}</Row>
          <Row label="Nationality">{emp.nationality}</Row>
          <Row label="Ask me about / Expertise">{emp.expertise}</Row>
          <Row label="About">{emp.aboutMe}</Row>
        </Section>
      )}

      {viewLevel === 'full' && (emp.hasUan || emp.hasPan || emp.hasAadhaar
        || emp.uanNumber || emp.panNumber || emp.aadhaarNumber) && (
        <IdentitySection employee={emp} viewer={viewer} />
      )}

      {any(emp.email, emp.personalEmail, emp.phone, emp.workPhone, emp.extension,
           emp.seatingLocation, address, emp.permanentAddress) && (
        <Section title="Contact details">
          <Row label="Work email">{emp.email}</Row>
          <Row label="Personal email">{emp.personalEmail}</Row>
          <Row label="Personal mobile">{emp.phone}</Row>
          <Row label="Work phone">{emp.workPhone}</Row>
          <Row label="Extension">{emp.extension}</Row>
          <Row label="Seating location">{emp.seatingLocation}</Row>
          <Row label="Present address">{address}</Row>
          <Row label="Permanent address">{emp.permanentAddress}</Row>
        </Section>
      )}

      {/* `undefined` means the endpoint refused; the section is dropped rather
          than drawn as an empty table that reads like "none on file". */}
      {Array.isArray(experience) && (
        <ChildTable
          title="Work experience"
          columns={['Company name', 'Job title', 'From', 'To', 'Description', 'Relevant']}
          rows={experience.map(e => [
            e.companyName, e.jobTitle,
            dateOr(e.fromDate), dateOr(e.toDate),
            e.jobDescription, e.relevant ? 'Yes' : 'No',
          ])}
          empty="No work experience on file."
        />
      )}

      {Array.isArray(education) && (
        <ChildTable
          title="Education"
          columns={['Institute', 'Degree / Diploma', 'Specialization', 'Year of passing']}
          rows={education.map(e => [
            e.universityOrInstitution || e.university_or_institution,
            e.degree,
            e.course || e.highestQualification || e.highest_qualification,
            e.yearOfPassing || e.year_of_passing,
          ])}
          empty="No education on file."
        />
      )}

      {Array.isArray(dependents) && (
        <ChildTable
          title="Dependents"
          columns={['Name', 'Relationship', 'Date of birth']}
          rows={dependents.map(d => [d.name, d.relationship, dateOr(d.dateOfBirth)])}
          empty="No dependents on file."
        />
      )}

      {any(emp.createdBy, emp.updatedBy, emp.createdAt, emp.updatedAt) && (
        <Section title="System fields">
          <Row label="Added by">{emp.createdBy ? fullNameOf(emp.createdBy) : null}</Row>
          <Row label="Added time">{fmtWhen(emp.createdAt)}</Row>
          <Row label="Modified by">{emp.updatedBy ? fullNameOf(emp.updatedBy) : null}</Row>
          <Row label="Modified time">{fmtWhen(emp.updatedAt)}</Row>
        </Section>
      )}
    </div>
  );
}

/* ── Department & Peers ──────────────────────────────────────────────────── */

/* Both lists are fed by the ordinary /employees list endpoint — the same one
 * the directory reads, with its own scoping untouched. Peers has no manager
 * filter there, so the active list is pulled once and narrowed on
 * reportingManagerId, which is what Peers.jsx does. */
function useRoster(url, narrow) {
  const [state, setState] = useState({ loading: true, failed: false, people: [] });
  useEffect(() => {
    // A null url is "there is nothing to ask for" — no department, no manager
    // — and the caller draws its own explanation instead.
    if (!url) { setState({ loading: false, failed: false, people: [] }); return undefined; }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, failed: false }));
    api.get(url)
      .then(r => {
        if (cancelled) return;
        const rows = r.data.data || [];
        setState({ loading: false, failed: false, people: narrow ? narrow(rows) : rows });
      })
      .catch(err => {
        if (cancelled) return;
        console.error(err);
        setState({ loading: false, failed: true, people: [] });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return state;
}

function DepartmentTab({ emp, onOpen }) {
  const department = emp.department || null;
  const { loading, failed, people } = useRoster(
    department ? `/employees?limit=200&status=active&department=${encodeURIComponent(department)}` : null,
  );

  /* The reference groups a department by designation and counts each group,
   * because "eleven people" is a fact about the department and "four Senior
   * Engineers" is the one somebody actually came here for. */
  const groups = useMemo(() => {
    const by = new Map();
    for (const p of people) {
      const key = p.designation || 'No designation';
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(p);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [people]);

  if (!department) {
    return (
      <div className="bg-white border border-slate-200 rounded-md text-center py-16 text-slate-400 text-base">
        {fullNameOf(emp)} is not in a department.
      </div>
    );
  }
  if (loading || failed || !people.length) {
    return (
      <PeopleGrid loading={loading} failed={failed} people={people}
        emptyText={`No one else is listed under ${department}.`} onOpen={onOpen} />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-slate-500">
        <span className="font-semibold text-slate-700">{department}</span> · {people.length} {people.length === 1 ? 'person' : 'people'}
      </p>
      {groups.map(([designation, members]) => (
        <div key={designation} className="space-y-3">
          <h3 className="text-[15px] font-semibold text-slate-700">
            {designation} <span className="text-slate-400 font-normal">({members.length})</span>
          </h3>
          <PeopleGrid loading={false} failed={false} people={members} emptyText="" onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

function PeersTab({ emp, onOpen }) {
  const manager = emp.manager?.id ? emp.manager : null;
  const { loading, failed, people } = useRoster(
    manager ? '/employees?limit=500&status=active' : null,
    rows => rows.filter(p => !same(p._id, emp._id)
      && same(p.reportingManagerId || p.reporting_manager_id, manager.id)),
  );

  if (!manager) {
    return (
      <div className="bg-white border border-slate-200 rounded-md text-center py-16 text-slate-400 text-base">
        {fullNameOf(emp)} has no reporting person set.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-slate-500">
        Reporting to <span className="font-semibold text-slate-700">{codeName(manager)}</span>
      </p>
      <PeopleGrid loading={loading} failed={failed} people={people}
        emptyText="Nobody else reports to the same manager." onOpen={onOpen} />
    </div>
  );
}

/* ── Related Data ────────────────────────────────────────────────────────── */

const money = (n) => (filled(n) && Number.isFinite(Number(n)) ? `₹${Number(n).toLocaleString('en-IN')}` : null);
const short = (d) => dateOr(d);

/* Asset and Benefit are in the reference and have no endpoint here — not an
 * empty one, none at all — so they are left out rather than drawn as a row
 * that will say 0 forever. The three that exist are listed by the endpoint
 * each viewer is actually allowed to call: `/my` for your own, the scoped
 * list for an approver, and nothing for a Team Incharge, whose role the
 * travel and expense lists do not authorize. Hiding a door is a UI fix;
 * opening one is an access-control decision. */
const RELATED = [
  {
    key: 'exit', label: 'Exit Details',
    allowed: ({ self, full }) => self || full,
    url: ({ self }) => (self ? '/exit/my' : '/exit/all'),
    rows: ({ self }, data, id) => (self
      ? (data ? [data] : [])
      : (data || []).filter(r => same(r.employee?._id, id))),
    columns: ['Status', 'Resignation date', 'Last working date', 'Reason'],
    cells: r => [r.status, short(r.resignationDate), short(r.lastWorkingDate), r.reason],
  },
  {
    key: 'travel', label: 'Travel Request',
    allowed: ({ self, full, approver }) => self || full || approver,
    url: ({ self }) => (self ? '/travel/my' : '/travel'),
    rows: ({ self }, data, id) => (self
      ? (data || [])
      : (data || []).filter(r => same(r.employee?._id, id))),
    columns: ['Status', 'Destination', 'From', 'To', 'Purpose'],
    cells: r => [r.status, r.destination, short(r.fromDate), short(r.toDate), r.purpose],
  },
  {
    key: 'expense', label: 'Travel Expense',
    allowed: ({ self, full, approver }) => self || full || approver,
    url: ({ self }) => (self ? '/compensation/my' : '/compensation'),
    /* The expense module is one table of claims with a type on each row;
     * travel expense is the travel-typed claims and nothing else, so the
     * count under this label is the count of those. */
    rows: ({ self }, data, id) => (data || [])
      .filter(r => (self || same(r.employee?._id, id))
        && String(r.claimType || '').toLowerCase() === 'travel'),
    columns: ['Status', 'Claim date', 'Amount', 'Description'],
    cells: r => [r.status, short(r.claimDate), money(r.amount), r.description],
  },
];

const relatedFor = (ctx) => RELATED.filter(s => s.allowed(ctx));

function RelatedRow({ spec, ctx, employeeId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(spec.url(ctx))
      .then(r => { if (live) setRows(spec.rows(ctx, r.data.data, employeeId)); })
      .catch(() => { if (live) { setFailed(true); setRows([]); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, spec.key]);

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="bg-white border border-slate-200 rounded-md">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-6 py-4 text-left">
        <Chevron size={16} className="text-slate-400 flex-shrink-0" />
        <span className="text-[16px] font-semibold text-slate-800 flex-1">{spec.label}</span>
        <span className="text-[13px] text-slate-500 bg-slate-100 rounded-full px-2.5 py-0.5">
          {rows === null ? '…' : failed ? '!' : rows.length}
        </span>
      </button>
      {open && (
        <div className="px-6 pb-5 overflow-x-auto">
          {rows === null ? <Spinner /> : failed ? (
            <p className="text-[14px] text-slate-400 py-4">Could not load this list.</p>
          ) : rows.length === 0 ? (
            <p className="text-[14px] text-slate-400 py-4">Nothing to display.</p>
          ) : (
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>{spec.columns.map(c => (
                  <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._id || i} className="border-t border-slate-100">
                    {spec.cells(r).map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-slate-700">{filled(cell) ? cell : '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const RelatedDataTab = ({ specs, ctx, employeeId }) => (
  <div className="space-y-3">
    {specs.map(spec => <RelatedRow key={spec.key} spec={spec} ctx={ctx} employeeId={employeeId} />)}
  </div>
);

/* ── the screen ──────────────────────────────────────────────────────────── */

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const [emp, setEmp] = useState(null);
  const [viewLevel, setViewLevel] = useState('full');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const fetchEmployee = () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    setError(false);
    api.get(`/employees/${id}`)
      .then(r => {
        setEmp(r.data.data || null);
        setViewLevel(r.data.viewLevel === 'colleague' ? 'colleague' : 'full');
      })
      .catch(err => {
        if (err.response?.status === 404) setNotFound(true);
        else setError(true);
        console.error(err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchEmployee, [id]);

  /* Who may open the private half. The subject, their reporting line and full
   * access — the same three the leave, attendance and document endpoints
   * behind those tabs check for themselves. The manager test reads the
   * colleague payload's `manager.id`, which is the one field a manager
   * reliably gets back about their own report. */
  const self = same(user?._id, emp?._id);
  const full = isFullAccess(user);
  /* The reporting link on its own is not enough: those endpoints ask for the
   * link AND a role that carries reports, so a team member who happens to be
   * named as somebody's manager would otherwise be handed four tabs that all
   * answer empty. */
  const inLine = isApprover(user) && (
    same(user?._id, emp?.manager?.id)
    || same(user?._id, emp?.approvingAuthority?.id)
    || same(user?._id, emp?.approvingAuthorityId)
    || same(user?._id, emp?.reportingManagerId));
  const maySeePrivate = !!emp && (self || full || inLine);
  // Travel and expense authorize manager but not team_incharge; exit is full
  // access only. A viewer with no reachable row gets no tab at all.
  const relatedSpecs = useMemo(
    () => (maySeePrivate
      ? relatedFor({ self, full, approver: full || user?.role === ROLES.MANAGER })
      : []),
    [maySeePrivate, self, full, user?.role],
  );

  const tabs = useMemo(() => {
    const list = [
      { key: 'profile',    label: 'Profile'    },
      { key: 'department', label: 'Department' },
      { key: 'peers',      label: 'Peers'      },
    ];
    if (maySeePrivate) {
      list.push({ key: 'leave', label: 'Leave' });
      list.push({ key: 'attendance', label: 'Attendance' });
      list.push({ key: 'files', label: 'Files' });
      if (relatedSpecs.length) list.push({ key: 'related', label: 'Related Data' });
    }
    return list;
  }, [maySeePrivate, relatedSpecs.length]);

  /* The open tab lives in the URL so it can be linked to and survives a
   * refresh; an unknown or no-longer-permitted one falls back to Profile
   * rather than rendering nothing. */
  const wanted = search.get('tab');
  const tab = tabs.some(t => t.key === wanted) ? wanted : 'profile';
  const setTab = (key) => {
    const next = new URLSearchParams(search);
    next.set('tab', key);
    setSearch(next, { replace: true });
  };

  // Lazy, then sticky: a tab is mounted the first time it is opened and left
  // mounted afterwards, so coming back does not re-fetch somebody's year.
  const [visited, setVisited] = useState(() => new Set(['profile']));
  useEffect(() => { setVisited(new Set(['profile'])); }, [id]);
  useEffect(() => {
    setVisited(v => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab, id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-[#f5f6f8] min-h-screen p-6">
        <button onClick={() => navigate(-1)} className="text-blue-600 text-base flex items-center gap-1 mb-4">
          <ArrowLeft size={14}/> Back
        </button>
        <p className="text-slate-500 mb-3">Something went wrong loading this employee.</p>
        <button onClick={fetchEmployee} className="text-blue-600 text-base font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50">Retry</button>
      </div>
    );
  }
  if (notFound || !emp) {
    return (
      <div className="bg-[#f5f6f8] min-h-screen p-6">
        <button onClick={() => navigate(-1)} className="text-blue-600 text-base flex items-center gap-1 mb-4">
          <ArrowLeft size={14}/> Back
        </button>
        <p className="text-slate-500">Employee not found.</p>
      </div>
    );
  }

  const fullName = fullNameOf(emp);
  const titleLine = codeName(emp);
  const presence = PRESENCE_META[emp.presence] || null;
  const checkedInAt = emp.checkInTime ? formatInstantTime(emp.checkInTime, '12') : null;
  const manager = emp.manager?.id ? emp.manager : null;
  const phoneNum = emp.phone || emp.workPhone || null;
  const mailHref = emp.email ? `mailto:${emp.email}` : null;
  const telHref  = phoneNum  ? `tel:${phoneNum}`    : null;
  const btnBase  = 'w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center';
  const btnOff   = 'w-9 h-9 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center cursor-not-allowed';

  // The shared screens key off `_id` and want only what their header draws.
  const person = {
    _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
    employeeId: emp.employeeId, photoUrl: emp.photoUrl,
  };
  const openPerson = (pid) => navigate(`/employees/${pid}`);
  const panel = (key) => (tab === key ? 'space-y-4' : 'hidden');

  return (
    <div className="bg-[#f5f6f8] min-h-screen">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-base">
            <ArrowLeft size={15}/> Back
          </button>
          <h1 className="text-[17px] font-semibold text-slate-800 truncate">
            {emp.employeeId && <>{emp.employeeId} <span className="text-slate-400 font-normal">-</span> </>}{fullName}
          </h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <section className="bg-white border border-slate-200 rounded-md p-6 flex flex-col lg:flex-row lg:items-center gap-5">
          <Avatar photoUrl={emp.photoUrl} initials={initialsOf(emp)} />
          <div className="flex-1 min-w-0">
            <p className="text-[18px] font-bold text-slate-800 truncate">{titleLine}</p>
            <p className="text-[15px] text-slate-500 truncate">{emp.designation || 'Employee'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {presence && (
                <span className={`px-2 py-0.5 rounded text-[13px] font-semibold ${presence.color}`}>
                  {presence.label}
                </span>
              )}
              {emp.status && (
                <span className={`px-2 py-0.5 rounded text-[13px] font-semibold ${statusMeta(emp.status).color}`}>
                  {statusMeta(emp.status).label}
                </span>
              )}
              {checkedInAt && (
                <span className="text-[13px] text-slate-500">Checked in at {checkedInAt}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            {manager && (
              <button type="button" onClick={() => openPerson(manager.id)}
                className="flex items-center gap-3 text-left rounded-lg px-2 py-1.5 hover:bg-slate-50 max-w-full">
                <Avatar photoUrl={manager.photoUrl} initials={initialsOf(manager)} size={36} />
                <span className="min-w-0">
                  <span className="block text-[13px] text-slate-400">Reporting Manager</span>
                  <span className="block text-[14px] font-semibold text-blue-600 hover:text-blue-700 truncate">
                    {codeName(manager)}
                  </span>
                </span>
              </button>
            )}
            <div className="flex lg:justify-end items-center gap-2">
              {mailHref ? <a href={mailHref} title={`Email ${emp.email}`} className={btnBase}><MessageSquare size={15}/></a>
                        : <span title="No email" className={btnOff}><MessageSquare size={15}/></span>}
              {telHref ? <a href={telHref} title={`Call ${phoneNum}`} className={btnBase}><Phone size={15}/></a>
                       : <span title="No phone" className={btnOff}><Phone size={15}/></span>}
            </div>
          </div>
        </section>

        <div className="flex border-b border-slate-200 bg-white rounded-t-md overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-6 py-3 text-[15px] font-semibold border-b-[2.5px] transition-colors -mb-px whitespace-nowrap ${
                tab === t.key
                  ? 'border-[#1a73e8] text-[#1a73e8]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={panel('profile')}>
          <ProfileTab emp={emp} viewLevel={viewLevel} viewer={user} />
        </div>

        {visited.has('department') && (
          <div className={panel('department')}>
            <DepartmentTab emp={emp} onOpen={openPerson} />
          </div>
        )}

        {visited.has('peers') && (
          <div className={panel('peers')}>
            <PeersTab emp={emp} onOpen={openPerson} />
          </div>
        )}

        {maySeePrivate && visited.has('leave') && (
          <div className={panel('leave')}>
            <div className="bg-white border border-slate-200 rounded-md p-5">
              <Suspense fallback={<Spinner />}>
                <LeaveTabs employee={person} canManage={full} />
              </Suspense>
            </div>
          </div>
        )}

        {maySeePrivate && visited.has('attendance') && (
          <div className={panel('attendance')}>
            <div className="bg-white border border-slate-200 rounded-md p-5">
              <Suspense fallback={<Spinner />}>
                <AttendanceTabs employee={person} canManage={full} />
              </Suspense>
            </div>
          </div>
        )}

        {maySeePrivate && visited.has('files') && (
          <div className={panel('files')}>
            <Suspense fallback={<Spinner />}>
              <EmployeeDocuments employeeId={emp._id} canEdit={false} emptyText="No files to display" />
            </Suspense>
          </div>
        )}

        {!!relatedSpecs.length && visited.has('related') && (
          <div className={panel('related')}>
            <RelatedDataTab
              specs={relatedSpecs}
              ctx={{ self, full, approver: full || user?.role === ROLES.MANAGER }}
              employeeId={emp._id}
            />
          </div>
        )}
      </div>
    </div>
  );
}
