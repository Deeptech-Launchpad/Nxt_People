/**
 * A permission request's duration is stored as decimal hours (1.1666... ->
 * 1.17, for a 70-minute gap) because that is what the monthly-cap SUM/compare
 * needs — but "1.17 hours" in an email reads like a typo of "1 hour 17",
 * when it is actually 1 hour 10 minutes. This only reformats the display; the
 * stored number, and every calculation against it, is untouched.
 */
function formatHoursDuration(decimalHours) {
  const totalMinutes = Math.round((Number(decimalHours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

module.exports = { formatHoursDuration };
