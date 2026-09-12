import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MessageSquare, Video, Building2, Users } from 'lucide-react';
import api from '../utils/api';
import { fmtDate } from '../utils/dateFormat';
import { formatTime } from '../utils/datetime';

/* ── Read-only view of any employee's profile. Reachable from the topbar
 *  search, the Employee Tree / Department Tree popup's eye button and
 *  SmartChat. `/api/employees/:id` answers every authenticated caller with a
 *  `viewLevel`, and the two levels are different pages:
 *    'full'      — the subject themselves or a full-access role; every field.
 *    'colleague' — everyone else; `data` carries only identity, department,
 *                  location, shift, work email, presence and manager.
 *                  Everything else is `undefined`, so the render is driven
 *                  off viewLevel and never off whether a field is truthy. */

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

// A shift row is only worth showing as a time range when both ends are on
// file; a half-filled shift reads as a real window that nobody works.
const shiftRange = (shift) => {
  if (!shift?.startTime || !shift?.endTime) return null;
  return `${formatTime(shift.startTime, '12')} – ${formatTime(shift.endTime, '12')}`;
};

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

const Avatar = ({ photoUrl, initials }) => (
  photoUrl ? (
    <img src={photoUrl} alt="" className="w-20 h-20 rounded-full object-cover border border-slate-200" />
  ) : (
    <div className="w-20 h-20 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[22px] font-bold border border-slate-200">
      {initials}
    </div>
  )
);

// Same card as Directory.jsx, so a colleague's Department / Peers tab looks
// like the directory they already know.
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
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
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

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [emp, setEmp] = useState(null);
  const [viewLevel, setViewLevel] = useState('full');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('profile');
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleFailed, setPeopleFailed] = useState(false);

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
  useEffect(() => { setTab('profile'); }, [id]);

  const department = emp?.department || null;
  const managerId  = emp?.manager?.id || null;

  /* Both tabs are fed by the ordinary /employees list endpoint. Peers has no
   * manager filter there, so the active list is pulled once and narrowed on
   * reportingManagerId — the same thing Peers.jsx does. */
  useEffect(() => {
    if (tab === 'profile' || !emp) return;
    if (tab === 'department' && !department) return;
    if (tab === 'peers' && !managerId) return;

    let cancelled = false;
    setPeopleLoading(true);
    setPeopleFailed(false);
    const req = tab === 'department'
      ? api.get(`/employees?limit=200&status=active&department=${encodeURIComponent(department)}`)
      : api.get('/employees?limit=500&status=active');

    req.then(r => {
      if (cancelled) return;
      const rows = r.data.data || [];
      setPeople(tab === 'peers'
        ? rows.filter(p => p._id !== emp._id && (p.reportingManagerId || p.reporting_manager_id) === managerId)
        : rows);
    }).catch(err => {
      if (cancelled) return;
      setPeopleFailed(true);
      console.error(err);
    }).finally(() => { if (!cancelled) setPeopleLoading(false); });

    return () => { cancelled = true; };
  }, [tab, emp, department, managerId]);

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
  const fullName = fullNameOf(emp);
  const titleLine = emp.employeeId ? `${emp.employeeId} - ${fullName}` : fullName;
  const phoneNum = emp.phone || emp.workPhone || null;
  const mailHref = emp.email ? `mailto:${emp.email}` : null;
  const telHref  = phoneNum  ? `tel:${phoneNum}`    : null;
  const btnBase  = 'w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center';
  const btnOff   = 'w-9 h-9 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center cursor-not-allowed';

  const header = (
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
  );

  if (viewLevel === 'colleague') {
    const presence = PRESENCE_META[emp.presence] || null;
    const managerName = fullNameOf(emp.manager);
    const range = shiftRange(emp.shift);

    return (
      <div className="bg-[#f5f6f8] min-h-screen">
        {header}

        <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
          <section className="bg-white border border-slate-200 rounded-md p-6 flex flex-col sm:flex-row sm:items-center gap-5">
            <Avatar photoUrl={emp.photoUrl} initials={initials} />
            <div className="flex-1 min-w-0">
              <p className="text-[18px] font-bold text-slate-800 truncate">{titleLine}</p>
              <p className="text-[15px] text-slate-500 truncate">{emp.designation || 'Employee'}</p>
              {presence && (
                <span className={`mt-2 inline-block px-2 py-0.5 rounded text-[13px] font-semibold ${presence.color}`}>
                  {presence.label}
                </span>
              )}
            </div>
            <div className="sm:text-right">
              {managerId && managerName && (
                <div className="mb-3">
                  <p className="text-[13px] text-slate-400">Reporting Manager</p>
                  <button
                    type="button"
                    onClick={() => navigate(`/employees/${managerId}`)}
                    className="text-[15px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {managerName}
                  </button>
                </div>
              )}
              {/* Only the actions we actually have data for — a colleague's
                  payload carries no phone at all, so no greyed-out dial. */}
              {mailHref && (
                <div className="flex sm:justify-end items-center gap-2">
                  <a href={mailHref} title={`Email ${emp.email}`} className={btnBase}><MessageSquare size={15}/></a>
                  {telHref && <a href={telHref} title={`Call ${phoneNum}`} className={btnBase}><Phone size={15}/></a>}
                </div>
              )}
            </div>
          </section>

          <div className="flex border-b border-slate-200 bg-white rounded-t-md">
            {[
              { key: 'profile',    label: 'Profile'    },
              { key: 'department', label: 'Department' },
              { key: 'peers',      label: 'Peers'      },
            ].map(t => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-6 py-3 text-[15px] font-semibold border-b-[2.5px] transition-colors -mb-px ${
                    active
                      ? 'border-[#1a73e8] text-[#1a73e8]'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'profile' && (
            <>
              <Section title="Profile">
                <Row label="Location">{emp.workLocation}</Row>
                <Row label="Department">{emp.department}</Row>
                <Row label="Shift">
                  {emp.shift?.name
                    ? <>{emp.shift.name}{range && <span className="text-slate-500 font-normal"> · {range}</span>}</>
                    : null}
                </Row>
                <Row label="Email address">{emp.email}</Row>
              </Section>

              <Section title="Organization Structure">
                <Row label="Department">{emp.department}</Row>
              </Section>
            </>
          )}

          {tab === 'department' && (
            department ? (
              <PeopleGrid
                loading={peopleLoading}
                failed={peopleFailed}
                people={people}
                emptyText={`No one else is listed under ${department}.`}
                onOpen={(pid) => navigate(`/employees/${pid}`)}
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-md text-center py-16 text-slate-400 text-base">
                {fullName} is not in a department.
              </div>
            )
          )}

          {tab === 'peers' && (
            managerId ? (
              <PeopleGrid
                loading={peopleLoading}
                failed={peopleFailed}
                people={people}
                emptyText="Nobody else reports to the same manager."
                onOpen={(pid) => navigate(`/employees/${pid}`)}
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-md text-center py-16 text-slate-400 text-base">
                {fullName} has no reporting person set.
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f5f6f8] min-h-screen">
      {/* Sticky header */}
      {header}

      {/* Hero card */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <section className="bg-white border border-slate-200 rounded-md p-6 flex items-center gap-5">
          <Avatar photoUrl={emp.photoUrl} initials={initials} />
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
