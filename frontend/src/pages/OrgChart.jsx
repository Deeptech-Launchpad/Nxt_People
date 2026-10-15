import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  User, Search, Eye, MessageSquare, Video, Phone, ChevronUp, ChevronDown, X,
  ChevronRight, Star, Mail, MoreHorizontal, Filter, ArrowUpDown, Crown,
  Users, Check, Clock, UserPlus,
} from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Avatar as PersonAvatar } from './team/teamShared';

/* No app-wide theme context exists yet — the dark toggle just flips a
 * class on <html>. This hook watches that class reactively (instead of
 * reading it once per render) so colors here don't go stale if the user
 * toggles theme while this page is mounted and otherwise idle. */
function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/* ── Square photo thumbnail. When no photo, a soft gray User silhouette
   (matches Zoho's placeholder — no initials, no coloured background). */
function Avatar({ size = 36, photoUrl, photoBroken, onPhotoError }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [photoUrl]);
  const showPhoto = photoUrl && !photoBroken && !broken;
  return (
    <div
      className="rounded border border-slate-200 dark:border-[#374151] bg-slate-100 dark:bg-[#2d3748] flex items-center justify-center flex-shrink-0 overflow-hidden text-slate-400 dark:text-slate-500"
      style={{ width: size, height: size }}
    >
      {showPhoto
        ? <img src={photoUrl} alt="" className="w-full h-full object-cover" onError={() => { setBroken(true); onPhotoError?.(); }} />
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
function HoverPopup({ emp, totalMembers, directReports, anchorRect, onMouseEnter, onMouseLeave }) {
  const navigate = useNavigate();
  // Position the popup just below the anchor card.
  const style = anchorRect
    ? { top: anchorRect.bottom + 6, left: anchorRect.left, position: 'fixed' }
    : null;
  if (!style) return null;

  const goView   = () => navigate(`/employees/${emp._id}`);
  const goChat   = () => navigate(`/chat?user=${emp._id}`);
  const phoneNum = emp.phone || emp.workPhone || null;
  const telHref  = phoneNum ? `tel:${phoneNum}` : null;

  const btnBase = 'w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-colors';
  const btnOff  = 'w-8 h-8 rounded-full bg-slate-100 dark:bg-[#374151] text-slate-400 dark:text-slate-500 flex items-center justify-center cursor-not-allowed';

  return (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="z-[9999] w-[280px] bg-white dark:bg-[#1e2538] border border-slate-200 dark:border-[#374151] rounded-xl shadow-2xl p-4 transition-none"
    >
      {/* Employee info row */}
      <div className="flex items-start gap-3">
        <Avatar photoUrl={emp.photoUrl} size={42} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-slate-800 dark:text-slate-100 truncate leading-snug">
            {emp.employeeId && (
              <span className="text-slate-400 dark:text-slate-400 font-mono mr-1 text-[13px]">{emp.employeeId}</span>
            )}
            <span className="text-slate-400 dark:text-slate-500 mr-1">·</span>
            {emp.firstName} {emp.lastName}
          </p>
          {emp.email && (
            <p className="text-[13px] text-blue-500 dark:text-blue-400 truncate mt-0.5">{emp.email}</p>
          )}
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {emp.designation || emp.role || 'Employee'}
          </p>
          {emp.department && (
            <p className="text-[13px] text-slate-400 dark:text-slate-500">{emp.department}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-[#374151] text-[13px] text-slate-500 dark:text-slate-400">
        <span>
          Total Members{' '}
          <strong className="ml-1 text-slate-700 dark:text-slate-200 font-bold">{totalMembers}</strong>
        </span>
        <span>
          Direct reports{' '}
          <strong className="ml-1 text-slate-700 dark:text-slate-200 font-bold">{directReports}</strong>
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-start gap-2 mt-3">
        <button type="button" onClick={goView} title="View profile" className={btnBase}>
          <Eye size={13} />
        </button>
        <button type="button" onClick={goChat} title={`Chat with ${emp.firstName || 'colleague'}`} className={btnBase}>
          <MessageSquare size={13} />
        </button>
        <span title="Video calling not enabled" className={btnOff}>
          <Video size={13} />
        </span>
        {telHref ? (
          <a href={telHref} title={`Call ${phoneNum}`} className={btnBase}>
            <Phone size={13} />
          </a>
        ) : (
          <span title="No phone number on file" className={btnOff}><Phone size={13} /></span>
        )}
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
function EmployeeCard({ emp, isExpanded, totalCount, directCount, onToggle, onHoverChange, mini = false, matched = false }) {
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

  const isDark = useIsDark();

  if (mini) {
    return (
        <button
          type="button"
          onClick={onToggle}
          title={`${emp.firstName} ${emp.lastName}${emp.designation ? ' · ' + emp.designation : ''}`}
          className="p-0.5 transition-all hover:shadow-sm"
          style={{
            background: isDark ? '#1f2937' : '#ffffff',
            borderColor: isExpanded ? '#0088FF' : matched ? '#f59e0b' : (isDark ? '#374151' : '#e2e8f0'),
            borderWidth: isExpanded ? 1.5 : 1,
            borderStyle: 'solid',
            borderRadius: 6,
            boxShadow: matched ? '0 0 0 2px rgba(245,158,11,0.35)' : undefined,
          }}
        >
          <Avatar photoUrl={emp.photoUrl} photoBroken={photoBroken} onPhotoError={() => setPhotoBroken(true)} size={34} />
        </button>
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
        // Lets a card give way on a narrow screen instead of forcing the whole
        // tree into a horizontal scroll before the first column is even read.
        // Height is what the connectors are measured from, and the
        // ResizeObserver re-measures when a wrapped designation changes it.
        maxWidth: 'calc(100vw - 5rem)',
        background: isExpanded
          ? (isDark ? '#1e3a5f' : '#eff6ff')
          : (isDark ? '#1f2937' : '#ffffff'),
        borderColor: isExpanded ? '#0088FF' : matched ? '#f59e0b' : (isDark ? '#374151' : '#e2e8f0'),
        borderWidth: isExpanded ? 1.5 : 1,
        borderStyle: 'solid',
        boxShadow: matched ? '0 0 0 2px rgba(245,158,11,0.35)' : undefined,
      }}
    >
      <Avatar photoUrl={emp.photoUrl} photoBroken={photoBroken} onPhotoError={() => setPhotoBroken(true)} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">{emp.firstName} {emp.lastName}</p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{emp.designation || emp.role || 'Employee'}</p>
      </div>
    </button>
  );
}

/* The subtree count, on the connector rather than in the card.
 *
 * It used to sit INSIDE the full card at its right edge — which is exactly
 * where the reference draws the line leaving the card, so the connection read
 * as broken. Mini cards already had it outside, so the two card types did not
 * even agree with each other. One component, one place: in the gutter, on the
 * line, which is also what it means — "this line leads to N people". */
function CountBadge({ count, isExpanded, onToggle, mini = false }) {
  if (!count) return null;
  return (
    <span className="flex items-center flex-shrink-0">
      {/* The badge sits ON the connector, with line running into it as well as
          out of it — the reference threads one continuous line from the card,
          through the count, and on to the spine of the column it opens.
          Rendered hard against the card (no margin) the badge read as part of
          the card instead, and the connection appeared to start out of
          nowhere a few pixels to its right. The line after it is the next
          column's hook, which already crosses the gutter. */}
      <span aria-hidden="true" style={{
        width: BADGE_LEAD,
        height: isExpanded ? 2 : 1,
        background: isExpanded ? ACTIVE_COLOR : LINE_COLOR,
      }} />
      <span
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onMouseDown={(e) => e.stopPropagation()}
        title={isExpanded ? 'Collapse this team' : 'Expand this team'}
        className={`relative z-10 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer transition-colors flex-shrink-0 ${
          mini ? 'text-[12px] px-1.5 py-0.5' : 'text-[13px] px-2 py-0.5'
        }`}
      >
        {count}
      </span>
    </span>
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
const MINI_GAP     = 20;          // breathing room between mini cards
const FULL_GAP     = 12;          // gap-3 between full cards
/* Row positions are MEASURED, never assumed.
 *
 * They used to come from four constants — a full card "58px + 12px gap", a
 * mini card "38px + 20px" — and both heights were wrong. A full card is
 * 62.25px: 20 padding + 2 border + a text block (15px at leading-tight, plus
 * 13px at the body's line-height 1.5, plus mt-0.5) that is 40.25px and so
 * outgrows the 36px avatar it sits beside. A mini card is 40px, not 38.
 *
 * Four pixels a row does not sound like much until it accumulates: the line
 * into the 31st report landed roughly two whole cards below the person it
 * pointed at. Worse, the selected card takes a 1.5px border instead of 1px,
 * so it is a pixel taller than its siblings and everything under it shifts as
 * you click around — drift no constant can track. So the geometry now reads
 * the rendered rows instead of predicting them. */
// Connector geometry. COL_GAP and HOOK_LEN must be equal so the parent
// hook exactly bridges the gap from the previous column's right edge to
// the spine on the children column's left edge.
const HOOK_LEN     = 20;
const COL_GAP      = 20;
// Card → badge. The badge's other side is the next column's HOOK_LEN, so the
// two together are the single line the reference draws through the count.
const BADGE_LEAD   = 12;

function ChildrenColumn({ children, expandedIds, subtreeSize, childrenOf, onToggle, onHoverChange,
                          stackRef, centers, parentCenter, matchIds, mini = false,
                          parentScrollDelta = 0 }) {
  /* Nothing is drawn until this column and its parent have both been
     measured. One frame without a line beats a frame with the line in the
     wrong place, and useLayoutEffect measures before the browser paints, so
     in practice nobody sees the gap. */
  const ready = centers && centers.length === children.length && parentCenter != null;

  const firstChildY = ready ? centers[0] : 0;
  const lastChildY  = ready ? centers[centers.length - 1] : 0;
  /* parentScrollDelta is (this column's scrollTop − the parent column's).
     Every column scrolls on its own, and this connector is drawn inside THIS
     column's scrolling content, so without that term the hook stays glued to
     our own scroll position and slides off the card it points at the moment
     either column moves. */
  const parentY = ready ? parentCenter + parentScrollDelta : 0;
  // Vertical line range — must cover BOTH the parent and every child so
  // the geometry visually closes.
  const lineTop     = Math.min(parentY, firstChildY);
  const lineBottom  = Math.max(parentY, lastChildY);

  // Y of the currently-expanded child in this column (if any). Drives the
  // blue "active branch" so the line visually traces from parent → selected
  // child as one continuous highlight, matching Zoho's behaviour.
  const selectedChildIdx = children.findIndex(c => expandedIds.has(c._id));
  const selectedChildY   = ready && selectedChildIdx >= 0 ? centers[selectedChildIdx] : null;
  const activeTop    = selectedChildY != null ? Math.min(parentY, selectedChildY) : null;
  const activeHeight = selectedChildY != null ? Math.abs(selectedChildY - parentY) : 0;

  return (
    <div ref={stackRef} className="relative flex flex-col" style={{
      paddingLeft: HOOK_LEN,
      gap: mini ? MINI_GAP : FULL_GAP,
    }}>
      {ready && (
        <>
          {/* Gray vertical spine — exactly tall enough to reach both ends */}
          <div className="absolute" style={{
            left: 0, top: lineTop, height: lineBottom - lineTop,
            width: 1, background: LINE_COLOR,
          }} />
          {/* Blue vertical overlay: covers only the active sub-path so the
              highlight is continuous from parent down to the selected child. */}
          {selectedChildY != null && activeHeight > 0 && (
            /* Same left edge as the grey spine, not one pixel beside it. At
               left:-1 the active branch ran alongside the resting line rather
               than along it, so the corner where blue met grey had a visible
               jog in it — the two halves of one line disagreeing about where
               that line is. */
            <div className="absolute" style={{
              left: 0, top: activeTop, height: activeHeight,
              width: 2, background: ACTIVE_COLOR,
            }} />
          )}
          {/* Blue hook back toward the parent — Zoho draws this at 2px. It
              overshoots by the spine's own width so the elbow is a solid
              corner instead of two strokes that stop short of each other. */}
          <div className="absolute" style={{
            left: -HOOK_LEN, top: parentY - 1, width: HOOK_LEN + 2, height: 2,
            background: ACTIVE_COLOR,
          }} />
        </>
      )}
      {/* Children: each card has a horizontal branch from the spine
          into its own left edge. The selected child's branch is BLUE
          and 2px (live branch); others are GRAY 1px (resting). */}
      {children.map(emp => {
        const isActive = expandedIds.has(emp._id);
        return (
          <div key={emp._id} data-row className="relative flex items-center">
            {/* The branch into this card: blue and 2px on the path you have
                drilled into, grey and 1px on every other, which is what makes
                the route through the tree readable at a glance. Both start at
                the spine's own left edge so they meet it rather than
                approaching it. */}
            <div className="absolute" style={{
              left: -HOOK_LEN,
              top: '50%',
              width: HOOK_LEN + (isActive ? 2 : 1),
              height: isActive ? 2 : 1,
              background: isActive ? ACTIVE_COLOR : LINE_COLOR,
              transform: 'translateY(-50%)',
            }} />
            <EmployeeCard
              emp={emp}
              mini={mini}
              isExpanded={isActive}
              matched={matchIds?.has(emp._id)}
              totalCount={subtreeSize[emp._id] || 0}
              directCount={(childrenOf[emp._id] || []).length}
              onToggle={() => onToggle(emp._id)}
              onHoverChange={onHoverChange}
            />
            <CountBadge
              count={subtreeSize[emp._id] || 0}
              isExpanded={isActive}
              mini={mini}
              onToggle={() => onToggle(emp._id)}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 *  Team > Department — restyled view (visual redesign only; the data below
 *  is exactly what the legacy dept-tree branch already computes — deptsList/
 *  activeDept/displayEmployees passed in as props — plus small, purely
 *  derived read-only values: who leads a department and today's presence,
 *  both already present in the `/org/directory` payload this page already
 *  fetches. No new API calls, fields, roles, or calculations.
 * ─────────────────────────────────────────────────────────────────────── */

/* The 12 department letter-tile SVGs supplied for this redesign, keyed by
   the exact department name they were drawn for. Any department name that
   is not one of these (this org's full taxonomy may grow) falls back to a
   tile generated in the same visual recipe — same shape, same font, a
   colour drawn from the same 12-colour set — so the UI never depends on a
   fixed, hand-authored list to stay correct. */
const KNOWN_DEPT_ICONS = {
  'content':                        { code: 'co', bg: '#EAF0FD', fg: '#1B2A6B' },
  'software':                       { code: 'so', bg: '#F0E9FF', fg: '#7B2FE0' },
  'it support':                     { code: 'it', bg: '#E3F8EA', fg: '#16A34A' },
  'house keeping':                  { code: 'ho', bg: '#E9EEFB', fg: '#1B2A6B' },
  'audit':                          { code: 'au', bg: '#ECEBFF', fg: '#1D4ED8' },
  'business operations':            { code: 'bu', bg: '#EBEDFF', fg: '#2230E6' },
  'sales & marketing':              { code: 'sa', bg: '#E4F0FF', fg: '#1D6FF0' },
  'product information management': { code: 'pi', bg: '#EEF0FF', fg: '#1E5BF0' },
  'pim - product information management': { code: 'pi', bg: '#EEF0FF', fg: '#1E5BF0' },
  'pim': { code: 'pi', bg: '#EEF0FF', fg: '#1E5BF0' },
  'hr & administration':            { code: 'hr', bg: '#E6ECFA', fg: '#1B2A5E' },
  'accounts':                       { code: 'ac', bg: '#E8EEFB', fg: '#1B2A5E' },
  'board of directors':             { code: 'bo', bg: '#F1E8FF', fg: '#7A22E0' },
  'unassigned':                     { code: 'un', bg: '#E6EDFA', fg: '#1B2A5E' },
};
const DEPT_PALETTE = Object.values(KNOWN_DEPT_ICONS);
const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/* `active` is the left-list's selected-row treatment only: the tile swaps
   to the uniform blue selection colour instead of the department's own
   colour/SVG, matching every other selected-state indicator in that list
   (border, name, count badge). Callers outside that list never pass it, so
   their tiles are unaffected. */
function DeptTile({ name, size = 40, active = false }) {
  const key = (name || '').trim().toLowerCase();
  const known = KNOWN_DEPT_ICONS[key];
  const radius = Math.round(size * 0.25);
  const prefix = (name || '').substring(0, 2).toUpperCase();
  if (active) {
    return (
      <div
        className="flex-shrink-0 flex items-center justify-center font-extrabold"
        style={{
          width: size, height: size, borderRadius: radius,
          background: '#EAF2FF', color: '#1E6FF0',
          fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
          fontSize: Math.round(size * 0.39),
        }}
      >
        {prefix}
      </div>
    );
  }
  if (known) {
    return (
      <img
        src={`/icons/departments/dept-${known.code}.svg`}
        alt={`${name} department icon`}
        style={{ width: size, height: size, borderRadius: radius }}
        className="flex-shrink-0"
      />
    );
  }
  const palette = DEPT_PALETTE[hashStr(key) % DEPT_PALETTE.length];
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center font-extrabold"
      style={{
        width: size, height: size, borderRadius: radius,
        background: palette.bg, color: palette.fg,
        fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
        fontSize: Math.round(size * 0.39),
      }}
    >
      {prefix}
    </div>
  );
}

/* Who leads a department: the member(s) of that department whose manager is
   NOT also in the department (reports outward, or has no manager at all).
   Usually exactly one person. If more than one local root exists, the one
   with the larger reporting subtree is shown — both numbers already come
   from the subtreeSize/childrenOf maps OrgChart already builds for the
   Employee Tree. Nothing here is fetched or computed beyond that. */
function deriveDeptHead(deptEmployees, empMap, subtreeSize) {
  const deptIds = new Set(deptEmployees.map(e => e._id));
  const localRoots = deptEmployees.filter(e => {
    const mgr = e.reportingManagerId && empMap[e.reportingManagerId];
    return !mgr || !deptIds.has(mgr._id);
  });
  if (localRoots.length === 0) return null;
  if (localRoots.length === 1) return localRoots[0];
  return localRoots.reduce((best, c) => (subtreeSize[c._id] || 0) > (subtreeSize[best._id] || 0) ? c : best);
}

/* A stat-row slot with no backing data (Open Role count, Location — neither
   concept exists anywhere in the schema today). Shown as a muted dash
   rather than omitted, so the row keeps the same rhythm as the design, per
   the rule: keep the element, never invent the number. Styled like the
   app's existing "Coming soon" tiles (Dashboard quick actions / quick
   links) — not clickable, not a new pattern. */
const ICON = '/icons/team-department';

function InertStat({ iconSrc, label }) {
  return (
    <div className="flex items-center gap-2 px-4 first:pl-0" title="Not tracked yet">
      <img src={iconSrc} alt="" className="w-7 h-7 flex-shrink-0 opacity-40 grayscale" />
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-slate-300 leading-none">—</p>
        <p className="text-[11px] text-[#6B7A99] mt-1">{label}</p>
      </div>
    </div>
  );
}

function InsightTile({ iconSrc, value, label, sub, donut }) {
  const hasValue = value != null;
  return (
    <div className="border border-[#E6EBF2] rounded-xl p-3 flex items-center justify-between gap-2" title={hasValue ? undefined : 'Not tracked yet'}>
      <div className="min-w-0">
        <img src={iconSrc} alt="" className={`w-8 h-8 ${hasValue ? '' : 'opacity-40 grayscale'}`} />
        <p className={`text-[19px] font-extrabold mt-1.5 leading-none ${hasValue ? 'text-[#0F1F4D]' : 'text-slate-300'}`}>
          {hasValue ? value : '—'}
        </p>
        <p className="text-[11px] text-[#6B7A99] mt-1">{label}</p>
        {sub && <p className="text-[10.5px] text-emerald-600 font-semibold mt-0.5">{sub}</p>}
      </div>
      {donut != null && (
        <div
          className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-[#0F1F4D]"
          style={{ background: `conic-gradient(#1E6FF0 ${donut * 3.6}deg, #E6EBF2 0deg)` }}
        >
          <span className="w-7 h-7 rounded-full bg-white flex items-center justify-center">{donut}%</span>
        </div>
      )}
    </div>
  );
}

/* Quick Actions has no destination wired up anywhere in the app for these
   four — matches the Dashboard's own "Coming soon" tile convention for a
   feature that is designed but not yet built, rather than inventing a
   click handler for something that doesn't exist. Each icon file already
   includes its own light-blue tile background, so it's used as-is with no
   extra wrapper box. */
function QuickActionTile({ iconSrc, label }) {
  return (
    <div title="Coming soon" className="flex flex-col items-center gap-1.5 cursor-not-allowed">
      <img src={iconSrc} alt="" className="w-14 h-14 rounded-2xl" />
      <span className="text-[11px] font-semibold text-[#0F1F4D] text-center leading-tight">{label}</span>
    </div>
  );
}

/* One of the extra member-list tabs (Open Roles / About / Projects /
   Documents) — none has any content behind it today, so each renders in
   the same inert style as QuickActionTile rather than switching to a tab
   with nothing to show. */
function InertTab({ label }) {
  return (
    <span title="Coming soon" className="py-3 px-1 text-[14px] font-medium text-slate-300 cursor-not-allowed whitespace-nowrap">
      {label}
    </span>
  );
}

/* Same `presence` value this page already fetches from /org/directory
   ('in' | 'out' | 'onLeave' | 'yetToCheckIn') — only the label/colour
   mapping is new, nothing about what presence means or how it's read.
   "Absent" isn't a value the app ever actually returns (there's no such
   status anywhere in attendance data), so the closest real, honest state
   for the fourth colour slot is 'out' (checked out), labelled as such
   rather than claiming someone who worked and left is "absent". */
/* Styled after status-present-pill.svg's own recipe (a filled colour circle
   with a small white glyph, sitting inside a pale pill of the same hue) —
   that file hard-codes the text "Present", so it's used as a visual
   reference rather than embedded directly, and reproduced here for all
   four states so the label stays dynamic. */
const STATUS_PILL = {
  in:           { label: 'Present',        circle: '#22A94F', cls: 'bg-[#E3F8EA] text-[#16923F]', Icon: Check },
  out:          { label: 'Checked out',     circle: '#E24C4C', cls: 'bg-[#FDEAEA] text-[#C32F2F]', Icon: X },
  onLeave:      { label: 'On Leave',        circle: '#F59A0C', cls: 'bg-[#FFF1DF] text-[#B5720A]', Icon: Clock },
  yetToCheckIn: { label: 'Yet to check in', circle: '#F0B429', cls: 'bg-[#FEF3DB] text-[#92610A]', Icon: Clock },
};
function StatusPill({ presence }) {
  const s = STATUS_PILL[presence] || STATUS_PILL.yetToCheckIn;
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold pl-1 pr-2.5 py-1 rounded-full ${s.cls}`}>
      <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: s.circle }}>
        <Icon size={10} className="text-white" strokeWidth={3} />
      </span>
      {s.label}
    </span>
  );
}

function MemberCard({ emp, isHead, isSelected, onSelect, onMail, onMore }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative text-left rounded-xl border p-3.5 transition-colors h-full"
      style={{
        borderColor: isSelected ? '#1E6FF0' : '#E6EBF2',
        background: isSelected ? '#F2F7FF' : '#ffffff',
      }}
    >
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onMail(); }}
          title={`Message ${emp.firstName || 'this person'}`}
          className="w-8 h-8 rounded-md border border-[#E6EBF2] bg-white flex items-center justify-center text-slate-400 hover:text-[#1E6FF0] hover:border-[#1E6FF0] transition-colors"
        >
          <Mail size={13} />
        </span>
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onMore(e); }}
          title="More actions"
          className="w-8 h-8 rounded-md border border-[#E6EBF2] bg-white flex items-center justify-center text-slate-400 hover:text-[#1E6FF0] hover:border-[#1E6FF0] transition-colors"
        >
          <MoreHorizontal size={13} />
        </span>
      </div>

      <div className="flex items-start gap-3 pr-[72px]">
        <div className="relative flex-shrink-0">
          <PersonAvatar person={emp} size={64} />
          {emp.presence === 'in' && (
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="flex items-center gap-1.5 flex-wrap">
            {isHead && <Crown size={13} className="text-amber-500 flex-shrink-0" />}
            <span className="text-[15px] font-bold text-[#0F1F4D] truncate">{emp.firstName} {emp.lastName}</span>
            {isHead && (
              <span className="text-[11px] font-semibold text-[#1E6FF0] bg-[#EAF2FF] px-2 py-0.5 rounded-full flex-shrink-0">Department Head</span>
            )}
          </p>
          <p className="text-[13px] text-[#6B7A99] truncate mt-0.5">{emp.designation || 'Employee'}</p>
          <div className="mt-1.5">
            <StatusPill presence={emp.presence} />
          </div>
        </div>
      </div>
    </button>
  );
}

function TeamDepartmentView({
  deptsList, activeDept, displayEmployees, selectedDept, setSelectedDept,
  selectedEmp, setSelectedEmp, searchTerm, setSearchTerm,
  empMap, childrenOf, subtreeSize, hovered, setHover, closeTimerRef, navigate,
}) {
  const [memberSearch, setMemberSearch] = useState('');

  if (!activeDept) {
    return <div className="p-10 text-center text-[14px] text-slate-400">Loading departments…</div>;
  }

  const head = deriveDeptHead(displayEmployees, empMap, subtreeSize);
  const rest = displayEmployees.filter(e => e._id !== head?._id);
  const presentCount = displayEmployees.filter(e => e.presence === 'in').length;

  const visibleMembers = memberSearch.trim()
    ? displayEmployees.filter(e => {
        const q = memberSearch.trim().toLowerCase();
        return `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
            || (e.designation || '').toLowerCase().includes(q);
      })
    : displayEmployees;

  const openMemberActions = (e, emp) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({
      emp,
      anchorRect: rect,
      totalCount: subtreeSize[emp._id] || 0,
      directCount: (childrenOf[emp._id] || []).length,
    });
  };

  return (
    <div className="box-border p-[15px] bg-[#F4F7FB]">
    <div className="grid grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)_380px] gap-3 items-stretch">
      {/* ── Left: Departments ──────────────────────────────────────────── */}
      <div className="order-3 lg:order-1 bg-white rounded-xl border border-[#E6EBF2] shadow-sm flex flex-col">
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold text-[#0F1F4D]">Departments</h2>
              <span className="text-[12px] font-bold text-[#1E6FF0] bg-[#EAF2FF] px-2 py-0.5 rounded-md">{deptsList.length}</span>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </div>
          <p className="text-[12px] text-[#6B7A99] mt-0.5">Browse and manage departments</p>

          <div className="relative mt-2.5">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, designation, department..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 h-9 w-full border border-[#E6EBF2] rounded-lg text-[13px] focus:outline-none focus:border-[#1E6FF0] focus:ring-1 focus:ring-[#1E6FF0] text-[#0F1F4D] placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className={`flex-1 px-2 pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full ${
          deptsList.length > 20 ? 'max-h-[70vh] overflow-y-auto' : ''
        }`}>
          {deptsList.map(dept => {
            const isActive = activeDept.name === dept.name;
            return (
              <div
                key={dept.name}
                onClick={() => { setSelectedDept(dept.name); setSelectedEmp(null); }}
                className={`flex items-center justify-between gap-2 px-2 py-1 mb-1.5 rounded-lg border cursor-pointer transition-colors ${
                  isActive ? 'border-[#1E6FF0] bg-[#F2F7FF]' : 'border-transparent hover:border-[#E6EBF2]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <DeptTile name={dept.name} size={33} active={isActive} />
                  <span className={`text-[13.5px] leading-tight truncate ${isActive ? 'font-semibold text-[#1E6FF0]' : 'font-medium text-slate-700'}`}>
                    {dept.name}
                  </span>
                </div>
                <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-md border flex-shrink-0 ${
                  isActive ? 'bg-[#1E6FF0] text-white border-[#1E6FF0]' : 'bg-white text-[#6B7A99] border-[#E6EBF2]'
                }`}>
                  {dept.count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Middle: department header + members ──────────────────────── */}
      <div className="order-1 lg:order-2 flex flex-col gap-3">
        <div
          className="rounded-[14px] p-5 bg-[#F6FAFF] flex-shrink-0"
          style={{
            backgroundImage: "url('/images/department-header-bg-only@2x.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'right center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <DeptTile name={activeDept.name} size={68} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[#6B7A99] tracking-wide uppercase">Department</p>
                <h1 className="text-[24px] sm:text-[26px] font-extrabold text-[#0F1F4D] leading-tight mt-0.5 flex items-center gap-2">
                  <span className="truncate">{activeDept.name}</span>
                  <Star size={18} className="text-slate-300 flex-shrink-0" />
                </h1>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span title="Coming soon" className="flex items-center gap-1.5 bg-[#1E6FF0] text-white px-3.5 h-9 rounded-lg text-[13px] font-semibold cursor-not-allowed">
                  <UserPlus size={14} /> Add Member
                </span>
                <span title="Coming soon" className="w-9 h-9 rounded-lg border border-[#E6EBF2] bg-white flex items-center justify-center text-slate-300 cursor-not-allowed">
                  <MoreHorizontal size={15} />
                </span>
              </div>
              <button type="button" onClick={() => navigate('/org-chart')}
                className="inline-flex items-center gap-1.5 bg-white border border-[#E6EBF2] px-3 h-9 rounded-lg text-[12.5px] font-semibold text-[#0F1F4D] hover:border-[#1E6FF0] hover:text-[#1E6FF0] transition-colors">
                <Users size={13} /> View Org Structure
              </button>
            </div>
          </div>

          <div className="flex items-center flex-wrap divide-x divide-[#E6EBF2] mt-4 pt-4 border-t border-[#E6EBF2]">
            <div className="flex items-center gap-2 pr-4">
              <img src={`${ICON}/team-total-members.svg`} alt="" className="w-7 h-7 flex-shrink-0" />
              <div>
                <p className="text-[14px] font-bold text-[#0F1F4D] leading-none">{activeDept.count}</p>
                <p className="text-[11px] text-[#6B7A99] mt-1">Team Members</p>
              </div>
            </div>
            <InertStat iconSrc={`${ICON}/team-open-role-green.svg`} label="Open Role" />
            <InertStat iconSrc={`${ICON}/team-location-pin.svg`} label="Location" />
            {head && (
              <div className="flex items-center gap-2 pl-4">
                <PersonAvatar person={head} size={32} />
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-[#0F1F4D] truncate">{head.firstName} {head.lastName}</p>
                  <p className="text-[11px] text-[#6B7A99]">Department Head</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E6EBF2] shadow-sm flex flex-col flex-1">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 pt-3 border-b border-[#E6EBF2]">
            <div className="flex items-center gap-5 overflow-x-auto scrollbar-none">
              <button type="button" className="py-3 px-1 text-[14px] font-semibold text-[#1E6FF0] border-b-2 border-[#1E6FF0] whitespace-nowrap">
                Team Members ({activeDept.count})
              </button>
              <InertTab label="Open Roles" />
              <InertTab label="About" />
              <InertTab label="Projects" />
              <InertTab label="Documents" />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap px-4 py-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search team members..."
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                className="pl-8 pr-3 h-8 w-full border border-[#E6EBF2] rounded-lg text-[13px] focus:outline-none focus:border-[#1E6FF0] focus:ring-1 focus:ring-[#1E6FF0] text-[#0F1F4D] placeholder:text-slate-400"
              />
            </div>
            <span title="Coming soon" className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E6EBF2] text-[12.5px] font-semibold text-slate-300 cursor-not-allowed">
              <Filter size={13} /> Filter
            </span>
            <span title="Coming soon" className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E6EBF2] text-[12.5px] font-semibold text-slate-300 cursor-not-allowed">
              <ArrowUpDown size={13} /> Sort
            </span>
          </div>

          <div className="px-4 pb-4">
            {visibleMembers.length === 0 ? (
              <p className="text-[13px] text-slate-400 italic py-6 text-center">No team members match your search.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleMembers.map(emp => (
                  <MemberCard
                    key={emp._id}
                    emp={emp}
                    isHead={emp._id === head?._id}
                    isSelected={emp._id === selectedEmp}
                    onSelect={() => setSelectedEmp(emp._id)}
                    onMail={() => navigate(`/chat?user=${emp._id}`)}
                    onMore={(e) => openMemberActions(e, emp)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: insights, reporting structure, quick actions ───────── */}
      <div className="order-2 lg:order-3 flex flex-col gap-3">
        <div className="bg-white rounded-xl border border-[#E6EBF2] shadow-sm p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-[#0F1F4D]">Department Insights</h3>
            <span title="Not tracked yet" className="flex items-center gap-1 text-[12px] font-semibold text-slate-300 border border-[#E6EBF2] rounded-md px-2 py-1 cursor-not-allowed">
              This Month <ChevronDown size={13} />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <InsightTile iconSrc={`${ICON}/team-total-members.svg`} value={activeDept.count} label="Total Members"
              sub={presentCount ? `${presentCount} present today` : null} />
            <InsightTile iconSrc={`${ICON}/team-open-role-blue.svg`} value={null} label="Open Role" />
            <InsightTile iconSrc={`${ICON}/team-in-office-building.svg`} value={null} label="In Office" />
            <InsightTile iconSrc={`${ICON}/team-remote-home-green.svg`} value={null} label="Remote" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E6EBF2] shadow-sm p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-[#0F1F4D]">Reporting Structure</h3>
            <button type="button" onClick={() => navigate('/org-chart')} className="text-[12.5px] font-semibold text-[#1E6FF0] hover:underline flex items-center gap-1">
              View Full Structure <ChevronRight size={13} />
            </button>
          </div>
          {head ? (
            <div className="mt-3">
              <div className="flex items-center gap-2.5">
                <PersonAvatar person={head} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-[#0F1F4D] truncate">{head.firstName} {head.lastName}</p>
                  <p className="text-[11.5px] text-[#6B7A99] truncate">{head.designation || 'Employee'}</p>
                </div>
                <span className="text-[10.5px] font-semibold text-[#1E6FF0] bg-[#EAF2FF] px-2 py-0.5 rounded-full flex-shrink-0">Department Head</span>
              </div>
              {rest.length > 0 && (
                <div className="relative pl-5 ml-5 mt-3 border-l-2 border-dotted border-[#E6EBF2] space-y-3">
                  {rest.map(emp => (
                    <div key={emp._id} className="relative flex items-center gap-2.5">
                      <span className="absolute -left-[25px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#CBD5E1]" />
                      <div className="relative flex-shrink-0">
                        <PersonAvatar person={emp} size={40} />
                        {emp.presence === 'in' && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[#0F1F4D] truncate">{emp.firstName} {emp.lastName}</p>
                        <p className="text-[12px] text-[#6B7A99] truncate">{emp.designation || 'Employee'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-400 italic mt-3">No reporting data for this department yet.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#E6EBF2] shadow-sm p-4 flex-1">
          <h3 className="text-[15px] font-bold text-[#0F1F4D]">Quick Actions</h3>
          <div className="grid grid-cols-4 gap-2 mt-3">
            <QuickActionTile iconSrc={`${ICON}/team-add-member.svg`} label="Add Member" />
            <QuickActionTile iconSrc={`${ICON}/team-create-role.svg`} label="Create Role" />
            <QuickActionTile iconSrc={`${ICON}/team-view-reports.svg`} label="View Reports" />
            <QuickActionTile iconSrc={`${ICON}/team-department-settings.svg`} label="Department Settings" />
          </div>
        </div>
      </div>

      {hovered && (
        <HoverPopup
          emp={hovered.emp}
          totalMembers={hovered.totalCount || 0}
          directReports={hovered.directCount || 0}
          anchorRect={hovered.anchorRect}
          onMouseEnter={() => clearTimeout(closeTimerRef.current)}
          onMouseLeave={() => setHover(null)}
        />
      )}
    </div>
    </div>
  );
}

export default function OrgChart() {
  const isDark = useIsDark();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Path of expanded manager ids, in order. Clicking a card (or its badge)
  // toggles the node at the corresponding depth. Recursive collapse falls
  // out because we just truncate selectedPath at the toggle depth.
  const [selectedPath, setSelectedPath] = useState([]);
  /* Each column is its own scroll container, the way the reference does it:
   * the wheel moves whichever column the pointer is over, so you can run down
   * a long list of reports without the columns you are comparing it against
   * sliding away. The scroll positions have to be in React state because the
   * connector lines are drawn from them. */
  const colRefs = useRef([]);
  const [colScroll, setColScroll] = useState([]);
  /* Whether each column has anything above or below the fold, which is all
   * the chevrons need to know. Kept beside the scroll position because both
   * change together. */
  const [colEdges, setColEdges] = useState({});
  const readEdges = (el) => ({
    up: el.scrollTop > 1,
    down: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
  });
  const handleColScroll = (depth) => (e) => {
    const el = e.currentTarget;
    const top = el.scrollTop;
    // The hover card is anchored to a viewport rect captured when the pointer
    // arrived, so scrolling the card out from under it would leave it floating
    // over nothing.
    setHovered(null);
    const edges = readEdges(el);
    setColEdges(prev => (prev[depth] && prev[depth].up === edges.up && prev[depth].down === edges.down)
      ? prev : { ...prev, [depth]: edges });
    setColScroll(prev => {
      if (prev[depth] === top) return prev;
      const next = [...prev];
      next[depth] = top;
      return next;
    });
  };
  const nudgeColumn = (depth, dir) => {
    const el = colRefs.current[depth];
    if (!el) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ top: dir * Math.round(el.clientHeight * 0.8), behavior: reduced ? 'auto' : 'smooth' });
  };

  /* Measured row centres, per column, in that column's own content
   * coordinates. The connectors are drawn from these — see the note above
   * ChildrenColumn for why they are measured rather than calculated. */
  const stackRefs = useRef({});
  const [rowCenters, setRowCenters] = useState({});
  const [matchIdx, setMatchIdx] = useState(0);
  // Currently hovered card — drives the floating details popup. null while
  // no card is hovered. Set by EmployeeCard on mouse-enter (after ~150ms).
  const [hovered, setHovered] = useState(null);  // { emp, anchorRect, totalCount, directCount }
  // Grace-period timer so the user can move the cursor from the card down
  // into the popup without it disappearing en route. The popup itself
  // cancels this timer on mouse-enter and re-arms it on mouse-leave.
  const closeTimerRef = useRef(null);
  const setHover = (data) => {
    clearTimeout(closeTimerRef.current);
    if (data) {
      setHovered(data);
    } else {
      closeTimerRef.current = setTimeout(() => setHovered(null), 200);
    }
  };

  const location = useLocation();
  const navigate = useNavigate();
  // /dept-tree (org-wide) and /team/department (under Team) both render the
  // same two-column view; the only difference is the default-selected dept.
  const isDepartmentTree = location.pathname === '/dept-tree' || location.pathname === '/team/department';
  const [selectedDept, setSelectedDept] = useState(null);
  // Currently-clicked employee in the dept-tree right column. Drives the
  // blue connector overlay + card highlight. Cleared when the dept changes.
  const [selectedEmp, setSelectedEmp] = useState(null);

  useEffect(() => {
    // Role-open org directory (basic, non-sensitive fields) so the Employee Tree
    // and Department Tree render the FULL org for every role. Sensitive data and
    // edit actions remain behind their own RBAC guards.
    api.get('/org/directory')
       .then(r => setEmployees(r.data.data || []))
       .catch(console.error)
       .finally(() => setLoading(false));
  }, []);

  // Pre-select a sensible default once employees load:
  //   • /team/department → the logged-in user's own department
  //   • /dept-tree       → the first department in the list
  const { user } = useAuth();
  useEffect(() => {
    if (selectedDept || employees.length === 0) return;
    if (location.pathname === '/team/department' && user?.department) {
      setSelectedDept(user.department);
    } else {
      const first = employees.find(e => e.department)?.department;
      if (first) setSelectedDept(first);
    }
  }, [employees, location.pathname, user, selectedDept]);

  /* ── Index employees + relationships once per render ─────────────────── */
  const empMap     = Object.fromEntries(employees.map(e => [e._id, e]));
  const childrenOf = {};
  for (const e of employees) {
    const mgr = e.reportingManagerId;
    if (mgr && empMap[mgr]) (childrenOf[mgr] = childrenOf[mgr] || []).push(e);
  }
  const trueRoots = employees.filter(e => !e.reportingManagerId || !empMap[e.reportingManagerId]);
  // Some reporting_manager_id chains form cycles and are unreachable from any
  // true root. For each such component walk upward to find the cycle entry
  // point, sever its upward edge in childrenOf so navigation cannot loop,
  // then add it as a single extra root so the whole subtree stays visible.
  const reachable = new Set();
  const markFromRoot = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const child of (childrenOf[id] || [])) markFromRoot(child._id);
  };
  trueRoots.forEach(r => markFromRoot(r._id));
  const extraRoots = [];
  for (const emp of employees) {
    if (reachable.has(emp._id)) continue;
    // Walk upward until we revisit a node (cycle) or hit a reachable/null node.
    const seen = new Set();
    let cur = emp;
    let prev = null;
    while (cur && !reachable.has(cur._id) && !seen.has(cur._id)) {
      seen.add(cur._id);
      prev = cur;
      cur = cur.reportingManagerId ? empMap[cur.reportingManagerId] : null;
    }
    // cur is the first node revisited — its incoming edge from prev is the bad
    // upward pointer. Making cur the cycle root severs that edge.
    const cycleHead = (cur && seen.has(cur._id)) ? cur : (prev || emp);
    // Sever the upward edge so navigation does not loop.
    const mgrId = cycleHead.reportingManagerId;
    if (mgrId && childrenOf[mgrId]) {
      childrenOf[mgrId] = childrenOf[mgrId].filter(c => c._id !== cycleHead._id);
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[OrgChart] Circular reporting_manager_id chain detected — ${cycleHead.firstName} ${cycleHead.lastName} (${cycleHead.employeeId || cycleHead._id}) was re-parented as an extra root to break the loop. Fix their reporting manager in Employee Master.`
    );
    extraRoots.push(cycleHead);
    markFromRoot(cycleHead._id);
  }
  const roots = extraRoots.length ? [...trueRoots, ...extraRoots] : trueRoots;

  /* ── Subtree size per employee (matches what Zoho's tree shows).
       Walks descendants once, memoised — so a 200-person org is still O(N).
       computing Set guards against circular reporting_manager_id data so
       a cycle doesn't cause an infinite recursion / blank page. */
  const subtreeSize = {};
  const computing = new Set();
  const computeSubtree = (id) => {
    if (subtreeSize[id] != null) return subtreeSize[id];
    if (computing.has(id)) return 0; // cycle — treat as leaf
    computing.add(id);
    const kids = childrenOf[id] || [];
    let total = 0;
    for (const k of kids) total += 1 + computeSubtree(k._id);
    subtreeSize[id] = total;
    computing.delete(id);
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

  /* Everyone the search term names, anywhere in the org — not a filter over
     one column. See the navigation effect below for why that matters. */
  const matches = searchTerm.trim() ? employees.filter(filterMatch) : [];
  const matchIds = new Set(matches.map(e => e._id));

  /* The chain of managers above someone, root-first, which is exactly the
     shape selectedPath wants: expand each of these and the person lands in
     the final column. */
  const pathToEmployee = (id) => {
    const chain = [];
    const seen = new Set();
    let cur = empMap[id];
    while (cur && cur.reportingManagerId && empMap[cur.reportingManagerId] && !seen.has(cur._id)) {
      seen.add(cur._id);
      cur = empMap[cur.reportingManagerId];
      chain.unshift(cur._id);
    }
    return chain;
  };

  /* A root with no reports is not a tree — it is a person nobody reports to
     and who reports to nobody. Several are not people at all: the system
     Admin, a "Zoho ANXT HR" row left over from the migration, the demo
     accounts. They used to stand beside the CEO as peers. They are still
     listed, under the tree and behind a count, because a real employee with
     no manager set is a data problem worth seeing rather than hiding. */
  /* Everybody with no manager is a root card, including the accounts that are
     not people — the reference does exactly this: its own organisation node
     sits in the first column beside the CEO, with no line between them,
     because neither reports to the other. Pulling them out into a "not in any
     reporting line" note said something true about the data and drew a tree
     that did not match the one it was describing. */

  /* ── Build the visible columns from the expanded path ────────────────── */
  // Stop adding columns the moment we hit a leaf with no children — Zoho
  // simply doesn't render an empty "No reports" column at the end. This
  // also keeps the column count tight so the "last 2 full" rule resolves
  // the right columns to full cards.
  //
  // Columns are NOT filtered by the search term. Filtering them hid the
  // searched person's colleagues and, because the search box also cleared
  // the expanded path, left only the root column to filter — so searching
  // for anybody who was not a root returned "No employees". A tree search
  // reveals a person in place; it does not prune the tree around them.
  const columns = [];
  columns.push(roots);
  for (const selId of selectedPath) {
    const kids = childrenOf[selId] || [];
    if (kids.length === 0) break;
    columns.push(kids);
  }
  const expandedIds = new Set(selectedPath);

  /* Measure every visible row, after layout and before paint.
     Relative to each column's own stack element, so the numbers are
     independent of how far that column happens to be scrolled — the scroll
     term is applied separately, once, where the parent hook is drawn.
     A ResizeObserver repeats the measurement when a card changes height:
     a web font arriving, a longer designation wrapping, the 1.5px border the
     selected card takes. */
  const columnsSig = columns.map(c => c.map(e => e._id).join(',')).join('|');
  useLayoutEffect(() => {
    const measure = () => {
      const next = {};
      Object.entries(stackRefs.current).forEach(([depth, stack]) => {
        if (!stack || !stack.isConnected) return;
        const top = stack.getBoundingClientRect().top;
        next[depth] = Array.from(stack.querySelectorAll('[data-row]')).map(el => {
          const r = el.getBoundingClientRect();
          return r.top - top + r.height / 2;
        });
      });
      setRowCenters(prev => {
        const keys = Object.keys(next);
        const same = keys.length === Object.keys(prev).length && keys.every(k =>
          prev[k] && prev[k].length === next[k].length &&
          prev[k].every((v, i) => Math.abs(v - next[k][i]) < 0.5));
        return same ? prev : next;
      });
      const edges = {};
      colRefs.current.forEach((el, depth) => { if (el) edges[depth] = readEdges(el); });
      setColEdges(prev => {
        const keys = Object.keys(edges);
        const same = keys.length === Object.keys(prev).length && keys.every(k =>
          prev[k] && prev[k].up === edges[k].up && prev[k].down === edges[k].down);
        return same ? prev : edges;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    Object.values(stackRefs.current).forEach(el => el && ro.observe(el));
    colRefs.current.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [columnsSig, loading]);

  /* Typing in the search box opens the tree to the first person it names,
     rather than pruning the columns around them. Enter steps to the next
     match. */
  const matchSig = matches.map(e => e._id).join(',');
  useEffect(() => {
    if (!matches.length) return;
    setMatchIdx(0);
    setSelectedPath(pathToEmployee(matches[0]._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchSig]);

  const gotoMatch = (i) => {
    if (!matches.length) return;
    const next = ((i % matches.length) + matches.length) % matches.length;
    setMatchIdx(next);
    setSelectedPath(pathToEmployee(matches[next]._id));
  };

  // Click anywhere on a card (body or badge) toggles expansion of that
  // node at the given depth. Clicking an already-expanded node collapses
  // it and everything below; clicking a sibling at the same depth swaps
  // to that branch.
  const handleToggle = (depth, empId) => {
    // Columns to the right are about to hold different people, so whatever
    // they were scrolled to means nothing there — send them back to the top
    // rather than opening a branch already scrolled halfway down.
    for (let d = depth + 1; d < colRefs.current.length; d++) {
      if (colRefs.current[d]) colRefs.current[d].scrollTop = 0;
    }
    setColScroll(prev => prev.slice(0, depth + 1));
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

    // /team/department gets the restyled 3-column view (TeamDepartmentView,
    // defined above); /dept-tree (Organization's Department Tree) keeps the
    // exact existing two-column layout below, untouched — this redesign is
    // scoped to the Team tab only.
    if (location.pathname === '/team/department') {
      return (
        <TeamDepartmentView
          deptsList={deptsList}
          activeDept={activeDept}
          displayEmployees={displayEmployees}
          selectedDept={selectedDept}
          setSelectedDept={setSelectedDept}
          selectedEmp={selectedEmp}
          setSelectedEmp={setSelectedEmp}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          empMap={empMap}
          childrenOf={childrenOf}
          subtreeSize={subtreeSize}
          hovered={hovered}
          setHover={setHover}
          closeTimerRef={closeTimerRef}
          navigate={navigate}
        />
      );
    }

    // Geometry for the dept → employees connector lines. Mirrors the
    // Employee Tree spine/hook style: gray spine spanning all employees,
    // blue hook from the selected department, gray hooks to each employee.
    const COL_PAD_TOP   = 32;   // p-8 top padding inside each column
    const DEPT_PITCH    = 70;   // dept card 58 + gap-3 (12)
    const DEPT_HALF     = 29;
    const EMP_PITCH     = 74;   // emp card 58 + gap-4 (16)
    const EMP_HALF      = 29;
    const DEPT_RIGHT_X  = 348;  // left col card right edge (380 width − p-8)
    const SPINE_X       = 388;  // sits in the gap between columns
    const EMP_LEFT_X    = 412;  // right col card left edge (380 + p-8)

    const selectedDeptIdx = Math.max(0, deptsList.findIndex(d => d.name === activeDept?.name));
    const selectedDeptY   = COL_PAD_TOP + selectedDeptIdx * DEPT_PITCH + DEPT_HALF;
    const firstEmpY       = COL_PAD_TOP + EMP_HALF;
    const lastEmpY        = COL_PAD_TOP + Math.max(0, displayEmployees.length - 1) * EMP_PITCH + EMP_HALF;
    const spineTop        = Math.min(selectedDeptY, firstEmpY);
    const spineBottom     = Math.max(selectedDeptY, lastEmpY);

    return (
      <div className="bg-white border-t border-slate-200 flex flex-col max-h-[calc(100vh-120px)]">
        <div className="p-4 border-b border-slate-100 dark:border-[#374151] flex-shrink-0">
          <div className="relative max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, designation, dept..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-1.5 border border-slate-200 dark:border-[#374151] rounded text-base w-full focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="flex overflow-auto relative flex-1">
          <div className="w-[380px] p-8 border-r border-slate-100 flex flex-col gap-3 flex-shrink-0 dark:bg-[#111827] dark:border-[#374151]">
            {deptsList.map(dept => {
              const isActive = (activeDept?.name) === dept.name;
              return (
                <div
                  key={dept.name}
                  onClick={() => { setSelectedDept(dept.name); setSelectedEmp(null); }}
                  className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                    isActive ? 'border-[#3b82f6] shadow-[0_0_0_1px_rgba(59,130,246,0.2)]' : 'border-slate-100 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 flex items-center justify-center text-[14px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded dark:bg-[#1f2937] dark:border-[#374151] dark:text-slate-300">
                      {dept.prefix}
                    </div>
                    <span className="text-[15px] font-bold text-slate-800">{dept.name}</span>
                  </div>
                  <div className={`text-[14px] font-bold px-2.5 py-0.5 rounded border ${
                    isActive ? 'bg-[#3b82f6] text-white border-[#3b82f6]' : 'bg-white text-slate-500 border-slate-200 dark:bg-[#1f2937] dark:text-slate-300 dark:border-[#374151]'
                  }`}>
                    {dept.count}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tree connectors — SVG overlay. Matches Zoho: gray spine + gray
              hooks by default, blue accent only along the path from the
              selected department through to the clicked employee. */}
          {displayEmployees.length > 0 && (() => {
            const selectedEmpIdx = displayEmployees.findIndex(e => e._id === selectedEmp);
            const selectedEmpY = selectedEmpIdx >= 0
              ? COL_PAD_TOP + selectedEmpIdx * EMP_PITCH + EMP_HALF
              : null;
            return (
              <svg
                className="absolute pointer-events-none"
                style={{ left: 0, top: 0, width: EMP_LEFT_X + 16, height: spineBottom + 32, zIndex: 5 }}
              >
                {/* Gray vertical spine */}
                <line
                  x1={SPINE_X} y1={spineTop}
                  x2={SPINE_X} y2={spineBottom}
                  stroke={LINE_COLOR} strokeWidth={1}
                />
                {/* Blue spine segment from the dept row down to the selected
                    employee row — only drawn when an employee is selected. */}
                {selectedEmpY != null && (
                  <line
                    x1={SPINE_X} y1={Math.min(selectedDeptY, selectedEmpY)}
                    x2={SPINE_X} y2={Math.max(selectedDeptY, selectedEmpY)}
                    stroke={ACTIVE_COLOR} strokeWidth={2}
                  />
                )}
                {/* Blue hook from the selected department into the spine */}
                <line
                  x1={DEPT_RIGHT_X} y1={selectedDeptY}
                  x2={SPINE_X}      y2={selectedDeptY}
                  stroke={ACTIVE_COLOR} strokeWidth={2}
                />
                {/* Per-employee hooks: blue + thicker for the selected one,
                    gray + thin for the rest. */}
                {displayEmployees.map((emp, idx) => {
                  const empY = COL_PAD_TOP + idx * EMP_PITCH + EMP_HALF;
                  const isSel = emp._id === selectedEmp;
                  return (
                    <line
                      key={`hook-${idx}`}
                      x1={SPINE_X}    y1={empY}
                      x2={EMP_LEFT_X} y2={empY}
                      stroke={isSel ? ACTIVE_COLOR : LINE_COLOR}
                      strokeWidth={isSel ? 2 : 1}
                    />
                  );
                })}
              </svg>
            );
          })()}

          <div className="flex-1 p-8">
            <div className="flex flex-col gap-4 max-w-[320px]">
              {displayEmployees.map((emp, idx) => {
                // Click selects (drives the blue connector + card highlight),
                // hover surfaces the action popup. Navigation to the full
                // profile happens via the eye button INSIDE the popup —
                // matches Zoho's exact pattern.
                const isSel = emp._id === selectedEmp;
                const handleEnter = (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHover({
                    emp,
                    anchorRect: rect,
                    totalCount: subtreeSize[emp._id] || 0,
                    directCount: (childrenOf[emp._id] || []).length,
                  });
                };
                return (
                  <button
                    key={emp._id || idx}
                    type="button"
                    onClick={() => setSelectedEmp(emp._id)}
                    onMouseEnter={handleEnter}
                    onMouseLeave={() => setHover(null)}
                    className="flex items-center gap-4 p-2 rounded-lg hover:shadow-sm transition-all text-left"
                    style={{
                      borderWidth: isSel ? 1.5 : 1,
                      borderStyle: 'solid',
                      borderColor: isSel ? '#0088FF' : (isDark ? '#374151' : '#e2e8f0'),
                      background: isSel
                        ? (isDark ? '#1e3a5f' : '#eff6ff')
                        : (isDark ? '#1f2937' : '#ffffff'),
                    }}
                  >
                    <Avatar photoUrl={emp.photoUrl} size={40} />
                    <div>
                      <p className="text-[15px] font-bold text-slate-800">{emp.firstName} {emp.lastName}</p>
                      <p className="text-[13px] text-slate-400 mt-0.5">{emp.designation || 'Employee'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Hover popup — shared with the Employee Tree. Rendered here so
            dept-tree gets the same "click name → see profile, hover →
            see contact actions" pattern Zoho uses. */}
        {hovered && (
          <HoverPopup
            emp={hovered.emp}
            totalMembers={hovered.totalCount || 0}
            directReports={hovered.directCount || 0}
            anchorRect={hovered.anchorRect}
            onMouseEnter={() => clearTimeout(closeTimerRef.current)}
            onMouseLeave={() => setHover(null)}
          />
        )}
      </div>
    );
  }

  /* ── Employee Tree Render — column-based ─────────────────────────────── */
  return (
    <div className="bg-white dark:bg-[#1f2937] rounded-xl shadow-sm border border-slate-200 dark:border-[#374151] flex flex-col h-[calc(100vh-10rem)]">
      <div className="p-4 border-b border-slate-100 dark:border-[#374151] flex flex-wrap justify-between items-center gap-3 bg-white dark:bg-[#1f2937] z-10 rounded-t-xl">
        <div className="flex items-center gap-4 min-w-0">
          {/* The instruction is the first thing to go when the bar is tight:
              the search box is the one control here that does work. */}
          <p className="hidden md:block text-[15px] text-slate-500 dark:text-slate-400">
            Click a card to expand their direct reports. Hover for contact info.
          </p>
        </div>
        <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none justify-end">
          {searchTerm.trim() && (
            <span className="text-[13px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {matches.length === 0
                ? 'No matches'
                : `${matchIdx + 1} of ${matches.length}${matches.length > 1 ? ' · Enter for next' : ''}`}
            </span>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, designation, dept..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); gotoMatch(matchIdx + (e.shiftKey ? -1 : 1)); }
                if (e.key === 'Escape') setSearchTerm('');
              }}
              className="pl-9 pr-8 py-1.5 border border-slate-200 dark:border-[#374151] rounded text-base w-full sm:w-72 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Only the horizontal axis scrolls out here; the vertical axis belongs
          to each column so the wheel acts on the one under the pointer. */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 bg-[#f8f9fc]">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex items-stretch min-w-max h-full">
            {columns.map((colEmps, depth) => {
              // Ancestor compression: keep the last TWO columns as full
              // cards (the active card's row + its children). Everything
              // earlier in the path collapses to mini — matches Zoho.
              const isAncestor    = columns.length >= 3 && depth < columns.length - 2;
              const isRoot        = depth === 0;
              // Parent row in the previous column — drives the connector
              // hook's vertical position so the line visibly originates at
              // the expanded card's row. -1 means the parent is not on screen,
              // and then no hook is drawn at all: pointing it at row 0 was a
              // lie the old Math.max(0, …) told silently.
              const parentIndex = depth > 0
                ? columns[depth - 1].findIndex(e => e._id === selectedPath[depth - 1])
                : 0;
              const parentCenter = depth > 0 && parentIndex >= 0
                ? (rowCenters[depth - 1] || [])[parentIndex]
                : null;
              const edges = colEdges[depth] || {};

              return (
                /* py-6 lives on the scroller rather than the outer box so every
                   column starts at the same Y — the connector maths below
                   assumes the columns share a top edge.
                
                   The GUTTER is this column's left padding rather than a gap
                   between columns, because this column is what draws the line
                   across it. The hook back to the parent sits at
                   left:-HOOK_LEN inside the scroller, and `overflow-y: auto`
                   clips horizontally as well as vertically — so while the
                   gutter was a flex gap that hook fell outside the scroller
                   and was clipped away entirely. The spine and its stubs
                   survived because they sit at x >= 0, which is why the line
                   appeared to begin abruptly at the card and never reach the
                   count badge it came from. Carried as padding, the same hook
                   lands inside and the line is one piece again. */
                <div key={depth} className="relative h-full group/col">
                <div
                  ref={el => { colRefs.current[depth] = el; }}
                  onScroll={handleColScroll(depth)}
                  style={{ paddingLeft: depth ? COL_GAP : 0 }}
                  className="h-full overflow-y-auto scrollbar-none py-6"
                >
                  {isRoot ? (
                    // Root column: no connector (nothing on the left).
                    // Auto-size to card contents; just stack the cards.
                    <div className="flex flex-col"
                         ref={el => { stackRefs.current[depth] = el; }}
                         style={{ gap: isAncestor ? MINI_GAP : FULL_GAP }}>
                      {colEmps.length === 0 ? (
                        <p className="text-[14px] text-slate-400 italic">No employees</p>
                      ) : (
                        colEmps.map(emp => (
                          <div key={emp._id} data-row className="flex items-center">
                            <EmployeeCard
                              emp={emp}
                              mini={isAncestor}
                              isExpanded={expandedIds.has(emp._id)}
                              matched={matchIds.has(emp._id)}
                              totalCount={subtreeSize[emp._id] || 0}
                              directCount={(childrenOf[emp._id] || []).length}
                              onToggle={() => handleToggle(depth, emp._id)}
                              onHoverChange={setHover}
                            />
                            <CountBadge
                              count={subtreeSize[emp._id] || 0}
                              isExpanded={expandedIds.has(emp._id)}
                              mini={isAncestor}
                              onToggle={() => handleToggle(depth, emp._id)}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    colEmps.length === 0 ? (
                      <p className="text-[14px] text-slate-400 italic px-4 py-2">No reports</p>
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
                        matchIds={matchIds}
                        stackRef={el => { stackRefs.current[depth] = el; }}
                        centers={rowCenters[depth]}
                        parentCenter={parentCenter}
                        parentScrollDelta={(colScroll[depth] || 0) - (colScroll[depth - 1] || 0)}
                        onToggle={(empId) => handleToggle(depth, empId)}
                        onHoverChange={setHover}
                      />
                    )
                  )}
                </div>
                {/* Paging chevrons instead of a scrollbar: the reference puts
                    them above and below the column, showing on hover and only
                    when there is something past the fold. A native bar is
                    ~15px wide and the gutter between columns is 20px — the
                    same 20px the connector hook has to cross — so the bar sat
                    on top of the line it was meant to sit beside. */}
                {edges.up && (
                  <button type="button" aria-label="Scroll up" onClick={() => nudgeColumn(depth, -1)}
                    className="absolute top-0 left-1/2 -translate-x-1/2 z-10 w-7 h-5 flex items-center justify-center rounded-b bg-white/90 dark:bg-[#1f2937]/90 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shadow-sm opacity-0 group-hover/col:opacity-100 focus:opacity-100 transition-opacity">
                    <ChevronUp size={15} />
                  </button>
                )}
                {edges.down && (
                  <button type="button" aria-label="Scroll down" onClick={() => nudgeColumn(depth, 1)}
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 w-7 h-5 flex items-center justify-center rounded-t bg-white/90 dark:bg-[#1f2937]/90 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shadow-sm opacity-0 group-hover/col:opacity-100 focus:opacity-100 transition-opacity">
                    <ChevronDown size={15} />
                  </button>
                )}
                </div>
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
          onMouseEnter={() => clearTimeout(closeTimerRef.current)}
          onMouseLeave={() => setHover(null)}
        />
      )}
    </div>
  );
}
