import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import api from '../../utils/api';

// Optional single-employee narrowing filter for the multi-employee table
// reports (Booked & Balance, Leave Type Summary, LOP, Payroll export) —
// reuses the existing employee search endpoint, same pattern as Leave
// Balance's picker.
export default function EmployeeFilter({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/employees?search=${encodeURIComponent(query.trim())}&limit=10`)
        .then(r => setResults(r.data.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setShowResults(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const select = emp => {
    onChange(emp);
    setQuery('');
    setShowResults(false);
  };

  if (value) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-blue-200 bg-blue-50 text-blue-700">
        Employee: {value.firstName} {value.lastName} ({value.employeeId})
        <button onClick={() => onChange(null)} className="text-blue-400 hover:text-blue-600"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
          placeholder="Employee"
          className="w-40 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
        />
      </div>
      {showResults && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          {results.map(emp => (
            <button key={emp._id} onClick={() => select(emp)} className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">
              <span className="font-medium">{emp.firstName} {emp.lastName}</span>
              <span className="text-slate-400 ml-1.5">({emp.employeeId})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
