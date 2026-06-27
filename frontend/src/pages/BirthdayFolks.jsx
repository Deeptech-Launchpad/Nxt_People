/**
 * BirthdayFolks.jsx — Organization / Birthday Folks Page
 * Matches screenshot: date-badged photo cards grid (6 across), month navigation, filter dropdown
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, Star, Phone, Calendar } from 'lucide-react';
import api from '../utils/api';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function BirthdayFolks() {
  const today = new Date();
  const [month, setMonth]     = useState(today.getMonth()); // 0-indexed
  const [year, setYear]       = useState(today.getFullYear());
  const [filter, setFilter]   = useState('current'); // 'current' | 'all'
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [starred, setStarred]     = useState({}); // empId → bool

  const load = useCallback(() => {
    setLoading(true);
    // Try the dedicated birthday endpoint first, fall back to employees list
    api.get(`/org/birthdays?month=${month + 1}&year=${year}`)
      .then(r => setEmployees(r.data.data || []))
      .catch(() => {
        // Fallback: filter employees locally
        api.get('/employees?limit=500&status=active')
          .then(r => {
            const all = r.data.data || [];
            const filtered = all.filter(e => {
              if (!e.dateOfBirth) return false;
              const dob = new Date(e.dateOfBirth);
              return dob.getMonth() === month;
            }).sort((a, b) => {
              const da = new Date(a.dateOfBirth).getDate();
              const db = new Date(b.dateOfBirth).getDate();
              return da - db;
            });
            setEmployees(filtered);
          }).catch(() => setEmployees([]));
      })
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const toggleStar = (id) => {
    setStarred(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filtered = employees.filter(e => {
    if (!search) return true;
    const name = `${e.firstName || e.first_name} ${e.lastName || e.last_name}`.toLowerCase();
    return name.includes(search.toLowerCase()) ||
           (e.employeeId || e.employee_id || '').toLowerCase().includes(search.toLowerCase()) ||
           (e.email || '').toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full font-sans" style={{ background: '#f4f5f7' }}>
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-4 flex-shrink-0">
        {/* Filter dropdown */}
        <div className="relative">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="appearance-none border border-gray-200 rounded px-3 py-1.5 pr-7 text-[13px] font-semibold text-gray-700 bg-white outline-none focus:border-blue-400 cursor-pointer"
          >
            <option value="current">Current Month</option>
            <option value="all">All Months</option>
          </select>
          <ChevronRight size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 rotate-90 pointer-events-none" />
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft size={15} />
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors"
            onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); }}>
            <Calendar size={14} />
          </button>
          <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronRight size={15} />
          </button>
          <span className="text-[13px] font-bold text-gray-800 min-w-[110px] text-center">
            {MONTHS[month]} - {year}
          </span>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          {showSearch && (
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, ID..."
              className="border border-gray-200 rounded px-3 py-1.5 text-[12.5px] w-48 outline-none focus:border-blue-400"
              onBlur={() => { if (!search) setShowSearch(false); }}
            />
          )}
          <button onClick={() => setShowSearch(v => !v)}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <Search size={15} />
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="grid grid-cols-6 gap-4">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
                <div className="w-8 h-8 bg-gray-100 rounded mb-3" />
                <div className="w-full h-24 bg-gray-100 rounded mb-2" />
                <div className="h-3 bg-gray-100 rounded w-3/4 mb-1.5" />
                <div className="h-2.5 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4">
              <span className="text-3xl">🎂</span>
            </div>
            <p className="text-[14px] font-bold text-gray-500">No birthdays in {MONTHS[month]}</p>
            <p className="text-[12.5px] text-gray-400 mt-1">Navigate to other months to find upcoming birthdays</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filtered.map(emp => {
              const dob = emp.dateOfBirth ? new Date(emp.dateOfBirth) : null;
              const firstName = emp.firstName || emp.first_name || '';
              const lastName  = emp.lastName  || emp.last_name  || '';
              const empId     = emp.employeeId || emp.employee_id || '';
              const day       = dob ? dob.getDate() : null;
              const mon       = dob ? MONTH_SHORT[dob.getMonth()] : '';
              const isTodayBday = dob && dob.getDate() === today.getDate() && dob.getMonth() === today.getMonth();
              const avatarUrl = emp.photoUrl || emp.photo_url
                ? (emp.photoUrl || emp.photo_url)
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=e8f0fe&color=1a73e8&size=80&bold=true`;

              return (
                <div key={emp._id || emp.id}
                  className={`bg-white rounded-lg border shadow-sm overflow-hidden hover:shadow-md transition-shadow relative cursor-pointer group
                    ${isTodayBday ? 'border-pink-300 ring-1 ring-pink-300' : 'border-gray-200'}`}>
                  {/* Date badge top-left */}
                  {day && (
                    <div className={`absolute top-0 left-0 flex flex-col items-center justify-center w-[46px] h-[50px] z-10
                      ${isTodayBday ? 'bg-pink-500 text-white' : 'bg-gray-800 text-white'}`}
                      style={{ borderBottomRightRadius: '8px' }}>
                      <span className="text-[15px] font-black leading-tight">{day}</span>
                      <span className="text-[9px] font-bold uppercase leading-tight">{mon}</span>
                    </div>
                  )}

                  {/* Action icons top-right */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
                    <button onClick={e => { e.stopPropagation(); toggleStar(emp._id || emp.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                      <Star size={13} className={starred[emp._id || emp.id] ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); if (emp.phone) window.open(`tel:${emp.phone}`); }}
                      className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                      <Phone size={12} className="text-gray-300 hover:text-green-500 transition-colors" />
                    </button>
                  </div>

                  {/* Photo */}
                  <div className="pt-12 pb-3 px-3">
                    <div className="flex justify-center mb-3">
                      <img
                        src={avatarUrl}
                        alt={firstName}
                        className="w-[72px] h-[72px] rounded object-cover border border-gray-100"
                        onError={e => {
                          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=e8f0fe&color=1a73e8&size=80&bold=true`;
                        }}
                      />
                    </div>

                    {/* Info */}
                    <div className="text-center">
                      <p className="text-[11.5px] font-bold text-gray-700 leading-tight">
                        {empId} - {firstName} {lastName}
                      </p>
                      <p className="text-[10.5px] text-gray-400 mt-0.5 truncate">{emp.email || emp.workEmail || ''}</p>
                      <p className="text-[10.5px] text-gray-500 mt-0.5 leading-tight truncate">{emp.designation || emp.role}</p>
                      <p className="text-[10px] text-gray-400 truncate">{emp.department}</p>
                    </div>
                  </div>

                  {/* Today badge */}
                  {isTodayBday && (
                    <div className="bg-pink-50 border-t border-pink-100 px-2 py-1 text-center">
                      <span className="text-[10.5px] font-bold text-pink-500">🎂 Birthday Today!</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
