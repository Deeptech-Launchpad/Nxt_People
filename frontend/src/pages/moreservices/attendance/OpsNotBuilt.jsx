import React from 'react';

/* Honest placeholder for a tab whose backend/UI has not been built yet —
 * same idiom as configKit's NotWired ("Saved, but not enforced yet") and
 * Operations.jsx's tile treatment ("Not built yet"): say so, rather than a
 * control or a page that looks live and quietly does nothing. */
export default function OpsNotBuilt({ title, description }) {
  return (
    <div className="text-center py-20 max-w-md mx-auto">
      <p className="text-[15px] font-medium text-slate-600 mb-1.5">{title}</p>
      <p className="text-[13.5px] text-slate-400 mb-3">{description}</p>
      <span className="inline-block text-[12px] text-amber-700 bg-amber-50 rounded px-2 py-1">Not built yet</span>
    </div>
  );
}
