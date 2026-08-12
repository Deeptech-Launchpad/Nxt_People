import React from 'react';
import FilterRow from './FilterRow';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import DirectReportsToggle from './DirectReportsToggle';

// The collapsible half of every report's filter panel, in Zoho's two-row
// grouping: direct-reportees toggle + org-hierarchy chips on one row, then
// Employee Status on its own. Rendered only when the funnel icon is open.
export default function StandardFilterRows({ f, showDirectReports = true, exclude = [], children }) {
  return (
    <>
      <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
        {showDirectReports && (
          <DirectReportsToggle value={f.directReportsOnly} onChange={f.setDirectReportsOnly} />
        )}
        {children}
        <FilterRow
          value={f.dimFilters}
          onChange={(k, v) => f.setDimFilters(prev => ({ ...prev, [k]: v }))}
          exclude={exclude}
        />
      </div>
      <div className="w-full flex flex-wrap items-center gap-1.5">
        <EmployeeStatusFilter value={f.employeeStatus} onChange={f.setEmployeeStatus} />
      </div>
    </>
  );
}
