import React, { useState, useEffect } from 'react';
import { Search, Phone, ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

export default function TeamAttendance() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    setLoading(true);
    api.get(`/attendance/team?date=${date}`)
      .then(r => {
        setEmployees(r.data.employees || []);
        setAttendance(r.data.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  /* ── Build a map: employeeId → attendance record ── */
  const attMap = {};
  attendance.forEach(a => {
    if (a.employee?._id) attMap[a.employee._id] = a;
  });

  /* ── Split into "In" / "Out" groups ── */
  const allPeople = employees.map(e => ({
    ...e,
    att: attMap[e._id] || null,
  }));

  const filtered = allPeople.filter(p =>
    !searchTerm ||
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.employeeId || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const checkedIn  = filtered.filter(p => p.att?.checkIn && !p.att?.checkOut);
  const checkedOut = filtered.filter(p => p.att?.checkOut);
  const notYet     = filtered.filter(p => !p.att?.checkIn);

  const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) : null;

  const MemberCard = ({ person }) => {
    const att = person.att;
    const isIn = att?.checkIn && !att?.checkOut;
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-all">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center flex-shrink-0 border border-slate-200 overflow-hidden">
            <img
              src={`https://ui-avatars.com/api/?name=${person.firstName}+${person.lastName}&background=e0e7ff&color=4f46e5&size=40`}
              alt={person.firstName}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-slate-800 truncate">
              {person.employeeId && <span className="text-slate-500 font-normal">{person.employeeId} - </span>}
              {person.firstName} {person.lastName}
            </p>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {person.department || 'No Department'}{person.workLocation ? `, ${person.workLocation}` : ''}
            </p>
          </div>

          {/* Phone icon — only shown when the employee has a number on record */}
          {person.phone && (
            <a href={`tel:${person.phone}`} className="text-slate-300 hover:text-blue-500 transition-colors flex-shrink-0">
              <Phone size={15} />
            </a>
          )}
        </div>

        {/* Shift info */}
        <div className="mt-2.5 pl-[52px]">
          {person.shift?.name && (
            <p className="text-[13px] text-slate-500">
              {person.shift.name}{person.shift.start_time && person.shift.end_time ? ` · ${person.shift.start_time} - ${person.shift.end_time}` : ''}
            </p>
          )}
          {att?.checkIn && (
            <p className="text-[13px] text-slate-400 mt-0.5">
              In: {fmtTime(att.checkIn)}
              {att.checkOut && <> · Out: {fmtTime(att.checkOut)}</>}
            </p>
          )}
        </div>
      </div>
    );
  };

  const GroupSection = ({ title, count, people, statusColor }) => (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <h3 className="text-[15px] font-semibold text-slate-700">{title}</h3>
        <span className="ml-auto text-[14px] font-bold text-slate-500">{count}</span>
      </div>
      <div className="space-y-2.5">
        {people.map(p => <MemberCard key={p._id} person={p} />)}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f2f3f7] pb-10">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 shadow-sm sticky top-0 z-30">
        <h2 className="text-[16px] font-bold text-slate-800 border-b-2 border-blue-500 pb-[10px] -mb-3">
          Team Members
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors">
            <Search size={15} />
          </button>
        </div>
      </div>

      <div className="px-6 pt-5">
        {/* Search + filters */}
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search members..."
              className="w-full pl-9 pr-4 py-2 text-[14px] border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition bg-white"
            />
          </div>
          <input
            type="date"
            value={date}
            max={new Date().toLocaleDateString('en-CA')}
            onChange={e => {
              // Defensive clamp — also rejects future dates pasted manually.
              const today = new Date().toLocaleDateString('en-CA');
              setDate(e.target.value > today ? today : e.target.value);
            }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 bg-white text-slate-600"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-7 h-7 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="max-w-[480px]">
            {checkedIn.length > 0 && (
              <GroupSection title="In" count={checkedIn.length} people={checkedIn} statusColor="bg-emerald-500" />
            )}
            {checkedOut.length > 0 && (
              <GroupSection title="Checked Out" count={checkedOut.length} people={checkedOut} statusColor="bg-slate-400" />
            )}
            {notYet.length > 0 && (
              <GroupSection title="Not Yet Checked In" count={notYet.length} people={notYet} statusColor="bg-slate-300" />
            )}
            {filtered.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <p className="text-[15px]">No team members found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
