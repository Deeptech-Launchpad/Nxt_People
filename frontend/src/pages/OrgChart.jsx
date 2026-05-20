import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { User, Search } from 'lucide-react';
import api from '../utils/api';

/* ── Square photo thumbnail. When no photo, a soft gray User silhouette
   (matches Zoho's placeholder — no initials, no coloured background). */
function Avatar({ size = 36, photoUrl, photoBroken, onPhotoError }) {
  const showPhoto = photoUrl && !photoBroken;
  return (
    <div
      className="rounded border border-slate-200 bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden text-slate-400"
      style={{ width: size, height: size }}
    >
      {showPhoto
        ? <img src={photoUrl} alt="" className="w-full h-full object-cover" onError={onPhotoError} />
        : <User size={Math.floor(size * 0.55)} strokeWidth={1.6} />}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 *  Employee Tree — Zoho-People-style horizontal columns.
 *  Click a card → that person's direct reports appear in a new column to
 *  the right. Click a different card in the same column → the columns to
 *  its right are replaced with that person's reports. Hover a card → a
 *  popover surfaces full contact info + action buttons.
 *
 *  Department Tree mode is the older two-column layout, kept as-is.
 * ─────────────────────────────────────────────────────────────────────── */

/* ── Single employee card.
   Both the card body AND the badge expand/collapse the node — matches
   Zoho's behaviour where clicking anywhere on a card opens that
   person's reports in the next column. The badge stays as a separate
   visual element (showing total team size) but its click does the same
   thing as the card click. */
function EmployeeCard({ emp, isExpanded, totalCount, onToggle, mini = false }) {
  const [photoBroken, setPhotoBroken] = useState(false);

  if (mini) {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          title={`${emp.firstName} ${emp.lastName}${emp.designation ? ' · ' + emp.designation : ''}`}
          className="bg-white p-0.5 transition-all hover:shadow-sm"
          style={{
            borderColor: isExpanded ? '#2563eb' : '#e2e8f0',
            borderWidth: isExpanded ? 1.5 : 1,
            borderStyle: 'solid',
            borderRadius: 6,
          }}
        >
          <Avatar photoUrl={emp.photoUrl} photoBroken={photoBroken} onPhotoError={() => setPhotoBroken(true)} size={34} />
        </button>
        {totalCount > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title={isExpanded ? 'Collapse' : 'Expand'}
            className="ml-1 text-[10.5px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
          >
            {totalCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-md p-2.5 flex items-center gap-3 text-left transition-shadow hover:shadow-sm"
      style={{
        width: 280,
        background: isExpanded ? '#eff6ff' : '#ffffff',
        borderColor: isExpanded ? '#2563eb' : '#e2e8f0',
        borderWidth: isExpanded ? 1.5 : 1,
        borderStyle: 'solid',
      }}
    >
      <Avatar photoUrl={emp.photoUrl} photoBroken={photoBroken} onPhotoError={() => setPhotoBroken(true)} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">{emp.firstName} {emp.lastName}</p>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{emp.designation || emp.role || 'Employee'}</p>
      </div>
      {totalCount > 0 && (
        <span
          // Badge is visually distinct but behaves identically to a card
          // click. stopPropagation prevents double-firing — without it,
          // both the badge handler and the parent button would toggle.
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onMouseDown={(e) => e.stopPropagation()}
          title={isExpanded ? 'Collapse this team' : 'Expand this team'}
          className="ml-1 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded flex-shrink-0 cursor-pointer transition-colors"
        >
          {totalCount}
        </span>
      )}
    </button>
  );
}

/* ── Floating popup shown when a card is clicked ───────────────────────── */
/* ── Column of children with vertical + horizontal blue connectors.
   All children render continuously (page scrolls); no pagination. */
function ChildrenColumn({ children, expandedIds, subtreeSize, onToggle }) {
  return (
    <div className="relative pl-6 flex flex-col gap-3">
      {/* Vertical blue connector — spans the full height of the column */}
      <div className="absolute top-0 bottom-0 left-0" style={{ width: 1.5, background: '#2563eb' }} />
      {children.map(emp => (
        <div key={emp._id} className="relative">
          {/* Horizontal branch line into this card */}
          <div
            className="absolute"
            style={{
              left: -24, top: '50%', width: 24, height: 1.5,
              background: '#2563eb', transform: 'translateY(-50%)',
            }}
          />
          <EmployeeCard
            emp={emp}
            isExpanded={expandedIds.has(emp._id)}
            totalCount={subtreeSize[emp._id] || 0}
            onToggle={() => onToggle(emp._id)}
          />
        </div>
      ))}
    </div>
  );
}

export default function OrgChart() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Path of expanded manager ids, in order. Clicking a card (or its badge)
  // toggles the node at the corresponding depth. Recursive collapse falls
  // out because we just truncate selectedPath at the toggle depth.
  const [selectedPath, setSelectedPath] = useState([]);

  const location = useLocation();
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

  /* ── Subtree size per employee (matches what Zoho's tree shows).
       Walks descendants once, memoised — so a 200-person org is still O(N). */
  const subtreeSize = {};
  const computeSubtree = (id) => {
    if (subtreeSize[id] != null) return subtreeSize[id];
    const kids = childrenOf[id] || [];
    let total = 0;
    for (const k of kids) total += 1 + computeSubtree(k._id);
    subtreeSize[id] = total;
    return total;
  };
  employees.forEach(e => computeSubtree(e._id));

  /* ── Search filter is applied flat across all employees ──────────────── */
  const filterMatch = (e) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
        || (e.designation || '').toLowerCase().includes(q)
        || (e.department  || '').toLowerCase().includes(q)
        || (e.employeeId  || '').toLowerCase().includes(q);
  };

  /* ── Build the visible columns from the expanded path ────────────────── */
  const columns = [];
  columns.push(roots.filter(filterMatch));
  for (const selId of selectedPath) {
    columns.push((childrenOf[selId] || []).filter(filterMatch));
  }
  const expandedIds = new Set(selectedPath);

  // Click anywhere on a card (body or badge) toggles expansion of that
  // node at the given depth. Clicking an already-expanded node collapses
  // it and everything below; clicking a sibling at the same depth swaps
  // to that branch.
  const handleToggle = (depth, empId) => {
    setSelectedPath(prev => {
      if (prev[depth] === empId) return prev.slice(0, depth);
      return [...prev.slice(0, depth), empId];
    });
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
          <div className="flex items-start gap-2 min-w-max">
            {columns.map((colEmps, depth) => {
              // Ancestor compression: once the tree is 3+ columns deep,
              // every column except the last TWO collapses to mini cards.
              // Keeps the right edge readable on narrow screens.
              const isAncestor = columns.length >= 3 && depth < columns.length - 2;
              const isRoot     = depth === 0;

              return (
                <React.Fragment key={depth}>
                  {isRoot ? (
                    // Root column: same column-style stack as before, no
                    // connectors (nothing to connect to on the left).
                    <div className="flex flex-col gap-3" style={{ width: isAncestor ? 56 : 220 }}>
                      {colEmps.length === 0 ? (
                        <p className="text-[12px] text-slate-400 italic">No employees</p>
                      ) : (
                        colEmps.map(emp => (
                          <EmployeeCard
                            key={emp._id}
                            emp={emp}
                            mini={isAncestor}
                            isExpanded={expandedIds.has(emp._id)}
                            totalCount={subtreeSize[emp._id] || 0}
                            onToggle={() => handleToggle(depth, emp._id)}
                          />
                        ))
                      )}
                    </div>
                  ) : isAncestor ? (
                    // Ancestor column: render mini cards in a tight stack,
                    // but no connectors — connectors only render around the
                    // CURRENT children of the most-recently-expanded node.
                    <div className="flex flex-col gap-2 items-center">
                      {colEmps.map(emp => (
                        <EmployeeCard
                          key={emp._id}
                          emp={emp}
                          mini
                          isExpanded={expandedIds.has(emp._id)}
                          totalCount={subtreeSize[emp._id] || 0}
                          onToggle={() => handleToggle(depth, emp._id)}
                        />
                      ))}
                    </div>
                  ) : (
                    // Live column: full-size cards + blue connectors + 5-row pager.
                    colEmps.length === 0 ? (
                      <p className="text-[12px] text-slate-400 italic px-4 py-2">No reports</p>
                    ) : (
                      <ChildrenColumn
                        children={colEmps}
                        expandedIds={expandedIds}
                        subtreeSize={subtreeSize}
                        onToggle={(empId) => handleToggle(depth, empId)}
                      />
                    )
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
