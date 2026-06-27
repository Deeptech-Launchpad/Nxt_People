/**
 * Weekend-rule evaluation.
 * Each rule mirrors a Google-Calendar-style recurrence so HR can declare
 * weekends without code changes. A date is a weekend if ANY active rule matches.
 *
 * Rule shape (matches /api/weekend-rules payload):
 *   {
 *     daysOfWeek:    ['sun', 'sat', ...],   // which weekdays the rule fires on
 *     weeksOfMonth:  [1, 3],                // [] / null = every week of the month
 *     intervalWeeks: 1,                     // repeat every N weeks
 *     startDate:     '2026-01-01',
 *     endType:       'never' | 'on' | 'after',
 *     endDate:       '2026-12-31' | null,
 *     endCount:      13 | null,             // total occurrences
 *     isActive:      true,
 *   }
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Make Date objects line up at local midnight so day-comparison is exact. */
function atMidnight(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Whole-day difference between two local midnights. */
function daysBetween(a, b) {
  return Math.round((atMidnight(b) - atMidnight(a)) / 86_400_000);
}

/** Nth occurrence of this weekday within `date`'s month. 1-based: 1, 2, 3, 4, 5. */
function weekOfMonthForWeekday(date) {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * Does `rule` make `date` a weekend?
 *
 * The rule's recurrence is interpreted as follows:
 *  - The rule is anchored at `startDate`. Only dates on or after start qualify.
 *  - The date's weekday must be in `daysOfWeek`.
 *  - If `weeksOfMonth` is non-empty, the date's position-of-weekday-in-month
 *    must be one of the listed values (1..5).
 *  - `intervalWeeks` skips weeks: the week-index from start (in 7-day steps)
 *    must be a multiple of `intervalWeeks`.
 *  - `endType` decides when the rule stops emitting weekends.
 */
export function ruleMatchesDate(rule, date) {
  if (!rule || rule.isActive === false) return false;
  const d = atMidnight(date);

  const start = rule.startDate ? atMidnight(new Date(rule.startDate)) : null;
  if (start && d < start) return false;

  // endType === 'on'
  if (rule.endType === 'on' && rule.endDate) {
    const end = atMidnight(new Date(rule.endDate));
    if (d > end) return false;
  }

  // endType === 'after' — count occurrences from start to (but not including) `d`.
  // Cheap upper bound check: if (d - start) / (interval * 7) > endCount, bail.
  if (rule.endType === 'after' && start && rule.endCount) {
    const weeksSinceStart = Math.floor(daysBetween(start, d) / 7);
    const occurrenceIndex = Math.floor(weeksSinceStart / Math.max(1, rule.intervalWeeks || 1)) + 1;
    if (occurrenceIndex > rule.endCount) return false;
  }

  // Weekday check.
  const dayKey = DAYS[d.getDay()];
  if (!Array.isArray(rule.daysOfWeek) || !rule.daysOfWeek.includes(dayKey)) return false;

  // Week-of-month filter (e.g. 1st & 3rd Saturday).
  if (Array.isArray(rule.weeksOfMonth) && rule.weeksOfMonth.length > 0) {
    const wom = weekOfMonthForWeekday(d);
    if (!rule.weeksOfMonth.includes(wom)) return false;
  }

  // Interval (every N weeks). Anchor on start_date's week.
  const interval = Math.max(1, rule.intervalWeeks || 1);
  if (interval > 1 && start) {
    const weeksDiff = Math.floor(daysBetween(start, d) / 7);
    if (weeksDiff % interval !== 0) return false;
  }

  return true;
}

/** Returns true if any active rule in the array applies to `date`. */
export function isWeekendByRules(date, rules) {
  if (!rules || !rules.length) return false;
  return rules.some(r => ruleMatchesDate(r, date));
}

/** Fallback used when the rules API hasn't loaded yet. Mirrors the legacy
 *  hardcoded rule (Sundays + 1st & 3rd Saturdays). */
export function legacyIsWeekend(date) {
  const d = new Date(date);
  const dow = d.getDay();
  if (dow === 0) return true;
  if (dow === 6) {
    const week = Math.floor((d.getDate() - 1) / 7) + 1;
    return week === 1 || week === 3;
  }
  return false;
}
