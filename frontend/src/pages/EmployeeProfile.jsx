import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MessageSquare, Video } from 'lucide-react';
import api from '../utils/api';
import { fmtDate } from '../utils/dateFormat';

/* ── Read-only view of any employee's profile. Reachable from the
 *  Employee Tree / Department Tree popup's eye button. Backend
 *  `/api/employees/:id` is `protect`-gated only — any logged-in user
 *  can fetch any colleague's profile, so this works for every role. */

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

const Row = ({ label, children }) => (
  <div className="grid grid-cols-[160px_1fr] gap-4 items-start py-3 border-b border-slate-100 last:border-b-0">
    <span className="text-[15px] text-slate-500">{label}</span>
    <span className="text-[15px] text-slate-800 font-medium break-words">
      {children == null || children === '' ? <span className="text-slate-300">-</span> : children}
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

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [emp, setEmp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const fetchEmployee = () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    setError(false);
    api.get(`/employees/${id}`)
      .then(r => setEmp(r.data.data || null))
      .catch(err => {
        if (err.response?.status === 404) setNotFound(true);
        else setError(true);
        console.error(err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchEmployee, [id]);

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

  const initials = `${emp.firstName?.[0] || ''}${emp.lastName?.[0] || ''}`.toUpperCase();
  const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  const phoneNum = emp.phone || emp.workPhone || null;
  const mailHref = emp.email ? `mailto:${emp.email}` : null;
  const telHref  = phoneNum  ? `tel:${phoneNum}`    : null;
  const btnBase  = 'w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center';
  const btnOff   = 'w-9 h-9 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center cursor-not-allowed';

  return (
    <div className="bg-[#f5f6f8] min-h-screen">
      {/* Sticky header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-base">
            <ArrowLeft size={15}/> Back
          </button>
          <h1 className="text-[17px] font-semibold text-slate-800">
            {emp.employeeId} <span className="text-slate-400 font-normal">-</span> {fullName}
          </h1>
          <div className="w-12" />
        </div>
      </div>

      {/* Hero card */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <section className="bg-white border border-slate-200 rounded-md p-6 flex items-center gap-5">
          {emp.photoUrl ? (
            <img src={emp.photoUrl} alt="" className="w-20 h-20 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[22px] font-bold border border-slate-200">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[18px] font-bold text-slate-800 truncate">{fullName}</p>
            <p className="text-[15px] text-slate-500 truncate">{emp.designation || 'Employee'}</p>
            {emp.email && (
              <p className="text-[14px] text-blue-600 truncate mt-0.5">{emp.email}</p>
            )}
            {emp.status && (
              <span className={`mt-2 inline-block px-2 py-0.5 rounded text-[13px] font-semibold ${statusMeta(emp.status).color}`}>
                {statusMeta(emp.status).label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mailHref ? <a href={mailHref} title={`Email ${emp.email}`} className={btnBase}><MessageSquare size={15}/></a>
                      : <span title="No email" className={btnOff}><MessageSquare size={15}/></span>}
            <span title="Video calling not enabled" className={btnOff}><Video size={15}/></span>
            {telHref ? <a href={telHref} title={`Call ${phoneNum}`} className={btnBase}><Phone size={15}/></a>
                     : <span title="No phone" className={btnOff}><Phone size={15}/></span>}
          </div>
        </section>

        <Section title="Work Information">
          <Row label="Department">{emp.department}</Row>
          <Row label="Designation">{emp.designation}</Row>
          <Row label="Company">{emp.company}</Row>
          <Row label="Division">{emp.division}</Row>
          <Row label="Work Location">{emp.workLocation}</Row>
          <Row label="Employment Type">{emp.employmentType}</Row>
          <Row label="Date of Joining">{fmtDate(emp.joiningDate, DATE_OPTS)}</Row>
          <Row label="Total Experience">{emp.totalExperience}</Row>
          <Row label="Source of Hire">{emp.sourceOfHire}</Row>
        </Section>

        {emp.manager && emp.manager.id && (
          <Section title="Reporting Person">
            <Row label="Name">{`${emp.manager.firstName || ''} ${emp.manager.lastName || ''}`.trim()}</Row>
            <Row label="Email">{emp.manager.email}</Row>
          </Section>
        )}

        <Section title="Contact Information">
          <Row label="Email">{emp.email}</Row>
          <Row label="Personal Email">{emp.personalEmail}</Row>
          <Row label="Phone">{emp.phone}</Row>
          <Row label="Work Phone">{emp.workPhone}</Row>
          <Row label="Extension">{emp.extension}</Row>
        </Section>

        <Section title="Personal Details">
          <Row label="Date of Birth">{emp.dateOfBirth ? fmtDate(emp.dateOfBirth, DATE_OPTS) : null}</Row>
          <Row label="Gender">{emp.gender}</Row>
          <Row label="Marital Status">{emp.maritalStatus}</Row>
          <Row label="Blood Group">{emp.bloodGroup}</Row>
          <Row label="Nationality">{emp.nationality}</Row>
          <Row label="About">{emp.aboutMe || emp.about_me}</Row>
          <Row label="Expertise">{emp.expertise}</Row>
        </Section>
      </div>
    </div>
  );
}
