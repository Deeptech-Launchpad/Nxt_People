// Dimension filters are multi-select, so each one holds an array of values.
// Spreading them into a URLSearchParams constructor would stringify an array
// as "a,b" and the backend would read that as one literal value, so every
// value has to be appended individually to produce `?department=a&department=b`.
export function appendDimensionFilters(params, dimFilters = {}) {
  Object.entries(dimFilters).forEach(([key, values]) => {
    [].concat(values || []).filter(v => v !== '' && v !== undefined && v !== null)
      .forEach(v => params.append(key, v));
  });
  return params;
}
