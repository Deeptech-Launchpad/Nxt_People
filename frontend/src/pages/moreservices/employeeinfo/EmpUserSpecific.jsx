import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Search, X, ArrowLeft, Pencil, Building2, Mail, Shield, Briefcase,
  Phone, Hash, MapPin, Armchair, ChevronDown,
} from 'lucide-react';
import api from '../../../utils/api';
import EmployeeEditModal from './EmployeeEditModal';

/* Operations -> Employee Information -> User-specific Operations.
 *
 * Search for somebody, then work on that one person: their profile, and the
 * audit trail of what changed on it.
 *
 * The Audit History tab reads the same audit_log the Audit page does. It will
 * be EMPTY for historic changes and says so — employee updates only began
 * recording old -> new when that logging was fixed, and no amount of UI can
 * invent a before-value that was never written down.
 */
const fmtDate = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—');
const fmtWhen = d => (d ? new Date(d).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const dash = v => (v === null || v === undefined || v === '' ? '—' : v);

const Tile = ({ icon, label, value }) => (
  <div className="flex items-start gap-3">
    <span className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
      {icon}
    </span>
    <div className="min-w-0">
      <p className="text-[13px] text-slate-400">{label}</p>
      <p className="text-[15px] text-slate-800 truncate">{dash(value)}</p>
    </div>
  </div>
);

const Section = ({ title, rows }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5">
    <h3 className="text-[16px] font-semibold text-slate-800 pb-3 mb-4 border-b border-slate-100">{title}</h3>
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-slate-50 pb-2.5">
          <dt className="text-[14px] text-slate-500">{k}</dt>
          <dd className="text-[15px] text-slate-800 text-right">{dash(v)}</dd>
        </div>
      ))}
    </dl>
  </div>
);

