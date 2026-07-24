// Single source of truth for the org's default timezone fallback.
// settings.timezone (DB) is the actual source of truth when set — this is
// only the fallback used before that row is read, or when it's NULL.
// Previously this string was duplicated as a literal in 6+ files; changing
// the default meant hunting down every occurrence.
const DEFAULT_TZ = 'Asia/Kolkata';

module.exports = { DEFAULT_TZ };
