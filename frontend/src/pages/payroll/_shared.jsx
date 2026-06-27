/**
 * Tiny shared utilities for the payroll pages — kept in one file so
 * the rupee formatting, month names, and status palette stay consistent
 * across every screen (admin run, payslip viewer, my payroll, team, etc.).
 */
import React from 'react';

export const MONTH_NAMES = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

export const SHORT_MONTHS = [
  '', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
];

export const fmtINR = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export const fmtINRshort = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000)   return `₹${(v / 100000).toFixed(2)} L`;
  if (v >= 1000)     return `₹${(v / 1000).toFixed(1)} K`;
  return `₹${v}`;
};

/** Coloured status badge used in every payslip table. */
export function StatusPill({ status }) {
  const map = {
    draft:  { bg: 'bg-slate-100',   fg: 'text-slate-700',   label: 'Draft'  },
    locked: { bg: 'bg-blue-50',     fg: 'text-blue-700',    label: 'Locked' },
    paid:   { bg: 'bg-emerald-50',  fg: 'text-emerald-700', label: 'Paid'   },
  };
  const s = map[status] || map.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] font-bold ${s.bg} ${s.fg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'paid' ? 'bg-emerald-500' : status === 'locked' ? 'bg-blue-500' : 'bg-slate-400'
      }`} />
      {s.label}
    </span>
  );
}

/** Current financial year string, India convention: 2026-27. */
export function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const fy = d.getMonth() >= 3 ? y : y - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** Stat card used at the top of nearly every payroll page. */
export function StatCard({ label, value, hint, color = 'text-slate-800', icon: Icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 relative overflow-hidden">
      {Icon && (
        <div className="absolute -right-2 -bottom-2 opacity-5">
          <Icon size={64} strokeWidth={1.2} />
        </div>
      )}
      <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 relative">{label}</p>
      <p className={`mt-1 text-[20px] font-bold relative ${color}`}>{value}</p>
      {hint && <p className="text-[13px] text-slate-400 mt-0.5 relative">{hint}</p>}
    </div>
  );
}
