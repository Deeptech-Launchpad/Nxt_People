/**
 * Whether an employee is eligible for a given report YEAR — i.e. whether
 * they were actually employed at any point during it.
 *
 * Deliberately date-based, not `employees.status`-based: status is a
 * present-tense column (active/inactive right now), so gating on it would
 * wrongly hide someone from a historical year they were genuinely employed
 * in just because they've since resigned, and wrongly show someone in a
 * year before they ever joined just because they're active today.
 *
 * `joiningDate` here must already be the resolved join date — prefer
 * `date_of_joining` (the bulk-import column) over `joining_date` (defaults
 * to row-creation time for most existing employees and is unusable for
 * anything before that), the same precedence routes/reports.js's
 * booked-balance endpoint already established.
 */
function eligibleForYear({ joiningDate, exitDate }, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (joiningDate && String(joiningDate).slice(0, 10) > yearEnd) return false;
  if (exitDate && String(exitDate).slice(0, 10) < yearStart) return false;
  return true;
}

// SQL-side equivalent for list/search endpoints (the employee picker) —
// narrows to employees who were employed at any point during `year`.
function eligibleForYearClause(alias, year, paramIndex) {
  return {
    clause: ` AND COALESCE(${alias}.date_of_joining, ${alias}.joining_date::date) <= make_date($${paramIndex}::int, 12, 31)
              AND (${alias}.exit_date IS NULL OR ${alias}.exit_date >= make_date($${paramIndex}::int, 1, 1))`,
    params: [year],
  };
}

module.exports = { eligibleForYear, eligibleForYearClause };
