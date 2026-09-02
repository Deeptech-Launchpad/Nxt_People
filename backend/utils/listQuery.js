/* The list-view query engine shared by Employees, Departments and Designations.
 *
 * All three tabs are the same screen with different columns: a filter panel
 * that builds criteria rows, sortable headers, and paging. Writing that three
 * times would guarantee they drift, so the SQL is built here from a per-module
 * FIELD REGISTRY and the routes only supply the registry.
 *
 * The registry is also the security boundary. A criteria row and a sort key
 * both arrive from the query string, and neither a column name nor an operator
 * can be passed as a bound parameter — they are concatenated into SQL. So
 * nothing is ever interpolated from user input: the field name is looked up in
 * the registry and the registry's own `column` is used, the operator is looked
 * up in OPERATORS, and only the VALUE is bound. An unknown field or operator is
 * dropped rather than guessed at.
 */

/* Operator -> SQL. `%s` is replaced by the column, `%p` by the next bind
 * placeholder. Kept as a closed table so a caller cannot invent one. */
const OPERATORS = {
  is:          { sql: (c, p) => `${c} = ${p}`,            args: 1 },
  is_not:      { sql: (c, p) => `${c} IS DISTINCT FROM ${p}`, args: 1 },
  contains:    { sql: (c, p) => `${c}::text ILIKE ${p}`,  args: 1, wrap: v => `%${v}%` },
  starts_with: { sql: (c, p) => `${c}::text ILIKE ${p}`,  args: 1, wrap: v => `${v}%` },
  before:      { sql: (c, p) => `${c} < ${p}`,            args: 1 },
  after:       { sql: (c, p) => `${c} > ${p}`,            args: 1 },
  gte:         { sql: (c, p) => `${c} >= ${p}`,           args: 1 },
  lte:         { sql: (c, p) => `${c} <= ${p}`,           args: 1 },
  between:     { sql: (c, a, b) => `${c} BETWEEN ${a} AND ${b}`, args: 2 },
  is_empty:    { sql: (c) => `(${c} IS NULL OR ${c}::text = '')`, args: 0 },
  is_not_empty:{ sql: (c) => `(${c} IS NOT NULL AND ${c}::text <> '')`, args: 0 },
};

/* Criteria arrive JSON-encoded in one query parameter because they are a list
 * of objects, and a malformed string must not take the page down — an empty
 * filter is a far better failure than a 500. */
function parseCriteria(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Build the WHERE fragment for a set of criteria rows.
 *
 * @param {object} fields  registry: { key: { column, type, sortable } }
 * @param {Array}  rows    [{ field, operator, value, value2 }]
 * @param {number} startIdx next free bind index
 * @returns {{clause: string, params: any[], nextIdx: number, applied: Array}}
 */
function buildCriteria(fields, rows, startIdx = 1) {
  const params = [];
  const parts = [];
  const applied = [];
  let idx = startIdx;

  for (const row of parseCriteria(rows)) {
    const def = fields[row?.field];
    const op = OPERATORS[row?.operator];
    if (!def || !op) continue;                    // unknown -> dropped, never guessed

    if (op.args === 0) {
      parts.push(op.sql(def.column));
      applied.push({ field: row.field, operator: row.operator });
      continue;
    }
    // An operator that needs a value but was given none would otherwise
    // produce `col = NULL`, which matches nothing and looks like a broken
    // filter rather than an unset one.
    if (row.value === undefined || row.value === null || row.value === '') continue;

    if (op.args === 2) {
      if (row.value2 === undefined || row.value2 === null || row.value2 === '') continue;
      parts.push(op.sql(def.column, `$${idx}`, `$${idx + 1}`));
      params.push(row.value, row.value2);
      idx += 2;
    } else {
      const v = op.wrap ? op.wrap(row.value) : row.value;
      parts.push(op.sql(def.column, `$${idx}`));
      params.push(v);
      idx += 1;
    }
    applied.push({ field: row.field, operator: row.operator, value: row.value, value2: row.value2 });
  }

  return {
    clause: parts.length ? ' AND ' + parts.join(' AND ') : '',
    params, nextIdx: idx, applied,
  };
}

/* ORDER BY cannot be parameterised, so the column comes from the registry and
 * never from the request. An unknown key falls back to the module default
 * rather than erroring — a bad sort should not blank the page. */
function buildOrder(fields, sortBy, sortDir, fallback) {
  const def = fields[sortBy];
  const column = def && def.sortable !== false ? def.column : fallback;
  const dir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // NULLS LAST in both directions so empty cells sink rather than filling the
  // first page with blanks the moment somebody sorts on an optional column.
  return `${column} ${dir} NULLS LAST`;
}

function buildPaging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  // 200 matches the largest option the per-page dropdown offers.
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { OPERATORS, parseCriteria, buildCriteria, buildOrder, buildPaging };
