import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { User, Search, Eye, MessageSquare, Video, Phone } from 'lucide-react';
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

/* ── Hover-only popup with employee details + 4 action buttons.
   Shown only while the cursor is over the card; disappears on mouse-leave.
   Click does NOT trigger this — the card click expands children, the
   hover surfaces details. Matches Zoho's pattern exactly. */
function HoverPopup({ emp, totalMembers, directReports, anchorRect }) {
  // Position the popup just below the anchor card.
  const style = anchorRect
    ? { top: anchorRect.bottom + 4, left: anchorRect.left, position: 'fixed' }
    : null;
  if (!style) return null;

  return (
    <div
      style={style}
      className="z-40 w-[280px] bg-white border border-slate-200 rounded-lg shadow-xl p-3 pointer-events-none"
    >
      <div className="flex items-start gap-3">
        <Avatar photoUrl={emp.photoUrl} size={42} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-slate-800 truncate">
            {emp.employeeId && <span className="text-slate-400 font-mono mr-1">{emp.employeeId}</span>}
            <span className="text-slate-400">-</span> {emp.firstName} {emp.lastName}
          </p>
          {emp.email && (
            <p className="text-[11.5px] text-blue-600 truncate mt-0.5">{emp.email}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5">
            {emp.designation || emp.role || 'Employee'}
          </p>
          {emp.department && (
            <p className="text-[11px] text-slate-500">{emp.department}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-[11.5px]">
        <span>Total Members <strong className="ml-1 text-slate-800">{totalMembers}</strong></span>
        <span>Direct reports <strong className="ml-1 text-slate-800">{directReports}</strong></span>
      </div>

      <div className="flex items-center justify-start gap-2 mt-3 pointer-events-auto">
        <button title="View" className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"><Eye size={13} /></button>
        <button title="Message" className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"><MessageSquare size={13} /></button>
        <button title="Video" className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"><Video size={13} /></button>
        <button title="Phone" className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"><Phone size={13} /></button>
      </div>
    </div>
  );
}

/* ── Single employee card.
   • Click anywhere on the card (body or badge) → expand/collapse children
     (single source of truth for navigation, matches Zoho).
   • Hover → show details popup with action buttons (handled by parent).
   The parent owns the hover popup so it can be portal-rendered above
   sibling z-indexes without being clipped by the column's overflow. */
function EmployeeCard({ emp, isExpanded, totalCount, directCount, onToggle, onHoverChange, mini = false }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  const cardRef = useRef(null);

  // Open the hover popup after a short delay so quick mouse movements
  // across the column don't trigger flicker. Cancel the timer on leave.
  const hoverTimer = useRef(null);
  const handleEnter = () => {
    if (mini) return; // Mini cards have title-attr tooltips, no popup
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const rect = cardRef.current && cardRef.current.getBoundingClientRect();
      onHoverChange && onHoverChange({ emp, anchorRect: rect, totalCount, directCount });
    }, 150);
  };
  const handleLeave = () => {
    clearTimeout(hoverTimer.current);
    onHoverChange && onHoverChange(null);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  if (mini) {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          title={`${emp.firstName} ${emp.lastName}${emp.designation ? ' · ' + emp.designation : ''}`}
          className="bg-white p-0.5 transition-all hover:shadow-sm"
          style={{
            borderColor: isExpanded ? '#0088FF' : '#e2e8f0',
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
      ref={cardRef}
      type="button"
      onClick={onToggle}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="rounded-md p-2.5 flex items-center gap-3 text-left transition-shadow hover:shadow-sm"
      style={{
        width: 280,
        background: isExpanded ? '#eff6ff' : '#ffffff',
        borderColor: isExpanded ? '#0088FF' : '#e2e8f0',
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
/* ── Column of children with parent-aware connectors.
   The vertical line spans from the FIRST child's Y down to the PARENT's
   Y position in the previous column, and a horizontal hook extends LEFT
   from that point back toward the parent. Visually the line now clearly
   originates at the expanded card's row — matching Zoho. */
// Match Zoho People's exact design tokens (lifted from their dev tools):
//   --brdr_gry      = #DCDCDC  → resting connector lines
//   --primarybluclr = #0088FF  → the "active branch" hook
const LINE_COLOR   = '#DCDCDC';   // gray — the bulk of the tree
const ACTIVE_COLOR = '#0088FF';   // blue — the "active branch" hook
const CARD_PITCH   = 70;          // full card: 58px + gap-3 (12px)
const CARD_HALF    = 29;          // centerline of a full card
const MINI_PITCH   = 48;          // mini card: 40px + gap-2 (8px)
const MINI_HALF    = 20;          // centerline of a mini card
const MINI_GAP     = 8;           // gap-2 between mini cards
const FULL_GAP     = 12;          // gap-3 between full cards
// Connector geometry. COL_GAP and HOOK_LEN must be equal so the parent
// hook exactly bridges the gap from the previous column's right edge to
// the spine on the children column's left edge.
const HOOK_LEN     = 20;
const COL_GAP      = 20;

function ChildrenColumn({ children, expandedIds, subtreeSize, childrenOf, onToggle, onHoverChange,
                          parentIndex = 0, parentPitch = CARD_PITCH, parentHalf = CARD_HALF, mini = false }) {
  // Pitch/half for THIS column's stack (mini cards are shorter & gap-tighter).
  const pitch = mini ? MINI_PITCH : CARD_PITCH;
  const half  = mini ? MINI_HALF  : CARD_HALF;

  // Y of each child's centerline (children always start at top of column).
  const firstChildY = half;
  const lastChildY  = (children.length - 1) * pitch + half;
  // Y of the parent's centerline in the previous column — uses the PARENT
  // column's pitch, not this column's, so the hook lands on the right row
  // even when the parent is a mini card.
  const parentY     = parentIndex * parentPitch + parentHalf;
  // Vertical line range — must cover BOTH the parent and every child so
  // the geometry visually closes.
  const lineTop     = Math.min(parentY, firstChildY);
  const lineBottom  = Math.max(parentY, lastChildY);

  // Y of the currently-expanded child in this column (if any). Drives the
  // blue "active branch" so the line visually traces from parent → selected
  // child as one continuous highlight, matching Zoho's behaviour.
  const selectedChildIdx = children.findIndex(c => expandedIds.has(c._id));
  const selectedChildY   = selectedChildIdx >= 0
    ? selectedChildIdx * pitch + half
    : null;
  const activeTop    = selectedChildY != null ? Math.min(parentY, selectedChildY) : null;
  const activeHeight = selectedChildY != null ? Math.abs(selectedChildY - parentY) : 0;

  return (
    <div className="relative flex flex-col" style={{
      paddingLeft: HOOK_LEN,
      gap: mini ? MINI_GAP : FULL_GAP,
    }}>
      {/* Gray vertical spine — exactly tall enough to reach both ends */}
      <div className="absolute" style={{
        left: 0, top: lineTop, height: lineBottom - lineTop,
        width: 1, background: LINE_COLOR,
      }} />
      {/* Blue vertical overlay: covers only the active sub-path so the
          highlight is continuous from parent down to the selected child. */}
      {selectedChildY != null && activeHeight > 0 && (
        <div className="absolute" style={{
          left: -1, top: activeTop, height: activeHeight,
          width: 2, background: ACTIVE_COLOR,
        }} />
      )}
      {/* Blue hook back toward the parent — Zoho draws this at 2px. */}
      <div className="absolute" style={{
        left: -HOOK_LEN, top: parentY - 1, width: HOOK_LEN, height: 2,
        background: ACTIVE_COLOR,
      }} />
      {/* Children: each card has a horizontal branch from the spine
          into its own left edge. The selected child's branch is BLUE
          and 2px (live branch); others are GRAY 1px (resting). */}
      {children.map(emp => {
        const isActive = expandedIds.has(emp._id);
        return (
          <div key={emp._id} className="relative">
            <div className="absolute" style={{
              left: isActive ? -HOOK_LEN - 1 : -HOOK_LEN,
              top: '50%',
              width: isActive ? HOOK_LEN + 1 : HOOK_LEN,
              height: isActive ? 2 : 1,
              background: isActive ? ACTIVE_COLOR : LINE_COLOR,
              transform: 'translateY(-50%)',
            }} />
            <EmployeeCard
              emp={emp}
              mini={mini}
              isExpanded={isActive}
              totalCount={subtreeSize[emp._id] || 0}
              directCount={(childrenOf[emp._id] || []).length}
              onToggle={() => onToggle(emp._id)}
              onHoverChange={onHoverChange}
            />
          </div>
        );
      })}
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
  // Currently hovered card — drives the floating details popup. null while
  // no card is hovered. Set by EmployeeCard on mouse-enter (after ~150ms).
  const [hovered, setHovered] = useState(null);  // { emp, anchorRect, totalCount, directCount }

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
          <div className="flex items-start min-w-max" style={{ gap: COL_GAP }}>
            {columns.map((colEmps, depth) => {
              // Ancestor compression: keep the last TWO columns as full
              // cards (the active card's row + its children). Everything
              // earlier in the path collapses to mini — matches Zoho.
              const isAncestor    = columns.length >= 3 && depth < columns.length - 2;
              const isRoot        = depth === 0;
              const prevIsMini    = depth > 0 && columns.length >= 3 && (depth - 1) < columns.length - 2;
              // Parent index in the previous column — drives the connector
              // hook's vertical position so the line visibly originates at
              // the expanded card's row.
              const parentIndex = depth > 0
                ? Math.max(0, columns[depth - 1].findIndex(e => e._id === selectedPath[depth - 1]))
                : 0;
              const parentPitch = prevIsMini ? MINI_PITCH : CARD_PITCH;
              const parentHalf  = prevIsMini ? MINI_HALF  : CARD_HALF;

              return (
                <React.Fragment key={depth}>
                  {isRoot ? (
                    // Root column: no connector (nothing on the left).
                    // Auto-size to card contents; just stack the cards.
                    <div className="flex flex-col" style={{
                      alignItems: 'flex-start',
                      gap: isAncestor ? MINI_GAP : FULL_GAP,
                    }}>
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
                            directCount={(childrenOf[emp._id] || []).length}
                            onToggle={() => handleToggle(depth, emp._id)}
                            onHoverChange={setHovered}
                          />
                        ))
                      )}
                    </div>
                  ) : (
                    colEmps.length === 0 ? (
                      <p className="text-[12px] text-slate-400 italic px-4 py-2">No reports</p>
                    ) : (
                      // Both mini ancestor columns AND the full active/child
                      // columns route through ChildrenColumn so the spine +
                      // blue active branch trace continuously from the root.
                      <ChildrenColumn
                        children={colEmps}
                        mini={isAncestor}
                        expandedIds={expandedIds}
                        subtreeSize={subtreeSize}
                        childrenOf={childrenOf}
                        parentIndex={parentIndex}
                        parentPitch={parentPitch}
                        parentHalf={parentHalf}
                        onToggle={(empId) => handleToggle(depth, empId)}
                        onHoverChange={setHovered}
                      />
                    )
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Hover-only details popup. Mounted at the component root with
          position:fixed so it overlays cleanly above the column scroll. */}
      {hovered && (
        <HoverPopup
          emp={hovered.emp}
          totalMembers={hovered.totalCount || 0}
          directReports={hovered.directCount || 0}
          anchorRect={hovered.anchorRect}
        />
      )}
    </div>
  );
}
