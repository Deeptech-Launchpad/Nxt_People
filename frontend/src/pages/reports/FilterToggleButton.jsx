import React from 'react';
import { ListFilter } from 'lucide-react';

// Single filter icon (top-right of the panel) that toggles the filter
// controls open/closed — matches Zoho's collapsed-by-default filter panel
// instead of permanently showing the Period/Employment Type/dimension
// chips inline on the page.
export default function FilterToggleButton({ open, onClick }) {
  return (
    <button
      onClick={onClick}
      title="Filters"
      className={`p-2 rounded-lg border transition-colors ${open ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
    >
      <ListFilter size={16} />
    </button>
  );
}
