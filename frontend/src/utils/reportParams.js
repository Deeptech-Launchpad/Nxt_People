// Dimension filters are multi-select, so each one holds an array of values.
// Spreading them into a URLSearchParams constructor would stringify an array
// as "a,b" and the backend would read that as one literal value, so every
// value has to be appended individually to produce `?department=a&department=b`.
export function appendDimensionFilters(params, dimFilters = {}) {
  Object.entries(dimFilters).forEach(([key, values]) => {
    // Experience is the one non-list dimension: it's a comparator object
    // {op, from, to}, so it serialises to its own three query keys rather
    // than a repeated value list.
    if (key === 'experience') {
      const e = values;
      if (e && e.op && e.from !== '' && e.from !== undefined && e.from !== null) {
        params.append('experienceOp', e.op);
        params.append('experienceFrom', e.from);
        if (e.op === 'between' && e.to !== '' && e.to !== undefined && e.to !== null) {
          params.append('experienceTo', e.to);
        }
      }
      return;
    }
    [].concat(values || []).filter(v => v !== '' && v !== undefined && v !== null)
      .forEach(v => params.append(key, v));
  });
  return params;
}
