import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Small back button for child module pages.
 * Props:
 *   to   — explicit path to go back to (e.g. '/attendance').
 *          If omitted, goes browser-history back (-1).
 *   label — link label, defaults to "Back"
 */
export default function BackButton({ to, label = 'Back' }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 hover:text-blue-600 transition-colors group"
    >
      <ArrowLeft size={15} strokeWidth={2.2} className="flex-shrink-0 group-hover:-translate-x-0.5 transition-transform" />
      {label}
    </button>
  );
}
