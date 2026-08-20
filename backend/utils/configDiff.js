/* ── What actually changed in a settings section ───────────────────────────
 *  Configuration screens save the whole section as one object, so "somebody
 *  saved the attendance policy" is all the request itself tells you. That is
 *  not enough to answer the only question anyone ever asks afterwards — which
 *  number changed, and to what.
 *
 *  This compares the section before and after and returns one entry per leaf
 *  that moved, with a dotted path. Nested objects are walked; arrays are
 *  compared whole, because a reordered list of leave policies is a change but
 *  not a per-index one anybody would want to read.
 *
 *  Deliberately returns an empty list when nothing moved, so a save with no
 *  edits — which happens constantly, people press the button twice — writes no
 *  audit entry and does not bury the real changes.
 * ────────────────────────────────────────────────────────────────────────── */

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

// Undefined and null both mean "not set" once a section has been through
// JSON, and a field flipping between them is not a change worth recording.
const isUnset = (v) => v === undefined || v === null;

const same = (a, b) => {
  if (isUnset(a) && isUnset(b)) return true;
  if (isUnset(a) || isUnset(b)) return false;
  // 8 and "8" are the same setting: these come back from JSONB and from
  // numeric columns, and the two spellings must not read as an edit.
  if (typeof a !== 'object' && typeof b !== 'object') {
    if (typeof a === 'number' || typeof b === 'number') {
      const na = Number(a), nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    }
    return a === b;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * @param {object} before  the section as it was
 * @param {object} after   the section as it now is
 * @returns {Array<{field: string, from: *, to: *}>}
 */
function diffConfig(before, after) {
  const changes = [];

  const walk = (a, b, prefix) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of [...keys].sort()) {
      const path = prefix ? `${prefix}.${key}` : key;
      const av = (a || {})[key];
      const bv = (b || {})[key];

      if (isPlainObject(av) && isPlainObject(bv)) { walk(av, bv, path); continue; }
      if (same(av, bv)) continue;

      changes.push({
        field: path,
        from: av === undefined ? null : av,
        to: bv === undefined ? null : bv,
      });
    }
  };

  walk(before || {}, after || {}, '');
  return changes;
}

/** A one-line human summary, for a list that shows entries without expanding them. */
function summarise(changes, limit = 3) {
  if (!changes.length) return 'no changes';
  const shown = changes.slice(0, limit).map(c => c.field).join(', ');
  return changes.length > limit
    ? `${shown} and ${changes.length - limit} more`
    : shown;
}

module.exports = { diffConfig, summarise };
