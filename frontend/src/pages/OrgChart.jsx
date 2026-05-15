import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, Search, Eye, MessageSquare, Video, Phone, ChevronRight } from 'lucide-react';
import api from '../utils/api';

/* ───────────────────────────────────────────────────────────────────────
 *  Employee Tree — Zoho-People-style horizontal columns.
 *  Click a card → that person's direct reports appear in a new column to
 *  the right. Click a different card in the same column → the columns to
 *  its right are replaced with that person's reports. Hover a card → a
 *  popover surfaces full contact info + action buttons.
 *
 *  Department Tree mode is the older two-column layout, kept as-is.
 * ─────────────────────────────────────────────────────────────────────── */

const PHOTO_FALLBACK = (firstName, lastName) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName || '')}+${encodeURIComponent(lastName || '')}&background=f1f5f9&color=475569`;

/* ── Single employee card used inside every column ─────────────────────── */
function EmployeeCard({ emp, isSelected, childCount, onClick, onAction }) {
  const [hover, setHover] = useState(false);
  const photo = emp.photoUrl || PHOTO_FALLBACK(emp.firstName, emp.lastName);

  return (
    <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={onClick}
        className={`w-full bg-white border rounded-lg p-2.5 flex items-center gap-3 transition-all text-left
          ${isSelected
            ? 'border-blue-400 ring-2 ring-blue-100 shadow'
            : 'border-slate-200 hover:border-blue-300 hover:shadow-sm'}`}
      >
        <div className="w-9 h-9 rounded border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center text-slate-400 flex-shrink-0">
          {emp.photoUrl
            ? <img src={photo} alt="" className="w-full h-full object-cover" />
            : <User size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-slate-800 truncate">{emp.firstName} {emp.lastName}</p>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{emp.designation || emp.role || 'Employee'}</p>
        </div>
        {childCount > 0 && (
          <span className="ml-1 text-[10.5px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-sm flex-shrink-0">
            {childCount}
          </span>
        )}
      </button>

      {hover && (
        <div className="absolute left-0 top-full mt-1.5 z-30 w-[260px] bg-white border border-slate-200 rounded-lg shadow-2xl p-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0">
              {emp.photoUrl
                ? <img src={photo} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-slate-400"><User size={22} /></div>}
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-slate-800 truncate">
                {emp.employeeId && <span className="text-slate-500 font-mono mr-1">{emp.employeeId}</span>}
                {emp.firstName} {emp.lastName}
              </p>
              <p className="text-[11px] text-blue-600 hover:underline truncate">
                {emp.email && <a href={`mailto:${emp.email}`}>{emp.email}</a>}
              </p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {emp.designation || emp.role || 'Employee'}
                {emp.department && <span className="text-slate-400"> · {emp.department}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              title="View profile"
              onClick={(e) => { e.stopPropagation(); onAction('view', emp); }}
              className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center"
            >
              <Eye size={13} />
            </button>
            <a
              title="Send email"
              href={emp.email ? `mailto:${emp.email}` : '#'}
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center"
            >
              <MessageSquare size={13} />
            </a>
            <button
              type="button"
              title="Video call (coming soon)"
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center"
            >
              <Video size={13} />
            </button>
            <a
              title="Call"
              href={emp.phone ? `tel:${emp.phone}` : '#'}
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center"
            >
              <Phone size={13} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgChart() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Path of selected manager ids — each entry opens the next column.
  // [] means only the root column is shown.
  const [selectedPath, setSelectedPath] = useState([]);

  const location = useLocation();
  const navigate = useNavigate();
  const isDepartmentTree = location.pathname === '/dept-tree';
  const [selectedDept, setSelectedDept] = useState('Software');

  useEffect(() => {
    api.get('/employees?limit=200&status=active')
       .then(r => setEmployees(r.data.data || []))
       .catch(console.error)
       .finally(() => setLoading(false));
  }, []);

  /* ── Index employees + relationships once per render ─────────────────── */
  const empMap     = Object.fromEntries(employees.map(e => [e._id, e]));
  const childrenOf = {};
  for (const e of employees) {
    const mgr = e.reportingManagerId;
    if (mgr && empMap[mgr]) (childrenOf[mgr] = childrenOf[mgr] || []).push(e);
  }
  const roots = employees.filter(e => !e.reportingManagerId || !empMap[e.reportingManagerId]);

  /* ── Search filter is applied flat across all employees ──────────────── */
  const filterMatch = (e) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
        || (e.designation || '').toLowerCase().includes(q)
        || (e.department  || '').toLowerCase().includes(q)
        || (e.employeeId  || '').toLowerCase().includes(q);
  };

  /* ── Build the visible columns from the selected path ────────────────── */
  const columns = [];
  // Column 0: roots
  columns.push(roots.filter(filterMatch));
  // Subsequent columns: direct reports of the selected employee in the previous column
  for (const selId of selectedPath) {
    columns.push((childrenOf[selId] || []).filter(filterMatch));
  }

  const handleSelect = (depth, empId) => {
    // Trim the path to this depth + push the new selection.
    setSelectedPath(prev => [...prev.slice(0, depth), empId]);
  };

  const handleAction = (action, emp) => {
    if (action === 'view') navigate(`/employees?search=${encodeURIComponent(emp.employeeId || emp.email || '')}`);
  };

  /* ── Department Tree Render (unchanged) ──────────────────────────────── */
  if (isDepartmentTree) {
    const filteredEmployees = employees.filter(filterMatch);
    const deptsMap = {};
    filteredEmployees.forEach(e => {
      const d = e.department || 'Unassigned';
      (deptsMap[d] = deptsMap[d] || []).push(e);
    });
    const deptsList = Object.keys(deptsMap).map(dName => ({
      name: dName,
      count: deptsMap[dName].length,
      prefix: dName.substring(0, 2).toUpperCase(),
      employees: deptsMap[dName]
    }));
    const activeDept = deptsList.find(d => d.name === selectedDept) || deptsList[0] || null;
    const displayEmployees = activeDept?.employees || [];

    return (
      <div className="bg-white min-h-[calc(100vh-120px)] border-t border-slate-200">
        <div className="flex h-full">
          <div className="w-[380px] p-8 border-r border-slate-100 flex flex-col gap-3">
            {deptsList.map(dept => {
              const isActive = (activeDept?.name) === dept.name;
              return (
                <div
                  key={dept.name}
                  onClick={() => setSelectedDept(dept.name)}
                  className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isActive ? 'border-[#3b82f6] shadow-[0_0_0_1px_rgba(59,130,246,0.2)]' : 'border-slate-100 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 flex items-center justify-center text-[12px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded">
                      {dept.prefix}
                    </div>
                    <span className="text-[13px] font-bold text-slate-800">{dept.name}</span>
                  </div>
                  <div className={`text-[12px] font-bold px-2.5 py-0.5 rounded border ${
                    isActive ? 'bg-[#3b82f6] text-white border-[#3b82f6]' : 'bg-white text-slate-500 border-slate-200'
                  }`}>
                    {dept.count}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex-1 p-8">
            <div className="flex flex-col gap-4 max-w-[320px]">
              {displayEmployees.map((emp, idx) => (
                <div key={idx} className="flex items-center gap-4 p-2 rounded-lg border border-slate-100">
                  <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden flex-shrink-0">
                    <img
                      src={emp.photoUrl || PHOTO_FALLBACK(emp.firstName, emp.lastName)}
                      alt=""
                      className="w-full h-full object-cover opacity-80"
                    />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-800">{emp.firstName} {emp.lastName}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{emp.designation || 'Employee'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Employee Tree Render — column-based ─────────────────────────────── */
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[calc(100vh-10rem)]">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10 rounded-t-xl">
        <p className="text-[13px] text-slate-500">
          Click a card to expand their direct reports. Hover for contact info.
        </p>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, designation, dept..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setSelectedPath([]); }}
            className="pl-9 pr-4 py-1.5 border border-slate-200 rounded text-sm w-72 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-[#f8f9fc]">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex items-start gap-3 min-w-max">
            {columns.map((colEmps, depth) => (
              <React.Fragment key={depth}>
                <div className="w-[260px] flex-shrink-0 flex flex-col gap-2">
                  {colEmps.length === 0 ? (
                    <p className="text-[12px] text-slate-400 italic px-2">No reports</p>
                  ) : (
                    colEmps.map(emp => (
                      <EmployeeCard
                        key={emp._id}
                        emp={emp}
                        isSelected={selectedPath[depth] === emp._id}
                        childCount={(childrenOf[emp._id] || []).length}
                        onClick={() => handleSelect(depth, emp._id)}
                        onAction={handleAction}
                      />
                    ))
                  )}
                </div>
                {depth < columns.length - 1 && (
                  <ChevronRight size={16} className="text-slate-300 mt-3 flex-shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
