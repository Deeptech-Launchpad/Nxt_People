/**
 * ApprovalTimeline
 * A clean, vertical, hierarchy-based approval timeline for a leave request.
 *
 * Data: `leave.approvalLevels` (from the backend) — one entry per level derived
 * from the Employee Tree at submission time:
 *   { level, status, onBehalf, byHr, actedAt, approverName, approverRole,
 *     approverEmail, actedByName, actedByRole }
 *
 * Presentation only — no workflow logic. Renders:
 *   • a status summary header (overall status + "N of M levels approved")
 *   • a "Leave Applied" origin node
 *   • one node per level: avatar, Level N, approver name + role, status pill,
 *     date/time, and the on-behalf / HR sub-label.
 *
 * Legacy leaves without approvalLevels fall back to a single status line.
 */
import React from 'react';
import { Rocket, Check, X, Clock } from 'lucide-react';
import { roleLabel } from '../utils/roles';

const initialsOf = (name) =>
  (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function fmtDateTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// Human-readable elapsed time (e.g. "5 Mins", "1 Hr 50 Mins", "2 Days").
function elapsedLabel(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} Min${mins !== 1 ? 's' : ''}`;
  const hrs = Math.floor(mins / 60), rm = mins % 60;
  if (hrs < 24) return `${hrs} Hr${hrs !== 1 ? 's' : ''}${rm ? ` ${rm} Min${rm !== 1 ? 's' : ''}` : ''}`;
  const days = Math.floor(hrs / 24), rh = hrs % 24;
  return `${days} Day${days !== 1 ? 's' : ''}${rh ? ` ${rh} Hr${rh !== 1 ? 's' : ''}` : ''}`;
}

// Visual tokens per status.
const TOKENS = {
  approved: { ring: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Check, label: 'Approved' },
  rejected: { ring: 'bg-rose-500',    soft: 'bg-rose-50 text-rose-700 border-rose-200',          Icon: X,     label: 'Rejected' },
  pending:  { ring: 'bg-amber-400',   soft: 'bg-amber-50 text-amber-700 border-amber-200',       Icon: Clock, label: 'Pending'  },
};

function StatusPill({ status }) {
  const t = TOKENS[status] || TOKENS.pending;
  const { Icon } = t;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${t.soft}`}>
      <Icon size={11} strokeWidth={2.5} /> {t.label}
    </span>
  );
}

// The "how it was actioned" sub-label for one level.
function actionNote(lvl) {
  const who = lvl.actedByName ? ` by ${lvl.actedByName}` : '';
  if (lvl.status === 'rejected') return lvl.byHr ? `Rejected on behalf by HR${who}` : `Rejected${who}`;
  if (lvl.status === 'approved') {
    if (lvl.byHr) return `Approved on behalf by HR${who}`;
    if (lvl.onBehalf) return `Approved on behalf of Level ${lvl.level}${who}`;
    return 'Approved';
  }
  return 'Awaiting approval';
}

export default function ApprovalTimeline({ leave, compact = false }) {
  if (!leave) return null;
  const levels = Array.isArray(leave.approvalLevels) ? leave.approvalLevels : [];

  const approvedCount = levels.filter(l => l.status === 'approved').length;
  const rejected = leave.status === 'rejected' || levels.some(l => l.status === 'rejected');
  const overall = rejected ? 'rejected' : (leave.status === 'approved' ? 'approved' : 'pending');

  // Total duration: submission → the last action (when resolved).
  const actedTimes = levels.map(l => l.actedAt).filter(Boolean).map(t => new Date(t).getTime());
  const lastActedAt = actedTimes.length ? new Date(Math.max(...actedTimes)).toISOString() : null;
  const isResolved = overall !== 'pending';
  const totalDuration = (isResolved && lastActedAt) ? elapsedLabel(leave.createdAt, lastActedAt) : null;

  return (
    <div className="flex flex-col">
      {/* Summary header — Total Duration + Status (Zoho-style) */}
      <div className="flex items-stretch gap-3 pb-4 mb-1">
        <div className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Total Duration</p>
          <p className="mt-1 text-[15px] font-bold text-slate-800">{totalDuration || (overall === 'pending' ? 'In progress' : '—')}</p>
          <p className="text-[10.5px] text-slate-400 mt-0.5">Submitted to {isResolved ? 'Completed' : 'now'}</p>
        </div>
        <div className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
          <div className="mt-1"><StatusPill status={overall} /></div>
          {levels.length > 0 && (
            <p className="text-[10.5px] text-slate-400 mt-1.5">{approvedCount} of {levels.length} level{levels.length !== 1 ? 's' : ''}</p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative pl-2">
        {/* origin: Leave Applied */}
        <div className="flex items-start gap-3 pb-4 relative">
          <div className="relative z-10 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Rocket size={14} />
          </div>
          <div className="min-w-0 pt-1">
            <p className="text-[13px] font-semibold text-slate-700">Request Submitted</p>
            <p className="text-[11.5px] text-slate-400">{fmtDateTime(leave.createdAt) || 'Submitted'}</p>
          </div>
          {(levels.length > 0) && <span className="absolute left-4 top-8 bottom-0 w-px bg-slate-200" />}
        </div>

        {levels.length === 0 ? (
          <div className="flex items-start gap-3 relative">
            <div className={`relative z-10 w-8 h-8 rounded-full ${TOKENS[overall].ring} text-white flex items-center justify-center flex-shrink-0`}>
              {React.createElement(TOKENS[overall].Icon, { size: 14, strokeWidth: 2.5 })}
            </div>
            <div className="pt-1"><StatusPill status={overall} /></div>
          </div>
        ) : (
          levels.map((lvl, i) => {
            const t = TOKENS[lvl.status] || TOKENS.pending;
            const when = fmtDateTime(lvl.actedAt);
            const isLast = i === levels.length - 1;
            return (
              <div key={lvl.level} className="flex items-start gap-3 pb-4 last:pb-0 relative">
                {/* connector */}
                {!isLast && <span className="absolute left-4 top-9 bottom-0 w-px bg-slate-200" />}
                {/* avatar */}
                <div className="relative z-10 flex-shrink-0">
                  <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center border border-slate-200">
                    {initialsOf(lvl.approverName)}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${t.ring}`} />
                </div>
                {/* details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                    <span className="text-[11px] font-bold text-slate-400">LEVEL {lvl.level}</span>
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{lvl.approverName || 'Not Assigned'}</span>
                    {lvl.approverRole && (
                      <span className="text-[10.5px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{roleLabel(lvl.approverRole)}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center flex-wrap gap-2">
                    <StatusPill status={lvl.status} />
                    {when && <span className="text-[11.5px] text-slate-400">{when}</span>}
                  </div>
                  {lvl.status !== 'pending' && (
                    <p className="mt-0.5 text-[11.5px] text-slate-500">{actionNote(lvl)}</p>
                  )}
                  {lvl.status !== 'pending' && elapsedLabel(leave.createdAt, lvl.actedAt) && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[10.5px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      <Clock size={10} /> Acted in {elapsedLabel(leave.createdAt, lvl.actedAt)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
