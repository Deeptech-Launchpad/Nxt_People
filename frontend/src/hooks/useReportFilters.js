import { useState } from 'react';
import { persistedEmployeeStatus } from '../pages/reports/EmployeeStatusFilter';

// Owns the four narrowing filters every Leave Tracker / Attendance report
// shares (single employee, employee status, direct-reportees, org-hierarchy
// chips) so each page doesn't re-declare the same four useStates, the same
// query-param assembly, and the same reset. `params()` produces exactly the
// query keys the backend's standardEmployeeFilters() reads.
export default function useReportFilters() {
  const [employee, setEmployee] = useState(null);
  // Starts from whatever was last persisted for this page rather than 'all',
  // so the very first fetch already carries the right filter — starting at
  // 'all' and correcting it a tick later raced this hook's own fetch effect,
  // and the loser of that race is whichever response happened to resolve last.
  const [employeeStatus, setEmployeeStatus] = useState(() => persistedEmployeeStatus() || 'all');
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
