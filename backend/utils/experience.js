// Formats a calendar-accurate years/months/days breakdown (as produced by
// Postgres's age(), which already does leap-year-aware, real calendar-month
// arithmetic — not a 30-day approximation) into the "Total Experience" text
// shown on the Profile page.
//
// Pure and DB-free so it can be unit-tested directly; routes/profile.js
// supplies the three components from `age(COALESCE(exit_date, today), joining_date)`.
function formatExperience(years, months, days) {
  // age() returns SQL NULL (-> JS null here) when joining_date itself is
  // NULL. Number(null) is 0, not NaN, so that case has to be caught before
  // the Number() conversion below or a missing join date would silently
  // read as "0 day(s)" instead of no experience figure at all.
  if (years == null || months == null || days == null) return null;
  const y = Number(years), m = Number(months), d = Number(days);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const parts = [];
  if (y > 0) parts.push(`${y} year(s)`);
  if (m > 0) parts.push(`${m} month(s)`);
  if (d > 0) parts.push(`${d} day(s)`);
  return parts.length ? parts.join(' ') : '0 day(s)';
}

module.exports = { formatExperience };