function AuditHistory({ employeeId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    setLoading(true);
    api.get(`/audit?resource=Employee&resourceId=${employeeId}&limit=100`)
      .then(r => setRows(r.data.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);

  if (loading) {
    return <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!rows.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
        <p className="text-slate-700 text-[16px] font-medium">Nothing recorded yet.</p>
        <p className="text-slate-500 text-[14px] mt-1.5 max-w-lg mx-auto">
          Changes to this profile are recorded from now on, with the old and new value of every
          field. Edits made before this was wired were never stored with a before-value, so they
          cannot be shown here.
        </p>
      </div>
    );
  }

  // Grouped by year, newest first, the way the reference stacks its timeline.
  const byYear = rows.reduce((acc, r) => {
    const y = new Date(r.createdAt).getFullYear();
    (acc[y] = acc[y] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.keys(byYear).sort((a, b) => b - a).map(year => (
        <div key={year}>
          <h3 className="text-[20px] font-semibold text-slate-800 mb-3">{year}</h3>
          <div className="space-y-3">
            {byYear[year].map(r => {
              const fields = r.changes?.fields || [];
              const open = !!expanded[r._id];
              const show = open ? fields : fields.slice(0, 3);
              const when = new Date(r.createdAt);
              return (
                <div key={r._id} className="flex gap-4">
                  <div className="w-12 flex-shrink-0 text-center pt-3">
                    <p className="text-[19px] font-semibold text-slate-700 leading-none">{when.getDate()}</p>
                    <p className="text-[13px] text-slate-400">{when.toLocaleDateString('en-GB', { month: 'short' })}</p>
                  </div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[14px] text-slate-600 font-medium">
                        {r.actor?.firstName ? `${r.actor.firstName} ${r.actor.lastName || ''}`.trim()
                          : (r.actor?.email || 'Unknown')}
                      </p>
                      <span className="text-[12.5px] text-slate-400">{fmtWhen(r.createdAt)}</span>
                    </div>
                    {fields.length === 0 ? (
                      <p className="text-[14px] text-slate-500">{r.changes?.summary || r.action}</p>
                    ) : (
                      <table className="w-full text-[14px]">
                        <tbody>
                          {show.map((f, i) => (
                            <tr key={i} className="border-t border-slate-50 first:border-0">
                              <td className="py-1.5 pr-4 text-slate-500 w-1/3">
                                {String(f.field).replace(/_/g, ' ')}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-400">{dash(String(f.from ?? ''))}</td>
                              <td className="py-1.5 w-6 text-slate-300">→</td>
                              <td className="py-1.5 text-slate-800 font-medium">{dash(String(f.to ?? ''))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {fields.length > 3 && (
                      <button onClick={() => setExpanded(e => ({ ...e, [r._id]: !open }))}
                        className="text-[13.5px] text-brand-600 hover:text-brand-700 mt-2">
                        {open ? 'Show less' : `${fields.length - 3} More`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EmpUserSpecific() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('employeeId');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [person, setPerson] = useState(null);
  const [tab, setTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?limit=10&search=${encodeURIComponent(q.trim())}`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!selectedId) { setPerson(null); return; }
    setLoading(true);
    api.get(`/employees/${selectedId}`)
      .then(r => setPerson(r.data.data))
      .catch(err => toast.error(err.response?.data?.message || 'Could not open that employee'))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const select = (p) => {
    const next = new URLSearchParams(params);
    next.set('employeeId', p._id);
    setParams(next, { replace: true });
    setQ(''); setResults([]);
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    next.delete('employeeId');
    setParams(next, { replace: true });
  };

  if (!selectedId) {
    return (
      <div className="py-16">
        <div className="max-w-2xl mx-auto">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Employee" autoFocus
              className="w-full border border-slate-200 rounded-xl pl-11 pr-10 py-3.5 text-[16px] bg-white shadow-sm focus:outline-none focus:border-brand-400" />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={17} />
              </button>
            )}
          </div>
          {results.length > 0 && (
            <div className="mt-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {results.map(p => (
                <button key={p._id} onClick={() => select(p)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3 border-b border-slate-50 last:border-0">
                  {p.photoUrl
                    ? <img src={p.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                    : <span className="w-9 h-9 rounded-full bg-slate-100" />}
                  <span>
                    <span className="block text-[15px] text-slate-800">{p.firstName} {p.lastName}</span>
                    <span className="block text-[13px] text-slate-400">{p.employeeId} · {p.designation || '—'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {!q && (
            <p className="text-center text-slate-400 text-[15px] mt-10">
              Please begin typing to search for an employee
            </p>
          )}
        </div>
      </div>
    );
  }

  if (loading || !person) {
    return <div className="flex justify-center py-24">
      <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <button onClick={clear}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ArrowLeft size={16} />
          </button>
          {person.photoUrl
            ? <img src={person.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
            : <span className="w-9 h-9 rounded-full bg-slate-100" />}
          <span className="text-[17px] font-semibold text-slate-800">
            {person.firstName} {person.lastName}
          </span>
          <span className="text-[14px] text-slate-400">{person.employeeId}</span>
        </div>
        {/* Opens the same editor the Employees tab uses, in place. It used to
            be a toast telling you to go somewhere else, which is not an edit. */}
        <button onClick={() => setEditing(true)}
          className="flex items-center gap-2 border border-brand-300 text-brand-600 px-4 h-10 rounded-lg text-[15px] font-medium hover:bg-brand-50">
          <Pencil size={15} /> Edit Profile
        </button>
      </div>

      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        {[['profile', 'Profile Information'], ['audit', 'Audit History']].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`pb-2.5 text-[15px] border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-brand-500 text-slate-800 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {editing && (
        <EmployeeEditModal
          employeeId={selectedId}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            // Re-read so the panel shows what was just saved.
            api.get(`/employees/${selectedId}`).then(r => setPerson(r.data.data)).catch(() => {});
          }}
        />
      )}

      {tab === 'profile' ? (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
            <Tile icon={<Building2 size={16} />} label="Department" value={person.department} />
            <Tile icon={<Mail size={16} />} label="Email address" value={person.email} />
            <Tile icon={<Shield size={16} />} label="Role" value={String(person.role || '').replace(/_/g, ' ')} />
            <Tile icon={<Briefcase size={16} />} label="Designation" value={person.designation} />
            <Tile icon={<Phone size={16} />} label="Work Phone Number" value={person.workPhone} />
            <Tile icon={<Hash size={16} />} label="Extension" value={person.extension} />
            <Tile icon={<MapPin size={16} />} label="Location" value={person.workLocation} />
            <Tile icon={<Armchair size={16} />} label="Employment Type" value={person.employmentType} />
          </div>

          <Section title="Basic information" rows={[
            ['Employee ID', person.employeeId],
            ['Nick name', person.nickName],
            ['First Name', person.firstName],
            ['Email address', person.email],
            ['Last Name', person.lastName],
            ['Personal Email Address', person.personalEmail],
          ]} />

          <Section title="Work Information" rows={[
            ['Department', person.department],
            ['Role', String(person.role || '').replace(/_/g, ' ')],
            ['Location', person.workLocation],
            ['Employment Type', person.employmentType],
            ['Designation', person.designation],
            ['Employee Status', person.status],
            ['Source of Hire', person.sourceOfHire],
            ['Date of Joining', fmtDate(person.dateOfJoining || person.joiningDate)],
            ['Total Experience', person.totalExperience],
            ['Date of Exit', fmtDate(person.exitDate)],
          ]} />

          <Section title="Personal Information" rows={[
            ['Date of Birth', fmtDate(person.dateOfBirth)],
            ['Gender', person.gender],
            ['Marital Status', person.maritalStatus],
            ['Blood Group', person.bloodGroup],
            ['Personal Mobile Number', person.phone],
            ['Nationality', person.nationality],
          ]} />

          <Section title="Hierarchy Information" rows={[
            ['Reporting Manager', person.manager
              ? `${person.manager.firstName || ''} ${person.manager.lastName || ''}`.trim() : ''],
            ['Approving Authority', person.approvingAuthority
              ? `${person.approvingAuthority.firstName || ''} ${person.approvingAuthority.lastName || ''}`.trim() : ''],
          ]} />

          <Section title="Address" rows={[
            ['Present Address', person.currentAddress || person.presentAddress || person.address],
            ['Permanent Address', person.permanentAddress],
          ]} />
        </div>
      ) : (
        <AuditHistory employeeId={selectedId} />
      )}
    </div>
  );
}
