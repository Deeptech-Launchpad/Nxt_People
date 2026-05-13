import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { User, Search } from 'lucide-react';
import api from '../utils/api';

/* ── Horizontal Tree (For Employee Tree) ────────────────────────── */
function HorizontalTree({ node, renderNode, isRoot = false }) {
  const hasChildren = node.children && node.children.length > 0;
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex items-center">
      <div className={`bg-white border ${isRoot ? 'border-blue-400 shadow-sm' : 'border-slate-200'} rounded-lg w-[220px] p-2.5 flex items-center gap-3 cursor-pointer hover:border-blue-400 transition-colors z-10 relative`}>
        {renderNode(node)}
      </div>
      
      {hasChildren && (
        <div className="flex items-center">
           <div className="w-6 h-[1.5px] bg-blue-500"></div>
           <div 
             className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 cursor-pointer select-none rounded-sm shadow-sm z-10 hover:bg-blue-600 font-bold" 
             onClick={() => setExpanded(!expanded)}
           >
             {node.children.length}
           </div>
           {expanded && (
             <>
               <div className="w-6 h-[1.5px] bg-blue-500"></div>
               <div className="flex flex-col relative py-1">
                 {node.children.map((child, i) => (
                   <div key={child._id || child.id || i} className="flex items-center relative py-2 pl-6">
                     <div className="absolute left-0 top-1/2 w-6 h-[1.5px] bg-blue-500"></div>
                     {node.children.length > 1 && (
                       <div className="absolute left-0 w-[1.5px] bg-blue-500" 
                            style={{
                               top: i === 0 ? '50%' : '0',
                               bottom: i === node.children.length - 1 ? '50%' : '0'
                            }}>
                       </div>
                     )}
                     <HorizontalTree node={child} renderNode={renderNode} />
                   </div>
                 ))}
               </div>
             </>
           )}
        </div>
      )}
    </div>
  );
}

function buildEmployeeTree(employees) {
  const map = {};
  const roots = [];
  employees.forEach(e => { map[e._id] = { ...e, children: [] }; });
  employees.forEach(e => {
    if (e.reportingManagerId && map[e.reportingManagerId]) {
      map[e.reportingManagerId].children.push(map[e._id]);
    } else {
      roots.push(map[e._id]);
    }
  });
  return roots;
}

export default function OrgChart() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const location = useLocation();
  const isDepartmentTree = location.pathname === '/dept-tree';

  // For department tree
  const [selectedDept, setSelectedDept] = useState('Software');

  useEffect(() => {
    api.get('/employees?limit=200&status=active')
       .then(r => setEmployees(r.data.data || []))
       .catch(console.error)
       .finally(() => setLoading(false));
  }, []);

  const filteredEmployees = employees.filter(e => 
    `${e.firstName} ${e.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.department || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const empTree = buildEmployeeTree(filteredEmployees);

  const renderEmpNode = (node) => (
    <>
      <div className="w-10 h-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center flex-shrink-0 text-slate-500 overflow-hidden">
         {node.firstName ? (
            <img src={`https://ui-avatars.com/api/?name=${node.firstName}+${node.lastName}&background=f8f9fc&color=475569`} alt="avatar" className="w-full h-full object-cover" />
         ) : <User size={20} />}
      </div>
      <div className="min-w-0 flex-1">
         <p className="text-[13px] font-bold text-slate-800 truncate">{node.firstName} {node.lastName}</p>
         <p className="text-[11px] text-slate-500 truncate mt-0.5">{node.designation || node.role}</p>
      </div>
    </>
  );

  /* ── Department Tree Render ────────────────────────────────────────── */
  if (isDepartmentTree) {
    // Generate mock departments combined with real data
    const deptsMap = {};
    filteredEmployees.forEach(e => {
      const d = e.department || 'Unassigned';
      if (!deptsMap[d]) deptsMap[d] = [];
      deptsMap[d].push(e);
    });

    // We map real data directly
    const deptsList = Object.keys(deptsMap).map(dName => ({
      name: dName,
      count: deptsMap[dName].length,
      prefix: dName.substring(0, 2).toUpperCase(),
      employees: deptsMap[dName]
    }));

    // Selected Dept Employees
    const activeDept = deptsList.find(d => d.name === selectedDept) || deptsList[0] || null;
    const displayEmployees = activeDept?.employees || [];

    return (
      <div className="bg-white min-h-[calc(100vh-120px)] border-t border-slate-200">
        <div className="flex h-full">
          {/* Left Column - Departments */}
          <div className="w-[380px] p-8 border-r border-slate-100 flex flex-col gap-3">
            {deptsList.map(dept => {
              const isActive = selectedDept === dept.name;
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

          {/* Right Column - Employees */}
          <div className="flex-1 p-8">
            <div className="flex flex-col gap-4 max-w-[320px]">
              {displayEmployees.map((emp, idx) => (
                <div key={idx} className="flex items-center gap-4 p-2 rounded-lg border border-slate-100">
                  <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden flex-shrink-0">
                    <img 
                      src={`https://ui-avatars.com/api/?name=${emp.firstName}+${emp.lastName || ''}&background=f8f9fc&color=475569`} 
                      alt="avatar" 
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

  /* ── Employee Tree Render ──────────────────────────────────────────── */
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[calc(100vh-10rem)]">
      {/* Toolbar */}
      <div className="p-4 border-b border-slate-100 flex justify-end bg-white z-10 shadow-sm rounded-t-xl">
         <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search employee..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-1.5 border border-slate-200 rounded text-sm w-72 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all bg-white shadow-inner" 
            />
         </div>
      </div>

      {/* Content Area - horizontal scrollable canvas */}
      <div className="flex-1 overflow-auto p-10 bg-[#f8f9fc]">
        {loading ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="flex flex-col gap-12 min-w-max">
            {empTree.length === 0 ? <p className="text-slate-400 text-sm">No employees found.</p> : empTree.map(root => <HorizontalTree key={root._id} node={root} renderNode={renderEmpNode} isRoot={true} />)}
          </div>
        )}
      </div>
    </div>
  );
}
