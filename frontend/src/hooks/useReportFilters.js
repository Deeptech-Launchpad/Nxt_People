import { useState } from 'react';

// Owns the four narrowing filters every Leave Tracker / Attendance report
// shares (single employee, employee status, direct-reportees, org-hierarchy
// chips) so each page doesn't re-declare the same four useStates, the same
// query-param assembly, and the same reset. `params()` produces exactly the
// query keys the backend's standardEmployeeFilters() reads.
export default function useReportFilters() {
  const [employee, setEmployee] = useState(null);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});

  // Scalar params only. Dimension filters are multi-select arrays and must be
  // appended one value at a time, so callers pass `dimFilters` through
  // appendDimensionFilters() after building their URLSearchParams.
  const params = () => ({
    employeeStatus,
    directReportsOnly: String(directReportsOnly),
    ...(employee ? { employeeId: employee._id } : {}),
  });

  const reset = () => {
    setEmployee(null);
    setEmployeeStatus('all');
    setDirectReportsOnly(false);
    setDimFilters({});
  };

  return {
    employee, setEmployee,
    employeeStatus, setEmployeeStatus,
    directReportsOnly, setDirectReportsOnly,
    dimFilters, setDimFilters,
    params, reset,
    // Spread into a useEffect dep array so any filter change refetches.
    deps: [employeeStatus, directReportsOnly, employee, dimFilters],
  };
}
