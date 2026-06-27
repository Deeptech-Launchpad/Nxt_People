import React, { useState, useEffect } from 'react';
import { Search, Phone, Mail, Building2, Users, X, ChevronDown } from 'lucide-react';
import api from '../utils/api';

function EmployeeCard({ emp }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all duration-200 overflow-hidden flex flex-col items-center p-6">
      <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-end justify-center overflow-hidden mb-4 border border-slate-200">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 text-slate-300 translate-y-2">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      </div>
      <h3 className="font-semibold text-slate-800 text-[14px] text-center">{emp.firstName} {emp.lastName}</h3>
      <p className="text-[12px] text-slate-500 mt-1 text-center">{emp.designation || '—'}</p>
      
      <div className="w-full mt-5 space-y-2 border-t border-slate-100 pt-4">
        {emp.email && (
          <div className="flex items-center gap-2 text-[11px] text-slate-600" title={emp.email}>
            <Mail size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.email}</span>
          </div>
        )}
        {emp.phone && (
          <div className="flex items-center gap-2 text-[11px] text-slate-600">
            <Phone size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.phone}</span>
          </div>
        )}
        {emp.employeeId && (
          <div className="flex items-center gap-2 text-[11px] text-slate-600">
            <Building2 size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate">{emp.employeeId}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Directory() {
  const [employees, setEmployees] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  
  // Filters
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDesignation, setSelectedDesignation] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [loading, setLoading] = useState(true);

  // Extract unique values
  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
  const designations = [...new Set(employees.map(e => e.designation).filter(Boolean))].sort();
  const locations = [...new Set(employees.map(e => e.location).filter(Boolean))].sort();

  useEffect(() => {
    api.get('/employees?limit=200&status=active').then(r => {
      const emps = r.data.data || [];
      setEmployees(emps);
      setFiltered(emps);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let result = employees;
    if (selectedDept) result = result.filter(e => e.department === selectedDept);
    if (selectedDesignation) result = result.filter(e => e.designation === selectedDesignation);
    if (selectedLocation) result = result.filter(e => e.location === selectedLocation);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        `${e.firstName} ${e.lastName} ${e.email} ${e.designation} ${e.department} ${e.employeeId}`.toLowerCase().includes(q)
      );
    }
    setFiltered(result);
  }, [search, selectedDept, selectedDesignation, selectedLocation, employees]);

  const clearFilters = () => {
    setSearch('');
    setSelectedDept('');
    setSelectedDesignation('');
    setSelectedLocation('');
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 items-start">
      {/* Left Sidebar Filter */}
      <div className="w-full md:w-64 flex-shrink-0 bg-white border border-slate-200 rounded-lg p-4 sticky top-4 hidden md:block shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-700">
            <Search size={14} />
            <h3 className="text-[13px] font-bold">Search Employee</h3>
          </div>
          <button onClick={clearFilters} className="text-slate-400 hover:text-slate-700" title="Clear Filters">
             <X size={14} />
          </button>
        </div>
        
        <input 
          type="text" 
          placeholder="Search" 
          className="w-full border border-slate-200 rounded text-[12px] px-3 py-2 mb-4 focus:outline-none focus:border-blue-400"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className="space-y-4">
          {/* Department Filter */}
          <div>
            <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700 mb-2 cursor-pointer">
              <span>Department</span>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
            <select className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] text-slate-600 focus:outline-none focus:border-blue-400" value={selectedDept} onChange={e=>setSelectedDept(e.target.value)}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Location Filter */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700 mb-2 cursor-pointer">
              <span>Location</span>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
            <select className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] text-slate-600 focus:outline-none focus:border-blue-400" value={selectedLocation} onChange={e=>setSelectedLocation(e.target.value)}>
              <option value="">All Locations</option>
              {locations.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Designation Filter */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-[12px] font-semibold text-slate-700 mb-2 cursor-pointer">
              <span>Designation</span>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
            <select className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] text-slate-600 focus:outline-none focus:border-blue-400" value={selectedDesignation} onChange={e=>setSelectedDesignation(e.target.value)}>
              <option value="">All Designations</option>
              {designations.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 w-full min-w-0">
        <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4 shadow-sm flex items-center justify-between">
           <h2 className="text-[15px] font-bold text-slate-800">Directory</h2>
           <span className="text-[12px] text-slate-500">{filtered.length} Employees</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm text-center py-20">
            <Users size={40} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium text-sm">No employees match the filters</p>
            <button onClick={clearFilters} className="text-blue-600 hover:text-blue-700 text-[12px] font-semibold mt-2">Clear Filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(emp => <EmployeeCard key={emp._id} emp={emp} />)}
          </div>
        )}
      </div>
    </div>
  );
}
