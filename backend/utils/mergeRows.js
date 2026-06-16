/**
 * mergeRows — collapse duplicate child-table rows that describe the SAME real
 * entry but arrived as several partial rows (e.g. the Zoho sync inserted one
 * row carrying the designation and a twin row carrying only the dates, both for
 * the same company + start date). Rows are grouped by a stable identity key and
 * each group is merged into ONE row, filling every field from whichever row in
 * the group has a non-blank value.
 *
 * Display-only: this never deletes anything from the DB — it just stops the
 * Profile page rendering the same entry twice. Insertion order is preserved, so
 * the caller's ORDER BY still holds.
 *
 * @param {object[]} rows   already-ordered rows from a SELECT
 * @param {(row:object)=>string} keyOf   identity of a real entry
 * @param {string[]} fields  columns to merge across duplicates
 */
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function mergeRows(rows, keyOf, fields) {
  if (!Array.isArray(rows)) return [];
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) { groups.set(key, { ...row }); continue; }
    const merged = groups.get(key);
    for (const f of fields) {
      if (isBlank(merged[f]) && !isBlank(row[f])) merged[f] = row[f];
    }
  }
  return [...groups.values()];
}

module.exports = { mergeRows, isBlank };
