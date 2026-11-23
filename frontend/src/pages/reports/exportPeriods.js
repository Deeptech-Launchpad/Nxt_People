// Shared "This Year / Last Year / Custom Date Range" presets for the
// employee-list exports added to Headcount, Employee Addition Trend and
// Employee Attrition Trend. Kept separate from each page's own chart-period
// control (Last N Years / Last N Months) so the export's date range can be
// picked independently of the chart without changing the chart's own
// filters or calculations.
const now = new Date();
const y = now.getFullYear();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

export const EXPORT_PERIOD_OPTIONS = [
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
  { key: 'lastYear', label: 'Last Year', value: range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)) },
  { key: 'custom', label: 'Custom Date Range', value: null },
];

export const DEFAULT_EXPORT_RANGE = EXPORT_PERIOD_OPTIONS[0].value;
