/**
 * "Applicable to" — turning a criteria builder into a list of employees.
 *
 * Shared by the two ways a shift is given out, because they are the same
 * question asked twice:
 *   POST /shifts/:id/assign      the standing shift, until somebody changes it
 *   POST /roster/assign-range    a dated run of days
 *
 * Rows are OR-ed, not AND-ed — the reference's builder puts an OR bubble
 * between them and this follows it. "Department is Sales, Location is
 * Coimbatore" means everyone in Sales plus everyone in Coimbatore.
 *
 * The field name is looked up in a whitelist rather than interpolated. This is
 * the one place a criteria builder turns somebody's input into SQL, and a
 * column name arriving from the browser is not a thing to pass through.
 */

const COLUMN = {
  employee:    'e.id',
  department:  'e.department',
  designation: 'e.designation',
  location:    'e.work_location',
};

/**
 * @returns {Promise<{ ids: string[] } | { error: string }>}
 *   ids — distinct employee ids, active and not deleted.
 */
async function resolveTargets(db, { employeeIds, criteria } = {}) {
  // An explicit list wins. It is what the single-employee form sends, and it
  // needs no resolving.
  if (Array.isArray(employeeIds) && employeeIds.length) {
    return { ids: [...new Set(employeeIds.map(String))] };
  }

  if (!Array.isArray(criteria) || !criteria.length) {
    return { error: 'Choose who this shift applies to' };
  }

  const ors = [];
  const params = [];
  for (const c of criteria) {
    const col = COLUMN[c?.field];
    const values = (c?.values || []).filter(Boolean);
    if (!col || !values.length) continue;
    params.push(values);
    ors.push(col === 'e.id'
      ? `e.id = ANY($${params.length}::uuid[])`
      : `${col} = ANY($${params.length}::text[])`);
  }

  if (!ors.length) return { error: 'Choose who this shift applies to' };

  const found = await db.query(
    `SELECT id FROM employees e
      WHERE e.deleted_at IS NULL AND e.status = 'active' AND (${ors.join(' OR ')})`,
    params
  );
  return { ids: found.rows.map(r => String(r.id)) };
}

module.exports = { resolveTargets, CRITERIA_COLUMNS: COLUMN };
